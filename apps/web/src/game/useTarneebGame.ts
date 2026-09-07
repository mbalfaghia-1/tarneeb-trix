import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyAction,
  canClaimRemaining,
  createGame,
  legalPlays,
  type Card,
  type CompletedTrick,
  type Seat,
  type Suit,
  type TarneebState,
} from '@tarneeb/engine';
import { chooseTarneebAction } from '@tarneeb/ai';

export const HUMAN_SEAT: Seat = 0;

/** How long the just-completed trick stays on the table before it clears. */
const TRICK_REVIEW_MS = 2200;
/** The trick that ENDS the hand lingers longer, so its closing cards are readable. */
const DEAL_END_REVIEW_MS = 2600;

/** Seconds the human has to act before the bot brain auto-plays for them. */
const TURN_LIMIT_MS = 15000;
const QUICK_TURN_MS = 5000; // forced move / completing a trick — nothing to deliberate

/** Shorten the wait when the human has no real decision: a single legal card, or
 *  the last card that completes the current trick. */
function humanTurnLimitMs(s: TarneebState): number {
  if (s.phase === 'playing' && s.turn === HUMAN_SEAT) {
    if (legalPlays(s.hands[HUMAN_SEAT] ?? [], s.currentTrick).length <= 1) return QUICK_TURN_MS;
    if (s.currentTrick.length === 3) return QUICK_TURN_MS; // last to play → completes the trick
  }
  return TURN_LIMIT_MS;
}

/** True when the engine is waiting on the human's own decision. */
function isHumanDecision(s: TarneebState): boolean {
  if (s.phase === 'bidding' || s.phase === 'trump-select' || s.phase === 'playing') {
    return s.turn === HUMAN_SEAT;
  }
  return false;
}

/** How long a bot "thinks" before acting, so play is watchable. */
function botDelayMs(s: TarneebState): number {
  return s.phase === 'playing' ? 650 : 550;
}

/** Play out every remaining trick with the bot brain until the hand is scored. Used
 *  to fast-forward a claim (human or bot) once the outcome is no longer in doubt. */
function fastForwardHand(s: TarneebState): TarneebState {
  let cur = s;
  let guard = 0;
  while (cur.phase === 'playing' && guard++ < 200) {
    cur = applyAction(cur, chooseTarneebAction(cur));
  }
  return cur;
}

export interface TarneebGame {
  state: TarneebState;
  humanSeat: Seat;
  /** True while it is the human's turn to act (bid/trump/play). */
  awaitingHuman: boolean;
  /** The just-completed trick, shown briefly before it clears (else null). */
  reviewTrick: CompletedTrick | null;
  /** Total time the human has per turn, in ms (for the countdown UI). */
  turnLimitMs: number;
  /** Changes every time a fresh human decision starts (to restart the timer UI). */
  turnToken: string;
  /** True when the human is on lead and provably wins every remaining trick. */
  canClaim: boolean;
  /** Claim the rest of the hand — auto-plays it to completion. */
  claim: () => void;
  bid: (amount: number) => void;
  pass: () => void;
  selectTrump: (suit: Suit) => void;
  playCard: (card: Card) => void;
  nextHand: () => void;
  newGame: () => void;
}

