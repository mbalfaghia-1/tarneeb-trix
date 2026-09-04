import type { Card, Suit } from '../cards.js';
import type { PlayedCard, Seat } from '../tarneeb/types.js';
import { SEATS } from '../tarneeb/types.js';
import type { SheddingLayout, SuitRange, TrixContract } from './types.js';

export const KING_OF_HEARTS: Card = { suit: 'H', rank: 13 };
const JACK = 11;
const SUITS_ALL: readonly Suit[] = ['C', 'D', 'H', 'S'];

/** Can this card be revealed and doubled under the given contract? */
export function isDoubleable(card: Card, contract: TrixContract): boolean {
  const isKingOfHearts = card.suit === 'H' && card.rank === 13;
  if (contract === 'kingOfHearts') return isKingOfHearts;
  if (contract === 'queens') return card.rank === 12;
  if (contract === 'complex') return card.rank === 12 || isKingOfHearts; // K♥ and queens
  return false;
}

// --- avoidance trick-games (no trump) --------------------------------------

/** Winner of a no-trump trick: the highest card of the led suit. */
export function avoidanceTrickWinner(cards: readonly PlayedCard[]): Seat {
  if (cards.length === 0) throw new Error('avoidanceTrickWinner: empty trick');
  const led = cards[0]!.card.suit;
  let best = cards[0]!;
  for (const pc of cards) {
    if (pc.card.suit === led && pc.card.rank > best.card.rank) best = pc;
  }
  return best.seat;
}

/** Has an avoidance contract reached its early end? */
export function isAvoidanceDealOver(
  contract: TrixContract,
  captured: readonly (readonly Card[])[],
  completedTricks: number,
): boolean {
  switch (contract) {
    case 'kingOfHearts':
      return captured.some((pile) => pile.some((c) => c.suit === 'H' && c.rank === 13));
    case 'diamonds':
      return countAll(captured, (c) => c.suit === 'D') === 13;
    case 'queens':
      return countAll(captured, (c) => c.rank === 12) === 4;
    case 'collection':
      return completedTricks === 13;
    default:
      return completedTricks === 13;
  }
}

function countAll(piles: readonly (readonly Card[])[], pred: (c: Card) => boolean): number {
  let n = 0;
  for (const pile of piles) for (const c of pile) if (pred(c)) n++;
  return n;
}

// --- shedding (Trix contract) ----------------------------------------------

/**
 * Cards playable in the shedding contract: a Jack opens a suit's chain; after
 * that you may extend a suit by exactly one rank below its low or above its high.
 */
export function sheddingPlayable(hand: readonly Card[], layout: SheddingLayout): Card[] {
  const out: Card[] = [];
  for (const c of hand) {
    const range = layout[c.suit];
    if (range === null) {
      if (c.rank === JACK) out.push(c);
    } else if (c.rank === range.low - 1 || c.rank === range.high + 1) {
      out.push(c);
    }
  }
  return out;
}

/** Return a new layout with `card` added to its suit's chain. */
export function extendLayout(layout: SheddingLayout, card: Card): SheddingLayout {
  const range = layout[card.suit];
  let next: SuitRange;
  if (range === null) {
    next = { low: JACK, high: JACK };
  } else if (card.rank === range.low - 1) {
    next = { low: card.rank, high: range.high };
  } else {
    next = { low: range.low, high: card.rank };
  }
  return { ...layout, [card.suit]: next };
}

export function emptyLayout(): SheddingLayout {
  return { C: null, D: null, H: null, S: null };
}

// --- scoring ----------------------------------------------------------------

export interface DealTally {
  readonly captured: readonly (readonly Card[])[];
  readonly tricksTaken: readonly number[];
  readonly finishOrder: readonly Seat[];
  /** Cards that were revealed and doubled (K♥ / Queens). Defaults to none. */
  readonly doubled?: readonly { readonly card: Card; readonly by: Seat }[];
  /** Leader of the trick each doubled card was played in (for forced-vs-natural). */
  readonly doubledLeaders?: readonly { readonly card: Card; readonly leader: Seat }[];
}

const SHEDDING_POINTS = [200, 150, 100, 50] as const;

/** The seat that doubled this exact card, or null if it was not doubled. */
function doublerOf(tally: DealTally, suit: Card['suit'], rank: Card['rank']): Seat | null {
  const d = tally.doubled?.find((x) => x.card.suit === suit && x.card.rank === rank);
  return d ? d.by : null;
}

/** Leader of the trick that captured this doubled card, or null if unknown. */
function leaderOf(tally: DealTally, suit: Card['suit'], rank: Card['rank']): Seat | null {
  const l = tally.doubledLeaders?.find((x) => x.card.suit === suit && x.card.rank === rank);
  return l ? l.leader : null;
}

