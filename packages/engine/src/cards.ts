import { makeRng, shuffleInPlace } from './rng.js';

/** Suits. Single-letter codes keep card ids compact and locale-independent. */
export type Suit = 'C' | 'D' | 'H' | 'S';
export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S'] as const;

export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };
export const SUIT_IS_RED: Record<Suit, boolean> = { C: false, D: true, H: true, S: false };

/**
 * Rank as a number so comparisons are trivial. Face cards map high:
 * J=11, Q=12, K=13, A=14. Order high→low: A K Q J 10 9 8 7 6 5 4 3 2.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export const RANK_LABEL: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Compact stable id, e.g. "AS", "10H", "2C". */
export function cardId(c: Card): string {
  return `${RANK_LABEL[c.rank]}${c.suit}`;
}

/** Human label, e.g. "A♠". */
export function formatCard(c: Card): string {
  return `${RANK_LABEL[c.rank]}${SUIT_SYMBOL[c.suit]}`;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** A fresh, ordered 52-card deck. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank });
  }
  return deck;
}

/** A shuffled deck for the given seed (deterministic). */
export function shuffledDeck(seed: number): Card[] {
  return shuffleInPlace(makeDeck(), makeRng(seed));
}

/**
 * Sort a hand for display: group by suit, ranks high→low within a suit.
 * Suit grouping order is fixed (C, D, H, S) so the UI is stable.
 */
export function sortHand(cards: readonly Card[]): Card[] {
  const suitOrder: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 };
  return [...cards].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return b.rank - a.rank;
  });
}
