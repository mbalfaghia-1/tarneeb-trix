// Thin WebSocket layer over the pure Lobby. Each socket is associated with a player
// and (once they create/join) a table code; after every mutation the affected table
// is re-broadcast: the lobby state before the game starts, and each seat's redacted
// view afterward. Also serves a small HTTP GET /rankings endpoint off the same port
// (the web client fetches it directly; the game protocol itself stays WebSocket-only).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, GameKind, ServerMsg } from '@tarneeb/room';
import { Lobby } from './lobby.js';
import { openRankingsDb, type RankingsDb } from './db.js';
import { openAuthDb, type AuthDb } from './auth.js';
import { verifyGoogleIdToken } from './google.js';
import { createEmailSender, type EmailSender } from './email.js';

interface Conn {
  socket: WebSocket;
  playerId: string | null;
  code: string | null;
  queue: { game: GameKind; partnership: boolean } | null;
  /** Set once this connection sends a valid 'authenticate' message. When set, every other
   *  message's playerId must match it — see the guard at the top of handle(). */
  accountId: string | null;
}

/** How long a quick-match waits for more humans before filling seats with bots. */
const MATCH_WAIT_MS = 15000;
/** How long a human has to act before the server auto-plays their turn (bot brain). */
const TURN_TIMEOUT_MS = 5000;
const NEEDED = 4;

// Online pacing. Bots resolve at once within a deal (fast); the only server-side pause is
// the between-deals score summary. BOT_STEP is used only by the dormant fully-paced path.
const BOT_STEP_MS = 350;
const DEAL_PAUSE_MS = 2800;

/** Where the rankings/auth DBs live: a real file by default (override via DB_PATH, e.g.
 *  the Fly volume mount), or ':memory:' for tests so they never touch disk / share state. */
