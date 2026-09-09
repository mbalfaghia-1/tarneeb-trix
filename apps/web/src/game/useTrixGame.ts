import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyTrixAction,
  createTrixGame,
  legalPlays,
  sheddingPlayable,
  type Card,
  type CompletedTrick,
  type Seat,
  type TrixAction,
  type TrixContract,
  type TrixMode,
  type TrixState,
} from '@tarneeb/engine';
import { chooseTrixAction } from '@tarneeb/ai';

export const TRIX_HUMAN: Seat = 0;
const TRICK_REVIEW_MS = 2200;
const DEAL_END_REVIEW_MS = 2600; // the trick that ENDS the deal lingers longer, so the closing cards are readable
const TURN_LIMIT_MS = 15000;
const QUICK_TURN_MS = 5000; // forced move / completing a trick — nothing to deliberate

/** How long to wait for the human before auto-playing: short when there's no real
 *  decision (a single legal card, or the last card that completes the trick). */
function humanTurnLimitMs(s: TrixState): number {
  if (s.phase === 'playing') {
    if (legalPlays(s.hands[TRIX_HUMAN] ?? [], s.currentTrick).length <= 1) return QUICK_TURN_MS;
    if (s.currentTrick.length === 3) return QUICK_TURN_MS; // last to play → completes the trick
  }
  if (s.phase === 'shedding' && sheddingPlayable(s.hands[TRIX_HUMAN] ?? [], s.layout).length <= 1) {
    return QUICK_TURN_MS;
  }
  return TURN_LIMIT_MS;
}

function isHumanTurn(s: TrixState): boolean {
  if (s.phase === 'contract-select') return s.king === TRIX_HUMAN;
  if (s.phase === 'doubling') return s.turn === TRIX_HUMAN;
  if (s.phase === 'playing' || s.phase === 'shedding') return s.turn === TRIX_HUMAN;
  return false;
}

function botDelayMs(s: TrixState): number {
  if (s.phase === 'contract-select') return 950;
  return s.phase === 'shedding' ? 700 : 900;
}

export interface TrixGame {
  state: TrixState;
  humanSeat: Seat;
  awaitingHuman: boolean;
  reviewTrick: CompletedTrick | null;
  turnLimitMs: number;
  turnToken: string;
  chooseContract: (contract: TrixContract) => void;
  setDouble: (cards: Card[]) => void;
  playCard: (card: Card) => void;
  pass: () => void;
  nextDeal: () => void;
  newGame: () => void;
}

