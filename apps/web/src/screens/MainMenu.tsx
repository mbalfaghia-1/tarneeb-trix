import { useState } from 'react';
import type { T } from '../i18n';
import { loadRecord } from '../game/record';
import type { AuthState } from '../game/useAuth';

export type GameId = 'tarneeb' | 'trix' | 'trixComplex';
export type CalcId = 'tarneebCalc' | 'trixCalc';

export function MainMenu({
  onPick,
  onCalc,
  onOnline,
  onRankings,
  onSignIn,
  auth,
  t,
}: {
  onPick: (g: GameId) => void;
  onCalc: (c: CalcId) => void;
  onOnline: () => void;
  onRankings: () => void;
  onSignIn: () => void;
  auth: AuthState;
  t: T;
}) {
  const rec = loadRecord();
  const recLabel = (g: GameId) =>
    rec[g].played > 0 ? t('recordWon', { won: rec[g].won, played: rec[g].played }) : null;
  const [resendStatus, setResendStatus] = useState<'sent' | 'alreadyVerified' | null>(null);
  const resend = async () => {
    const result = await auth.resendVerification();
    setResendStatus(result === 'error' ? null : result);
  };
  return (
    <main className="menu">
      <header className="menu-hero">
        <div className="menu-hero-crown" aria-hidden="true">♛</div>
        <h2 className="menu-hero-title">Tarneeb &amp; Trix</h2>
        <div className="menu-hero-sub">طرنيب · تركس</div>
      </header>
      <button type="button" className="online-banner" onClick={onOnline}>
        <span className="banner-icon">🌐</span> {t('playOnline')}
      </button>
      <button type="button" className="online-banner rankings-banner" onClick={onRankings}>
        <span className="banner-icon">🏆</span> {t('rankings')}
      </button>

      {auth.status === 'signedIn' && auth.account && (
        <div className="account-row">
          <span className="account-name">👤 {auth.account.name}</span>
          <button type="button" className="ghost-btn" onClick={() => void auth.signOut()}>
            {t('signOut')}
          </button>
        </div>
      )}
      {auth.status === 'signedIn' && auth.account && !auth.account.emailVerified && (
        <div className="account-verify-nudge">
          <span>
            {resendStatus === 'sent'
              ? t('verificationSent')
              : resendStatus === 'alreadyVerified'
                ? t('verificationAlready')
                : t('verifyEmailNudge')}
          </span>
          {resendStatus === null && (
            <button type="button" className="link-btn" onClick={() => void resend()}>
              {t('resendVerification')}
            </button>
          )}
        </div>
      )}
      {auth.status === 'signedOut' && (
        <button type="button" className="ghost-btn account-signin-btn" onClick={onSignIn}>
          {t('signIn')}
        </button>
      )}

      <div className="menu-cards">
        <button type="button" className="menu-card tarneeb" onClick={() => onPick('tarneeb')}>
          <img className="menu-art" src="/art/tarneeb.webp" alt="" width={768} height={576} />
          <span className="menu-name">{t('tarneeb')}</span>
          {recLabel('tarneeb') && <span className="menu-record">{recLabel('tarneeb')}</span>}
        </button>
        <button type="button" className="menu-card trix" onClick={() => onPick('trix')}>
          <img className="menu-art" src="/art/trix.webp" alt="" width={768} height={576} />
          <span className="menu-name">{t('trixName')}</span>
          {recLabel('trix') && <span className="menu-record">{recLabel('trix')}</span>}
        </button>
        <button type="button" className="menu-card complex" onClick={() => onPick('trixComplex')}>
          <img className="menu-art" src="/art/complex.webp" alt="" width={768} height={576} />
          <span className="menu-name">{t('trixComplex')}</span>
          {recLabel('trixComplex') && <span className="menu-record">{recLabel('trixComplex')}</span>}
        </button>
      </div>

      <div className="menu-tools">
        <div className="menu-tools-head">🧮 {t('scoreKeeper')}</div>
        <div className="menu-tools-row">
          <button type="button" className="tool-btn" onClick={() => onCalc('tarneebCalc')}>
            {t('tarneebCalc')}
          </button>
          <button type="button" className="tool-btn" onClick={() => onCalc('trixCalc')}>
            {t('trixCalc')}
          </button>
        </div>
      </div>

      <div className="build-stamp">v{__BUILD_STAMP__}</div>
    </main>
  );
}
