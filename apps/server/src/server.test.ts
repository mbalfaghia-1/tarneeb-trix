import { afterEach, describe, expect, it } from 'vitest';
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

/** Intercepts outgoing Resend API calls (createEmailSender's fetch) and lets a test pull
 *  the real verify/reset token out of the actual emailed link — exercising the genuine
 *  end-to-end flow rather than bypassing it via direct DB access. */
function mockResendCapturingLinks(): { sentTo: string[]; tokens: () => string[] } {
  const sentTo: string[] = [];
  const bodies: string[] = [];
  const realFetch = globalThis.fetch;
  // Only intercept the server's own outgoing call to Resend — everything else (the
  // test's own fetch() calls to the local server under test) must pass through
  // untouched, since both run through this same process-wide global.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url !== 'https://api.resend.com/emails') return realFetch(url, init);
    const body = JSON.parse((init as RequestInit).body as string) as { to: string[]; html: string };
    sentTo.push(...body.to);
    bodies.push(body.html);
    return { ok: true } as Response;
  }) as typeof fetch;
  return {
    sentTo,
    tokens: () => bodies.map((html) => /[?&](?:verify|reset)=([^"&\s]+)/.exec(html)?.[1] ?? ''),
  };
}

describe('HTTP /auth/* email verification + password reset', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('a fresh signup is unverified; the emailed link verifies it', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const mail = mockResendCapturingLinks();
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    try {
      const signupRes = await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'verifyme@example.com', password: 'password123', name: 'Verify Me' }),
      });
      const signup = (await signupRes.json()) as AuthResponse & { account: { emailVerified: boolean } };
      expect(signup.account.emailVerified).toBe(false);
      expect(mail.sentTo).toEqual(['verifyme@example.com']);

      const [verifyToken] = mail.tokens();
      expect(verifyToken).toBeTruthy();

      const verifyRes = await fetch(`${base}/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: verifyToken }),
      });
      expect(verifyRes.status).toBe(200);
      const verified = (await verifyRes.json()) as { verified: boolean; account: { emailVerified: boolean } };
      expect(verified.verified).toBe(true);
      expect(verified.account.emailVerified).toBe(true);

      // Single-use: verifying again with the same (now-consumed) token fails.
      const secondTry = await fetch(`${base}/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: verifyToken }),
      });
      expect(secondTry.status).toBe(400);
    } finally {
      wss.close();
    }
  });

  it('resend-verification requires a valid session and no-ops once already verified', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const mail = mockResendCapturingLinks();
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    try {
      const noAuth = await fetch(`${base}/auth/resend-verification`, { method: 'POST' });
      expect(noAuth.status).toBe(401);

      const signupRes = await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'resend@example.com', password: 'password123', name: 'Resend' }),
      });
      const signup = (await signupRes.json()) as AuthResponse;
      expect(mail.sentTo).toHaveLength(1); // the automatic signup verification email

      const resendRes = await fetch(`${base}/auth/resend-verification`, {
        method: 'POST',
        headers: { authorization: `Bearer ${signup.token}` },
      });
      expect(resendRes.status).toBe(200);
      expect(mail.sentTo).toHaveLength(2); // a second email actually went out

      const [, resendToken] = mail.tokens();
      await fetch(`${base}/auth/verify-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resendToken }),
      });

      const alreadyRes = await fetch(`${base}/auth/resend-verification`, {
        method: 'POST',
        headers: { authorization: `Bearer ${signup.token}` },
      });
      const already = (await alreadyRes.json()) as { alreadyVerified: boolean };
      expect(already.alreadyVerified).toBe(true);
      expect(mail.sentTo).toHaveLength(2); // no third email sent once already verified
    } finally {
      wss.close();
    }
  });

  it('forgot-password always returns 200 (even for an unregistered email), only emails real accounts', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const mail = mockResendCapturingLinks();
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    try {
      await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'forgot@example.com', password: 'old-password', name: 'Forgot' }),
      });
      mail.sentTo.length = 0; // clear the signup-verification email so we only see the reset one

      const unknownRes = await fetch(`${base}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody-here@example.com' }),
      });
      expect(unknownRes.status).toBe(200); // never reveals whether the email is registered
      expect(mail.sentTo).toHaveLength(0); // but nothing was actually sent for it

      const knownRes = await fetch(`${base}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'forgot@example.com' }),
      });
      expect(knownRes.status).toBe(200);
      expect(mail.sentTo).toEqual(['forgot@example.com']);
    } finally {
      wss.close();
    }
  });

  it('a reset link sets a new password, signs the user in, and kills their old sessions', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const mail = mockResendCapturingLinks();
    const wss = createGameServer(0, ':memory:');
    const port = (wss.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;
    try {
      const signupRes = await fetch(`${base}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset-http@example.com', password: 'old-password', name: 'Reset Http' }),
      });
      const signup = (await signupRes.json()) as AuthResponse;
      const oldSessionStillValid = await fetch(`${base}/auth/me`, {
        headers: { authorization: `Bearer ${signup.token}` },
      });
      expect(oldSessionStillValid.status).toBe(200);

      await fetch(`${base}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset-http@example.com' }),
      });
      const [, resetToken] = mail.tokens(); // [0] = signup verify link, [1] = reset link

      // A too-short new password is rejected WITHOUT burning the single-use token.
      const tooShort = await fetch(`${base}/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: 'short' }),
      });
      expect(tooShort.status).toBe(400);

      const resetRes = await fetch(`${base}/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: 'brand-new-password' }),
      });
      expect(resetRes.status).toBe(200);
      const reset = (await resetRes.json()) as AuthResponse;

      // The old session from signup is dead now (reset revokes everything).
      const oldSessionNowDead = await fetch(`${base}/auth/me`, {
        headers: { authorization: `Bearer ${signup.token}` },
      });
      expect(oldSessionNowDead.status).toBe(401);
      // But reset-password handed back a fresh, working session.
      const newSessionWorks = await fetch(`${base}/auth/me`, {
        headers: { authorization: `Bearer ${reset.token}` },
      });
      expect(newSessionWorks.status).toBe(200);

      // Old password no longer works; new one does.
      const oldLogin = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset-http@example.com', password: 'old-password' }),
      });
      expect(oldLogin.status).toBe(401);
      const newLogin = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reset-http@example.com', password: 'brand-new-password' }),
      });
      expect(newLogin.status).toBe(200);
    } finally {
      wss.close();
    }
  });
});
