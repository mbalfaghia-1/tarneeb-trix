import { useEffect, useState } from 'react';
import { handLayout } from './cardLayout';

const CEILING = 130;

function clamp(lo: number, v: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Stable dimensions for each viewport and orientation. */
function tableCardWidth(vw: number, vh: number): number {
  if (vw > vh && vh <= 600) {
    const tableHeight = document.querySelector('.table')?.clientHeight ?? vh;
    return clamp(42, 0.15 * tableHeight, 72);
  }
  return clamp(42, Math.min(0.13 * vw, 0.14 * vh), CEILING);
}

function compute(cardCount: number): { '--card-w': string; '--card-h': string; '--hand-offset': string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const horizontalPadding = 28; // .hand's own 12px+12px side padding, plus a small safety margin
  const global = tableCardWidth(vw, vh);
  const layout = handLayout(global, vw - horizontalPadding, cardCount);
  return { '--card-w': `${layout.width}px`, '--card-h': `${layout.height}px`, '--hand-offset': `${layout.offset}px` };
}

/** Change the fan overlap, not the card dimensions, when cards are played. */
export function useHandCardWidth(
  cardCount: number,
  _suitBreaks: number,
): { '--card-w': string; '--card-h': string; '--hand-offset': string } {
  const [size, setSize] = useState(() => compute(cardCount));

  useEffect(() => {
    const onResize = () => setSize(compute(cardCount));
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [cardCount]);

  return size;
}
