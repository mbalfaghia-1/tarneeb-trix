import { useEffect, useRef, useState } from 'react';
import type { CompletedTrick } from '@tarneeb/engine';

const REVIEW_MS = 2200;

/**
 * Hold a just-completed trick on screen for a beat so online players can see who took
 * it. The server is authoritative and sends the already-cleared next state immediately,
 * so without this the winning trick vanishes instantly. Pass the current `lastTrick`
 * (rotated to the viewer); returns the trick to overlay, or null when not reviewing.
 *
 * The clear-timer is managed imperatively (via a ref), NOT through the effect's cleanup —
 * otherwise an unrelated re-render cancels it and the trick sticks on screen into the next
 * deal. A fresh deal (no lastTrick) clears any lingering review at once.
 */
export function useTrickReview(
  lastTrick: CompletedTrick | null | undefined,
  ms: number = REVIEW_MS,
): CompletedTrick | null {
  const [review, setReview] = useState<CompletedTrick | null>(null);
  const ltRef = useRef(lastTrick);
  ltRef.current = lastTrick;
  const seen = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sig =
    lastTrick && lastTrick.cards.length > 0
      ? lastTrick.cards.map((c) => `${c.card.rank}${c.card.suit}`).join(',') + ':' + lastTrick.winner
      : '';

  useEffect(() => {
    if (seen.current === null) {
      seen.current = sig; // first render (or reconnect): adopt without flashing
      return;
    }
    if (sig === seen.current) return;
    seen.current = sig;
    if (timer.current) clearTimeout(timer.current);
    if (sig) {
      setReview(ltRef.current ?? null);
      timer.current = setTimeout(() => setReview(null), ms);
    } else {
      setReview(null); // a fresh deal has no last trick — drop any lingering review now
    }
  }, [sig, ms]);

  // Cancel a pending timer only when the component actually unmounts.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return review;
}
