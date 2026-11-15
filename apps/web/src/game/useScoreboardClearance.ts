import { useLayoutEffect, useRef } from 'react';

/**
 * Publishes the scoreboard's rendered bottom edge, the left seat's height and
 * the wider side seat's width on the table, so CSS can keep the left player
 * below the scoreboard and the middle of the table clear of both side seats.
 * Re-measures after every render because seats and the scoreboard re-mount
 * between phases (e.g. Trix contracts), which a mount-time observer misses.
 */
export function useScoreboardClearance<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const measureRef = useRef<() => void>(() => {});
  // Side-seat room only grows for a given screen size, so the middle of the
  // table (and the Trix column cards sized from it) doesn't resize mid-game.
  const sideW = useRef({ key: '', width: 0 });

  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const measure = () => {
      const box = (s: string) => table.querySelector<HTMLElement>(s)?.getBoundingClientRect();
      const top = table.getBoundingClientRect().top;
      const board = box('.scoreboard');
      const left = box('.seat-left');
      const right = box('.seat-right');
      const set = (k: string, v: number) => {
        const next = `${Math.max(0, Math.round(v))}px`;
        if (table.style.getPropertyValue(k) !== next) table.style.setProperty(k, next);
      };
      set('--score-bottom', board ? board.bottom - top : 0);
      set('--seat-left-h', left?.height ?? 0);
      const key = `${window.innerWidth}x${window.innerHeight}:${table.querySelector(".shedding-board") ? "columns" : "tricks"}`;
      const width = Math.max(left?.width ?? 0, right?.width ?? 0);
      sideW.current = { key, width: sideW.current.key === key ? Math.max(sideW.current.width, width) : width };
      set('--seat-side-w', sideW.current.width);
    };
    measureRef.current = measure;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => measureRef.current());

  return ref;
}
