import type { Card, Suit } from '../cards.js';
import { cardsEqual } from '../cards.js';
import type { PlayedCard, Seat, Team } from './types.js';
import { MAX_BID, MIN_BID, teamOf } from './types.js';

/**
 * Legal cards a player may play into the current trick.
 * Rule: you must follow the led suit if you can; otherwise any card.
 */
export function legalPlays(hand: readonly Card[], currentTrick: readonly PlayedCard[]): Card[] {
  if (currentTrick.length === 0) return [...hand];
  const led = currentTrick[0]!.card.suit;
  const following = hand.filter((c) => c.suit === led);
  return following.length > 0 ? following : [...hand];
}

export function canPlay(hand: readonly Card[], currentTrick: readonly PlayedCard[], card: Card): boolean {
  if (!hand.some((c) => cardsEqual(c, card))) return false;
  return legalPlays(hand, currentTrick).some((c) => cardsEqual(c, card));
}

/**
 * Winner of a completed (or partial) trick: highest trump wins; if no trump
 * was played, the highest card of the led suit wins. Off-suit non-trump cards
 * can never win.
 */
export function trickWinner(cards: readonly PlayedCard[], trump: Suit): Seat {
  if (cards.length === 0) throw new Error('trickWinner: empty trick');
  const led = cards[0]!.card.suit;
  let best = cards[0]!;
  for (const pc of cards) {
    if (cardBeats(pc.card, best.card, trump, led)) best = pc;
  }
  return best.seat;
}

/** Does card `a` beat the current-best card `b`, given trump and the led suit? */
export function cardBeats(a: Card, b: Card, trump: Suit, led: Suit): boolean {
  const aTrump = a.suit === trump;
  const bTrump = b.suit === trump;
  if (aTrump && !bTrump) return true;
  if (!aTrump && bTrump) return false;
  if (aTrump && bTrump) return a.rank > b.rank;
  // neither is trump: only led-suit cards are live
  const aLed = a.suit === led;
  const bLed = b.suit === led;
  if (aLed && !bLed) return true;
  if (!aLed && bLed) return false;
  if (aLed && bLed) return a.rank > b.rank;
  return false; // both off-suit, non-trump
}

/** Lowest legal bid given the current high bid (null = no bid yet). */
export function minLegalBid(highBidAmount: number | null): number {
  return highBidAmount === null ? MIN_BID : highBidAmount + 1;
}

/** The bid amounts a player may currently choose (empty once 13 is bid). */
export function legalBidAmounts(highBidAmount: number | null): number[] {
  const min = minLegalBid(highBidAmount);
  const out: number[] = [];
  for (let a = min; a <= MAX_BID; a++) out.push(a);
  return out;
}

/**
 * Score a completed hand. Returns the per-team point delta [team0, team1].
 *
 * Rules (from the design doc):
 *  - Bid < 13, made (won >= bid): declarer team scores the tricks it actually
 *    won; opponents score 0. Kaboot (all 13 on a sub-13 bid): +3 bonus (=16).
 *  - Bid < 13, failed: declarer team scores -bid; opponents score their tricks.
 *  - Bid == 13, all 13 won: +26. Bid == 13, any trick lost: -16, and
 *    opponents score double the tricks they won.
 */
export function scoreHand(
  contract: number,
  declarer: Seat,
  declarerTricks: number,
): [number, number] {
  const dTeam = teamOf(declarer);
  const oTeam = (1 - dTeam) as Team;
  const oppTricks = 13 - declarerTricks;
  const delta: [number, number] = [0, 0];

  if (contract < 13) {
    if (declarerTricks >= contract) {
      delta[dTeam] = declarerTricks === 13 ? 16 : declarerTricks; // kaboot +3
    } else {
      delta[dTeam] = -contract;
      delta[oTeam] = oppTricks;
    }
  } else {
    // contract == 13
    if (declarerTricks === 13) {
      delta[dTeam] = 26;
    } else {
      delta[dTeam] = -16;
      delta[oTeam] = 2 * oppTricks;
    }
  }
  return delta;
}
