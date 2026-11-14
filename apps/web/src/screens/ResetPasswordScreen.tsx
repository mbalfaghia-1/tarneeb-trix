import { useState } from 'react';
import type { T } from '../i18n';
import { authErrorText, type AuthState } from '../game/useAuth';

export function ResetPasswordScreen({
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
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const ok = await auth.resetPassword(token, newPassword);
    setSubmitting(false);
    if (ok) onDone(); // unreachable in practice — success reloads the app, same as signIn/signUp
  };

  return (
    <main className="online">
      <div className="online-card">
        <label className="online-field">
          <span>{t('newPassword')}</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>

        {auth.error && <p className="online-error">{authErrorText(auth.error, t)}</p>}

        <button
          type="button"
          className="primary-btn"
          disabled={submitting || !newPassword}
          onClick={() => void submit()}
        >
          {t('resetPasswordBtn')}
        </button>
        <button type="button" className="ghost-btn" onClick={onDone}>
          {t('continueAsGuest')}
        </button>
      </div>
    </main>
  );
}
