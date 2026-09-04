import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../cards.js';
import { makeRng } from '../rng.js';
import type { Seat } from '../tarneeb/types.js';
import {
  avoidanceTrickWinner,
  emptyLayout,
  extendLayout,
  isAvoidanceDealOver,
  scoreTrixDeal,
  sheddingPlayable,
} from './rules.js';
import { applyTrixAction, createTrixGame, getTrixLegalActions } from './game.js';
import { trixTeamScores } from './types.js';
import type { SheddingLayout } from './types.js';

const C = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });
const piles = (a: Card[], b: Card[], c: Card[], d: Card[]): Card[][] => [a, b, c, d];

describe('shedding rules', () => {
  it('only Jacks are playable on an empty suit; then chains extend by one', () => {
    const hand = [C(11, 'H'), C(10, 'H'), C(12, 'H'), C(14, 'S')];
    let layout: SheddingLayout = emptyLayout();
    expect(sheddingPlayable(hand, layout).map((c) => c.rank).sort()).toEqual([11]); // only JH

    layout = extendLayout(layout, C(11, 'H'));
    expect(layout.H).toEqual({ low: 11, high: 11 });
    // Now 10H (low-1) and QH (high+1) are playable; AS still not (no JS yet).
    expect(sheddingPlayable(hand, layout).map((c) => `${c.rank}${c.suit}`).sort()).toEqual([
      '10H',
      '12H',
    ]);

    layout = extendLayout(layout, C(12, 'H')); // play QH
    expect(layout.H).toEqual({ low: 11, high: 12 });
    layout = extendLayout(layout, C(10, 'H')); // play 10H
    expect(layout.H).toEqual({ low: 10, high: 12 });
  });
});

describe('avoidance rules', () => {
  it('no-trump trick is won by the highest card of the led suit', () => {
    const winner = avoidanceTrickWinner([
      { seat: 0, card: C(10, 'H') },
      { seat: 1, card: C(14, 'S') }, // off-suit, cannot win (no trump in Trix)
      { seat: 2, card: C(13, 'H') },
      { seat: 3, card: C(2, 'H') },
    ]);
    expect(winner).toBe(2);
  });

  it('detects early-end conditions', () => {
    expect(isAvoidanceDealOver('kingOfHearts', piles([C(13, 'H')], [], [], []), 3)).toBe(true);
    expect(isAvoidanceDealOver('kingOfHearts', piles([C(12, 'H')], [], [], []), 3)).toBe(false);
    const allDiamonds = Array.from({ length: 13 }, (_, i) => C((i + 2) as Card['rank'], 'D'));
    expect(isAvoidanceDealOver('diamonds', piles(allDiamonds, [], [], []), 5)).toBe(true);
    expect(isAvoidanceDealOver('collection', piles([], [], [], []), 13)).toBe(true);
    expect(isAvoidanceDealOver('collection', piles([], [], [], []), 12)).toBe(false);
  });
});

describe('scoring', () => {
  const tally = (over: Partial<Parameters<typeof scoreTrixDeal>[1]>) => ({
    captured: piles([], [], [], []),
    tricksTaken: [0, 0, 0, 0],
    finishOrder: [] as Seat[],
    ...over,
  });

  it('king of hearts: -75 to whoever took it', () => {
    expect(scoreTrixDeal('kingOfHearts', tally({ captured: piles([], [], [C(13, 'H')], []) }))).toEqual([
      0, 0, -75, 0,
    ]);
  });

  it('diamonds: -10 each', () => {
    expect(
      scoreTrixDeal('diamonds', tally({ captured: piles([C(2, 'D'), C(9, 'D'), C(5, 'D')], [], [], []) })),
    ).toEqual([-30, 0, 0, 0]);
  });

  it('queens: -25 each', () => {
    expect(
      scoreTrixDeal('queens', tally({ captured: piles([], [C(12, 'S'), C(12, 'D')], [], []) })),
    ).toEqual([0, -50, 0, 0]);
  });

  it('collection: -15 per trick', () => {
    expect(scoreTrixDeal('collection', tally({ tricksTaken: [5, 4, 3, 1] }))).toEqual([
      -75, -60, -45, -15,
    ]);
  });

  it('trix shedding: 200/150/100/50 by finish order; missing seat is last', () => {
    expect(scoreTrixDeal('trix', tally({ finishOrder: [2, 0, 3] }))).toEqual([150, 50, 200, 100]);
  });
});

