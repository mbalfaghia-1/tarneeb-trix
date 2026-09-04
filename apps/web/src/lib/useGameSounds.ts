import { useEffect, useRef } from 'react';
import { Sound } from './sound';
import type { TarneebGame } from '../game/useTarneebGame';

/** Plays sound effects in response to game-state transitions. Reusable per screen. */
export function useGameSounds(game: TarneebGame): void {
  const { state, reviewTrick, awaitingHuman } = game;
  const played = useRef(0);
  const hand = useRef(-1);
  const wasAwaiting = useRef(false);
  const phase = useRef('');

  // A card hit the table (human or bot).
  useEffect(() => {
    const count = state.tricks.length * 4 + state.currentTrick.length;
    if (count > played.current) Sound.play('card');
    played.current = count;
  }, [state.tricks.length, state.currentTrick.length]);

  // A fresh hand was dealt.
  useEffect(() => {
    if (state.handNumber !== hand.current) {
      hand.current = state.handNumber;
      played.current = 0;
      Sound.play('deal');
    }
  }, [state.handNumber]);

  // A trick just completed (entered the review window).
  useEffect(() => {
    if (reviewTrick) Sound.play('trick');
  }, [reviewTrick]);

  // It became the human's turn.
  useEffect(() => {
    if (awaitingHuman && !wasAwaiting.current) Sound.play('turn');
    wasAwaiting.current = awaitingHuman;
  }, [awaitingHuman]);

  // Game ended.
  useEffect(() => {
    if (state.phase === 'game-over' && phase.current !== 'game-over') {
      Sound.play(state.winner === 0 ? 'win' : 'lose');
    }
    phase.current = state.phase;
  }, [state.phase, state.winner]);
}
