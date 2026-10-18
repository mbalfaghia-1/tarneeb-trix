import { useCallback, useEffect, useState } from 'react';

const SERVER_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ||
  'ws://localhost:8787';
/** Auth endpoints are plain HTTP(S) on the same host/port as the game WebSocket. */
const HTTP_BASE = SERVER_URL.replace(/^ws/, 'http');

const TOKEN_KEY = 'tarneeb.sessionToken';
const PLAYER_ID_KEY = 'tarneeb.playerId';
const PLAYER_NAME_KEY = 'tarneeb.playerName';

export interface Account {
  accountId: string;
  email: string;
  name: string;
}

export type AuthErrorKind = 'emailTaken' | 'invalid' | 'googleOnly' | 'invalidInput' | 'invalidToken' | 'network';

export interface AuthState {
  /** 'loading' only while restoring a saved session on first mount. */
  status: 'loading' | 'signedOut' | 'signedIn';
  account: Account | null;
  error: AuthErrorKind | null;
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithGoogle: (idToken: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Overwrites the SAME localStorage keys useOnlineGame.ts already reads on every mount —
 *  this is the entire mechanism that makes sign-in take effect: no protocol/pipeline
 *  changes needed, just a different value in the one place playerId comes from. The
 *  forced reload after this (see doAuth/signOut below) is required, not cosmetic:
 *  useOnlineGame's playerId is captured once via useRef at mount and never re-read, so
 *  without a remount it would silently keep using the old identity for the rest of the
 *  session. */
function applySession(token: string, account: Account): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(PLAYER_ID_KEY, account.accountId);
    localStorage.setItem(PLAYER_NAME_KEY, account.name);
  } catch {
    /* ignore storage failures */
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    // Also drop the device's identity/name — this may be a shared/public device, so the
    // next person should start as a fresh guest, not inherit the signed-out account's id.
    localStorage.removeItem(PLAYER_ID_KEY);
    localStorage.removeItem(PLAYER_NAME_KEY);
  } catch {
    /* ignore storage failures */
  }
}

interface AuthOkResponse {
  token: string;
  expiresAt: number;
  account: Account;
}
interface AuthErrorResponse {
  error: string;
  message?: string;
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<AuthErrorKind | null>(null);

  useEffect(() => {
    const token = loadToken();
    if (!token) {
      setStatus('signedOut');
      return;
    }
    let cancelled = false;
    fetch(`${HTTP_BASE}/auth/me`, { headers: { authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ account: Account }>) : Promise.reject(new Error())))
      .then((data) => {
        if (cancelled) return;
        setAccount(data.account);
        setStatus('signedIn');
      })
      .catch(() => {
        if (cancelled) return;
        clearSession(); // the saved token is stale/invalid — don't keep offering a dead session
        setStatus('signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const doAuth = useCallback(async (path: string, body: unknown): Promise<boolean> => {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`${HTTP_BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      setError('network');
      return false;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({ error: 'network' }))) as AuthErrorResponse;
      const kind: AuthErrorKind =
        data.error === 'emailTaken' ||
        data.error === 'invalid' ||
        data.error === 'googleOnly' ||
        data.error === 'invalidInput' ||
        data.error === 'invalidToken'
          ? data.error
          : 'network';
      setError(kind);
      return false;
    }
    const data = (await res.json()) as AuthOkResponse;
    applySession(data.token, data.account);
    location.reload(); // remount useOnlineGame so it picks up the new identity — see applySession
    return true;
  }, []);

  const signUp = useCallback(
    (email: string, password: string, name: string) => doAuth('/auth/signup', { email, password, name }),
    [doAuth],
  );
  const signIn = useCallback(
    (email: string, password: string) => doAuth('/auth/login', { email, password }),
    [doAuth],
  );
  const signInWithGoogle = useCallback((idToken: string) => doAuth('/auth/google', { idToken }), [doAuth]);

  const signOut = useCallback(async () => {
    const token = loadToken();
    if (token) {
      try {
        await fetch(`${HTTP_BASE}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      } catch {
        /* best-effort — proceed to clear locally either way */
      }
    }
    clearSession();
    location.reload();
  }, []);

  return { status, account, error, signUp, signIn, signInWithGoogle, signOut };
}
