import type { Card, PlayedCard, Rank, Seat, Suit, TarneebState } from '@tarneeb/engine';
import { RANKS, SUITS, cardId } from '@tarneeb/engine';

/**
 * What a fair bot can infer from PUBLIC information only — the completed tricks,
 * the current trick, and its own hand. It never looks at other players' cards.
 * This is the "core capabilities" layer from the strategy doc: card counting,
 * void inference, and outstanding-card reasoning.
 */
export interface Knowledge {
  readonly me: Seat;
  readonly trump: Suit;
  /** Has `seat` been shown void in `suit` (failed to follow it)? */
  isVoid(seat: Seat, suit: Suit): boolean;
  /** Ranks of `suit` neither seen in play nor in my own hand (held by others). */
  outstanding(suit: Suit): Rank[];
  /** Highest such outstanding rank, or null if none remain out. */
  highestOutstanding(suit: Suit): Rank | null;
  /** Count of trumps still outstanding (not seen, not mine). */
  trumpsOutstanding(): number;
  /** Could `seat` plausibly hold this exact card? (not me, not seen/mine, not void) */
  couldHold(seat: Seat, suit: Suit, rank: Rank): boolean;
}

const emptyVoids = (): Record<Seat, Set<Suit>> => ({
  0: new Set<Suit>(),
  1: new Set<Suit>(),
  2: new Set<Suit>(),
  3: new Set<Suit>(),
});

export function buildKnowledge(state: TarneebState, me: Seat): Knowledge {
  const trump = state.trump!;
  const myHand = state.hands[me] ?? [];
  const myIds = new Set(myHand.map(cardId));
  const played = new Set<string>();
  const voids = emptyVoids();

  const ingest = (cards: readonly PlayedCard[]): void => {
    if (cards.length === 0) return;
    const led = cards[0]!.card.suit;
    for (const pc of cards) {
      played.add(cardId(pc.card));
      if (pc.card.suit !== led) voids[pc.seat].add(led); // didn't follow → void in led
    }
  };
  for (const t of state.tricks) ingest(t.cards);
  ingest(state.currentTrick);

  const idOf = (suit: Suit, rank: Rank): string => cardId({ suit, rank } as Card);

  const outstanding = (suit: Suit): Rank[] =>
    RANKS.filter((r) => {
      const id = idOf(suit, r);
      return !played.has(id) && !myIds.has(id);
    });

  return {
    me,
    trump,
    isVoid: (seat, suit) => voids[seat].has(suit),
    outstanding,
    highestOutstanding: (suit) => {
      const out = outstanding(suit);
      return out.length ? out[out.length - 1]! : null;
    },
    trumpsOutstanding: () => outstanding(trump).length,
    couldHold: (seat, suit, rank) => {
      if (seat === me) return false;
      if (voids[seat].has(suit)) return false;
      const id = idOf(suit, rank);
      return !played.has(id) && !myIds.has(id);
    },
  };
}

/** Both of `team`'s opponents have shown void in trump (T4 / D1 signal). */
export function bothOpponentsVoidOfTrump(k: Knowledge, team: 0 | 1): boolean {
  const opps: Seat[] = team === 0 ? [1, 3] : [0, 2];
  return opps.every((s) => k.isVoid(s, k.trump));
}

/** The non-trump suits present, with a strength score = length*2 + honour weight. */
export function suitStrength(hand: readonly Card[], suit: Suit): number {
  const cards = hand.filter((c) => c.suit === suit);
  let honour = 0;
  for (const c of cards) {
    if (c.rank === 14) honour += 3;
    else if (c.rank === 13) honour += 2;
    else if (c.rank === 12) honour += 1;
  }
  return cards.length * 2 + honour;
}

export { SUITS };
