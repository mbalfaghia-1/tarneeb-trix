import { describe, expect, it } from 'vitest';
import { makeDeck, cardId, type Card, type Suit } from '../cards.js';
import { makeRng } from '../rng.js';
import { legalPlays, scoreHand, trickWinner } from './rules.js';
import { applyAction, canClaimRemaining, createGame, getLegalActions } from './game.js';
import { partnerOf, teamOf, type PlayedCard, type Seat, type TarneebState } from './types.js';

const C = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });

/** Minimal playing-phase state for claim tests (fields canClaimRemaining reads). */
const claimState = (hands: Card[][], trump: Suit): TarneebState =>
  ({ phase: 'playing', turn: 0, currentTrick: [], hands, trump } as unknown as TarneebState);

describe('deck', () => {
  it('has 52 unique cards', () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
  });
});

describe('trickWinner', () => {
  it('highest trump wins even against high off-suit cards', () => {
    const trick: PlayedCard[] = [
      { seat: 0, card: C(10, 'H') }, // led hearts
      { seat: 1, card: C(2, 'S') }, // trump
      { seat: 2, card: C(14, 'H') }, // ace of hearts
      { seat: 3, card: C(5, 'C') },
    ];
    expect(trickWinner(trick, 'S')).toBe(1);
  });

  it('with no trump played, highest card of the led suit wins', () => {
    const trick: PlayedCard[] = [
      { seat: 0, card: C(10, 'H') },
      { seat: 1, card: C(14, 'H') },
      { seat: 2, card: C(5, 'C') }, // off-suit, cannot win
      { seat: 3, card: C(13, 'D') }, // off-suit, cannot win
    ];
    expect(trickWinner(trick, 'S')).toBe(1);
  });

  it('highest of multiple trumps wins', () => {
    const trick: PlayedCard[] = [
      { seat: 0, card: C(9, 'S') },
      { seat: 1, card: C(11, 'S') },
      { seat: 2, card: C(13, 'S') },
      { seat: 3, card: C(7, 'S') },
    ];
    expect(trickWinner(trick, 'S')).toBe(2);
  });
});

describe('legalPlays', () => {
  it('must follow the led suit when able', () => {
    const hand: Card[] = [C(2, 'H'), C(9, 'H'), C(14, 'S')];
    const trick: PlayedCard[] = [{ seat: 0, card: C(5, 'H') }];
    const legal = legalPlays(hand, trick);
    expect(legal.map(cardId).sort()).toEqual(['2H', '9H']);
  });

  it('may play anything when void in the led suit', () => {
    const hand: Card[] = [C(14, 'S'), C(3, 'C')];
    const trick: PlayedCard[] = [{ seat: 0, card: C(5, 'H') }];
    expect(legalPlays(hand, trick)).toHaveLength(2);
  });

  it('anything is legal when leading', () => {
    const hand: Card[] = [C(14, 'S'), C(3, 'C'), C(9, 'H')];
    expect(legalPlays(hand, [])).toHaveLength(3);
  });
});

describe('scoreHand', () => {
  it('sub-13 bid made scores actual tricks', () => {
    // declarer seat 0 (team 0), bid 9, won 10
    expect(scoreHand(9, 0, 10)).toEqual([10, 0]);
  });

  it('sub-13 bid failed: -bid to declarer, tricks to opponents', () => {
    // bid 9, won 7 → opp won 6
    expect(scoreHand(9, 0, 7)).toEqual([-9, 6]);
  });

  it('kaboot: all 13 on a sub-13 bid gives +3 bonus', () => {
    expect(scoreHand(7, 0, 13)).toEqual([16, 0]);
  });

  it('bid 13 and made all 13 scores +26', () => {
    expect(scoreHand(13, 1, 13)).toEqual([0, 26]);
  });

  it('bid 13 and failed: -16 and double opponents tricks', () => {
    // declarer team 1, won 10 → opp (team 0) won 3 → doubled = 6
    expect(scoreHand(13, 1, 10)).toEqual([6, -16]);
  });
});

describe('bidding flow', () => {
  it('resolves to the high bidder and moves to trump selection', () => {
    let s = createGame({ seed: 42, firstDealer: 0 });
    // bidding starts to the dealer's right = seat 1
    expect(s.phase).toBe('bidding');
    expect(s.turn).toBe(1);

    s = applyAction(s, { type: 'BID', seat: 1, amount: 7 });
    s = applyAction(s, { type: 'PASS', seat: 2 });
    s = applyAction(s, { type: 'BID', seat: 3, amount: 8 });
    s = applyAction(s, { type: 'PASS', seat: 0 });
    s = applyAction(s, { type: 'PASS', seat: 1 });

    expect(s.phase).toBe('trump-select');
    expect(s.declarer).toBe(3);
    expect(s.highBid).toEqual({ seat: 3, amount: 8 });
    expect(s.turn).toBe(3);

    s = applyAction(s, { type: 'SELECT_TRUMP', seat: 3, suit: 'H' });
    expect(s.phase).toBe('playing');
    expect(s.trump).toBe('H');
    expect(s.contract).toBe(8);
    expect(s.leader).toBe(3);
    expect(s.turn).toBe(3); // declarer leads
  });

  it('redeals when everyone passes', () => {
    let s = createGame({ seed: 7, firstDealer: 0 });
    const firstHand = s.hands.map((h) => h.map(cardId).join(','));
    s = applyAction(s, { type: 'PASS', seat: 1 });
    s = applyAction(s, { type: 'PASS', seat: 2 });
    s = applyAction(s, { type: 'PASS', seat: 3 });
    s = applyAction(s, { type: 'PASS', seat: 0 });
    expect(s.phase).toBe('bidding');
    expect(s.handNumber).toBe(1);
    expect(s.dealer).toBe(1); // deal moved right
    const secondHand = s.hands.map((h) => h.map(cardId).join(','));
    expect(secondHand).not.toEqual(firstHand);
  });

  it('rejects a bid that is not higher than the standing bid', () => {
    let s = createGame({ seed: 1, firstDealer: 0 });
    s = applyAction(s, { type: 'BID', seat: 1, amount: 9 });
    expect(() => applyAction(s, { type: 'BID', seat: 2, amount: 9 })).toThrow();
    expect(() => applyAction(s, { type: 'BID', seat: 2, amount: 8 })).toThrow();
  });
});

