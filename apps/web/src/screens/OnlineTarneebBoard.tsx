import { type Card, type Seat, type Suit, type TarneebState } from '@tarneeb/engine';
import type { RedactedView } from '@tarneeb/room';
import { rotateTarneeb } from '../game/rotate';
import { useTrickReview } from '../game/useTrickReview';
import type { T } from '../i18n';
import { TarneebBoard } from '../components/TarneebBoard';
import { LeaveButton } from '../components/LeaveButton';
import { GameOverOverlay, HandOverOverlay } from '../components/Overlays';

/** How long the server gives a human before auto-playing (mirror of TURN_TIMEOUT_MS). */
const TURN_LIMIT_MS = 25000;

export function OnlineTarneebBoard({
  view,
  submit,
  onLeave,
  t,
}: {
  view: RedactedView;
  submit: (action: unknown) => void;
  onLeave: () => void;
  t: T;
}) {
  const seat = view.seat;
  const state = rotateTarneeb(view.state as TarneebState, seat);
  const review = useTrickReview(state.tricks[state.tricks.length - 1] ?? null);
  const awaitingHuman = view.yourTurn && review === null;

  const nameFor = (s: Seat) => view.occupants[(s + seat) % 4]?.name ?? '';
  const countFor = (s: Seat) => view.handCounts[(s + seat) % 4] ?? 0;

  const timerToken = `${state.phase}:${state.tricks.length}:${state.currentTrick.length}:${state.bidLog.length}`;

  return (
    <TarneebBoard
      state={state}
      t={t}
      awaitingHuman={awaitingHuman}
      reviewTrick={review}
      onBid={(n: number) => submit({ type: 'BID', seat, amount: n })}
      onPass={() => submit({ type: 'PASS', seat })}
      onSelectTrump={(su: Suit) => submit({ type: 'SELECT_TRUMP', seat, suit: su })}
      onPlay={(c: Card) => submit({ type: 'PLAY', seat, card: c })}
      nameFor={nameFor}
      countFor={countFor}
      turnTimer={{ limitMs: TURN_LIMIT_MS, token: timerToken }}
    >
      <LeaveButton onLeave={onLeave} t={t} />
      {state.phase === 'hand-over' && review === null && (
        <HandOverOverlay state={state} onNext={() => {}} t={t} auto />
      )}
      {state.phase === 'game-over' && <GameOverOverlay state={state} onNewGame={onLeave} t={t} />}
    </TarneebBoard>
  );
}