describe('doubling', () => {
  const tally = (over: Partial<Parameters<typeof scoreTrixDeal>[1]>) => ({
    captured: piles([], [], [], []),
    tricksTaken: [0, 0, 0, 0],
    finishOrder: [] as Seat[],
    ...over,
  });

  it('K♥ doubled and caught by another → -150 to taker, +75 to doubler', () => {
    const t = tally({ captured: piles([], [], [], [C(13, 'H')]), doubled: [{ card: C(13, 'H'), by: 1 }] });
    expect(scoreTrixDeal('kingOfHearts', t)).toEqual([0, 75, 0, -150]);
  });

  it('K♥ doubled but caught by the doubler → just -75', () => {
    const t = tally({ captured: piles([], [C(13, 'H')], [], []), doubled: [{ card: C(13, 'H'), by: 1 }] });
    expect(scoreTrixDeal('kingOfHearts', t)).toEqual([0, -75, 0, 0]);
  });

  it('a doubled queen caught by another is -50/+25; other queens stay -25', () => {
    const t = tally({
      captured: piles([C(12, 'S')], [C(12, 'H')], [], []),
      doubled: [{ card: C(12, 'S'), by: 2 }],
    });
    expect(scoreTrixDeal('queens', t)).toEqual([-50, -25, 25, 0]);
  });

  it('a K♥ contract enters a doubling phase; the holder may double, then play begins', () => {
    let s = createTrixGame({ seed: 42 });
    s = applyTrixAction(s, { type: 'CHOOSE_CONTRACT', seat: s.king, contract: 'kingOfHearts' });
    expect(s.phase).toBe('doubling');
    const decider = s.turn; // the sole K♥ holder
    const kh = s.hands[decider]!.find((c) => c.suit === 'H' && c.rank === 13)!;
    s = applyTrixAction(s, { type: 'SET_DOUBLE', seat: decider, cards: [kh] });
    expect(s.phase).toBe('playing');
    expect(s.leader).toBe(s.king);
    expect(s.doubled).toEqual([{ card: { suit: 'H', rank: 13 }, by: decider }]);
  });
});

describe('shedding: 2s exposure', () => {
  it('reveals the 2s at shedding start (Complex only) when they span both teams', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = createTrixGame({ seed, mode: 'complex' });
      const holders = new Set<Seat>();
      for (const seat of [0, 1, 2, 3] as Seat[]) {
        for (const c of s.hands[seat]!) if (c.rank === 2) holders.add(seat);
      }
      const bothTeams = [...holders].some((h) => h % 2 === 0) && [...holders].some((h) => h % 2 === 1);
      s = applyTrixAction(s, { type: 'CHOOSE_CONTRACT', seat: s.king, contract: 'trix' });
      expect(s.phase).toBe('shedding');
      if (bothTeams) {
        expect(s.exposedTwos.length).toBe(4);
        expect(s.exposedTwos.every((t) => t.card.rank === 2)).toBe(true);
      } else {
        expect(s.exposedTwos.length).toBe(0);
      }
    }
  });

  it('never exposes the 2s in regular Trix (Complex-only rule)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createTrixGame({ seed }); // regular mode
      s = applyTrixAction(s, { type: 'CHOOSE_CONTRACT', seat: s.king, contract: 'trix' });
      expect(s.phase).toBe('shedding');
      expect(s.exposedTwos.length).toBe(0);
    }
  });
});