function defaultDbPath(): string {
  return process.env.DB_PATH ?? './data/rankings.db';
}

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10; // signup/login/google attempts per IP per window — scrypt is deliberately expensive

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk;
      if (data.length > 10_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        const parsed: unknown = data ? JSON.parse(data) : {};
        resolve(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function verifyEmailHtml(link: string): string {
  return `<p>Welcome to Tarneeb &amp; Trix! Click the link below to verify your email address:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>`;
}

function resetPasswordHtml(link: string): string {
  return `<p>We received a request to reset your Tarneeb &amp; Trix password. Click the link below to choose a new one:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email.</p>`;
}

export function createGameServer(port: number, dbPath: string = defaultDbPath()): WebSocketServer {
  const db: RankingsDb = openRankingsDb(dbPath);
  const authDb: AuthDb = openAuthDb(dbPath);
  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const emailSender: EmailSender = createEmailSender();
  // Where the web app lives — used to build the links inside verify/reset emails.
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const recordedResults = new Set<string>(); // table codes already written, so pump() can't double-record

  const rateLimits = new Map<string, { count: number; windowStart: number }>();
  const rateLimitSweep = setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
    for (const [ip, entry] of rateLimits) if (entry.windowStart < cutoff) rateLimits.delete(ip);
  }, RATE_LIMIT_WINDOW_MS);
  rateLimitSweep.unref?.();
  const checkRateLimit = (ip: string): boolean => {
    const now = Date.now();
    const entry = rateLimits.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimits.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= RATE_LIMIT_MAX;
  };

  const handleHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // JSON bodies + a custom Authorization header force the browser to preflight —
    // every /auth/* call is silently blocked without this.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://x');

    if (req.method === 'GET' && url.pathname === '/rankings') {
      const game = url.searchParams.get('game') as GameKind | null;
      const rows = db.leaderboard(game && game !== ('' as GameKind) ? game : null);
      sendJson(res, 200, { players: rows });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/me') {
      const token = bearerToken(req);
      const account = token ? authDb.resolveSession(token) : null;
      if (!account) {
        sendJson(res, 401, { error: 'invalid' });
        return;
      }
      sendJson(res, 200, { account });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      const token = bearerToken(req);
      if (token) authDb.deleteSession(token); // best-effort, idempotent either way
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/auth/signup' || url.pathname === '/auth/login')) {
      if (!checkRateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rateLimited' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalidInput', message: 'malformed request body' });
        return;
      }
      const email = str(body.email);
      const password = str(body.password);
      const result =
        url.pathname === '/auth/signup'
          ? await authDb.signupPassword(email, password, str(body.name))
          : await authDb.loginPassword(email, password);
      if (result.kind !== 'ok') {
        const status = result.kind === 'invalidInput' ? 400 : result.kind === 'emailTaken' ? 409 : 401;
        sendJson(res, status, result);
        return;
      }
      if (url.pathname === '/auth/signup') {
        // Fire-and-verify: send immediately, but never fail the signup itself over it —
        // emailSender.send() already swallows its own errors and returns false, so this
        // is safe to await without extra try/catch.
        const { token } = authDb.createToken(result.account.accountId, 'verify');
        await emailSender.send(
          result.account.email,
          'Verify your email — Tarneeb & Trix',
          verifyEmailHtml(`${webOrigin}/?verify=${token}`),
        );
      }
      const session = authDb.createSession(result.account.accountId);
      sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, account: result.account });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/google') {
      if (!checkRateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rateLimited' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalidInput', message: 'malformed request body' });
        return;
      }
      const idToken = str(body.idToken);
      const identity = idToken && googleClientId ? await verifyGoogleIdToken(idToken, googleClientId) : null;
      if (!identity) {
        sendJson(res, 401, { error: 'invalidToken' });
        return;
      }
      const result = authDb.findOrCreateGoogleAccount(identity.sub, identity.email, identity.name);
      if (result.kind !== 'ok') {
        sendJson(res, 409, result);
        return;
      }
      const session = authDb.createSession(result.account.accountId);
      sendJson(res, 200, {
        token: session.token,
        expiresAt: session.expiresAt,
        account: result.account,
        isNew: result.isNew,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/resend-verification') {
      if (!checkRateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rateLimited' });
        return;
      }
      const token = bearerToken(req);
      const account = token ? authDb.resolveSession(token) : null;
      if (!account) {
        sendJson(res, 401, { error: 'invalid' });
        return;
      }
      if (account.emailVerified) {
        sendJson(res, 200, { alreadyVerified: true });
        return;
      }
      const { token: verifyToken } = authDb.createToken(account.accountId, 'verify');
      await emailSender.send(
        account.email,
        'Verify your email — Tarneeb & Trix',
        verifyEmailHtml(`${webOrigin}/?verify=${verifyToken}`),
      );
      sendJson(res, 200, { sent: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/verify-email') {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalidInput', message: 'malformed request body' });
        return;
      }
      const accountId = authDb.consumeToken(str(body.token), 'verify');
      if (!accountId) {
        sendJson(res, 400, { error: 'invalidToken' });
        return;
      }
      authDb.markEmailVerified(accountId);
      const account = authDb.getAccountById(accountId);
      sendJson(res, 200, { verified: true, account });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/forgot-password') {
      if (!checkRateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rateLimited' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalidInput', message: 'malformed request body' });
        return;
      }
      const account = authDb.getAccountByEmail(str(body.email));
      if (account) {
        const { token: resetToken } = authDb.createToken(account.accountId, 'reset');
        await emailSender.send(
          account.email,
          'Reset your password — Tarneeb & Trix',
          resetPasswordHtml(`${webOrigin}/?reset=${resetToken}`),
        );
      }
      // Always 200, whether or not the email was registered — an endpoint that answers
      // differently either way could be used to check who has an account.
      sendJson(res, 200, { sent: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/reset-password') {
      if (!checkRateLimit(clientIp(req))) {
        sendJson(res, 429, { error: 'rateLimited' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalidInput', message: 'malformed request body' });
        return;
      }
      const newPassword = str(body.newPassword);
      if (newPassword.length < 8) {
        // Validate BEFORE touching the token — it's single-use, so a client-side-
        // preventable error shouldn't burn it and force requesting a new email.
        sendJson(res, 400, { error: 'invalidInput', message: 'password must be at least 8 characters' });
        return;
      }
      const accountId = authDb.consumeToken(str(body.token), 'reset');
      if (!accountId) {
        sendJson(res, 400, { error: 'invalidToken' });
        return;
      }
      await authDb.setPassword(accountId, newPassword);
      authDb.deleteAllSessions(accountId); // the old password could be why a reset was needed
      const account = authDb.getAccountById(accountId);
      if (!account) {
        sendJson(res, 500, { error: 'internal' });
        return;
      }
      const session = authDb.createSession(accountId); // sign them in immediately post-reset
      sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, account });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  };

  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
    });
  });
  const wss = new WebSocketServer({ server: httpServer });
  // `ws` does NOT close an externally-provided server on wss.close() (it may be shared) —
  // cascade it ourselves so callers can still just call wss.close() like before.
  wss.on('close', () => {
    httpServer.close();
    clearInterval(rateLimitSweep);
    db.close();
    authDb.close();
  });
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
    // terminal — record the result for rankings (once) and schedule nothing further.
    if (!recordedResults.has(code)) {
      recordedResults.add(code);
      const result = lobby.gameResult(code);
      if (result) db.recordGame(result);
    }
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
    // Once a connection has authenticated, every other message must claim the SAME
    // playerId as the account it authenticated as — otherwise a signed-in connection
    // could spoof another player's stable id on the public leaderboard. Guests (who never
    // send 'authenticate') are entirely unaffected: conn.accountId stays null forever.
    if (conn.accountId !== null && msg.t !== 'authenticate' && msg.playerId !== conn.accountId) {
      throw new Error('playerId does not match the authenticated account');
    }
    switch (msg.t) {
      case 'authenticate': {
        const account = authDb.resolveSession(msg.sessionToken);
        if (!account) {
          send(conn.socket, { t: 'error', message: 'invalid or expired session' });
          break;
        }
        conn.accountId = account.accountId;
        break;
      }
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
    const conn: Conn = { socket, playerId: null, code: null, queue: null, accountId: null };
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

  httpServer.listen(port);
  return wss;
}