/**
 * Score a doubled penalty card the DOUBLER ended up capturing itself. Forced out by
 * another seat (someone else led its suit) → doubled penalty to the doubler and the
 * reward to the forcer. Taken naturally (the doubler led that trick, sweeping) → just
 * the single penalty, no reward.
 */
function scoreSelfCaughtDouble(
  delta: Delta,
  tally: DealTally,
  suit: Card['suit'],
  rank: Card['rank'],
  taker: Seat,
  single: number,
  doubledPenalty: number,
  reward: number,
): void {
  const leader = leaderOf(tally, suit, rank);
  if (leader !== null && leader !== taker) {
    delta[taker] += doubledPenalty; // forced out by another
    delta[leader] += reward; // the forcer's bonus
  } else {
    delta[taker] += single; // natural capture (led it / swept)
  }
}

type Delta = [number, number, number, number];

/**
 * K♥ penalty with doubling:
 *  - caught by another (doubler avoided it) → taker -150, doubler +75.
 *  - doubler forced to catch its own (an opponent led it) → doubler -150, forcer +75.
 *  - doubler caught its own naturally (led it while sweeping) → -75.
 *  - undoubled → -75.
 */
function applyKingOfHearts(delta: Delta, tally: DealTally): void {
  const taker = seatThatCaptured(tally.captured, (c) => c.suit === 'H' && c.rank === 13);
  if (taker === null) return;
  const by = doublerOf(tally, 'H', 13);
  if (by !== null && by !== taker) {
    delta[taker] += -150;
    delta[by] += 75;
  } else if (by !== null) {
    scoreSelfCaughtDouble(delta, tally, 'H', 13, taker, -75, -150, 75);
  } else {
    delta[taker] += -75;
  }
}

/**
 * Each queen with doubling: caught by another → -50/+25; doubler forced to catch its
 * own (opponent led) → -50 with +25 to the forcer; caught naturally / undoubled → -25.
 */
function applyQueens(delta: Delta, tally: DealTally): void {
  for (const suit of SUITS_ALL) {
    const taker = seatThatCaptured(tally.captured, (c) => c.suit === suit && c.rank === 12);
    if (taker === null) continue;
    const by = doublerOf(tally, suit, 12);
    if (by !== null && by !== taker) {
      delta[taker] += -50;
      delta[by] += 25;
    } else if (by !== null) {
      scoreSelfCaughtDouble(delta, tally, suit, 12, taker, -25, -50, 25);
    } else {
      delta[taker] += -25;
    }
  }
}

/** Per-seat score delta for a completed deal of the given contract. */
export function scoreTrixDeal(contract: TrixContract, tally: DealTally): number[] {
  const delta: Delta = [0, 0, 0, 0];
  switch (contract) {
    case 'kingOfHearts':
      applyKingOfHearts(delta, tally);
      break;
    case 'diamonds':
      for (const s of SEATS) delta[s] = -10 * countPile(tally.captured[s]!, (c) => c.suit === 'D');
      break;
    case 'queens':
      applyQueens(delta, tally);
      break;
    case 'collection':
      for (const s of SEATS) delta[s] = -15 * (tally.tricksTaken[s] ?? 0);
      break;
    case 'complex':
      // Every avoidance penalty stacked into one deal.
      applyKingOfHearts(delta, tally);
      applyQueens(delta, tally);
      for (const s of SEATS) {
        delta[s] += -10 * countPile(tally.captured[s]!, (c) => c.suit === 'D');
        delta[s] += -15 * (tally.tricksTaken[s] ?? 0);
      }
      break;
    case 'trix': {
      const order = completeFinishOrder(tally.finishOrder);
      order.forEach((seat, i) => {
        delta[seat] = SHEDDING_POINTS[i] ?? 0;
      });
      break;
    }
  }
  return delta.map((v) => (v === 0 ? 0 : v)); // collapse -0 to +0
}

function seatThatCaptured(
  captured: readonly (readonly Card[])[],
  pred: (c: Card) => boolean,
): Seat | null {
  for (const s of SEATS) {
    if (captured[s]!.some(pred)) return s;
  }
  return null;
}

function countPile(pile: readonly Card[], pred: (c: Card) => boolean): number {
  return pile.reduce((n, c) => n + (pred(c) ? 1 : 0), 0);
}

/** Ensure all four seats are present; the missing one finishes last. */
function completeFinishOrder(order: readonly Seat[]): Seat[] {
  const full = [...order];
  for (const s of SEATS) if (!full.includes(s)) full.push(s);
  return full;
}
