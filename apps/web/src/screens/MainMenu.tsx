import type { T } from '../i18n';

export type GameId = 'tarneeb' | 'trix' | 'trixComplex';
export type CalcId = 'tarneebCalc' | 'trixCalc';

export function MainMenu({
  onPick,
  onCalc,
  onOnline,
  t,
}: {
  onPick: (g: GameId) => void;
  onCalc: (c: CalcId) => void;
  onOnline: () => void;
  t: T;
}) {
  return (
    <main className="menu">
      <button type="button" className="online-banner" onClick={onOnline}>
        🌐 {t('playOnline')}
      </button>

      <div className="menu-cards">
        <button type="button" className="menu-card tarneeb" onClick={() => onPick('tarneeb')}>
          <span className="menu-emoji">♠</span>
          <span className="menu-name">{t('tarneeb')}</span>
        </button>
        <button type="button" className="menu-card trix" onClick={() => onPick('trix')}>
          <span className="menu-emoji">👑</span>
          <span className="menu-name">{t('trixName')}</span>
        </button>
        <button type="button" className="menu-card complex" onClick={() => onPick('trixComplex')}>
          <span className="menu-emoji">☠</span>
          <span className="menu-name">{t('trixComplex')}</span>
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
