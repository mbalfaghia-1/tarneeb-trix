import { useEffect, useRef, useState } from 'react';
import type { T } from '../i18n';
import type { AuthErrorKind, AuthState } from '../game/useAuth';
import { loadGoogleIdentity } from '../lib/loadGoogleIdentity';

const GOOGLE_CLIENT_ID =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || '';

function errorText(kind: AuthErrorKind, t: T): string {
  switch (kind) {
    case 'emailTaken':
      return t('authErrEmailTaken');
    case 'googleOnly':
      return t('authErrGoogleOnly');
    case 'invalid':
      return t('authErrInvalid');
    case 'invalidInput':
      return t('authErrInvalidInput');
    case 'invalidToken':
      return t('authErrInvalidToken');
    case 'network':
      return t('connErrBody');
  }
}

export function SignInScreen({
  auth,
  onDone,
  t,
}: {
  auth: AuthState;
  onDone: () => void;
  t: T;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  // Google button: only attempted when a Client ID is actually configured (Phase 0 of
  // the sign-in rollout — before that, this section just doesn't render at all).
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !googleButtonRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            void auth.signInWithGoogle(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 280,
        });
      })
      .catch(() => {
        /* Google script failed to load (offline, blocked, etc.) — the button just stays empty;
           email/password sign-in is unaffected. */
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const submit = async () => {
    setSubmitting(true);
    const ok = mode === 'signin' ? await auth.signIn(email, password) : await auth.signUp(email, password, name);
    setSubmitting(false);
    if (ok) onDone(); // unreachable in practice — a successful sign-in reloads the app
  };

  return (
    <main className="online">
      <div className="online-card">
        <div className="seg">
          <button type="button" className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
            {t('signIn')}
          </button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
            {t('createAccount')}
          </button>
        </div>

        {GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleButtonRef} className="google-btn-slot" />
            <div className="online-or">— {t('orEmail')} —</div>
          </>
        )}

        {mode === 'signup' && (
          <label className="online-field">
            <span>{t('yourName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          </label>
        )}
        <label className="online-field">
          <span>{t('email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="online-field">
          <span>{t('password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>

        {auth.error && <p className="online-error">{errorText(auth.error, t)}</p>}

        <button
          type="button"
          className="primary-btn"
          disabled={submitting || !email || !password || (mode === 'signup' && !name)}
          onClick={() => void submit()}
        >
          {mode === 'signin' ? t('signIn') : t('createAccount')}
        </button>

        <button type="button" className="ghost-btn" onClick={onDone}>
          {t('continueAsGuest')}
        </button>
      </div>
    </main>
  );
}
