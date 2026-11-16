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

/** Visible strip of a covered tableau card: rank and suit side by side. */
export const stripFor = (w: number) => w * 0.3 + 4;

export type TableauMode = 'columns' | 'grid' | 'stack';

/** Empty suits reserve the Jack's rank slot exactly like a played Jack. */
export function tableauLead(firstRank: number = 11, sideways: boolean) {
  return sideways ? firstRank - 2 : 14 - firstRank;
}

/**
 * Tableau cards and their stacking step are sized for a full thirteen-rank run
 * before the first card is played, so nothing resizes during play. The board
 * always fits its space with no scrolling: four downward columns when there is
 * height, or a 2x2 grid of sideways rows on short/wide screens - whichever
 * gives the bigger cards.
 */
export function tableauLayout(height: number, availableWidth: number, _count: number) {
  const n = FULL_RUN - 1;
  // Columns: 1.4w + 12 * (0.3w + 4) <= height
  const colW = Math.max(16, Math.min(110, (height - 4 * n) / (1.4 + 0.3 * n), (availableWidth - 36) / 4));
  // Grid: two rows of two suits; each row w + 12 * 0.4w <= rowWidth, two card heights <= height
  const gap = 10;
  const rowW = (availableWidth - gap) / 2;
  const gridW = Math.max(16, Math.min(110, rowW / (1 + 0.4 * n), (height - gap) / 2.8));
  // Stack: four full-width sideways rows, each overlapping the one above so
  // only its corner strip (rank over suit) shows: w + 12 * 0.4w <= width, 1.4w + 3 * 0.6w <= height
  const stackW = Math.max(16, Math.min(110, availableWidth / (1 + 0.4 * n), height / (1.4 + 3 * 0.6)));
  if (stackW > colW * 1.08 && stackW > gridW) {
    const step = Math.min(stackW * 0.5, (availableWidth - stackW) / n);
    const rowStep = Math.min(stackW * 1.4 + 8, (height - stackW * 1.4) / 3);
    return { mode: 'stack' as TableauMode, width: stackW, height: stackW * 1.4, step, rowStep };
  }
  if (gridW > colW * 1.08) {
    const step = Math.min(gridW * 0.5, (rowW - gridW) / n);
    return { mode: 'grid' as TableauMode, width: gridW, height: gridW * 1.4, step };
  }
  const step = Math.max(stripFor(colW), Math.min(colW * 0.42, (height - colW * 1.4) / n));
  return { mode: 'columns' as TableauMode, width: colW, height: colW * 1.4, step };
}
