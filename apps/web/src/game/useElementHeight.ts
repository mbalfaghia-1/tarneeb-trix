import { useEffect, useRef, useState, type RefObject } from 'react';

/** Tracks an element's real rendered height via ResizeObserver. Used so layout
 *  that must stay clear of another element (e.g. the trick area staying above
 *  the bottom seat's nameplate/badges) can react to that element's actual size
 *  instead of a guessed fixed offset — badges can wrap onto extra lines, and
 *  card size itself is fluid, so a hardcoded number silently goes stale. */
export function useElementHeight<T extends HTMLElement>(fallback: number): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Seats include padding and borders; reserving content height alone
      // lets the lowest played card disappear behind the nameplate.
      const h = el.getBoundingClientRect().height;
      if (h) setHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, height];
}
