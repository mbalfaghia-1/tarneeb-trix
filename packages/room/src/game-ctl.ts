// Thin adapters that give the Room a uniform view of either engine. Each control
// exposes: create, list legal actions, apply one, choose a bot action, tell which
// seat owns an action (null = a seatless auto-advance like NEXT_HAND / NEXT_DEAL),
// redact a state for one seat, and report hand sizes.
import {
  applyAction,
  applyTrixAction,
  createGame,
  createTrixGame,
  getLegalActions,
  getTrixLegalActions,
  type Seat,
  type TarneebAction,
  type TarneebState,
  type TrixAction,
  type TrixState,
} from '@tarneeb/engine';
import { chooseTarneebAction, chooseTrixAction } from '@tarneeb/ai';
import type { PaceHint } from './types.js';

export interface GameCtl<S, A> {
  create(seed?: number): S;
  legalActions(s: S): readonly A[];
  apply(s: S, a: A): S;
  botAction(s: S): A;
  /** Seat that owns action `a`, or null for a seatless auto-advance action. */
  actorOf(a: A): Seat | null;
  redact(s: S, seat: Seat): S;
  handCounts(s: S): number[];
  /**
   * True for a "freeform" action whose full parameter space `legalActions` cannot
   * enumerate — e.g. Trix SET_DOUBLE, which may carry any subset of the doubler's
   * eligible cards. The room can't exact-match these against the legal list, so it
   * validates the seat and lets `apply` validate the rest (it throws on anything
   * illegal). Absent/false → the action is exact-matched against `legalActions`.
   */
  isFreeform?(a: unknown): boolean;
  /** Pacing hint for the current position (paced/online play): 'deal' at a between-deals
   *  summary, 'trick' just after a trick completed, else 'normal'. Default 'normal'. */
  paceHint?(s: S): PaceHint;
  /** Seats that won the GAME (not just a hand/deal) — empty while not yet game-over, or
   *  on a tie. Both engines' winner fields are team/seat indices that overlap in range
   *  (0|1 for a team, or a lone seat), so each control normalizes its own meaning here. */
  winnerSeats(s: S): readonly Seat[];
}

const emptyOtherHands = <S extends { hands: readonly (readonly unknown[])[] }>(
  s: S,
  seat: Seat,
): S => ({
  ...s,
  hands: s.hands.map((h, i) => (i === seat ? h : [])),
});

export const tarneebCtl: GameCtl<TarneebState, TarneebAction> = {
  create: (seed) => createGame(seed === undefined ? {} : { seed }),
  legalActions: (s) => getLegalActions(s),
  apply: (s, a) => applyAction(s, a),
  botAction: (s) => chooseTarneebAction(s),
  actorOf: (a) => (a.type === 'NEXT_HAND' ? null : a.seat),
  redact: (s, seat) => emptyOtherHands(s, seat),
  handCounts: (s) => s.hands.map((h) => h.length),
  paceHint: (s) => {
    if (s.phase === 'hand-over') return 'deal';
    if (s.phase === 'playing' && s.currentTrick.length === 0 && s.tricks.length > 0) return 'trick';
    return 'normal';
  },
  // Tarneeb teams: seats {0,2} = team 0, seats {1,3} = team 1.
  winnerSeats: (s) => (s.winner === 0 ? [0, 2] : s.winner === 1 ? [1, 3] : []),
};

export function makeTrixCtl(
  mode: TrixState['mode'],
  partnership: boolean,
): GameCtl<TrixState, TrixAction> {
  return {
    create: (seed) =>
      createTrixGame({ mode, partnership, ...(seed === undefined ? {} : { seed }) }),
    legalActions: (s) => getTrixLegalActions(s),
    apply: (s, a) => applyTrixAction(s, a),
    botAction: (s) => chooseTrixAction(s),
    actorOf: (a) => (a.type === 'NEXT_DEAL' ? null : a.seat),
    redact: (s, seat) => emptyOtherHands(s, seat),
    handCounts: (s) => s.hands.map((h) => h.length),
    // SET_DOUBLE carries a chosen card subset that legalActions can't enumerate.
    isFreeform: (a) =>
      typeof a === 'object' && a !== null && (a as { type?: unknown }).type === 'SET_DOUBLE',
    paceHint: (s): PaceHint => {
      if (s.phase === 'deal-over') return 'deal';
      const tricksTaken = s.tricksTaken.reduce((a, b) => a + b, 0);
      if (s.phase === 'playing' && s.currentTrick.length === 0 && tricksTaken > 0) return 'trick';
      return 'normal';
    },
    // Individual mode: s.winner IS the winning seat. Partnership mode: s.winner is a
    // TEAM index (0 = seats {0,2}, 1 = seats {1,3}) despite sharing the Seat type.
    winnerSeats: (s) => {
      if (s.winner === null || s.winner === 'tie') return [];
      if (!partnership) return [s.winner];
      return s.winner === 0 ? [0, 2] : [1, 3];
    },
  };
}
