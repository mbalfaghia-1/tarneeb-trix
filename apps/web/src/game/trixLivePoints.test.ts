import { describe, expect, it } from 'vitest';
import { createTrixGame, type Card, type TrixContract, type TrixState } from '@tarneeb/engine';
import { trixLivePoints } from './trixLivePoints';

function playing(contract: TrixContract, over: Partial<TrixState> = {}): TrixState {
  return { ...createTrixGame({ seed: 17 }), phase: 'playing', contract, ...over };
}
const queen: Card = { suit: 'S', rank: 12 };
const king: Card = { suit: 'H', rank: 13 };

describe('live Trix penalty points', () => {
  it('shows -30 for two tricks, at -15 each, for all four seats', () => {
    expect(trixLivePoints(playing('collection', { tricksTaken: [2, 1, 3, 0] }))).toEqual([-30, -15, -45, 0]);
  });
  it('charges -10 per diamond, not the number captured', () => {
    expect(trixLivePoints(playing('diamonds', { captured: [[{ suit: 'D', rank: 2 }, { suit: 'D', rank: 8 }], [], [], []] }))).toEqual([-20, 0, 0, 0]);
  });
  it('charges -25 per undoubled queen', () => {
    expect(trixLivePoints(playing('queens', { captured: [[queen, { suit: 'D', rank: 12 }], [], [], []] }))).toEqual([-50, 0, 0, 0]);
  });
  it('charges -50 for a doubled queen and awards its doubler +25', () => {
    expect(trixLivePoints(playing('queens', { captured: [[queen], [], [], []], doubled: [{ card: queen, by: 2 }] }))).toEqual([-50, 0, 25, 0]);
  });
  it('charges -75 for the undoubled King of Hearts', () => {
    expect(trixLivePoints(playing('kingOfHearts', { captured: [[], [king], [], []] }))).toEqual([0, -75, 0, 0]);
  });
  it('charges -150 for the doubled King and awards its doubler +75', () => {
    expect(trixLivePoints(playing('kingOfHearts', { captured: [[], [king], [], []], doubled: [{ card: king, by: 3 }] }))).toEqual([0, -150, 0, 75]);
  });
  it('combines penalties and bonuses in Complex using the same totals', () => {
    expect(trixLivePoints(playing('complex', {
      captured: [[queen, king, { suit: 'D', rank: 2 }], [], [], []], tricksTaken: [2, 0, 0, 0],
      doubled: [{ card: queen, by: 2 }, { card: king, by: 3 }],
    }))).toEqual([-240, 0, 25, 75]);
  });
  it('does not invent penalties during contract selection or shedding', () => {
    expect(trixLivePoints(createTrixGame({ seed: 17 }))).toBeNull();
    expect(trixLivePoints({ ...playing('trix'), phase: 'shedding' })).toBeNull();
  });
});