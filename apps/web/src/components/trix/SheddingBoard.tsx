import { useRef, useLayoutEffect, useState, type CSSProperties } from 'react';
import { SUIT_SYMBOL, SUIT_IS_RED, type Card, type Rank, type Suit, type TrixState } from '@tarneeb/engine';
import { CardView } from '../CardView';

const COL_SUITS: readonly Suit[] = ['S', 'H', 'C', 'D'];

function rangeCards(suit: Suit, low: Rank, high: Rank): Card[] {
  const out: Card[] = [];
  for (let r = low; r <= high; r++) out.push({ suit, rank: r as Rank });
  return out;
}

function ShedCol({ cards, suit }: { cards: Card[]; suit: Suit }) {
  if (cards.length === 0) {
    return (
      <div className="shed-col">
        <div className={`shed-empty ${SUIT_IS_RED[suit] ? 'red' : ''}`}>
          {SUIT_SYMBOL[suit]}
        </div>
      </div>
    );
  }

  return (
    <div className="shed-col">
      {cards.map((card, i) => (
        <div
          className="shed-card"
          key={card.rank}
          style={i > 0 ? { marginTop: 'calc(var(--shed-step) - var(--card-h))' } : undefined}
        >
          <CardView card={card} size="lg" />
        </div>
      ))}
    </div>
  );
}

/** The shedding tableau: one column per suit, cards fan downward (Ace at top). */
export function SheddingBoard({ state }: { state: TrixState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CSSProperties>({});
  const longest = Math.max(1, ...COL_SUITS.map(suit => {
    const run = state.layout[suit];
    return run ? run.high - run.low + 1 : 0;
  }));

  useLayoutEffect(() => {
    const board = ref.current;
    if (!board) return;
    const measure = () => {
      const height = Math.max(0, board.clientHeight - 4);
      const steps = longest - 1;
      // Fit a complete run, keeping each exposed rank legible. Only very
      // short phone landscapes need the scroll fallback at the 36px floor.
      // Step scales gently with card size, so long runs keep cards large
      // instead of shrinking with every card added.
      const fit = (height - 4 * steps) / (1.4 + 0.2 * steps);
      const width = Math.max(44, Math.min(110, fit, (board.clientWidth - 36) / 4));
      setSize({
        '--card-w': `${width}px`,
        '--card-h': `${width * 1.4}px`,
        '--shed-step': `${Math.max(14, width * 0.2 + 4)}px`,
      } as CSSProperties);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [longest]);

  return (
    <div className="shedding-board" ref={ref} style={size} aria-label="Trix tableau" tabIndex={0}>
      {COL_SUITS.map((suit) => {
        const r = state.layout[suit];
        const cards = r ? rangeCards(suit, r.low, r.high).reverse() : [];
        return <ShedCol key={suit} cards={cards} suit={suit} />;
      })}
    </div>
  );
}
