import { useEffect, useRef, useState } from 'react';
import type { CompletedTrick } from '@tarneeb/engine';

const REVIEW_MS = 1200;

/**
 * Hold a just-completed trick on screen for a beat so online players can see who took
 * it. The server is authoritative and sends the already-cleared next state immediately,
 * so without this the winning trick vanishes instantly. Pass the current `lastTrick`
 * (rotated to the viewer); returns the trick to overlay, or null when not reviewing.
 */
export function useTrickReview(
  lastTrick: CompletedTrick | null | undefined,
  ms: number = REVIEW_MS,
): CompletedTrick | null {
  const [review, setReview] = useState<CompletedTrick | null>(null);
  const ltRef = useRef(lastTrick);
  ltRef.current = lastTrick;
  const seen = useRef<string | null>(null);

  const sig =
    lastTrick && lastTrick.cards.length > 0
      ? lastTrick.cards.map((c) => `${c.card.rank}${c.card.suit}`).join(',') + ':' + lastTrick.winner
      : '';

  useEffect(() => {
    if (seen.current === null) {
      seen.current = sig; // first render (or reconnect): adopt the current trick without flashing it
      return;
    }
    if (sig && sig !== seen.current) {
      seen.current = sig;
      setReview(ltRef.current ?? null);
      const timer = setTimeout(() => setReview(null), ms);
      return () => clearTimeout(timer);
    }
    seen.current = sig;
  }, [sig, ms]);

  return review;
}
