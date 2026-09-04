import { type CompletedTrick, type Seat, type TrixState } from '@tarneeb/engine';
import { CardView } from '../CardView';
import { posOf } from '../../game/layout';

export function TrixTrick({
  state,
  reviewTrick,
}: {
  state: TrixState;
  reviewTrick: CompletedTrick | null;
}) {
  const cards = state.currentTrick.length > 0 ? state.currentTrick : (reviewTrick?.cards ?? []);
  const winner = state.currentTrick.length > 0 ? null : reviewTrick?.winner ?? null;
  return (
    <div className="trick-area">
      {cards.map((pc) => {
        const pos = posOf(pc.seat, 0 as Seat);
        return (
          <div
            className={`trick-card at-${pos} ${winner === pc.seat ? 'winner' : ''}`}
            key={`${pc.card.rank}${pc.card.suit}`}
          >
            <CardView card={pc.card} size="lg" />
          </div>
        );
      })}
    </div>
  );
}