export function useTarneebGame(): TarneebGame {
  const [state, setState] = useState<TarneebState>(() => createGame());
  const [reviewTrick, setReviewTrick] = useState<CompletedTrick | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTricks = useRef(0);

  // When a trick completes the engine clears it immediately; hold it on the
  // table for a moment so the player can see the cards and who won.
  useEffect(() => {
    const n = state.tricks.length;
    if (n > prevTricks.current && n > 0) {
      prevTricks.current = n;
      setReviewTrick(state.tricks[n - 1]!);
      // The hand's final trick (phase now hand-over / game-over) lingers longer.
      const ending = state.phase === 'hand-over' || state.phase === 'game-over';
      const t = setTimeout(() => setReviewTrick(null), ending ? DEAL_END_REVIEW_MS : TRICK_REVIEW_MS);
      return () => clearTimeout(t);
    }
    prevTricks.current = n; // new hand deals reset the count
    return;
  }, [state.tricks.length]);

  // Bot / auto-advance loop: whenever it is not the human's turn (and the game
  // is live, and no trick is being reviewed), schedule the next bot action.
  useEffect(() => {
    if (state.phase === 'game-over' || state.phase === 'hand-over') return;
    if (reviewTrick !== null) return;
    if (isHumanDecision(state)) return;

    timer.current = setTimeout(() => {
      setState((s) => {
        if (s.phase === 'game-over' || s.phase === 'hand-over' || isHumanDecision(s)) return s;
        // If the bot on lead provably wins every remaining trick, claim it: fast-forward
        // the rest of the hand in one step instead of plodding through each trick.
        if (canClaimRemaining(s, s.turn)) return fastForwardHand(s);
        return applyAction(s, chooseTarneebAction(s));
      });
    }, botDelayMs(state));

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, reviewTrick]);

  const awaitingHuman = isHumanDecision(state) && reviewTrick === null;
  // A token that changes each time a new human decision begins, so the countdown
  // UI restarts and the auto-play timer below re-arms for the new turn.
  const turnToken = `${state.phase}:${state.handNumber}:${state.tricks.length}:${state.currentTrick.length}:${state.bidLog.length}`;

  // Turn timer: if the human doesn't act in time, the bot brain plays for them
  // so the table never stalls.
  useEffect(() => {
    if (!awaitingHuman) return;
    const t = setTimeout(() => {
      setState((s) => (isHumanDecision(s) ? applyAction(s, chooseTarneebAction(s)) : s));
    }, humanTurnLimitMs(state));
    return () => clearTimeout(t);
  }, [awaitingHuman, turnToken, state]);

  const humanAct = useCallback((build: (s: TarneebState) => TarneebState) => {
    setState((s) => build(s));
  }, []);

  const bid = useCallback(
    (amount: number) =>
      humanAct((s) =>
        s.phase === 'bidding' && s.turn === HUMAN_SEAT
          ? applyAction(s, { type: 'BID', seat: HUMAN_SEAT, amount })
          : s,
      ),
    [humanAct],
  );

  const pass = useCallback(
    () =>
      humanAct((s) =>
        s.phase === 'bidding' && s.turn === HUMAN_SEAT
          ? applyAction(s, { type: 'PASS', seat: HUMAN_SEAT })
          : s,
      ),
    [humanAct],
  );

  const selectTrump = useCallback(
    (suit: Suit) =>
      humanAct((s) =>
        s.phase === 'trump-select' && s.turn === HUMAN_SEAT
          ? applyAction(s, { type: 'SELECT_TRUMP', seat: HUMAN_SEAT, suit })
          : s,
      ),
    [humanAct],
  );

  const playCard = useCallback(
    (card: Card) =>
      humanAct((s) =>
        s.phase === 'playing' && s.turn === HUMAN_SEAT
          ? applyAction(s, { type: 'PLAY', seat: HUMAN_SEAT, card })
          : s,
      ),
    [humanAct],
  );

  const nextHand = useCallback(
    () => humanAct((s) => (s.phase === 'hand-over' ? applyAction(s, { type: 'NEXT_HAND' }) : s)),
    [humanAct],
  );

  const newGame = useCallback(() => setState(createGame()), []);

  // Claim: when the human provably wins every remaining trick, fast-forward the
  // rest of the hand (auto-play all seats) to the result in one step.
  const claim = useCallback(() => {
    setReviewTrick(null);
    setState((s) =>
      s.phase === 'playing' && canClaimRemaining(s, HUMAN_SEAT) ? fastForwardHand(s) : s,
    );
  }, []);

  const canClaim = awaitingHuman && canClaimRemaining(state, HUMAN_SEAT);

  return {
    state,
    humanSeat: HUMAN_SEAT,
    awaitingHuman,
    reviewTrick,
    turnLimitMs: humanTurnLimitMs(state),
    turnToken,
    canClaim,
    claim,
    bid,
    pass,
    selectTrump,
    playCard,
    nextHand,
    newGame,
  };
}
