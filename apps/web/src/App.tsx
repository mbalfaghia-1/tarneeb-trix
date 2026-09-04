import { useEffect, useState } from 'react';
import { makeT, isRtl, type Lang } from './i18n';
import { Sound, primeAudio } from './lib/sound';
import { MainMenu, type GameId } from './screens/MainMenu';
import { TarneebScreen } from './screens/TarneebScreen';
import { TrixScreen } from './screens/TrixScreen';

type Screen = 'menu' | GameId;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [muted, setMuted] = useState<boolean>(() => Sound.isMuted());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('tarneeb.theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [screen, setScreen] = useState<Screen>('menu');
  const [gameKey, setGameKey] = useState(0);
  const [pending, setPending] = useState<GameId | null>(null); // awaiting partnership choice
  const [partnership, setPartnership] = useState(false);
  const t = makeT(lang);

  useEffect(() => {
    primeAudio();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('tarneeb.theme', theme);
    } catch {
      /* ignore storage failures */
    }
  }, [theme]);

  const title =
    screen === 'trix'
      ? t('trixName')
      : screen === 'trixComplex'
        ? t('trixComplex')
        : screen === 'tarneeb'
          ? t('tarneeb')
          : t('chooseGame');

  const pick = (g: GameId) => {
    if (g === 'tarneeb') {
      setScreen(g);
      setGameKey((k) => k + 1);
    } else {
      setPending(g); // Trix / Trix Complex: ask Partnership or Alone first
    }
  };

  const startTrix = (asPartners: boolean) => {
    if (!pending) return;
    setPartnership(asPartners);
    setScreen(pending);
    setGameKey((k) => k + 1);
    setPending(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="theme"
            title="theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMuted(Sound.toggle())}
            aria-label="sound"
            title="sound"
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button type="button" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            {t('language')}
          </button>
          {screen !== 'menu' && (
            <button type="button" onClick={() => setGameKey((k) => k + 1)}>
              {t('newGame')}
            </button>
          )}
          {screen !== 'menu' && (
            <button type="button" onClick={() => setScreen('menu')}>
              {t('menu')}
            </button>
          )}
        </div>
      </header>

      {screen === 'menu' && <MainMenu onPick={pick} t={t} />}
      {screen === 'tarneeb' && <TarneebScreen key={gameKey} t={t} />}
      {screen === 'trix' && (
        <TrixScreen key={gameKey} t={t} mode="regular" partnership={partnership} />
      )}
      {screen === 'trixComplex' && (
        <TrixScreen key={gameKey} t={t} mode="complex" partnership={partnership} />
      )}

      {pending && (
        <div className="overlay">
          <div className="panel">
            <div className="panel-title">{t('partnershipQ')}</div>
            <div className="mode-choice">
              <button type="button" className="primary-btn" onClick={() => startTrix(false)}>
                {t('alone')}
              </button>
              <button type="button" className="primary-btn" onClick={() => startTrix(true)}>
                {t('partners')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
