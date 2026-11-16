import { scoreTrixDeal, type TrixState } from '@tarneeb/engine';

/** Current-deal points only; completed tricks are already recorded in captured. */
export function trixLivePoints(state: TrixState): number[] | null {
  if (state.phase !== 'playing' || !state.contract || state.contract === 'trix') return null;
  return scoreTrixDeal(state.contract, {
    captured: state.captured,
    tricksTaken: state.tricksTaken,
    finishOrder: [],
    doubled: state.doubled,
    doubledLeaders: state.doubledLeaders,
  });
}