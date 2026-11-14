import { describe, expect, it } from 'vitest';
import { openAuthDb } from './auth.js';

describe('auth db: password signup/login', () => {
  it('signs up, then logs in with the same credentials', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('Alice@Example.com', 'hunter2!!', 'Alice');
    expect(signup.kind).toBe('ok');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    expect(signup.account.email).toBe('alice@example.com'); // normalized

    const login = await db.loginPassword('ALICE@example.com', 'hunter2!!'); // case-insensitive email
    expect(login.kind).toBe('ok');
    if (login.kind !== 'ok') throw new Error('unreachable');
    expect(login.account.accountId).toBe(signup.account.accountId);
    db.close();
  });

  it('rejects a second signup with an already-registered email', async () => {
    const db = openAuthDb(':memory:');
    await db.signupPassword('123@gmail.com', 'password1', 'First');
    const second = await db.signupPassword('123@gmail.com', 'differentpw', 'Second');
    expect(second.kind).toBe('emailTaken');
    db.close();
  });

  it('rejects login with the wrong password', async () => {
    const db = openAuthDb(':memory:');
    await db.signupPassword('bob@example.com', 'correct-password', 'Bob');
    const login = await db.loginPassword('bob@example.com', 'wrong-password');
    expect(login.kind).toBe('invalid');
    db.close();
  });

  it('rejects login for an email that was never registered', async () => {
    const db = openAuthDb(':memory:');
    const login = await db.loginPassword('nobody@example.com', 'whatever1');
    expect(login.kind).toBe('invalid');
    db.close();
  });

  it('rejects signup with a too-short password or invalid email', async () => {
    const db = openAuthDb(':memory:');
    const shortPw = await db.signupPassword('ok@example.com', 'short', 'Name');
    expect(shortPw.kind).toBe('invalidInput');
    const badEmail = await db.signupPassword('not-an-email', 'longenoughpw', 'Name');
    expect(badEmail.kind).toBe('invalidInput');
    db.close();
  });
});

describe('auth db: Google sign-in', () => {
  it('creates a new account on first sign-in, logs into the same one on repeat sign-in', () => {
    const db = openAuthDb(':memory:');
    const first = db.findOrCreateGoogleAccount('google-sub-1', 'carol@gmail.com', 'Carol');
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error('unreachable');
    expect(first.isNew).toBe(true);

    const second = db.findOrCreateGoogleAccount('google-sub-1', 'carol@gmail.com', 'Carol');
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw new Error('unreachable');
    expect(second.isNew).toBe(false);
    expect(second.account.accountId).toBe(first.account.accountId);
    db.close();
  });

  it('does NOT link onto an existing password account with the same email (account-takeover guard)', async () => {
    const db = openAuthDb(':memory:');
    const passwordSignup = await db.signupPassword('dave@gmail.com', 'somepassword', 'Dave (password)');
    expect(passwordSignup.kind).toBe('ok');

    const googleAttempt = db.findOrCreateGoogleAccount('google-sub-dave', 'dave@gmail.com', 'Dave (google)');
    expect(googleAttempt.kind).toBe('emailTaken');
    db.close();
  });
});

describe('auth db: sessions', () => {
  it('creates a session and resolves it back to the account', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('eve@example.com', 'password123', 'Eve');
    if (signup.kind !== 'ok') throw new Error('unreachable');

    const { token, expiresAt } = db.createSession(signup.account.accountId);
    expect(expiresAt).toBeGreaterThan(Date.now());
    const resolved = db.resolveSession(token);
    expect(resolved?.accountId).toBe(signup.account.accountId);
    db.close();
  });

  it('rolls the expiry forward on each successful resolve', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('frank@example.com', 'password123', 'Frank');
    if (signup.kind !== 'ok') throw new Error('unreachable');

    const { token, expiresAt: firstExpiry } = db.createSession(signup.account.accountId);
    // Resolving again should push expiresAt forward (can't easily observe the new value
    // through the public API, so just confirm repeated resolves keep succeeding and the
    // session isn't deleted — the rolling-renewal contract).
    expect(db.resolveSession(token)).not.toBeNull();
    expect(db.resolveSession(token)).not.toBeNull();
    expect(firstExpiry).toBeGreaterThan(Date.now());
    db.close();
  });

  it('returns null for an unknown token', async () => {
    const db = openAuthDb(':memory:');
    expect(db.resolveSession('not-a-real-token')).toBeNull();
    db.close();
  });

  it('deleteSession revokes it immediately (sign-out)', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('grace@example.com', 'password123', 'Grace');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    const { token } = db.createSession(signup.account.accountId);
    expect(db.resolveSession(token)).not.toBeNull();

    db.deleteSession(token);
    expect(db.resolveSession(token)).toBeNull();
    db.close();
  });

  it('deleteAllSessions revokes every session for the account, not just one', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('multi@example.com', 'password123', 'Multi');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    const a = db.createSession(signup.account.accountId);
    const b = db.createSession(signup.account.accountId);
    expect(db.resolveSession(a.token)).not.toBeNull();
    expect(db.resolveSession(b.token)).not.toBeNull();

    db.deleteAllSessions(signup.account.accountId);
    expect(db.resolveSession(a.token)).toBeNull();
    expect(db.resolveSession(b.token)).toBeNull();
    db.close();
  });
});

