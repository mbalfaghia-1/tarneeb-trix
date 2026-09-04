import { useEffect, useRef } from 'react';
import { Sound } from './sound';
import type { TrixGame } from '../game/useTrixGame';

/** Sound effects for Trix, mirroring the Tarneeb sound hook. */
export function useTrixSounds(game: TrixGame): void {
  const { state, reviewTrick, awaitingHuman } = game;
  const played = useRef(0);
  const deal = useRef(-1);
  const wasAwaiting = useRef(false);
  const phase = useRef('');

  useEffect(() => {
    const count = 52 - state.hands.reduce((n, h) => n + h.length, 0);
    if (count > played.current) Sound.play('card');
    played.current = count;
  }, [state.hands]);

  useEffect(() => {
    if (state.dealNumber !== deal.current) {
      deal.current = state.dealNumber;
      played.current = 0;
      Sound.play('deal');
    }
  }, [state.dealNumber]);

  useEffect(() => {
    if (reviewTrick) Sound.play('trick');
  }, [reviewTrick]);

  useEffect(() => {
    if (awaitingHuman && !wasAwaiting.current) Sound.play('turn');
    wasAwaiting.current = awaitingHuman;
  }, [awaitingHuman]);

  useEffect(() => {
    if (state.phase === 'game-over' && phase.current !== 'game-over') {
      Sound.play(state.winner === 0 ? 'win' : 'lose');
    }
    phase.current = state.phase;
  }, [state.phase, state.winner]);
}
