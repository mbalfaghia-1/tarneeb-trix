import type { CSSProperties } from 'react';
import {
  cardId,
  legalPlays,
  sheddingPlayable,
  type Card,
  type Suit,
  type TrixState,
} from '@tarneeb/engine';
import { CardView } from '../CardView';
import { useHandCardWidth } from '../../game/useHandCardWidth';

const SUIT_DISPLAY_ORDER: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };
const forDisplay = (cards: readonly Card[]): Card[] =>
  [...cards].sort((a, b) =>
    a.suit !== b.suit ? SUIT_DISPLAY_ORDER[a.suit] - SUIT_DISPLAY_ORDER[b.suit] : b.rank - a.rank,
  );

export function TrixHand({
  state,
  active,
  onPlay,
}: {
  state: TrixState;
  active: boolean;
  onPlay: (c: Card) => void;
}) {
  const hand = state.hands[0] ?? [];
  let legalIds = new Set<string>();
  if (active && state.phase === 'playing') {
    legalIds = new Set(legalPlays(hand, state.currentTrick).map(cardId));
  } else if (active && state.phase === 'shedding') {
    legalIds = new Set(sheddingPlayable(hand, state.layout).map(cardId));
  }
  const cards = forDisplay(hand);
  const gating = active && (state.phase === 'playing' || state.phase === 'shedding');
  const suitBreaks = cards.reduce(
    (n, c, i) => n + (i > 0 && cards[i - 1]!.suit !== c.suit ? 1 : 0),
    0,
  );
  const sizeVars = useHandCardWidth(cards.length, suitBreaks);

  return (
    <div className="hand" style={sizeVars as CSSProperties}>
      {cards.map((card, i) => {
        const playable = legalIds.has(cardId(card));
        const prev = cards[i - 1];
        const suitBreak = prev !== undefined && prev.suit !== card.suit;
        return (
          <div
            className={`hand-card ${suitBreak ? 'suit-break' : ''} ${playable ? 'is-playable' : ''}`}
            key={cardId(card)}
            style={{ animationDelay: `${i * 28}ms` }}
          >
            <CardView
              card={card}
              size="lg"
              playable={playable}
              dimmed={gating && !playable}
              onClick={() => onPlay(card)}
            />
          </div>
        );
      })}
    </div>
  );
}
