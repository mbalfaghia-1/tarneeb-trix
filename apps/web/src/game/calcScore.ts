// Scoring helpers for the standalone real-life score calculators.
//
// Tarneeb reuses the engine's tested scoreHand. Trix is scored directly from the
// per-item point values (mirroring packages/engine/src/trix/rules.ts) because the
// calculator takes COUNTS, not cards: in a real deal the Queen of Diamonds is a
// single card counted in both the 13 diamonds and the 4 queens, so a count-based
// score must add −10 (as a diamond) and −25 (as a queen) from the user's totals —
// never synthesize cards, which would double-count that overlap. Doubling is not
// modelled here (players can adjust manually if they doubled).
import { scoreHand, type Seat, type TrixContract } from '@tarneeb/engine';

export type CalcContract = TrixContract; // kingOfHearts | diamonds | queens | collection | trix | complex

/**
 * A doubled queen: who doubled it, who captured it, and — only when the doubler
 * caught its own (by === taker) — who forced it (led the suit). forcedBy null on a
 * self-catch means a natural sweep (single penalty, no reward).
 */
export interface DoubledQueen {
  by: Seat;
  taker: Seat;
  forcedBy: Seat | null;
}

/** Simplified per-deal inputs a human enters after a real-life Trix deal. */
export interface TrixDealInputs {
  /** Seat that captured the King of Hearts (kingOfHearts, complex). */
  kohTaker?: Seat | null;
  /** Diamonds captured per seat, indexed by seat, sum 13 (diamonds, complex). */
  diamonds?: number[];
  /** Queens captured per seat, sum 4 (queens, complex). */
  queens?: number[];
  /** Tricks taken per seat, sum 13 (collection, complex). */
  tricks?: number[];
  /** Seats in finishing order, first out first (trix / shedding). */
  finishOrder?: Seat[];
  /** Seat that doubled the K♥ (null = not doubled). */
  kohDoubledBy?: Seat | null;
  /** When the K♥ doubler caught its own: who forced it (null = natural sweep). */
  kohForcedBy?: Seat | null;
  /** Doubled queens (each layered on top of the base queen penalty). */
  doubledQueens?: DoubledQueen[];
}

// Point values — kept in sync with the play engine (trix/rules.ts).
const KING_OF_HEARTS = -75;
const PER_DIAMOND = -10;
const PER_QUEEN = -25;
const PER_TRICK = -15;
const SHEDDING_POINTS = [200, 150, 100, 50] as const;

/**
 * Layer a doubled card's effect on top of the base penalty already charged to the
 * taker. Caught by another → taker pays the DOUBLED penalty, the doubler earns the
 * reward. Self-caught but forced (someone led it) → the doubler pays double, the
 * forcer earns the reward. Self-caught naturally → unchanged (single penalty).
 */
function applyDouble(
  delta: number[],
  taker: Seat,
  by: Seat,
  forcedBy: Seat | null,
  single: number,
  doubled: number,
  reward: number,
): void {
  const extra = doubled - single; // additional penalty to reach the doubled amount
  if (by !== taker) {
    delta[taker]! += extra;
    delta[by]! += reward;
  } else if (forcedBy != null) {
    delta[taker]! += extra;
    delta[forcedBy]! += reward;
  }
  // natural self-catch: base single penalty stands, no change
}

/** Per-seat point delta for one real-life Trix deal, including doubling. */
export function scoreTrixCalcDeal(contract: CalcContract, inputs: TrixDealInputs): number[] {
  const delta = [0, 0, 0, 0];
  const addPer = (counts: number[] | undefined, per: number) =>
    counts?.forEach((n, s) => (delta[s]! += per * n));
  const hasKoh = contract === 'kingOfHearts' || contract === 'complex';
  const hasQueens = contract === 'queens' || contract === 'complex';

  switch (contract) {
    case 'diamonds':
      addPer(inputs.diamonds, PER_DIAMOND);
      break;
    case 'collection':
      addPer(inputs.tricks, PER_TRICK);
      break;
    case 'complex':
      addPer(inputs.diamonds, PER_DIAMOND);
      addPer(inputs.tricks, PER_TRICK);
      break;
    case 'trix':
      (inputs.finishOrder ?? []).forEach((seat, i) => {
        delta[seat] = SHEDDING_POINTS[i] ?? 0;
      });
      break;
    default:
      break;
  }

  if (hasKoh && inputs.kohTaker != null) {
    delta[inputs.kohTaker]! += KING_OF_HEARTS;
    if (inputs.kohDoubledBy != null) {
      applyDouble(delta, inputs.kohTaker, inputs.kohDoubledBy, inputs.kohForcedBy ?? null, -75, -150, 75);
    }
  }
  if (hasQueens) {
    addPer(inputs.queens, PER_QUEEN);
    for (const q of inputs.doubledQueens ?? []) {
      applyDouble(delta, q.taker, q.by, q.forcedBy, -25, -50, 25);
    }
  }
  return delta;
}

/** Per-team point delta for one real-life Tarneeb hand: [team0, team1]. */
export function scoreTarneebRound(
  bid: number,
  declarerTeam: 0 | 1,
  declarerTricks: number,
): [number, number] {
  return scoreHand(bid, declarerTeam as Seat, declarerTricks);
}
