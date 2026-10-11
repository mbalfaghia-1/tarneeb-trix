import type { Card, Suit, Seat, TarneebAction, TarneebState } from '@tarneeb/engine';
import { MAX_BID, SUITS, minLegalBid } from '@tarneeb/engine';
import { buildKnowledge } from './knowledge.js';
import { choosePlay } from './play.js';
import { DEFAULT_TARNEEB_PARAMS, type TarneebBotParams } from './params.js';

export type { TarneebBotParams } from './params.js';
export { DEFAULT_TARNEEB_PARAMS } from './params.js';

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
export function chooseTarneebAction(
  state: TarneebState,
  params: TarneebBotParams = DEFAULT_TARNEEB_PARAMS,
): TarneebAction {
  const seat = state.turn;
  switch (state.phase) {
    case 'bidding':
      return chooseBid(state, seat, params);
    case 'trump-select':
      return { type: 'SELECT_TRUMP', seat, suit: bestSuit(state.hands[seat]!, params) };
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

function chooseBid(state: TarneebState, seat: Seat, params: TarneebBotParams): TarneebAction {
  const hand = state.hands[seat]!;
  const trump = bestSuit(hand, params);
  const trumpHonours = hand.filter((c) => c.suit === trump && c.rank >= 11).length;
  const sideHonours = hand.filter((c) => c.suit !== trump && c.rank >= 11).length;
  if (trumpHonours < params.minTrumpHonoursToBid || sideHonours < params.minSideHonoursToBid) {
    return { type: 'PASS', seat };
  }

  const ceiling = clamp(Math.round(estimateTricks(hand, params)) + params.partnerAllowance, 0, MAX_BID);
  const min = minLegalBid(state.highBid?.amount ?? null);
  if (ceiling >= min) return { type: 'BID', seat, amount: min };
  return { type: 'PASS', seat };
}

/** Rough trick estimate: top honours per suit + trump length beyond three. */
function estimateTricks(hand: readonly Card[], params: TarneebBotParams): number {
  const trump = bestSuit(hand, params);
  let honours = 0;
  for (const suit of SUITS) honours += honourTricks(hand.filter((c) => c.suit === suit), params);
  const trumpLen = hand.filter((c) => c.suit === trump).length;
  return honours + Math.max(0, trumpLen - 3);
}

/** Sure honour tricks, top-down: A=1, A-K=2, A-K-Q=3; a K without the A ≈ 0.5. */
function honourTricks(cards: readonly Card[], params: TarneebBotParams): number {
  const has = (r: number) => cards.some((c) => c.rank === r);
  const A = has(14);
  const K = has(13);
  const Q = has(12);
  if (A && K && Q) return params.honourAceKingQueen;
  if (A && K) return params.honourAceKing;
  if (A) return params.honourAce;
  if (K) return params.honourKingOnly;
  return 0;
}

/** Longest suit; ties broken by most honour tricks. Used for trump choice. */
function bestSuit(hand: readonly Card[], params: TarneebBotParams): Suit {
  let best: Suit = 'S';
  let bestScore = -Infinity;
  for (const suit of SUITS) {
    const cards = hand.filter((c) => c.suit === suit);
    const score = cards.length * params.suitLengthWeight + honourTricks(cards, params);
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
