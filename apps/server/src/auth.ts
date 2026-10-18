// Account/session persistence for real sign-in (Google + email/password), layered
// alongside the rankings DB in db.ts. Deliberately a SEPARATE DatabaseSync connection to
// the same file path, rather than sharing one handle across modules — node:sqlite is
// synchronous and this is a single long-running machine (same reasoning already in
// db.ts), so two independent handles to one file is simpler than plumbing a shared
// connection object through two modules' constructors.
//
// `node:sqlite` is fetched via process.getBuiltinModule rather than a static import —
// see the comment at the top of db.ts for why (this repo's Vite/Vitest predates that
// builtin and mis-resolves a literal `import ... from 'node:sqlite'`).
import { randomBytes, randomUUID, scrypt as scryptCb, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, rolling — see plan doc
const SCRYPT_KEYLEN = 64;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // sweep expired sessions hourly

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
}

export type AuthResult =
  | { readonly kind: 'ok'; readonly account: Account }
  | { readonly kind: 'emailTaken' }
  | { readonly kind: 'invalid' } // wrong email/password combo
  | { readonly kind: 'googleOnly' } // tried a password login on a Google-only account
  | { readonly kind: 'invalidInput'; readonly message: string };

export type GoogleAuthResult =
  | { readonly kind: 'ok'; readonly account: Account; readonly isNew: boolean }
  | { readonly kind: 'emailTaken' }; // email belongs to an existing PASSWORD account — never auto-linked, see plan doc

export interface AuthDb {
  signupPassword(email: string, password: string, name: string): Promise<AuthResult>;
  loginPassword(email: string, password: string): Promise<AuthResult>;
  findOrCreateGoogleAccount(sub: string, email: string, name: string): GoogleAuthResult;
  /** Raw token returned ONLY here, at creation — never stored or returned again. */
  createSession(accountId: string): { token: string; expiresAt: number };
  /** Resolves a session to its account, rolling the 90-day expiry forward on every
   *  successful use (so an actively-used device never re-prompts for sign-in). Lazily
   *  deletes the row and returns null if already expired. */
  resolveSession(token: string): Account | null;
  deleteSession(token: string): void;
  close(): void;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface AccountRow {
  account_id: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  name: string;
}

export function openAuthDb(path: string): AuthDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
  `);

  const insertAccount = db.prepare(
    `INSERT INTO accounts (account_id, email, password_hash, google_sub, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const byEmail = db.prepare(`SELECT * FROM accounts WHERE email = ?`);
  const byGoogleSub = db.prepare(`SELECT * FROM accounts WHERE google_sub = ?`);
  const byAccountId = db.prepare(`SELECT * FROM accounts WHERE account_id = ?`);
  const insertSession = db.prepare(`INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`);
  const sessionByHash = db.prepare(`SELECT * FROM sessions WHERE token_hash = ?`);
  const touchSession = db.prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`);
  const deleteSessionByHash = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`);
  const sweepExpired = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

  const toAccount = (row: AccountRow): Account => ({ accountId: row.account_id, email: row.email, name: row.name });

  const sweepTimer = setInterval(() => sweepExpired.run(Date.now()), SWEEP_INTERVAL_MS);
  sweepTimer.unref?.(); // don't keep the process alive just for this

  return {
    async signupPassword(emailIn, password, nameIn) {
      const email = normalizeEmail(emailIn);
      const name = nameIn.trim();
      if (!isValidEmail(email)) return { kind: 'invalidInput', message: 'invalid email' };
      if (password.length < 8) return { kind: 'invalidInput', message: 'password must be at least 8 characters' };
      if (!name) return { kind: 'invalidInput', message: 'name is required' };
      if (byEmail.get(email)) return { kind: 'emailTaken' };

      const accountId = randomUUID();
      const passwordHash = await hashPassword(password);
      insertAccount.run(accountId, email, passwordHash, null, name, Date.now());
      return { kind: 'ok', account: { accountId, email, name } };
    },

    async loginPassword(emailIn, password) {
      const email = normalizeEmail(emailIn);
      const row = byEmail.get(email) as AccountRow | undefined;
      if (!row) return { kind: 'invalid' };
      if (!row.password_hash) return { kind: 'googleOnly' };
      const ok = await verifyPassword(password, row.password_hash);
      if (!ok) return { kind: 'invalid' };
      return { kind: 'ok', account: toAccount(row) };
    },

    findOrCreateGoogleAccount(sub, emailIn, nameIn) {
      const email = normalizeEmail(emailIn);
      const name = nameIn.trim() || email;

      const existingBySub = byGoogleSub.get(sub) as AccountRow | undefined;
      if (existingBySub) return { kind: 'ok', account: toAccount(existingBySub), isNew: false };

      const existingByEmail = byEmail.get(email) as AccountRow | undefined;
      if (existingByEmail) {
        // Never auto-link onto a password account by bare email match — see plan doc
        // for the account-takeover scenario this specifically avoids.
        return { kind: 'emailTaken' };
      }

      const accountId = randomUUID();
      insertAccount.run(accountId, email, null, sub, name, Date.now());
      return { kind: 'ok', account: { accountId, email, name }, isNew: true };
    },

    createSession(accountId) {
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      const expiresAt = now + SESSION_TTL_MS;
      insertSession.run(sha256Hex(token), accountId, now, expiresAt);
      return { token, expiresAt };
    },

    resolveSession(token) {
      const tokenHash = sha256Hex(token);
      const row = sessionByHash.get(tokenHash) as { account_id: string; expires_at: number } | undefined;
      if (!row) return null;
      if (row.expires_at < Date.now()) {
        deleteSessionByHash.run(tokenHash);
        return null;
      }
      touchSession.run(Date.now() + SESSION_TTL_MS, tokenHash);
      const accountRow = byAccountId.get(row.account_id) as AccountRow | undefined;
      return accountRow ? toAccount(accountRow) : null;
    },

    deleteSession(token) {
      deleteSessionByHash.run(sha256Hex(token));
    },

    close() {
      clearInterval(sweepTimer);
      db.close();
    },
  };
}
