/**
 * Tunable knobs for the Trix bot's contract-selection scoring (contractFit) and
 * doubling policy (chooseDoubles) in bot.ts. These are the genuinely continuous
 * "how aggressive" numbers in the Trix playbook — the avoidance/shedding play
 * tactics (never lead a doubled suit, void-lead avoidance, endgame solver, etc.)
 * are discrete rules fixed by user-confirmed corrections (see project memory:
 * tarneeb-trix-doubled-strategy), so they are intentionally NOT parameterized
 * here — an optimizer could otherwise "fix" a numeric score back into a bug that
 * was deliberately corrected.
 */
export interface TrixBotParams {
  /** contractFit: 'queens' contract score when holding zero queens (very safe). */
  readonly queensZeroBonus: number;
  /** contractFit: 'queens' base score when holding at least one queen, before the per-queen penalty. */
  readonly queensBaseWithSome: number;
  /** contractFit: 'queens' penalty per queen held, applied when queens > 0. */
  readonly queensPerQueenPenalty: number;
  /** contractFit: 'queens' bonus for holding a short (<=2 card) suit to help shed into. */
  readonly queensShortSuitBonus: number;
  /** contractFit: hearts length at/above which holding K-of-H is considered manageable. */
  readonly kohSafeHeartsLength: number;
  /** contractFit: 'kingOfHearts' score when holding K-of-H with enough heart length. */
  readonly kohWithEnoughHearts: number;
  /** contractFit: 'kingOfHearts' score when holding K-of-H without enough heart length. */
  readonly kohWithFewHearts: number;
  /** contractFit: 'kingOfHearts' score when NOT holding K-of-H (very safe). */
  readonly kohWithoutCard: number;
  /** contractFit: 'diamonds' score when holding zero diamonds (very safe). */
  readonly diamondsZeroBonus: number;
  /** contractFit: 'diamonds' base score when holding at least one diamond. */
  readonly diamondsBaseScore: number;
  /** contractFit: 'diamonds' penalty per high (rank>=11) diamond held. */
  readonly diamondsHighCardWeight: number;
  /** contractFit: 'diamonds' length beyond which extra diamonds start costing more. */
  readonly diamondsLengthSoftCap: number;
  /** chooseDoubles: minimum suit length to double a penalty card outright. */
  readonly doubleMinSafeLength: number;
  /** chooseDoubles: suit length that's doubleable only if void elsewhere (a discard escape). */
  readonly doubleRiskyLength: number;
}

export const DEFAULT_TRIX_PARAMS: TrixBotParams = {
  queensZeroBonus: 6,
  queensBaseWithSome: 3,
  queensPerQueenPenalty: 2,
  queensShortSuitBonus: 2,
  kohSafeHeartsLength: 4,
  kohWithEnoughHearts: 1,
  kohWithFewHearts: -3,
  kohWithoutCard: 5,
  diamondsZeroBonus: 6,
  diamondsBaseScore: 4,
  diamondsHighCardWeight: 2,
  diamondsLengthSoftCap: 6,
  doubleMinSafeLength: 4,
  doubleRiskyLength: 3,
};
