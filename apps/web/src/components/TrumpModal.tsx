import { SUITS, SUIT_IS_RED, SUIT_SYMBOL, type Suit } from '@tarneeb/engine';
import type { T } from '../i18n';

export function TrumpModal({ onSelect, t }: { onSelect: (s: Suit) => void; t: T }) {
  return (
    <div className="modal trump-modal">
      <div className="modal-title">{t('chooseTarneeb')}</div>
      <div className="trump-grid">
        {SUITS.map((suit) => (
          <button
            key={suit}
            type="button"
            className={`trump-btn ${SUIT_IS_RED[suit] ? 'red' : 'black'}`}
            onClick={() => onSelect(suit)}
            aria-label={suit}
          >
            {SUIT_SYMBOL[suit]}
          </button>
        ))}
      </div>
    </div>
  );
}
