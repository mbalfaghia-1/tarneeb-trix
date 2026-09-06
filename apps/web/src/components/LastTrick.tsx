import { useState } from 'react';
import type { CompletedTrick, Seat } from '@tarneeb/engine';
import { CardView } from './CardView';
import type { T } from '../i18n';

/**
 * A small "last trick" button + popup showing the previously completed trick — who
 * played what and who won — for players who got distracted or forgot. Renders nothing
 * until there is a completed trick to show.
 */
export function LastTrick({
  trick,
  nameFor,
  t,
}: {
  trick: CompletedTrick | null | undefined;
  nameFor: (seat: Seat) => string;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  if (!trick || trick.cards.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="last-trick-btn"
        onClick={() => setOpen(true)}
        aria-label={t('lastTrick')}
        title={t('lastTrick')}
      >
        🂠
      </button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="panel last-trick-panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">{t('lastTrick')}</div>
            <div className="lt-cards">
              {trick.cards.map((pc) => (
                <div
                  key={`${pc.card.rank}${pc.card.suit}`}
                  className={`lt-slot ${pc.seat === trick.winner ? 'winner' : ''}`}
                >
                  <CardView card={pc.card} size="md" />
                  <span className="lt-name">{nameFor(pc.seat)}</span>
                </div>
              ))}
            </div>
            <button type="button" className="primary-btn" onClick={() => setOpen(false)}>
              {t('close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
