import { useEffect, useState } from 'react';
import type { QueuedInfo } from '../game/useOnlineGame';
import type { T } from '../i18n';

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

/** VIP-Jalsat-style "searching" screen: a 2×2 grid of the four seats that fill with
 *  players' names as they join, an elapsed timer, and options to wait, fill with bots
 *  now, or cancel. */
export function FindingPlayers({
  queued,
  onPlayNow,
  onCancel,
  t,
}: {
  queued: QueuedInfo;
  onPlayNow: () => void;
  onCancel: () => void;
  t: T;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const seats = [0, 1, 2, 3].map((i) => queued.names[i] ?? null);

  return (
    <main className="online">
      <div className="online-card">
        <div className="online-finding-title">{t('findingPlayers')}</div>
        <div className="search-grid">
          {seats.map((name, i) => (
            <div key={i} className={`search-seat ${name ? 'filled' : 'empty'}`}>
              {name ? (
                <>
                  <span className="search-avatar">{name.charAt(0)}</span>
                  <span className="search-name">{name}</span>
                </>
              ) : (
                <span className="search-shimmer" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        <div className="search-meta">
          {t('timeSpent')}: {fmt(elapsed)} &nbsp;·&nbsp; {queued.size}/{queued.needed}
        </div>
        <div className="online-actions">
          <button type="button" className="primary-btn" onClick={onPlayNow}>
            {t('playNowBots')}
          </button>
          <button type="button" className="ghost-btn" onClick={onCancel}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </main>
  );
}
