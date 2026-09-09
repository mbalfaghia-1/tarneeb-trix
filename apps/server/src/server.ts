// Thin WebSocket layer over the pure Lobby. Each socket is associated with a player
// and (once they create/join) a table code; after every mutation the affected table
// is re-broadcast: the lobby state before the game starts, and each seat's redacted
// view afterward.
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, GameKind, ServerMsg } from '@tarneeb/room';
import { Lobby } from './lobby.js';

interface Conn {
  socket: WebSocket;
  playerId: string | null;
  code: string | null;
  queue: { game: GameKind; partnership: boolean } | null;
}

/** How long a quick-match waits for more humans before filling seats with bots. */
const MATCH_WAIT_MS = 15000;
/** How long a human has to act before the server auto-plays their turn (bot brain). */
const TURN_TIMEOUT_MS = 25000;
const NEEDED = 4;

// Online pacing. Bots resolve at once within a deal (fast); the only server-side pause is
// the between-deals score summary. BOT_STEP is used only by the dormant fully-paced path.
const BOT_STEP_MS = 350;
const DEAL_PAUSE_MS = 2800;

export function createGameServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const lobby = new Lobby();
  const conns = new Map<WebSocket, Conn>();
  const matchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const stepTimers = new Map<string, ReturnType<typeof setTimeout>>(); // paced bot/auto stepping
  const bucket = (game: GameKind, partnership: boolean) => `${game}:${partnership ? 1 : 0}`;

  const send = (socket: WebSocket, msg: ServerMsg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const connOf = (playerId: string): Conn | null => {
    for (const c of conns.values()) if (c.playerId === playerId) return c;
    return null;
  };
  const sockOf = (playerId: string): WebSocket | null => connOf(playerId)?.socket ?? null;

  const clearTurnTimer = (code: string) => {
    const tm = turnTimers.get(code);
    if (tm) {
      clearTimeout(tm);
      turnTimers.delete(code);
    }
  };
  const clearStepTimer = (code: string) => {
    const tm = stepTimers.get(code);
    if (tm) {
      clearTimeout(tm);
      stepTimers.delete(code);
    }
  };
  // Arm a per-table turn timer while a human is on turn; on expiry the server auto-plays
  // that turn with the bot brain, so a slow or disconnected player never stalls the game.
  function armTurnTimer(code: string) {
    clearTurnTimer(code);
    if (lobby.awaitingHumanSeat(code) === null) return; // bot turn / terminal
    turnTimers.set(
      code,
      setTimeout(() => {
        turnTimers.delete(code);
        if (lobby.forceTurn(code)) pump(code); // played the stalled turn → resume pacing
      }, TURN_TIMEOUT_MS),
    );
  }

  // Only send a table's messages to a player whose connection is currently attached
  // to *this* table. A player can still be seated at an old table they navigated away
  // from (e.g. tapped Menu, then quick-matched into a new game); without this guard the
  // old table's turn-timer broadcasts would clobber the new game's view on their socket.
  const sockAt = (playerId: string, code: string): WebSocket | null => {
    const c = connOf(playerId);
    return c && c.code === code ? c.socket : null;
  };

  // Broadcast a table to everyone seated: lobby state pre-start, per-seat view after.
  // Send-only — pacing/turn timers are driven by pump().
  const broadcast = (code: string) => {
    if (!lobby.hasTable(code)) return;
    if (lobby.isStarted(code)) {
      for (const h of lobby.humansOf(code)) {
        const view = lobby.viewFor(code, h.playerId);
        const sock = sockAt(h.playerId, code);
        if (view && sock) send(sock, { t: 'view', code, view });
      }
    } else {
      const state = lobby.lobbyState(code);
      for (const h of lobby.humansOf(code)) {
        const sock = sockAt(h.playerId, code);
        if (sock) send(sock, { t: 'lobby', state });
      }
    }
  };

  // Broadcast the current position, then — for a started table — decide what happens next.
  // In holdDeals mode bot turns within a deal are already settled, so the only wait is a
  // human's turn (arm the turn timer) or a deal/hand boundary (hold the summary briefly,
  // then resume the next deal at once). The 'bot' branch only fires for a fully-paced room
  // (unused today). Re-entrant-safe: clears any pending step/turn timer first.
  function pump(code: string) {
    clearStepTimer(code);
    clearTurnTimer(code);
    if (!lobby.hasTable(code)) return;
    broadcast(code);
    if (!lobby.isStarted(code)) return;
    const next = lobby.peekNext(code);
    if (next === 'human') {
      armTurnTimer(code);
      return;
    }
    if (next === 'auto') {
      // Between-deals summary is now on screen; hold it, then advance past the boundary.
      stepTimers.set(
        code,
        setTimeout(() => {
          stepTimers.delete(code);
          if (!lobby.hasTable(code)) return;
          lobby.resumeDeal(code); // apply NEXT_DEAL/NEXT_HAND + settle the next deal at once
          pump(code);
        }, DEAL_PAUSE_MS),
      );
      return;
    }
    if (next === 'bot') {
      stepTimers.set(
        code,
        setTimeout(() => {
          stepTimers.delete(code);
          if (!lobby.hasTable(code)) return;
          lobby.stepAuto(code);
          pump(code);
        }, BOT_STEP_MS),
      );
      return;
    }
    // terminal — nothing to schedule
  }

  const broadcastQueue = (game: GameKind, partnership: boolean) => {
    const players = lobby.queuedPlayers(game, partnership);
    const names = players.map((h) => h.name);
    for (const h of players) {
      const sock = sockOf(h.playerId);
      if (sock) send(sock, { t: 'queued', game, partnership, size: players.length, needed: NEEDED, names });
    }
  };

  const clearTimer = (game: GameKind, partnership: boolean) => {
    const key = bucket(game, partnership);
    const tm = matchTimers.get(key);
    if (tm) {
      clearTimeout(tm);
      matchTimers.delete(key);
    }
  };
  const armTimer = (game: GameKind, partnership: boolean) => {
    const key = bucket(game, partnership);
    if (matchTimers.has(key)) return;
    matchTimers.set(
      key,
      setTimeout(() => {
        matchTimers.delete(key);
        tryMatch(game, partnership, true);
      }, MATCH_WAIT_MS),
    );
  };

  // Form a match when the queue is full (or forced, filling the rest with bots);
  // otherwise just refresh everyone's "finding players (n/4)" status.
  function tryMatch(game: GameKind, partnership: boolean, force: boolean) {
    const size = lobby.queueSize(game, partnership);
    if (size === 0) {
      clearTimer(game, partnership);
      return;
    }
    if (size >= NEEDED || force) {
      const m = lobby.formMatch(game, partnership);
      if (m) {
        for (const h of m.humans) {
          const c = connOf(h.playerId);
          if (c) {
            c.code = m.code;
            c.queue = null;
          }
        }
        pump(m.code); // begin paced play (opening bot moves stepped, then first human)
      }
      if (lobby.queueSize(game, partnership) > 0) armTimer(game, partnership);
      else clearTimer(game, partnership);
    } else {
      broadcastQueue(game, partnership);
      armTimer(game, partnership);
    }
  }

  const handle = (conn: Conn, msg: ClientMsg) => {
    switch (msg.t) {
      case 'create': {
        const code = lobby.createTable(
          { playerId: msg.playerId, name: msg.name },
          msg.game,
          msg.partnership ?? false,
        );
        conn.playerId = msg.playerId;
        conn.code = code;
        broadcast(code);
        break;
      }
      case 'join': {
        lobby.join(msg.code, { playerId: msg.playerId, name: msg.name });
        conn.playerId = msg.playerId;
        conn.code = msg.code;
        broadcast(msg.code);
        break;
      }
      case 'hello': {
        // A reconnected socket re-attaches to its player + table and gets the current state.
        if (!lobby.hasTable(msg.code) || lobby.seatOf(msg.code, msg.playerId) === null) {
          send(conn.socket, { t: 'error', message: 'table not found' });
          break;
        }
        conn.playerId = msg.playerId;
        conn.code = msg.code;
        if (lobby.isStarted(msg.code)) {
          const view = lobby.viewFor(msg.code, msg.playerId);
          if (view) send(conn.socket, { t: 'view', code: msg.code, view });
        } else {
          send(conn.socket, { t: 'lobby', state: lobby.lobbyState(msg.code) });
        }
        break;
      }
      case 'start': {
        lobby.start(msg.code, msg.playerId);
        pump(msg.code);
        break;
      }
      case 'action': {
        lobby.submit(msg.code, msg.playerId, msg.action);
        pump(msg.code);
        break;
      }
      case 'leave': {
        lobby.leave(msg.code, msg.playerId);
        conn.code = null;
        pump(msg.code);
        break;
      }
      case 'quickmatch': {
        const partnership = msg.partnership ?? false;
        conn.playerId = msg.playerId;
        conn.queue = { game: msg.game, partnership };
        lobby.enqueue(msg.game, partnership, { playerId: msg.playerId, name: msg.name });
        tryMatch(msg.game, partnership, false);
        break;
      }
      case 'matchnow': {
        const partnership = msg.partnership ?? false;
        tryMatch(msg.game, partnership, true);
        break;
      }
      case 'cancelmatch': {
        const partnership = msg.partnership ?? false;
        lobby.dequeue(msg.game, partnership, msg.playerId);
        conn.queue = null;
        broadcastQueue(msg.game, partnership);
        break;
      }
      default:
        throw new Error('unknown message');
    }
  };

  // Tell everyone how many players are currently connected (a lightweight "N online").
  const broadcastPresence = () => {
    const online = conns.size;
    for (const c of conns.values()) send(c.socket, { t: 'presence', online });
  };

  wss.on('connection', (socket: WebSocket) => {
    const conn: Conn = { socket, playerId: null, code: null, queue: null };
    conns.set(socket, conn);
    broadcastPresence();

    socket.on('message', (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        send(socket, { t: 'error', message: 'invalid JSON' });
        return;
      }
      try {
        handle(conn, msg);
      } catch (err) {
        send(socket, { t: 'error', message: err instanceof Error ? err.message : 'error' });
      }
    });

    socket.on('close', () => {
      // Drop out of any matchmaking queue.
      if (conn.queue && conn.playerId) {
        const { game, partnership } = conn.queue;
        lobby.dequeue(game, partnership, conn.playerId);
        broadcastQueue(game, partnership);
      }
      // Pre-start: free the seat so the table stays tidy. Post-start we keep the seat
      // (reconnection / bot-takeover is a later refinement).
      if (conn.code && conn.playerId && !lobby.isStarted(conn.code)) {
        const code = conn.code;
        lobby.leave(code, conn.playerId);
        broadcast(code);
      }
      conns.delete(socket);
      broadcastPresence();
    });
  });

  return wss;
}
