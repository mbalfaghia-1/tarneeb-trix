import { useRef, useLayoutEffect, useEffect, useState, useCallback } from 'react';
import { SUIT_SYMBOL, SUIT_IS_RED, type Card, type Rank, type Suit, type TrixState } from '@tarneeb/engine';
import { CardView } from '../CardView';

const COL_SUITS: readonly Suit[] = ['S', 'H', 'C', 'D'];

function rangeCards(suit: Suit, low: Rank, high: Rank): Card[] {
  const out: Card[] = [];
  for (let r = low; r <= high; r++) out.push({ suit, rank: r as Rank });
  return out;
}

function ShedCol({ cards, suit }: { cards: Card[]; suit: Suit }) {
  const colRef = useRef<HTMLDivElement>(null);
  const [overlap, setOverlap] = useState(0);

  const measure = useCallback(() => {
    const col = colRef.current;
    if (!col || cards.length <= 1) { setOverlap(0); return; }
    const cardEl = col.querySelector('.card') as HTMLElement | null;
    if (!cardEl) return;
    const cardH = cardEl.offsetHeight;
    // The exposed sliver must be tall enough to actually show the rank in the
    // top-left corner (CardView's `.corner.tl`, offset 5px from the card's own
    // top edge) — a sliver thinner than that still technically renders the
    // card, but shows nothing legible, which is just as unusable as the
    // earlier clipping bug this replaced (a player couldn't tell a doubled
    // run had reached down to e.g. a jack vs. a queen). Suit isn't needed in
    // the sliver since the whole column is already one suit.
    //
    // Always use this readable sliver, even if that makes the column taller
    // than the available band — .shedding-board scrolls (overflow-y: auto)
    // rather than clipping in that case, so a long run stays reachable
    // instead of either disappearing (the original clipping bug) or
    // rendering too thin to read (what capping this at "whatever fits" did).
    const minReadableSliver = Math.max(18, cardH * 0.22 + 8);
    setOverlap(Math.max(0, cardH - minReadableSliver));
  }, [cards.length]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  if (cards.length === 0) {
    return (
      <div className="shed-col" ref={colRef}>
        <div className={`shed-empty ${SUIT_IS_RED[suit] ? 'red' : ''}`}>
          {SUIT_SYMBOL[suit]}
        </div>
      </div>
    );
  }

  return (
    <div className="shed-col" ref={colRef}>
      {cards.map((card, i) => (
        <div
          className="shed-card"
          key={card.rank}
          style={i > 0 ? { marginTop: -overlap } : undefined}
        >
          <CardView card={card} size="lg" />
        </div>
      ))}
    </div>
  );
}

/** The shedding tableau: one column per suit, cards fan downward (Ace at top). */
export function SheddingBoard({ state }: { state: TrixState }) {
  return (
    <div className="shedding-board">
      {COL_SUITS.map((suit) => {
        const r = state.layout[suit];
        const cards = r ? rangeCards(suit, r.low, r.high).reverse() : [];
        return <ShedCol key={suit} cards={cards} suit={suit} />;
      })}
    </div>
  );
}