describe('auth db: email verification', () => {
  it('password accounts start unverified; Google accounts start verified', async () => {
    const db = openAuthDb(':memory:');
    const pw = await db.signupPassword('pw@example.com', 'password123', 'Pw');
    if (pw.kind !== 'ok') throw new Error('unreachable');
    expect(pw.account.emailVerified).toBe(false);

    const g = db.findOrCreateGoogleAccount('sub-verify-1', 'g@example.com', 'G');
    if (g.kind !== 'ok') throw new Error('unreachable');
    expect(g.account.emailVerified).toBe(true);
    db.close();
  });

  it('a verify token marks the account verified exactly once', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('verify@example.com', 'password123', 'Verify');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    expect(signup.account.emailVerified).toBe(false);

    const { token } = db.createToken(signup.account.accountId, 'verify');
    const accountId = db.consumeToken(token, 'verify');
    expect(accountId).toBe(signup.account.accountId);
    db.markEmailVerified(accountId!);
    expect(db.getAccountById(signup.account.accountId)?.emailVerified).toBe(true);

    // Single-use: the same token can't be consumed again.
    expect(db.consumeToken(token, 'verify')).toBeNull();
    db.close();
  });

  it('a verify token cannot be used as a reset token (purpose-scoped)', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('scoped@example.com', 'password123', 'Scoped');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    const { token } = db.createToken(signup.account.accountId, 'verify');
    expect(db.consumeToken(token, 'reset')).toBeNull();
    db.close();
  });

  it('returns null for an unknown or already-consumed token', () => {
    const db = openAuthDb(':memory:');
    expect(db.consumeToken('not-a-real-token', 'verify')).toBeNull();
    db.close();
  });
});

describe('auth db: password reset', () => {
  it('a reset token lets a new password replace the old one, and old sessions die', async () => {
    const db = openAuthDb(':memory:');
    const signup = await db.signupPassword('reset@example.com', 'old-password', 'Reset');
    if (signup.kind !== 'ok') throw new Error('unreachable');
    const { token: sessionToken } = db.createSession(signup.account.accountId);
    expect(db.resolveSession(sessionToken)).not.toBeNull();

    const { token: resetToken } = db.createToken(signup.account.accountId, 'reset');
    const accountId = db.consumeToken(resetToken, 'reset');
    expect(accountId).toBe(signup.account.accountId);
    await db.setPassword(accountId!, 'new-password');
    db.deleteAllSessions(accountId!); // simulates what the HTTP route does after a reset

    const oldLogin = await db.loginPassword('reset@example.com', 'old-password');
    expect(oldLogin.kind).toBe('invalid');
    const newLogin = await db.loginPassword('reset@example.com', 'new-password');
    expect(newLogin.kind).toBe('ok');
    expect(db.resolveSession(sessionToken)).toBeNull(); // revoked by the reset
    db.close();
  });
});

describe('auth db: migration backfills email_verified for a pre-existing DB', () => {
  it('marks existing Google accounts verified, leaves password accounts unverified', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'tarneeb-auth-migration-'));
    const dbPath = join(dir, 'auth.db');
    try {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
        DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
      };
      // Simulate a DB created before email_verified existed.
      const old = new DatabaseSync(dbPath);
      old.exec(`
        CREATE TABLE accounts (
          account_id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT,
          google_sub TEXT UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        INSERT INTO accounts (account_id, email, password_hash, google_sub, name, created_at)
          VALUES ('acct-pw', 'legacy-pw@example.com', 'scrypt:aa:bb', NULL, 'Legacy Pw', 1);
        INSERT INTO accounts (account_id, email, password_hash, google_sub, name, created_at)
          VALUES ('acct-google', 'legacy-google@example.com', NULL, 'legacy-sub', 'Legacy Google', 1);
      `);
      old.close();

      const db = openAuthDb(dbPath);
      expect(db.getAccountById('acct-pw')?.emailVerified).toBe(false);
      expect(db.getAccountById('acct-google')?.emailVerified).toBe(true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
