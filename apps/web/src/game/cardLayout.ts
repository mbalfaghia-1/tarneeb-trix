/** A full suit run or a full hand: layouts are reserved for this many cards. */
export const FULL_RUN = 13;

/**
 * Card dimensions and fan overlap depend on screen space, never on the number
 * of cards held, so dealing and playing never resize or re-space the hand.
 */
export function handLayout(width: number, available: number, _count: number) {
  const step = Math.max(12, Math.min(width * 0.58, (available - width) / (FULL_RUN - 1)));
  return { width, height: width * 1.4, offset: step - width };
}

/**
 * Tableau cards and their vertical stacking step are sized for a full
 * thirteen-rank column before the first card is played, so adding cards to a
 * column never shrinks or squeezes the cards already on the table.
 */
export function tableauLayout(height: number, availableWidth: number, _count: number) {
  const capacitySteps = FULL_RUN - 1;
  const fit = (height - 4 * capacitySteps) / (1.4 + 0.2 * capacitySteps);
  const width = Math.max(44, Math.min(110, fit, (availableWidth - 36) / 4));
  const minimumStep = Math.max(14, width * 0.2 + 4);
  const step = Math.max(minimumStep, Math.min(width * 0.42, (height - width * 1.4) / capacitySteps));
  return { width, height: width * 1.4, step };
}
