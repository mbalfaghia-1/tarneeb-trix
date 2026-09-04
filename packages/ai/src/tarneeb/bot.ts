import type { Card, Suit, Seat, TarneebAction, TarneebState } from '@tarneeb/engine';
import { MAX_BID, SUITS, minLegalBid } from '@tarneeb/engine';
import { buildKnowledge } from './knowledge.js';
import { choosePlay } from './play.js';

/**
 * Full-playbook Tarneeb bot. Rule-based and deterministic given the state. It
 * reasons only from its own hand plus public information (trump, the current
 * trick, and completed-trick history) via the inference layer in knowledge.ts —
 * it never peeks at another player's cards.
 *
 *   Bidding  : B1  (sure honour tricks + trump length, shaded for risk)
 *   Play     : T1–T11 declarer/partnership tactics and D1–D2 defense
 *              (see play.ts), built on card counting / void inference.
 */
export function chooseTarneebAction(state: TarneebState): TarneebAction {
  const seat = state.turn;
  switch (state.phase) {
    case 'bidding':
      return chooseBid(state, seat);
    case 'trump-select':
      return { type: 'SELECT_TRUMP', seat, suit: bestSuit(state.hands[seat]!) };
    case 'playing': {
      const k = buildKnowledge(state, seat);
      return { type: 'PLAY', seat, card: choosePlay(state, seat, k) };
    }
    default:
      throw new Error(`Bot cannot act in phase ${state.phase}`);
  }
}

// ---------------------------------------------------------------------------
// B1 — Bidding
// ---------------------------------------------------------------------------

function chooseBid(state: TarneebState, seat: Seat): TarneebAction {
  const hand = state.hands[seat]!;
  // Our own sure tricks. A bid is a TEAM claim (min 7 of 13), so add a conservative
  // allowance for our unseen partner (~a quarter of the deck) to get expected team
  // tricks. Failing costs minus the bid and overbidding earns nothing extra (a made
  // bid scores actual tricks), so we bid the MINIMUM needed to stay in the auction —
  // never above our ceiling — and simply pass a hand too weak to want it. All four
  // passing just redeals, so there is no need to prop up a bad hand with a bid.
  const ceiling = clamp(Math.round(estimateTricks(hand)) + PARTNER_ALLOWANCE, 0, MAX_BID);
  const min = minLegalBid(state.highBid?.amount ?? null);
  if (ceiling >= min) return { type: 'BID', seat, amount: min };
  return { type: 'PASS', seat };
}

/** Rough tricks an unseen partner adds to our own count (a shade under an even quarter). */
const PARTNER_ALLOWANCE = 3;

/** Rough trick estimate: top honours per suit + trump length beyond three. */
function estimateTricks(hand: readonly Card[]): number {
  const trump = bestSuit(hand);
  let honours = 0;
  for (const suit of SUITS) honours += honourTricks(hand.filter((c) => c.suit === suit));
  const trumpLen = hand.filter((c) => c.suit === trump).length;
  return honours + Math.max(0, trumpLen - 3);
}

/** Sure honour tricks, top-down: A=1, A-K=2, A-K-Q=3; a K without the A ≈ 0.5. */
function honourTricks(cards: readonly Card[]): number {
  const has = (r: number) => cards.some((c) => c.rank === r);
  const A = has(14);
  const K = has(13);
  const Q = has(12);
  if (A && K && Q) return 3;
  if (A && K) return 2;
  if (A) return 1;
  if (K) return 0.5;
  return 0;
}

/** Longest suit; ties broken by most honour tricks. Used for trump choice. */
function bestSuit(hand: readonly Card[]): Suit {
  let best: Suit = 'S';
  let bestScore = -Infinity;
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.suit === suit);
    const score = cards.length * 10 + honourTricks(cards);
    if (score > bestScore) {
      bestScore = score;
      best = suit;
    }
  }
  return best;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
