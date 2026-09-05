import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { getLegalActions, type TarneebState } from '@tarneeb/engine';
import { createGameServer } from './server.js';
import type { ClientMsg, ServerMsg } from './protocol.js';

const connect = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });

const send = (ws: WebSocket, m: ClientMsg) => ws.send(JSON.stringify(m));

function nextMsg(ws: WebSocket, match: (m: ServerMsg) => boolean, timeout = 3000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', on);
      reject(new Error('timeout waiting for message'));
    }, timeout);
    const on = (data: unknown) => {
      const m = JSON.parse(String(data)) as ServerMsg;
      if (match(m)) {
        clearTimeout(timer);
        ws.off('message', on);
        resolve(m);
      }
    };
    ws.on('message', on);
  });
}

describe('game server over WebSocket', () => {
  it('two clients create/join/start and play a move, with redacted views', async () => {
    const wss = createGameServer(0);
    const port = (wss.address() as AddressInfo).port;
    try {
      const a = await connect(port);
      const b = await connect(port);

      send(a, { t: 'create', playerId: 'A', name: 'A', game: 'tarneeb' });
      const created = (await nextMsg(a, (m) => m.t === 'lobby')) as Extract<ServerMsg, { t: 'lobby' }>;
      const code = created.state.code;
      expect(created.state.seats[0]!.kind).toBe('human');

      send(b, { t: 'join', playerId: 'B', name: 'B', code });
      const lob = (await nextMsg(
        b,
        (m) => m.t === 'lobby' && !m.state.started,
      )) as Extract<ServerMsg, { t: 'lobby' }>;
      expect(lob.state.seats.filter((s) => s.kind === 'human').length).toBe(2);

      // Start → both receive their own redacted view.
      const aViewP = nextMsg(a, (m) => m.t === 'view');
      const bViewP = nextMsg(b, (m) => m.t === 'view');
      send(a, { t: 'start', playerId: 'A', code });
      const av = (await aViewP) as Extract<ServerMsg, { t: 'view' }>;
      const bv = (await bViewP) as Extract<ServerMsg, { t: 'view' }>;
      expect(av.view.seat).toBe(0);
      expect(bv.view.seat).toBe(1);
      expect((av.view.state as TarneebState).hands[1]!.length).toBe(0); // A can't see B's cards

      // Whichever human is on turn plays a legal move; an updated view comes back.
      const actor = av.view.yourTurn ? { ws: a, pid: 'A', view: av.view } : { ws: b, pid: 'B', view: bv.view };
      const legal = getLegalActions(actor.view.state as TarneebState);
      const updated = nextMsg(actor.ws, (m) => m.t === 'view');
      send(actor.ws, { t: 'action', playerId: actor.pid, code, action: legal[0] });
      const upd = (await updated) as Extract<ServerMsg, { t: 'view' }>;
      expect(upd.view.state).toBeDefined();

      a.close();
      b.close();
    } finally {
      wss.close();
    }
  });

  it('reports an error for an illegal action instead of crashing', async () => {
    const wss = createGameServer(0);
    const port = (wss.address() as AddressInfo).port;
    try {
      const a = await connect(port);
      send(a, { t: 'create', playerId: 'A', name: 'A', game: 'tarneeb' });
      const created = (await nextMsg(a, (m) => m.t === 'lobby')) as Extract<ServerMsg, { t: 'lobby' }>;
      const code = created.state.code;
      send(a, { t: 'start', playerId: 'A', code });
      await nextMsg(a, (m) => m.t === 'view');

      send(a, { t: 'action', playerId: 'A', code, action: { type: 'PASS', seat: 9 } });
      const err = (await nextMsg(a, (m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
      expect(err.message).toBeTruthy();
      a.close();
    } finally {
      wss.close();
    }
  });
});
