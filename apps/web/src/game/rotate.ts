// Rotate a game state so a chosen viewer seat becomes seat 0. The single-player board
// components all assume the human is seat 0 (bottom of the table); by rotating the
// server's redacted state we can reuse every one of them for an online player sitting
// in any seat, with no per-component changes. Actions are still built with the real
// seat (the caller knows its own seat), so only rendering uses the rotated copy.
import type {
  CompletedTrick,
  PlayedCard,
  Seat,
  TarneebState,
  Team,
  TrixState,
} from '@tarneeb/engine';

const rseat = (s: Seat, shift: number): Seat => ((((s - shift) % 4) + 4) % 4) as Seat;

/** New index i holds the seat that is `i` seats clockwise from the viewer. */
function bySeat<T>(arr: readonly T[], shift: number): T[] {
  return [0, 1, 2, 3].map((i) => arr[(i + shift) % 4]!);
}

export function rotateTarneeb(state: TarneebState, viewer: Seat): TarneebState {
  const sh = viewer;
  const rs = (s: Seat) => rseat(s, sh);
  const rpc = (pc: PlayedCard): PlayedCard => ({ seat: rs(pc.seat), card: pc.card });
  const rtrick = (t: CompletedTrick): CompletedTrick => ({
    leader: rs(t.leader),
    winner: rs(t.winner),
    cards: t.cards.map(rpc),
  });
  // Rotating by an odd number of seats swaps the two teams (0&2 ↔ 1&3).
  const flip = sh % 2 === 1;
  const team2 = <T>(a: readonly [T, T]): [T, T] => (flip ? [a[1], a[0]] : [a[0], a[1]]);
  return {
    ...state,
    hands: bySeat(state.hands, sh),
    passed: bySeat(state.passed, sh),
    dealer: rs(state.dealer),
    turn: rs(state.turn),
    declarer: state.declarer === null ? null : rs(state.declarer),
    leader: state.leader === null ? null : rs(state.leader),
    currentTrick: state.currentTrick.map(rpc),
    tricks: state.tricks.map(rtrick),
    tricksWon: team2(state.tricksWon),
    scores: team2(state.scores),
    bidLog: state.bidLog.map((e) => ({ ...e, seat: rs(e.seat) })),
    highBid: state.highBid === null ? null : { ...state.highBid, seat: rs(state.highBid.seat) },
    lastHand:
      state.lastHand === null
        ? null
        : { ...state.lastHand, declarer: rs(state.lastHand.declarer), delta: team2(state.lastHand.delta) },
    winner: state.winner === null ? null : (((state.winner + (flip ? 1 : 0)) % 2) as Team),
  };
}

export function rotateTrix(state: TrixState, viewer: Seat): TrixState {
  const sh = viewer;
  const rs = (s: Seat) => rseat(s, sh);
  const rpc = (pc: PlayedCard): PlayedCard => ({ seat: rs(pc.seat), card: pc.card });
  return {
    ...state,
    hands: bySeat(state.hands, sh),
    turn: rs(state.turn),
    leader: state.leader === null ? null : rs(state.leader),
    king: rs(state.king),
    firstKing: rs(state.firstKing),
    currentTrick: state.currentTrick.map(rpc),
    captured: bySeat(state.captured, sh),
    tricksTaken: bySeat(state.tricksTaken, sh),
    voids: bySeat(state.voids, sh),
    doublePending: state.doublePending.map(rs),
    doubled: state.doubled.map((d) => ({ ...d, by: rs(d.by) })),
    ...(state.doubledLeaders
      ? { doubledLeaders: state.doubledLeaders.map((d) => ({ ...d, leader: rs(d.leader) })) }
      : {}),
    finishOrder: state.finishOrder.map(rs),
    exposedTwos: state.exposedTwos.map((e) => ({ ...e, holder: rs(e.holder) })),
    scores: bySeat(state.scores, sh),
    dealResult:
      state.dealResult === null
        ? null
        : { ...state.dealResult, delta: bySeat(state.dealResult.delta, sh) },
    winner:
      state.winner === null || state.winner === 'tie' ? state.winner : rs(state.winner),
  };
}
