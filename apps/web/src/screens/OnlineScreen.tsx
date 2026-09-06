import { useState } from 'react';
import type { GameKind } from '@tarneeb/room';
import { useOnlineGame } from '../game/useOnlineGame';
import type { T } from '../i18n';
import { OnlineTarneebBoard } from './OnlineTarneebBoard';
import { OnlineTrixBoard } from './OnlineTrixBoard';
import { FindingPlayers } from './FindingPlayers';

const loadName = (): string => {
  try {
    return localStorage.getItem('tarneeb.playerName') ?? '';
  } catch {
    return '';
  }
};

export function OnlineScreen({ t }: { t: T }) {
  const game = useOnlineGame();
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<GameKind>('tarneeb');
  const [partners, setPartners] = useState(false);

  const saveName = (v: string) => {
    setName(v);
    try {
      localStorage.setItem('tarneeb.playerName', v);
    } catch {
      /* ignore */
    }
  };
  const displayName = () => name.trim() || t('defaultName');

  // --- in a started game → show the board (a view only arrives after start) ---
  if (game.view) {
    return game.view.game === 'tarneeb' ? (
      <OnlineTarneebBoard view={game.view} submit={game.submit} onLeave={game.leave} t={t} />
    ) : (
      <OnlineTrixBoard view={game.view} submit={game.submit} onLeave={game.leave} t={t} />
    );
  }

  // --- matchmaking: finding players ---
  if (game.queued) {
    return (
      <FindingPlayers queued={game.queued} onPlayNow={game.matchNow} onCancel={game.cancelMatch} t={t} />
    );
  }

  // --- connection problem ---
  if (game.status === 'error') {
    return (
      <main className="online">
        <div className="panel">
          <div className="panel-title">{t('connErr')}</div>
          <p className="panel-msg">{game.error ?? t('connErrBody')}</p>
          <button type="button" className="primary-btn" onClick={() => location.reload()}>
            {t('retry')}
          </button>
        </div>
      </main>
    );
  }

  // --- in a waiting room (created/joined, not started) ---
  if (game.lobby) {
    const lob = game.lobby;
    const isHost = lob.hostId === game.me;
    return (
      <main className="online">
        <div className="online-card">
          <div className="online-code-label">{t('tableCode')}</div>
          <div className="online-code">{lob.code}</div>
          <div className="online-seats">
            {lob.seats.map((s, i) => (
              <div key={i} className={`online-seat ${s.kind}`}>
                <span className="online-seat-n">{i + 1}</span>
                <span className="online-seat-name">
                  {s.kind === 'human' ? s.name : s.kind === 'bot' ? t('botLabel') : t('seatEmpty')}
                </span>
              </div>
            ))}
          </div>
          <p className="online-hint">{t('waitingHint')}</p>
          <div className="online-actions">
            {isHost && (
              <button type="button" className="primary-btn" onClick={game.start}>
                {t('startGame')}
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={game.leave}>
              {t('leaveTable')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- lobby: create or join ---
  const disabled = game.status !== 'online';
  return (
    <main className="online">
      <div className="online-card">
        <label className="online-field">
          <span>{t('yourName')}</span>
          <input
            value={name}
            placeholder={t('defaultName')}
            onChange={(e) => saveName(e.target.value)}
            maxLength={16}
          />
        </label>

        <div className="online-section">
          <div className="online-section-title">🎲 {t('quickMatch')}</div>
          <div className="seg">
            {(['tarneeb', 'trix', 'trixComplex'] as const).map((g) => (
              <button key={g} type="button" className={kind === g ? 'on' : ''} onClick={() => setKind(g)}>
                {t(g === 'tarneeb' ? 'tarneeb' : g === 'trix' ? 'trixName' : 'trixComplex')}
              </button>
            ))}
          </div>
          {kind !== 'tarneeb' && (
            <label className="online-check">
              <input type="checkbox" checked={partners} onChange={(e) => setPartners(e.target.checked)} />
              <span>{t('partners')}</span>
            </label>
          )}
          <button
            type="button"
            className="primary-btn"
            disabled={disabled}
            onClick={() => game.quickMatch(kind, kind !== 'tarneeb' && partners, displayName())}
          >
            {t('findPlayers')}
          </button>
          <p className="online-hint">{t('quickMatchHint')}</p>
        </div>

        <div className="online-or">— {t('orPlayFriends')} —</div>

        <div className="online-section">
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled}
            onClick={() => game.create(kind, kind !== 'tarneeb' && partners, displayName())}
          >
            {t('createTable')}
          </button>
        </div>

        <div className="online-section">
          <div className="online-section-title">{t('joinTable')}</div>
          <input
            className="online-code-input"
            value={code}
            placeholder={t('enterCode')}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
          />
          <button
            type="button"
            className="primary-btn"
            disabled={disabled || code.trim().length < 4}
            onClick={() => game.join(code.trim(), displayName())}
          >
            {t('joinTable')}
          </button>
        </div>

        {game.error && <p className="online-error">{game.error}</p>}
        {disabled && <p className="online-hint">{t('connecting')}</p>}
      </div>
    </main>
  );
}
