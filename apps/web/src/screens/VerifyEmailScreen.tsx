import { useEffect, useRef, useState } from 'react';
import type { T } from '../i18n';
import type { AuthState } from '../game/useAuth';

export function VerifyEmailScreen({
  token,
  auth,
  onDone,
  t,
}: {
  token: string;
  auth: AuthState;
  onDone: () => void;
  t: T;
}) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  // The verify token is single-use server-side, so the request itself must fire at most
  // once per token — a ref (not a local effect variable) is what survives StrictMode's
  // dev-mode mount->cleanup->remount. No "cancelled" cleanup flag here on purpose: the
  // cleanup between StrictMode's two invocations would mark the FIRST (real, eventually
  // successful) call as cancelled and discard its result, while the second invocation
  // is the one that's skipped by the ref guard above — so with both, nothing ever sets
  // status. One real call, whose result is always applied, is correct here.
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (attemptedRef.current === token) return;
    attemptedRef.current = token;
    void auth.verifyEmail(token).then((ok) => {
      setStatus(ok ? 'ok' : 'error');
    });
    // auth.verifyEmail is a stable (useCallback, []-deps) reference — only token matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="online">
      <div className="online-card">
        {status === 'checking' && <p className="online-hint">{t('connecting')}</p>}
        {status === 'ok' && <p className="online-hint">{t('verifySuccess')}</p>}
        {status === 'error' && <p className="online-error">{t('verifyFailed')}</p>}
        {status !== 'checking' && (
          <button type="button" className="primary-btn" onClick={onDone}>
            {t('continueBtn')}
          </button>
        )}
      </div>
    </main>
  );
}
