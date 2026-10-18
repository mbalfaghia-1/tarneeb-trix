import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { getLegalActions, type TarneebState } from '@tarneeb/engine';
import type { ClientMsg, ServerMsg } from '@tarneeb/room';
import { createGameServer } from './server.js';

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
    const wss = createGameServer(0, ':memory:');
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
    const wss = createGameServer(0, ':memory:');
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

  it('serves GET /rankings as JSON off the same port as the WebSocket', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://localhost:${port}/rankings?game=tarneeb`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      const body = (await res.json()) as { players: unknown[] };
      expect(body.players).toEqual([]); // nothing recorded yet in a fresh :memory: db
    } finally {
      wss.close();
    }
  });
});

interface AuthResponse {
  token: string;
  expiresAt: number;
  account: { accountId: string; email: string; name: string };
}

describe('HTTP /auth/* routes', () => {
  it('answers an OPTIONS preflight with the headers a browser needs', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://localhost:${port}/auth/signup`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
    } finally {
      wss.close();
    }
  });

  it('signs up, logs in, restores via /auth/me, then logs out and revokes the session', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    try {
      const signupRes = await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'integration@example.com', password: 'password123', name: 'Integration' }),
      });
      expect(signupRes.status).toBe(200);
      const signup = (await signupRes.json()) as AuthResponse;
      expect(signup.account.email).toBe('integration@example.com');

      const meRes = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${signup.token}` } });
      expect(meRes.status).toBe(200);
      const me = (await meRes.json()) as { account: AuthResponse['account'] };
      expect(me.account.accountId).toBe(signup.account.accountId);

      const loginRes = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'integration@example.com', password: 'password123' }),
      });
      expect(loginRes.status).toBe(200);
      const login = (await loginRes.json()) as AuthResponse;
      expect(login.account.accountId).toBe(signup.account.accountId);

      const logoutRes = await fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${login.token}` },
      });
      expect(logoutRes.status).toBe(204);

      // The logged-out token is now dead; the session from signup (a different token) is untouched.
      const meAfterLogout = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${login.token}` } });
      expect(meAfterLogout.status).toBe(401);
      const meStillValid = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${signup.token}` } });
      expect(meStillValid.status).toBe(200);
    } finally {
      wss.close();
    }
  });

  it('rejects a second signup with an already-registered email over HTTP', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    const signup = (email: string) =>
      fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Name' }),
      });
    try {
      expect((await signup('dup@example.com')).status).toBe(200);
      expect((await signup('dup@example.com')).status).toBe(409);
    } finally {
      wss.close();
    }
  });

  it('GET /auth/me with no/invalid token returns a clean 401, not a crash', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const noToken = await fetch(`http://localhost:${port}/auth/me`);
      expect(noToken.status).toBe(401);
      const badToken = await fetch(`http://localhost:${port}/auth/me`, {
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(badToken.status).toBe(401);
    } finally {
      wss.close();
    }
  });
});

describe('WebSocket authenticate: anti-spoofing guard', () => {
  it('accepts messages whose playerId matches the authenticated account', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const signupRes = await fetch(`http://localhost:${port}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'password123', name: 'Owner' }),
      });
      const { token, account } = (await signupRes.json()) as AuthResponse;

      const ws = await connect(port);
      send(ws, { t: 'authenticate', sessionToken: token });
      send(ws, { t: 'create', playerId: account.accountId, name: 'Owner', game: 'tarneeb' });
      const created = (await nextMsg(ws, (m) => m.t === 'lobby')) as Extract<ServerMsg, { t: 'lobby' }>;
      expect(created.state.seats[0]!.kind).toBe('human'); // accepted — no spoofing involved
      ws.close();
    } finally {
      wss.close();
    }
  });

  it('rejects a message whose playerId does NOT match the authenticated account', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const signupRes = await fetch(`http://localhost:${port}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'victim@example.com', password: 'password123', name: 'Victim' }),
      });
      const { token } = (await signupRes.json()) as AuthResponse;

      const ws = await connect(port);
      send(ws, { t: 'authenticate', sessionToken: token });
      // Attempt to act as a completely different (someone else's) playerId.
      send(ws, { t: 'create', playerId: 'someone-elses-account-id', name: 'Spoofed', game: 'tarneeb' });
      const err = (await nextMsg(ws, (m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
      expect(err.message).toContain('playerId');
      ws.close();
    } finally {
      wss.close();
    }
  });

  it('leaves unauthenticated guest connections completely unaffected', async () => {
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    try {
      const ws = await connect(port);
      // No 'authenticate' message sent at all — any playerId string is accepted, as today.
      send(ws, { t: 'create', playerId: 'random-guest-id', name: 'Guest', game: 'tarneeb' });
      const created = (await nextMsg(ws, (m) => m.t === 'lobby')) as Extract<ServerMsg, { t: 'lobby' }>;
      expect(created.state.seats[0]!.kind).toBe('human');
      ws.close();
    } finally {
      wss.close();
    }
  });
});
