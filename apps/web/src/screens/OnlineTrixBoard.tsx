import { useEffect } from 'react';
import {
  getTrixLegalActions,
  type Card,
  type Seat,
  type TrixContract,
  type TrixState,
} from '@tarneeb/engine';
import type { RedactedView } from '@tarneeb/room';
import { rotateTrix } from '../game/rotate';
import { useTrickReview } from '../game/useTrickReview';
import { useOnlineSounds } from '../lib/useOnlineSounds';
import { useRecordOutcome } from '../game/useRecordOutcome';
import type { RecordGameId } from '../game/record';
import type { T } from '../i18n';
import { TrixBoard } from '../components/trix/TrixBoard';
import { LeaveButton } from '../components/LeaveButton';
import { TrixDealOverlay, TrixGameOverlay } from '../components/trix/TrixOverlays';

/** How long the server gives a human before auto-playing (mirror of TURN_TIMEOUT_MS). */
const TURN_LIMIT_MS = 25000;

export function OnlineTrixBoard({
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
  const real = view.state as TrixState;
  const state = rotateTrix(real, seat);
  const review = useTrickReview(state.lastTrick);
  const awaitingHuman = view.yourTurn && review === null;
  useOnlineSounds(state, review, awaitingHuman, 'trix');
  useRecordOutcome(view.game as RecordGameId, state.phase, state.winner);

  // Shedding: when the only legal move is to pass (nothing playable), do it automatically
  // so the table never stalls on a stuck human.
  useEffect(() => {
    if (!view.yourTurn || real.phase !== 'shedding') return;
    const legal = getTrixLegalActions(real);
    if (legal.length === 1 && legal[0]!.type === 'PASS') submit({ type: 'PASS', seat });
  }, [real, view.yourTurn, seat, submit]);

  const nameFor = (s: Seat) => view.occupants[(s + seat) % 4]?.name ?? '';
  const countFor = (s: Seat) => view.handCounts[(s + seat) % 4] ?? 0;

  const timerToken = `${state.phase}:${state.dealNumber}:${state.kingdomIndex}:${state.currentTrick.length}:${state.doublePending.length}`;

  return (
    <TrixBoard
      state={state}
      t={t}
      awaitingHuman={awaitingHuman}
      reviewTrick={review}
      onChooseContract={(c: TrixContract) => submit({ type: 'CHOOSE_CONTRACT', seat, contract: c })}
      onSetDouble={(cards: Card[]) => submit({ type: 'SET_DOUBLE', seat, cards })}
      onPlay={(c: Card) => submit({ type: 'PLAY', seat, card: c })}
      nameFor={nameFor}
      countFor={countFor}
      turnTimer={{ limitMs: TURN_LIMIT_MS, token: timerToken }}
    >
      <LeaveButton onLeave={onLeave} t={t} />
      {state.phase === 'deal-over' && review === null && (
        <TrixDealOverlay state={state} onNext={() => {}} t={t} auto />
      )}
      {state.phase === 'game-over' && <TrixGameOverlay state={state} onNewGame={onLeave} t={t} />}
    </TrixBoard>
  );
}
