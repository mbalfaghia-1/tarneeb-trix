import { useState } from 'react';
import { cardId, isDoubleable, type Card, type TrixState } from '@tarneeb/engine';
import { CardView } from '../CardView';
import type { T } from '../../i18n';

/** Lets the human reveal & double their K♥ / queen(s) before an avoidance deal. */
export function DoubleModal({
  state,
  onSubmit,
  t,
}: {
  state: TrixState;
  onSubmit: (cards: Card[]) => void;
  t: T;
}) {
  const eligible = (state.hands[0] ?? []).filter(
    (c) => state.contract !== null && isDoubleable(c, state.contract),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chosen = eligible.filter((c) => selected.has(cardId(c)));

  return (
    <div className="modal double-modal">
      <div className="modal-title">{t('double_title')}</div>
      <div className="double-hint">{t('double_hint')}</div>
      <div className="double-cards">
        {eligible.map((c) => {
          const id = cardId(c);
          const on = selected.has(id);
          // A plain wrapper (not a button) around CardView's own button — nesting a
          // <button> inside a <button> is invalid and swallows taps on touch devices.
          return (
            <div key={id} className={`double-card ${on ? 'on' : ''}`}>
              <CardView card={c} size="md" playable onClick={() => toggle(id)} />
              {on && <span className="dbl-check">✓</span>}
            </div>
          );
        })}
      </div>
      <div className="double-actions">
        <button type="button" className="pass-btn small" onClick={() => onSubmit([])}>
          {t('double_skip')}
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={chosen.length === 0}
          onClick={() => onSubmit(chosen)}
        >
          {t('double_confirm')}
        </button>
      </div>
    </div>
  );
}
