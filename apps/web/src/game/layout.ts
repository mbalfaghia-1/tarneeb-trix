import type { Seat } from '@tarneeb/engine';

export type TablePos = 'bottom' | 'right' | 'top' | 'left';

/** Screen position of a seat, rotated so the human is always at the bottom. */
export function posOf(seat: Seat, humanSeat: Seat): TablePos {
  const rel = (((seat - humanSeat) % 4) + 4) % 4;
  return (['bottom', 'right', 'top', 'left'] as const)[rel]!;
}
