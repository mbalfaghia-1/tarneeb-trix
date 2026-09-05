// Thin WebSocket layer over the pure Lobby. Each socket is associated with a player
// and (once they create/join) a table code; after every mutation the affected table
// is re-broadcast: the lobby state before the game starts, and each seat's redacted
// view afterward.
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby } from './lobby.js';
import type { ClientMsg, ServerMsg } from './protocol.js';

interface Conn {
  socket: WebSocket;
  playerId: string | null;
  code: string | null;
}

export function createGameServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const lobby = new Lobby();
  const conns = new Map<WebSocket, Conn>();

  const send = (socket: WebSocket, msg: ServerMsg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };
  const sockOf = (playerId: string): WebSocket | null => {
    for (const c of conns.values()) if (c.playerId === playerId) return c.socket;
    return null;
  };

  // Broadcast a table to everyone seated: lobby state pre-start, per-seat view after.
  const broadcast = (code: string) => {
    if (!lobby.hasTable(code)) return;
    if (lobby.isStarted(code)) {
      for (const h of lobby.humansOf(code)) {
        const view = lobby.viewFor(code, h.playerId);
        const sock = sockOf(h.playerId);
        if (view && sock) send(sock, { t: 'view', view });
      }
    } else {
      const state = lobby.lobbyState(code);
      for (const h of lobby.humansOf(code)) {
        const sock = sockOf(h.playerId);
        if (sock) send(sock, { t: 'lobby', state });
      }
    }
  };

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
      case 'start': {
        lobby.start(msg.code, msg.playerId);
        broadcast(msg.code);
        break;
      }
      case 'action': {
        lobby.submit(msg.code, msg.playerId, msg.action);
        broadcast(msg.code);
        break;
      }
      case 'leave': {
        lobby.leave(msg.code, msg.playerId);
        conn.code = null;
        broadcast(msg.code);
        break;
      }
      default:
        throw new Error('unknown message');
    }
  };

  wss.on('connection', (socket: WebSocket) => {
    const conn: Conn = { socket, playerId: null, code: null };
    conns.set(socket, conn);

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
      // Pre-start: free the seat so the table stays tidy. Post-start we keep the seat
      // (reconnection / bot-takeover is a later refinement).
      if (conn.code && conn.playerId && !lobby.isStarted(conn.code)) {
        const code = conn.code;
        lobby.leave(code, conn.playerId);
        broadcast(code);
      }
      conns.delete(socket);
    });
  });

  return wss;
}
