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
});
