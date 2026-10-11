/**
 * Tunable knobs for the Tarneeb bidding formula (chooseBid/estimateTricks/bestSuit
 * in bot.ts). These are the only genuinely continuous "how aggressive" numbers in
 * the Tarneeb playbook — the play-phase tactics (T1-T11/D1-D2 in play.ts) are
 * discrete rules fixed by the game's actual card ranks, not heuristic weights, so
 * they are intentionally NOT parameterized here.
 */
export interface TarneebBotParams {
  /** Minimum trump honours (J/Q/K/A) in hand before considering a bid at all. */
  readonly minTrumpHonoursToBid: number;
  /** Minimum side-suit honours in hand before considering a bid at all. */
  readonly minSideHonoursToBid: number;
  /** Rough tricks an unseen partner adds to our own count when deciding a bid ceiling. */
  readonly partnerAllowance: number;
  /** Sure-trick value of a bare Ace in a suit. */
  readonly honourAce: number;
  /** Sure-trick value of an Ace-King in a suit. */
  readonly honourAceKing: number;
  /** Sure-trick value of an Ace-King-Queen in a suit. */
  readonly honourAceKingQueen: number;
  /** Sure-trick value of a King without the Ace. */
  readonly honourKingOnly: number;
  /** Per-card weight for suit length when picking the trump suit (ties broken by honour tricks). */
  readonly suitLengthWeight: number;
}

export const DEFAULT_TARNEEB_PARAMS: TarneebBotParams = {
  minTrumpHonoursToBid: 2,
  minSideHonoursToBid: 1,
  partnerAllowance: 3,
  honourAce: 1,
  honourAceKing: 2,
  honourAceKingQueen: 3,
  honourKingOnly: 0.5,
  suitLengthWeight: 10,
};