export function useTrixGame(mode: TrixMode = 'regular', partnership = false): TrixGame {
  const [state, setState] = useState<TrixState>(() => createTrixGame({ mode, partnership }));
  const [reviewTrick, setReviewTrick] = useState<CompletedTrick | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const reviewRef = useRef(reviewTrick);
  reviewRef.current = reviewTrick;
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply an action, capturing a completed avoidance trick for the review pause.
  const advance = useCallback((action: TrixAction) => {
    const pre = stateRef.current;
    const post = applyTrixAction(pre, action);
    if (pre.phase === 'playing' && action.type === 'PLAY' && pre.currentTrick.length === 3) {
      const cards = [...pre.currentTrick, { seat: action.seat, card: action.card }];
      setReviewTrick({ leader: pre.leader ?? action.seat, cards, winner: post.leader ?? action.seat });
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
      // The deal-ending trick stays up longer so its cards are readable before the result.
      const ms = post.phase === 'deal-over' ? DEAL_END_REVIEW_MS : TRICK_REVIEW_MS;
      reviewTimer.current = setTimeout(() => setReviewTrick(null), ms);
    }
    stateRef.current = post;
    setState(post);
  }, []);

  // A stuck shedding turn (no playable card) is not a real decision — it passes
  // automatically, so it doesn't count as awaiting the human.
  const stuckShedding =
    state.phase === 'shedding' &&
    state.turn === TRIX_HUMAN &&
    sheddingPlayable(state.hands[TRIX_HUMAN] ?? [], state.layout).length === 0;

  const awaitingHuman =
    isHumanTurn(state) &&
    reviewTrick === null &&
    state.phase !== 'deal-over' &&
    state.phase !== 'game-over' &&
    !stuckShedding;

  const turnToken = `${state.phase}:${state.dealNumber}:${state.kingdomIndex}:${state.tricksTaken.reduce(
    (a, b) => a + b,
    0,
  )}:${state.currentTrick.length}:${state.finishOrder.length}:${state.doublePending.length}`;

  // Bot loop.
  useEffect(() => {
    if (state.phase === 'deal-over' || state.phase === 'game-over') return;
    if (reviewTrick !== null) return;
    if (isHumanTurn(state)) return;
    botTimer.current = setTimeout(() => {
      // Re-check at fire time (with fresh refs) so a stray timer can never act
      // on the human's turn or during a trick review.
      const s = stateRef.current;
      if (reviewRef.current) return;
      if (s.phase === 'deal-over' || s.phase === 'game-over') return;
      if (isHumanTurn(s)) return;
      advance(chooseTrixAction(s));
    }, botDelayMs(state));
    return () => {
      if (botTimer.current) clearTimeout(botTimer.current);
    };
  }, [state, reviewTrick, advance]);

  // Turn timer: auto-play the smart move if the human stalls (short for non-decisions).
  useEffect(() => {
    if (!awaitingHuman) return;
    const t = setTimeout(() => advance(chooseTrixAction(stateRef.current)), humanTurnLimitMs(state));
    return () => clearTimeout(t);
  }, [awaitingHuman, turnToken, advance, state]);

  // Auto-pass a stuck shedding turn — the player has nothing to play, so there's
  // no button to press.
  useEffect(() => {
    if (!stuckShedding || reviewTrick !== null) return;
    const t = setTimeout(() => {
      const s = stateRef.current;
      if (
        s.phase === 'shedding' &&
        s.turn === TRIX_HUMAN &&
        sheddingPlayable(s.hands[TRIX_HUMAN] ?? [], s.layout).length === 0
      ) {
        advance({ type: 'PASS', seat: TRIX_HUMAN });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [stuckShedding, reviewTrick, turnToken, advance]);

  const chooseContract = useCallback(
    (contract: TrixContract) => {
      const s = stateRef.current;
      if (s.phase === 'contract-select' && s.king === TRIX_HUMAN) {
        advance({ type: 'CHOOSE_CONTRACT', seat: TRIX_HUMAN, contract });
      }
    },
    [advance],
  );

  const setDouble = useCallback(
    (cards: Card[]) => {
      const s = stateRef.current;
      if (s.phase === 'doubling' && s.turn === TRIX_HUMAN) {
        advance({ type: 'SET_DOUBLE', seat: TRIX_HUMAN, cards });
      }
    },
    [advance],
  );

  const playCard = useCallback(
    (card: Card) => {
      const s = stateRef.current;
      if ((s.phase === 'playing' || s.phase === 'shedding') && s.turn === TRIX_HUMAN) {
        advance({ type: 'PLAY', seat: TRIX_HUMAN, card });
      }
    },
    [advance],
  );

  const pass = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'shedding' && s.turn === TRIX_HUMAN) advance({ type: 'PASS', seat: TRIX_HUMAN });
  }, [advance]);

  const nextDeal = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === 'deal-over') advance({ type: 'NEXT_DEAL' });
  }, [advance]);

  const newGame = useCallback(() => {
    setReviewTrick(null);
    const fresh = createTrixGame({ mode, partnership });
    stateRef.current = fresh;
    setState(fresh);
  }, [mode, partnership]);

  return {
    state,
    humanSeat: TRIX_HUMAN,
    awaitingHuman,
    reviewTrick,
    turnLimitMs: humanTurnLimitMs(state),
    turnToken,
    chooseContract,
    setDouble,
    playCard,
    pass,
    nextDeal,
    newGame,
  };
}
