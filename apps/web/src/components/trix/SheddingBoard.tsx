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
    const availH = col.parentElement?.clientHeight ?? 400;
    // Prefer a readable 30%-of-card-height sliver per card, but never more than
    // what actually fits in availH — the old version used a hard 30% floor with
    // no ceiling, so a long run (e.g. 11 cards of one suit still in play) could
    // demand more height than was available. Since .shedding-board clips with
    // overflow:hidden, the column silently overflowed downward and whichever
    // cards fell past the visible edge were just gone (not scrollable, not
    // indicated) — reported live: a player's next legal card implied several
    // ranks had already been played that weren't visible anywhere on screen.
    // Capping at the fit-based gap guarantees the whole column always fits,
    // even if that means a thin 2px sliver per card in extreme cases.
    const idealGap = cardH * 0.3;
    const fitGap = (availH - cardH) / (cards.length - 1);
    const visiblePerCard = Math.max(2, Math.min(idealGap, fitGap));
    setOverlap(Math.max(0, cardH - visiblePerCard));
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
