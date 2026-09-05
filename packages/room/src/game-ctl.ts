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

export interface GameCtl<S, A> {
  create(seed?: number): S;
  legalActions(s: S): readonly A[];
  apply(s: S, a: A): S;
  botAction(s: S): A;
  /** Seat that owns action `a`, or null for a seatless auto-advance action. */
  actorOf(a: A): Seat | null;
  redact(s: S, seat: Seat): S;
  handCounts(s: S): number[];
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
  };
}