describe('self-play (random legal moves)', () => {
  it('keeps rule invariants across many complete hands', () => {
    const rng = makeRng(12345);
    let s = createGame({ seed: 999, firstDealer: 2 });
    let handsCompleted = 0;
    let guard = 0;

    // With purely random play a team may never reach the target (declarers
    // usually fail their bids), so we validate invariants over a fixed number
    // of completed hands rather than requiring the game to end.
    while (handsCompleted < 40 && s.phase !== 'game-over') {
      if (++guard > 200_000) throw new Error('self-play stalled');

      if (s.phase === 'hand-over') {
        expect(s.tricksWon[0] + s.tricksWon[1]).toBe(13);
        expect(s.lastHand).not.toBeNull();
        handsCompleted++;
      }

      const actions = getLegalActions(s);
      expect(actions.length).toBeGreaterThan(0);
      s = applyAction(s, actions[rng.int(actions.length)]!);

      // During play the four hands always sum with played cards to 52.
      if (s.phase === 'playing') {
        const inHands = s.hands.reduce((n, h) => n + h.length, 0);
        const played = s.tricks.length * 4 + s.currentTrick.length;
        expect(inHands + played).toBe(52);
      }
    }

    expect(handsCompleted).toBeGreaterThanOrEqual(40);
  });

  it('reaches a winner (>=31) under a decisive policy', () => {
    // Declarer team always plays its highest legal card, defenders their
    // lowest; the opening bidder takes a minimum contract. The declaring team
    // therefore wins most tricks and the game terminates quickly.
    let s = createGame({ seed: 3, firstDealer: 0 });
    let guard = 0;

    while (s.phase !== 'game-over') {
      if (++guard > 100_000) throw new Error('decisive policy did not terminate');
      const actions = getLegalActions(s);

      if (s.phase === 'bidding') {
        s = applyAction(
          s,
          s.highBid === null
            ? { type: 'BID', seat: s.turn, amount: 7 }
            : { type: 'PASS', seat: s.turn },
        );
      } else if (s.phase === 'trump-select') {
        s = applyAction(s, actions[0]!);
      } else if (s.phase === 'hand-over') {
        s = applyAction(s, { type: 'NEXT_HAND' });
      } else {
        const plays = actions.filter(
          (a): a is Extract<typeof a, { type: 'PLAY' }> => a.type === 'PLAY',
        );
        const wantHigh = teamOf(s.turn) === teamOf(s.declarer!);
        plays.sort((a, b) => a.card.rank - b.card.rank);
        s = applyAction(s, wantHigh ? plays[plays.length - 1]! : plays[0]!);
      }
    }

    expect(s.winner).not.toBeNull();
    expect(s.scores[s.winner!]).toBeGreaterThanOrEqual(31);
  });
});

describe('claim (end the hand)', () => {
  it('allows a claim when every card is an unbeatable winner (top trumps)', () => {
    const s = claimState([[C(14, 'S'), C(13, 'S')], [C(5, 'S')], [C(2, 'H')], [C(3, 'D')]], 'S');
    expect(canClaimRemaining(s, 0)).toBe(true);
  });

  it('rejects a claim when an opponent holds a higher trump', () => {
    const s = claimState([[C(12, 'S')], [C(13, 'S')], [C(2, 'H')], [C(3, 'D')]], 'S');
    expect(canClaimRemaining(s, 0)).toBe(false);
  });

  it('rejects when a side-suit winner could be ruffed', () => {
    // A♥ is the top heart, but seat 1 is void in hearts and holds a trump.
    const s = claimState([[C(14, 'H')], [C(2, 'S')], [C(3, 'H')], [C(4, 'D')]], 'S');
    expect(canClaimRemaining(s, 0)).toBe(false);
  });

  it('allows a side-suit winner when nobody can ruff', () => {
    const s = claimState([[C(14, 'H')], [C(2, 'H')], [C(3, 'H')], [C(4, 'H')]], 'S');
    expect(canClaimRemaining(s, 0)).toBe(true);
  });

  it('rejects when not on lead', () => {
    const s = {
      ...claimState([[C(14, 'S')], [], [], []], 'S'),
      currentTrick: [{ seat: 3, card: C(2, 'H') }],
    } as unknown as TarneebState;
    expect(canClaimRemaining(s, 0)).toBe(false);
  });
});

describe('table geometry', () => {
  it('partners face each other and share a team', () => {
    const seats: Seat[] = [0, 1, 2, 3];
    for (const seat of seats) {
      expect(teamOf(seat)).toBe(teamOf(partnerOf(seat)));
      expect(partnerOf(seat)).toBe(((seat + 2) % 4) as Seat);
    }
  });
});
