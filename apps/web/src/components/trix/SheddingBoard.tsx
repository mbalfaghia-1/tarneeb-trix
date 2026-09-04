import { SUIT_SYMBOL, SUIT_IS_RED, type Card, type Rank, type Suit, type TrixState } from '@tarneeb/engine';
import { CardView } from '../CardView';

const ROW_SUITS: readonly Suit[] = ['S', 'H', 'C', 'D'];

function rangeCards(suit: Suit, low: Rank, high: Rank): Card[] {
  const out: Card[] = [];
  for (let r = low; r <= high; r++) out.push({ suit, rank: r as Rank });
  return out;
}

/** The shedding tableau: one row per suit showing its played chain (J outward). */
export function SheddingBoard({ state }: { state: TrixState }) {
  return (
    <div className="shedding-board">
      {ROW_SUITS.map((suit) => {
        const r = state.layout[suit];
        return (
          <div className="shed-row" key={suit}>
            {r ? (
              rangeCards(suit, r.low, r.high).map((card) => (
                <div className="shed-card" key={card.rank}>
                  <CardView card={card} size="md" />
                </div>
              ))
            ) : (
              <div className={`shed-empty ${SUIT_IS_RED[suit] ? 'red' : ''}`}>
                {SUIT_SYMBOL[suit]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
