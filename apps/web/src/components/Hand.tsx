import { cardId, legalPlays, type Card, type Suit, type TarneebState } from '@tarneeb/engine';
import { CardView } from './CardView';
import { HUMAN_SEAT } from '../game/useTarneebGame';

// Alternating colours for readability: ♠(black) ♥(red) ♣(black) ♦(red).
const SUIT_DISPLAY_ORDER: Record<Suit, number> = { S: 0, H: 1, C: 2, D: 3 };

function forDisplay(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) =>
    a.suit !== b.suit ? SUIT_DISPLAY_ORDER[a.suit] - SUIT_DISPLAY_ORDER[b.suit] : b.rank - a.rank,
  );
}

export function Hand({
  state,
  active,
  onPlay,
}: {
  state: TarneebState;
  active: boolean;
  onPlay: (c: Card) => void;
}) {
  const hand = state.hands[HUMAN_SEAT] ?? [];
  const myTurnToPlay = active && state.phase === 'playing';
  const legalIds = myTurnToPlay
    ? new Set(legalPlays(hand, state.currentTrick).map(cardId))
    : new Set<string>();
  const cards = forDisplay(hand);

  return (
    <div className="hand">
      {cards.map((card, i) => {
        const playable = myTurnToPlay && legalIds.has(cardId(card));
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
              dimmed={myTurnToPlay && !playable}
              onClick={() => onPlay(card)}
            />
          </div>
        );
      })}
    </div>
  );
}
