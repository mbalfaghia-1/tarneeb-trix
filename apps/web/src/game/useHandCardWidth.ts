import { useEffect, useState } from 'react';

const FLOOR = 28;
const CEILING = 130;

function clamp(lo: number, v: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Mirrors the --card-w formula in theme.css, so a hand that doesn't need
 *  shrinking still matches the rest of the table's card size. */
function tableCardWidth(vw: number, vh: number): number {
  if (vw > vh && vh <= 600) {
    const tableHeight = document.querySelector('.table')?.clientHeight ?? vh;
    return clamp(42, 0.15 * tableHeight, 72);
  }
  return clamp(42, Math.min(0.13 * vw, 0.14 * vh), CEILING);
}

/** The largest card width that still guarantees the whole fanned-out hand (cards
 *  overlapping at -50% margin, suit-break groups getting a small gap instead —
 *  see .hand-card / .hand-card.suit-break in theme.css) fits within the
 *  available width. Without this, a 13-card hand with several suit groups can
 *  overflow a narrow (portrait) screen even though each individual card is
 *  within the normal size range. */
function fitCardWidth(count: number, suitBreaks: number, availableWidth: number): number {
  if (count <= 1) return CEILING;
  const overlapCount = count - 1 - suitBreaks;
  const gapPx = 10; // approximates the CSS suit-break gap (max(2px, 0.8vw)) closely enough
  const denom = 1 + 0.5 * overlapCount + suitBreaks;
  return (availableWidth - suitBreaks * gapPx) / denom;
}

function compute(cardCount: number, suitBreaks: number): { '--card-w': string; '--card-h': string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const horizontalPadding = 28; // .hand's own 12px+12px side padding, plus a small safety margin
  const global = tableCardWidth(vw, vh);
  const fit = fitCardWidth(cardCount, suitBreaks, vw - horizontalPadding);
  const w = clamp(FLOOR, Math.min(global, fit), CEILING);
  return { '--card-w': `${w}px`, '--card-h': `${w * 1.4}px` };
}

/** Card width (and derived height), as CSS custom properties, for the human's
 *  hand — shrunk just enough to guarantee the hand fits the screen. Apply the
 *  returned object as the `.hand` element's inline style: CSS custom properties
 *  cascade, so this overrides --card-w/--card-h for hand cards only, leaving
 *  the rest of the table (seats, trick cards) on the normal table-wide value. */
export function useHandCardWidth(
  cardCount: number,
  suitBreaks: number,
): { '--card-w': string; '--card-h': string } {
  const [size, setSize] = useState(() => compute(cardCount, suitBreaks));

  useEffect(() => {
    const onResize = () => setSize(compute(cardCount, suitBreaks));
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [cardCount, suitBreaks]);

  return size;
}
