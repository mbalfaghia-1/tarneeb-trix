import { useEffect, useRef } from 'react';
import { addResult, type RecordGameId } from './record';

/**
 * Record a finished game to the local per-device tally exactly once. Works for both
 * single-player and online: the state is oriented so the viewer is seat 0 / team 0, so
 * `winner === 0` means we won (a Trix 'tie' counts as played, not won). Resets when the
 * board leaves game-over (a New Game / next match records again).
 */
export function useRecordOutcome(
  game: RecordGameId,
  phase: string,
  winner: number | string | null,
): void {
  const recorded = useRef(false);
  useEffect(() => {
    if (phase !== 'game-over') {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    recorded.current = true;
    addResult(game, winner === 0);
  }, [game, phase, winner]);
}
