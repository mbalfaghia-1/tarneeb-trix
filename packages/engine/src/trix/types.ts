import type { Card, Rank, Suit } from '../cards.js';
import type { PlayedCard, Seat } from '../tarneeb/types.js';

/**
 * Trix contracts. In regular Trix: four avoidance trick-games + `trix` shedding.
 * In Trix Complex: `complex` (all avoidance penalties stacked) + `trix` shedding.
 */
export type TrixContract =
  | 'kingOfHearts'
  | 'diamonds'
  | 'queens'
  | 'collection'
  | 'trix'
  | 'complex';

export const TRIX_CONTRACTS: readonly TrixContract[] = [
  'kingOfHearts',
  'diamonds',
  'queens',
  'collection',
  'trix',
] as const;

export const COMPLEX_CONTRACTS: readonly TrixContract[] = ['complex', 'trix'] as const;

export type TrixMode = 'regular' | 'complex';

/** The contracts a kingdom cycles through in the given mode. */
export function contractsForMode(mode: TrixMode): readonly TrixContract[] {
  return mode === 'complex' ? COMPLEX_CONTRACTS : TRIX_CONTRACTS;
}

/** Team totals for partnership scoring: [team 0 = seats 0+2, team 1 = seats 1+3]. */
export function trixTeamScores(scores: readonly number[]): [number, number] {
  return [(scores[0] ?? 0) + (scores[2] ?? 0), (scores[1] ?? 0) + (scores[3] ?? 0)];
}

export type TrixPhase =
  | 'contract-select' // the king picks one of the remaining contracts
  | 'doubling'        // K♥/Queens holders may reveal & double before play
  | 'playing'         // an avoidance trick-game is in progress
  | 'shedding'        // the Trix shedding contract is in progress
  | 'deal-over'       // the deal is scored; awaiting NEXT_DEAL
  | 'game-over';      // all 4 kingdoms × 5 contracts played

/** A card a holder revealed and doubled (King of Hearts / a Queen). */
export interface DoubledCard {
  readonly card: Card;
  readonly by: Seat; // the seat that revealed it
}

/** Inclusive played rank-range of one suit's shedding chain (starts at the Jack). */
export interface SuitRange {
  readonly low: Rank;
  readonly high: Rank;
}
export type SheddingLayout = Record<Suit, SuitRange | null>;

export const KINGDOMS = 4;
export const CONTRACTS_PER_KINGDOM = 5;
export const TOTAL_DEALS = KINGDOMS * CONTRACTS_PER_KINGDOM; // 20

/**
 * Full serializable Trix state (individual scoring). Like the Tarneeb engine it
 * is driven by a pure reducer over public data.
 */
export interface TrixState {
  readonly mode: TrixMode;
  /** When true, the winner is decided by summed team totals (seats 0+2 vs 1+3). */
  readonly partnership: boolean;
  readonly seed: number;
  readonly dealNumber: number; // 0-based
  readonly kingdomIndex: number; // 0..3
  readonly king: Seat; // owns the kingdom; chooses contracts and leads every deal
  readonly firstKing: Seat; // holder of 7♥ on the very first deal
  readonly usedContracts: readonly TrixContract[]; // used so far this kingdom
  readonly contract: TrixContract | null;

  readonly phase: TrixPhase;
  readonly hands: readonly (readonly Card[])[];
  readonly turn: Seat;
  readonly leader: Seat | null;

  // avoidance trick-games
  readonly currentTrick: readonly PlayedCard[];
  readonly captured: readonly (readonly Card[])[]; // cards each seat has taken this deal
  readonly tricksTaken: readonly number[]; // per seat
  readonly voids: readonly (readonly Suit[])[]; // suits each seat has shown void in

  // doubling (King of Hearts / Queens contracts)
  readonly doublePending: readonly Seat[]; // eligible holders still to decide
  readonly doubled: readonly DoubledCard[];

  // shedding
  readonly layout: SheddingLayout;
  readonly finishOrder: readonly Seat[]; // order players emptied their hands
  /** 2s revealed face-up at shedding start (info only) — when the four 2s are
   *  spread across more than 3 players. Empty otherwise. */
  readonly exposedTwos: readonly { readonly card: Card; readonly holder: Seat }[];

  // scoring (per seat, individual)
  readonly scores: readonly number[];
  readonly dealResult: { readonly contract: TrixContract; readonly delta: readonly number[] } | null;
  readonly winner: Seat | 'tie' | null;
}

export type TrixAction =
  | { readonly type: 'CHOOSE_CONTRACT'; readonly seat: Seat; readonly contract: TrixContract }
  | { readonly type: 'SET_DOUBLE'; readonly seat: Seat; readonly cards: readonly Card[] } // doubling
  | { readonly type: 'PLAY'; readonly seat: Seat; readonly card: Card }
  | { readonly type: 'PASS'; readonly seat: Seat } // shedding only, when nothing is playable
  | { readonly type: 'NEXT_DEAL' };
