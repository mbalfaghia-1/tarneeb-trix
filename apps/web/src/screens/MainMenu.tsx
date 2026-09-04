import type { T } from '../i18n';

export type GameId = 'tarneeb' | 'trix' | 'trixComplex';

export function MainMenu({ onPick, t }: { onPick: (g: GameId) => void; t: T }) {
  return (
    <main className="menu">
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
    </main>
  );
}
