import { useEffect, useRef } from 'react';
import type { CompletedTrick, TarneebState, TrixState } from '@tarneeb/engine';
import { Sound } from './sound';

/**
 * Sound effects for the ONLINE boards, mirroring the single-player hooks
 * (useGameSounds / useTrixSounds) but driven by the redacted, rotated server view —
 * so online play sounds the same. Cards arrive one at a time now (server pacing), so a
 * 'card' plays as each lands (currentTrick grows) and again when the fourth completes
 * the trick (it clears + a trick-review begins).
 */
export function useOnlineSounds(
  state: TarneebState | TrixState,
  reviewTrick: CompletedTrick | null,
  awaitingHuman: boolean,
  game: 'tarneeb' | 'trix',
): void {
  const prevTrickLen = useRef(-1); // -1 = not yet seen (skip the mount/reconnect burst)
  const dealKey = useRef('');
  const wasAwaiting = useRef(false);
  const phase = useRef('');

  // A card landed in the current trick (paced arrivals grow it one at a time).
  useEffect(() => {
    const len = state.currentTrick.length;
    if (prevTrickLen.current >= 0 && len > prevTrickLen.current) Sound.play('card');
    prevTrickLen.current = len;
  }, [state.currentTrick.length]);

  // The fourth card completed the trick (it cleared and a review began).
  useEffect(() => {
    if (reviewTrick) {
      Sound.play('card');
      Sound.play('trick');
    }
  }, [reviewTrick]);

  // A fresh deal/hand was dealt.
  useEffect(() => {
    const key =
      game === 'tarneeb'
        ? `h${(state as TarneebState).handNumber}`
        : `d${(state as TrixState).dealNumber}:${(state as TrixState).kingdomIndex}`;
    if (dealKey.current === '') {
      dealKey.current = key; // adopt on mount without a sound
      return;
    }
    if (key !== dealKey.current) {
      dealKey.current = key;
      prevTrickLen.current = 0;
      Sound.play('deal');
    }
  }, [game, state]);

  // It became our turn.
  useEffect(() => {
    if (awaitingHuman && !wasAwaiting.current) Sound.play('turn');
    wasAwaiting.current = awaitingHuman;
  }, [awaitingHuman]);

  // Game ended (rotated so seat 0 / team 0 is us).
  useEffect(() => {
    if (state.phase === 'game-over' && phase.current !== 'game-over') {
      Sound.play(state.winner === 0 ? 'win' : 'lose');
    }
    phase.current = state.phase;
  }, [state.phase, state.winner]);
}