describe('trix complex', () => {
  const tally = (over: Partial<Parameters<typeof scoreTrixDeal>[1]>) => ({
    captured: piles([], [], [], []),
    tricksTaken: [0, 0, 0, 0],
    finishOrder: [] as Seat[],
    ...over,
  });

  it('the complex contract stacks every penalty', () => {
    // seat 0 took the K♥, a queen, two diamonds, and 3 tricks.
    const t = tally({
      captured: piles([C(13, 'H'), C(12, 'S'), C(2, 'D'), C(9, 'D')], [], [], []),
      tricksTaken: [3, 0, 0, 0],
    });
    // -75 (K♥) -25 (Q♠) -20 (2♦,9♦) -45 (3 tricks) = -165
    expect(scoreTrixDeal('complex', t)).toEqual([-165, 0, 0, 0]);
  });

  it('complex doubling: a doubled queen caught by another still stacks with the rest', () => {
    const t = tally({
      captured: piles([C(12, 'S')], [], [], []),
      tricksTaken: [1, 0, 0, 0],
      doubled: [{ card: C(12, 'S'), by: 2 }],
    });
    // seat0: Q♠ doubled by seat2 → -50, plus 1 trick -15 = -65; seat2 +25
    expect(scoreTrixDeal('complex', t)).toEqual([-65, 0, 25, 0]);
  });

  it('plays a full 8-deal Trix Complex game to a winner', () => {
    const rng = makeRng(7);
    let s = createTrixGame({ seed: 55, mode: 'complex' });
    let deals = 0;
    let guard = 0;
    while (s.phase !== 'game-over') {
      if (++guard > 500_000) throw new Error('complex game did not terminate');
      if (s.phase === 'deal-over') {
        deals++;
        s = applyTrixAction(s, { type: 'NEXT_DEAL' });
        continue;
      }
      const actions = getTrixLegalActions(s);
      s = applyTrixAction(s, actions[rng.int(actions.length)]!);
    }
    expect(deals).toBe(8);
    expect(s.kingdomIndex).toBe(3);
    expect(s.winner).not.toBeNull();
  });
});

describe('game flow', () => {
  it('first king holds the 7 of hearts', () => {
    const s = createTrixGame({ seed: 123 });
    expect(s.phase).toBe('contract-select');
    expect(s.hands[s.king]!.some((c) => c.suit === 'H' && c.rank === 7)).toBe(true);
  });

  it('partnership mode decides the winner by summed team totals', () => {
    const rng = makeRng(3);
    let s = createTrixGame({ seed: 202, partnership: true });
    let guard = 0;
    while (s.phase !== 'game-over') {
      if (++guard > 500_000) throw new Error('partnership game did not terminate');
      if (s.phase === 'deal-over') {
        s = applyTrixAction(s, { type: 'NEXT_DEAL' });
        continue;
      }
      const actions = getTrixLegalActions(s);
      s = applyTrixAction(s, actions[rng.int(actions.length)]!);
    }
    const [t0, t1] = trixTeamScores(s.scores);
    expect(s.winner).not.toBeNull();
    if (t0 === t1) expect(s.winner).toBe('tie');
    else expect(s.winner).toBe(t0 > t1 ? 0 : 1);
  });

  it('plays a full 20-deal game to a winner with consistent invariants', () => {
    const rng = makeRng(2026);
    let s = createTrixGame({ seed: 55 });
    let deals = 0;
    let guard = 0;

    while (s.phase !== 'game-over') {
      if (++guard > 500_000) throw new Error('Trix self-play did not terminate');

      if (s.phase === 'deal-over') {
        deals++;
        expect(s.dealResult).not.toBeNull();
        s = applyTrixAction(s, { type: 'NEXT_DEAL' });
        continue;
      }

      const actions = getTrixLegalActions(s);
      expect(actions.length).toBeGreaterThan(0);
      s = applyTrixAction(s, actions[rng.int(actions.length)]!);

      // Card conservation while playing.
      if (s.phase === 'playing') {
        const inHands = s.hands.reduce((n, h) => n + h.length, 0);
        const captured = s.captured.reduce((n, p) => n + p.length, 0);
        expect(inHands + captured + s.currentTrick.length).toBe(52);
      } else if (s.phase === 'shedding') {
        const inHands = s.hands.reduce((n, h) => n + h.length, 0);
        expect(inHands + layoutCardCount(s.layout)).toBe(52);
      }
    }

    expect(deals).toBe(20);
    expect(s.kingdomIndex).toBe(3);
    expect(s.winner).not.toBeNull();
  });
});

function layoutCardCount(layout: SheddingLayout): number {
  let n = 0;
  for (const suit of ['C', 'D', 'H', 'S'] as const) {
    const r = layout[suit];
    if (r) n += r.high - r.low + 1;
  }
  return n;
}
