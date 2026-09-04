import type { Card, Suit } from '../cards.js';

/** Seats 0..3 around the table. Play moves counter-clockwise: next = (s + 1) % 4. */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

/** Team 0 = seats 0 & 2 (partners facing each other); Team 1 = seats 1 & 3. */
export type Team = 0 | 1;
export const teamOf = (s: Seat): Team => (s % 2) as Team;

/** Counter-clockwise (to the right) is the direction of play and the deal rotation. */
export const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat);
export const partnerOf = (s: Seat): Seat => (((s + 2) % 4) as Seat);

export type Phase =
  | 'bidding'      // players bid or pass, starting right of the dealer
  | 'trump-select' // the winning bidder names trump
  | 'playing'      // 13 tricks
  | 'hand-over'    // hand scored; awaiting NEXT_HAND
  | 'game-over';   // a team reached the target score

export const MIN_BID = 7;
export const MAX_BID = 13;
export const GAME_TARGET = 31;

export interface Bid {
  readonly seat: Seat;
  readonly amount: number; // 7..13
}

export interface PlayedCard {
  readonly seat: Seat;
  readonly card: Card;
}

export interface CompletedTrick {
  readonly leader: Seat;
  readonly cards: readonly PlayedCard[]; // in play order, length 4
  readonly winner: Seat;
}

/**
 * The full, serializable game state. The engine is a pure reducer over this:
 * (state, action) -> state. UI and bots read the same state and use the same
 * legal-move helpers, so there is a single source of truth for the rules.
 */
export interface TarneebState {
  readonly phase: Phase;
  readonly handNumber: number; // 0-based, increments each fresh deal (incl. redeals)
  readonly seed: number;       // base seed; each deal uses seed + handNumber

  readonly dealer: Seat;
  readonly turn: Seat;         // whose action the engine is waiting on

  readonly hands: readonly (readonly Card[])[]; // indexed by seat

  // --- bidding ---
  readonly passed: readonly boolean[];          // indexed by seat
  readonly bidLog: readonly (Bid | { seat: Seat; amount: 'pass' })[];
  readonly highBid: Bid | null;

  // --- contract ---
  readonly declarer: Seat | null;
  readonly trump: Suit | null;
  readonly contract: number | null; // winning bid amount

  // --- play ---
  readonly leader: Seat | null;
  readonly currentTrick: readonly PlayedCard[];
  readonly tricks: readonly CompletedTrick[];
  readonly tricksWon: readonly [number, number]; // by team

  // --- scoring ---
  readonly scores: readonly [number, number];    // cumulative, by team
  readonly lastHand: {
    readonly contract: number;
    readonly declarer: Seat;
    readonly trump: Suit;
    readonly declarerTricks: number;
    readonly delta: readonly [number, number];
  } | null;
  readonly winner: Team | null;
}

export type TarneebAction =
  | { readonly type: 'BID'; readonly seat: Seat; readonly amount: number }
  | { readonly type: 'PASS'; readonly seat: Seat }
  | { readonly type: 'SELECT_TRUMP'; readonly seat: Seat; readonly suit: Suit }
  | { readonly type: 'PLAY'; readonly seat: Seat; readonly card: Card }
  | { readonly type: 'NEXT_HAND' };
