import { type CompletedTrick, type TarneebState } from '@tarneeb/engine';
import { CardView } from './CardView';
import { HUMAN_SEAT } from '../game/useTarneebGame';
import { posOf } from '../game/layout';

export function TrickView({
  state,
  reviewTrick,
}: {
  state: TarneebState;
  reviewTrick: CompletedTrick | null;
}) {
  // Show the live trick, or the just-completed one during the review pause.
  const cards = state.currentTrick.length > 0 ? state.currentTrick : (reviewTrick?.cards ?? []);
  const winner = state.currentTrick.length > 0 ? null : reviewTrick?.winner ?? null;

  return (
    <div className="trick-area">
      {cards.map((pc) => {
        const pos = posOf(pc.seat, HUMAN_SEAT);
        const isWinner = winner === pc.seat;
        return (
          <div
            className={`trick-card at-${pos} ${isWinner ? 'winner' : ''}`}
            key={`${pc.card.rank}${pc.card.suit}`}
          >
            <CardView card={pc.card} size="lg" />
          </div>
        );
      })}
    </div>
  );
}
