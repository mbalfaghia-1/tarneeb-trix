import { describe, expect, it } from 'vitest';
import {
  applyTrixAction,
  createTrixGame,
  type Card,
  type PlayedCard,
  type Seat,
  type SheddingLayout,
  type Suit,
  type TrixContract,
  type TrixState,
} from '@tarneeb/engine';
import { chooseTrixAction } from './bot.js';

const C = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });

function trixPlay(
  contract: TrixContract,
  hand: Card[],
  trick: [Seat, Card][],
  opts: {
    partnership?: boolean;
    voids?: Suit[][];
    doubled?: { card: Card; by: Seat }[];
  } = {},
): TrixState {
  return {
    mode: 'regular',
    partnership: opts.partnership ?? false,
    seed: 0,
    dealNumber: 0,
    kingdomIndex: 0,
    king: 0,
    firstKing: 0,
    usedContracts: [],
    contract,
    phase: 'playing',
    hands: [hand, [], [], []],
    turn: 0,
    leader: trick.length ? trick[0]![0] : 0,
    currentTrick: trick.map(([seat, card]): PlayedCard => ({ seat, card })),
    captured: [[], [], [], []],
    tricksTaken: [0, 0, 0, 0],
    voids: opts.voids ?? [[], [], [], []],
    doublePending: [],
    doubled: opts.doubled ?? [],
    layout: { C: null, D: null, H: null, S: null },
    finishOrder: [],
    exposedTwos: [],
    scores: [0, 0, 0, 0],
    dealResult: null,
    winner: null,
  } as TrixState;
}

const chosen = (s: TrixState): Card => (chooseTrixAction(s) as { card: Card }).card;

/** Minimal doubling-phase state (only the fields the bot reads). */
const doublingState = (contract: TrixContract, hand: Card[]): TrixState =>
  ({ phase: 'doubling', turn: 0, contract, hands: [hand, [], [], []] } as unknown as TrixState);

/** Minimal shedding-phase state (only the fields the bot reads). */
const sheddingState = (
  hand: Card[],
  layout: SheddingLayout,
  opts: { exposedTwos?: { card: Card; holder: Seat }[]; partnership?: boolean } = {},
): TrixState =>
  ({
    phase: 'shedding',
    turn: 0,
    hands: [hand, [], [], []],
    layout,
    exposedTwos: opts.exposedTwos ?? [],
    partnership: opts.partnership ?? false,
  }) as unknown as TrixState;

describe('trix bot', () => {
  it('plays a full 20-deal game with only legal actions (engine would throw otherwise)', () => {
    let s = createTrixGame({ seed: 77 });
    let deals = 0;
    let guard = 0;
    while (s.phase !== 'game-over') {
      if (++guard > 500_000) throw new Error('smart Trix game did not terminate');
      if (s.phase === 'deal-over') deals++;
      s = applyTrixAction(s, chooseTrixAction(s));
    }
    expect(deals).toBe(20);
    expect(s.winner).not.toBeNull();
    // Every contract of every kingdom was used exactly once (5 per kingdom).
    expect(s.kingdomIndex).toBe(3);
  });

  it('is deterministic for a given state', () => {
    const s = createTrixGame({ seed: 9 });
    expect(chooseTrixAction(s)).toEqual(chooseTrixAction(s));
  });

  it('doubles the K♥ when hearts are long (cover to duck), not when short', () => {
    // 4 hearts → the low hearts let us duck under every heart lead → safe to double.
    const longHearts = doublingState('kingOfHearts', [
      C(13, 'H'),
      C(9, 'H'),
      C(4, 'H'),
      C(2, 'H'),
      C(5, 'S'),
    ]);
    expect(chooseTrixAction(longHearts)).toEqual({ type: 'SET_DOUBLE', seat: 0, cards: [C(13, 'H')] });

    // Bare K♥ in a full hand (no void) → forced to play it early → do NOT double.
    const shortHearts = doublingState('kingOfHearts', [C(13, 'H'), C(2, 'C'), C(5, 'S'), C(7, 'D')]);
    expect(chooseTrixAction(shortHearts)).toEqual({ type: 'SET_DOUBLE', seat: 0, cards: [] });
  });

  it('doubles the K♥ on 3 hearts only when void in another suit (a discard escape)', () => {
    // 3 hearts + void in spades & diamonds → risky but allowed.
    const withVoid = doublingState('kingOfHearts', [C(13, 'H'), C(9, 'H'), C(4, 'H'), C(2, 'C')]);
    expect(chooseTrixAction(withVoid)).toEqual({ type: 'SET_DOUBLE', seat: 0, cards: [C(13, 'H')] });

    // 3 hearts but no void anywhere → not enough cover → do NOT double.
    const noVoid = doublingState('kingOfHearts', [
      C(13, 'H'),
      C(9, 'H'),
      C(4, 'H'),
      C(2, 'C'),
      C(5, 'S'),
      C(7, 'D'),
    ]);
    expect(chooseTrixAction(noVoid)).toEqual({ type: 'SET_DOUBLE', seat: 0, cards: [] });
  });

  it('doubles a queen only when its suit is long', () => {
    // Q♠ sits in a 4-card spade suit → double it; Q♥ is a singleton → leave it.
    const s = doublingState('queens', [C(12, 'S'), C(5, 'S'), C(4, 'S'), C(3, 'S'), C(12, 'H'), C(8, 'C')]);
    expect(chooseTrixAction(s)).toEqual({ type: 'SET_DOUBLE', seat: 0, cards: [C(12, 'S')] });
  });

  it('plays a full Trix Complex game with only legal actions', () => {
    let s = createTrixGame({ seed: 88, mode: 'complex' });
    let deals = 0;
    let guard = 0;
    while (s.phase !== 'game-over') {
      if (++guard > 500_000) throw new Error('complex game did not terminate');
      if (s.phase === 'deal-over') deals++;
      s = applyTrixAction(s, chooseTrixAction(s));
    }
    expect(deals).toBe(8);
  });
});

describe('trix avoidance: take harmless tricks, duck penalised ones', () => {
  it('diamonds: a diamond-free trick is harmless when no later player can add a diamond', () => {
    // Clubs led; the two players still to act (seats 1 & 2) are void in diamonds, so
    // none can be discarded onto us → win with the K♣ to shed a high card.
    const s = trixPlay('diamonds', [C(13, 'C'), C(5, 'C'), C(2, 'D')], [[3, C(9, 'C')]], {
      voids: [[], ['D'], ['D'], []],
    });
    expect(chosen(s)).toEqual(C(13, 'C'));
  });

  it('diamonds: takes a diamond-free trick early when no voids are known', () => {
    // No known voids → nobody is proven able to dump a diamond, so play aggressively
    // and take the harmless trick with K♣ to shed a high card.
    expect(
      chosen(trixPlay('diamonds', [C(13, 'C'), C(5, 'C'), C(2, 'D')], [[3, C(9, 'C')]])),
    ).toEqual(C(13, 'C'));
  });

  it('diamonds: ducks when a later player is known void in the led suit', () => {
    // Seat 1 is void in clubs → could dump a diamond on our win; duck.
    expect(
      chosen(trixPlay('diamonds', [C(13, 'C'), C(5, 'C'), C(2, 'D')], [[3, C(9, 'C')]], {
        voids: [[], ['C'], [], []],
      })),
    ).toEqual(C(5, 'C'));
  });

  it('collection: ducks under an opponent instead of winning when it can', () => {
    // Hearts led; opponent (seat 1) winning with 8♥. We are last holding 9/7/6♥ —
    // ducking with the 7♥ avoids the trick; winning with the 9♥ would cost -15.
    const s = trixPlay('collection', [C(9, 'H'), C(7, 'H'), C(6, 'H')], [
      [1, C(8, 'H')],
      [2, C(3, 'H')],
      [3, C(4, 'H')],
    ]);
    expect(chosen(s)).toEqual(C(7, 'H'));
  });

  it('diamonds: when diamonds are led, duck to avoid taking them', () => {
    expect(chosen(trixPlay('diamonds', [C(13, 'D'), C(2, 'D')], [[3, C(5, 'D')]]))).toEqual(C(2, 'D'));
  });

  it('diamonds: leads a low safe card when one exists (saves the diamond)', () => {
    expect(chosen(trixPlay('diamonds', [C(14, 'S'), C(4, 'C'), C(3, 'D')], []))).toEqual(C(4, 'C'));
  });

  it('diamonds: leads a low diamond when every other card would win (avoids collecting)', () => {
    // A♠ and K♠ would win the lead and let opponents dump diamonds → escape with 3♦.
    expect(chosen(trixPlay('diamonds', [C(14, 'S'), C(13, 'S'), C(3, 'D')], []))).toEqual(C(3, 'D'));
  });

  it('diamonds: boxed into a table-void suit — concedes a low diamond, does not lead the void suit', () => {
    // On lead holding only hearts (every opponent is void in hearts) plus a low
    // diamond. Leading a heart would win for sure and rake in their diamond discards,
    // so concede the lead with the 3♦ instead.
    const s = trixPlay('diamonds', [C(9, 'H'), C(7, 'H'), C(5, 'H'), C(3, 'D')], [], {
      voids: [[], ['H'], ['H'], ['H']],
    });
    expect(chosen(s)).toEqual(C(3, 'D'));
  });

  it('never leads a high singleton — leads low to lose the trick (Complex)', () => {
    // Shortest suit is a lone A♣, but we hold low cards — lead low, not the ace.
    const card = chosen(trixPlay('complex', [C(14, 'C'), C(3, 'S'), C(5, 'S'), C(2, 'H')], []));
    expect(card).not.toEqual(C(14, 'C'));
    expect(card.rank).toBeLessThanOrEqual(9);
  });

  it('never leads a high singleton — leads low (Collection)', () => {
    const card = chosen(trixPlay('collection', [C(13, 'S'), C(4, 'H'), C(2, 'H')], []));
    expect(card.rank).toBeLessThanOrEqual(9);
  });

  it('king of hearts: a non-heart lead is harmless — play high', () => {
    expect(chosen(trixPlay('kingOfHearts', [C(14, 'S'), C(5, 'S'), C(13, 'H')], [[3, C(9, 'S')]]))).toEqual(
      C(14, 'S'),
    );
  });

  it('king of hearts: the K♥ holder never wins a trick by playing its own K♥', () => {
    // A heart is led; we hold the K♥ plus low hearts. The K♥ "could" win, but playing
    // it into our own trick catches it — duck with a low heart instead.
    const s = trixPlay('kingOfHearts', [C(13, 'H'), C(4, 'H'), C(3, 'H')], [[3, C(9, 'H')]]);
    expect(chosen(s)).toEqual(C(4, 'H'));
  });

  it('king of hearts: on a heart lead when not last, duck (never risk catching the K♥)', () => {
    expect(chosen(trixPlay('kingOfHearts', [C(14, 'H'), C(5, 'H')], [[3, C(10, 'H')]]))).toEqual(
      C(5, 'H'),
    );
  });

  it('king of hearts: never leads the K♥ (leads a low safe card instead)', () => {
    const card = chosen(trixPlay('kingOfHearts', [C(13, 'H'), C(2, 'S'), C(9, 'S')], []));
    expect(card).not.toEqual(C(13, 'H'));
    expect(card).toEqual(C(2, 'S'));
  });

  it('queens: never leads a queen', () => {
    const card = chosen(trixPlay('queens', [C(12, 'S'), C(3, 'C'), C(9, 'C')], []));
    expect(card.rank).not.toBe(12);
  });

  it('queens: a middle hand unloads a high card when the led-suit queen is doubled elsewhere', () => {
    // Clubs led; the Q♣ is doubled by seat 2 (already played), so the last player
    // (seat 1) cannot add it — safe to win this queen-free trick and shed our A♣.
    const s = trixPlay('queens', [C(14, 'C'), C(3, 'C')], [
      [2, C(8, 'C')],
      [3, C(4, 'C')],
    ], { doubled: [{ card: C(12, 'C'), by: 2 }] });
    expect(chosen(s)).toEqual(C(14, 'C'));
  });

  it('queens: does NOT win with a high card when a later player holds the doubled led-suit queen', () => {
    // Clubs led; we hold A♣/3♣ and a later player (seat 1) has doubled the Q♣. Winning
    // with the A♣ lets them dump the Q♣ under it (we eat −50), so duck with the 3♣.
    const s = trixPlay('queens', [C(14, 'C'), C(3, 'C')], [[3, C(5, 'C')]], {
      doubled: [{ card: C(12, 'C'), by: 1 }],
    });
    expect(chosen(s)).toEqual(C(3, 'C'));
  });

  it('queens: unloads high early on a queen-free trick, but ducks once a later player is known void', () => {
    // Not last, no voids revealed → take the trick and shed the A♠ (bold early play,
    // don't hoard high cards for the endgame).
    expect(chosen(trixPlay('queens', [C(14, 'S'), C(5, 'S')], [[3, C(9, 'S')]]))).toEqual(C(14, 'S'));
    // Same, but the last player (seat 1) is known void in spades → they could discard
    // a queen onto our win, so now duck with the 5♠.
    const risky = trixPlay('queens', [C(14, 'S'), C(5, 'S')], [[3, C(9, 'S')]], {
      voids: [[], ['S'], [], []],
    });
    expect(chosen(risky)).toEqual(C(5, 'S'));
    // Last (three cards), no queen → take with the ace.
    const last = trixPlay('queens', [C(14, 'S'), C(5, 'S')], [
      [1, C(9, 'S')],
      [2, C(3, 'S')],
      [3, C(7, 'S')],
    ]);
    expect(chosen(last)).toEqual(C(14, 'S'));
  });
});

describe('trix avoidance stress', () => {
  it('never leads a high card (Q/K/A) in Complex while holding a low one', () => {
    for (const partnership of [false, true]) {
      for (let seed = 1; seed <= 15; seed++) {
        let s = createTrixGame({ seed, mode: 'complex', partnership });
        let guard = 0;
        while (s.phase !== 'game-over') {
          if (++guard > 500_000) throw new Error('did not terminate');
          if (s.phase === 'deal-over') {
            s = applyTrixAction(s, { type: 'NEXT_DEAL' });
            continue;
          }
          const action = chooseTrixAction(s);
          // In the last two tricks the exact endgame solver takes over; its optimal
          // play can rightly break these heuristic rules of thumb, so only check while
          // the heuristics are actually driving (more than two cards in hand).
          const heuristicDomain = Math.max(...s.hands.map((h) => h.length)) > 2;
          if (s.phase === 'playing' && action.type === 'PLAY' && heuristicDomain) {
            const hand = s.hands[s.turn]!;
            const trick = s.currentTrick;
            if (trick.length === 0) {
              // Leading: never lead a high card while holding a low one.
              if (hand.some((c) => c.rank <= 9) && action.card.rank >= 12) {
                throw new Error(
                  `seat ${s.turn} led ${action.card.rank}${action.card.suit} with a low card in hand`,
                );
              }
            } else {
              // Following: never take a trick from an OPPONENT that we could have
              // ducked (Complex = every trick costs). Overtaking our own partner is
              // fine — the team takes it either way, and we unload a high liability.
              const led = trick[0]!.card.suit;
              let winTop = -1;
              let winnerSeat = trick[0]!.seat;
              for (const pc of trick) {
                if (pc.card.suit === led && pc.card.rank > winTop) {
                  winTop = pc.card.rank;
                  winnerSeat = pc.seat;
                }
              }
              const wins = action.card.suit === led && action.card.rank > winTop;
              const couldDuck = hand.some((c) => c.suit === led && c.rank < winTop);
              const partnerWasWinning = partnership && winnerSeat % 2 === s.turn % 2;
              if (wins && couldDuck && !partnerWasWinning) {
                throw new Error(`seat ${s.turn} took a trick it could have ducked`);
              }
            }
          }
          s = applyTrixAction(s, action);
        }
      }
    }
  });
});

describe('trix shedding', () => {
  it('opens the Jack of the suit where it holds the most low cards', () => {
    const s = sheddingState([C(11, 'S'), C(2, 'S'), C(3, 'S'), C(4, 'S'), C(11, 'C'), C(9, 'C')], {
      C: null,
      D: null,
      H: null,
      S: null,
    });
    expect(chosen(s)).toEqual(C(11, 'S')); // three low spades vs one low club
  });

  it('extends the chain toward its own stuck low cards', () => {
    const s = sheddingState([C(10, 'S'), C(3, 'S'), C(2, 'S'), C(11, 'C')], {
      C: null,
      D: null,
      H: null,
      S: { low: 11, high: 11 },
    });
    // Playing the 10♠ (down from the J♠) heads toward our stuck 2♠/3♠.
    expect(chosen(s)).toEqual(C(10, 'S'));
  });

  it('exploits exposed 2s: will not unblock an opponent\'s 2 (opens instead)', () => {
    const s = sheddingState(
      [C(3, 'S'), C(11, 'C'), C(5, 'H')],
      { C: null, D: null, H: null, S: { low: 4, high: 11 } },
      { exposedTwos: [{ card: C(2, 'S'), holder: 1 }] }, // opponent (seat 1) holds 2♠
    );
    // Playing 3♠ would let the opponent shed their 2♠ → open the J♣ instead.
    expect(chosen(s)).toEqual(C(11, 'C'));
  });

  it('exploits exposed 2s: helps a partner reach their 2 (extends down)', () => {
    const s = sheddingState(
      [C(3, 'S'), C(11, 'C')],
      { C: null, D: null, H: null, S: { low: 4, high: 11 } },
      { exposedTwos: [{ card: C(2, 'S'), holder: 2 }], partnership: true }, // partner (seat 2) holds 2♠
    );
    expect(chosen(s)).toEqual(C(3, 'S'));
  });

  it('opens the suit where it can shed the most cards, counting highs too', () => {
    // J♠ + Q♠K♠A♠ (a 3-card run to shed upward) vs J♣ + one low club. Open spades:
    // counting only low cards would wrongly value the lone club higher.
    const s = sheddingState([C(11, 'S'), C(12, 'S'), C(13, 'S'), C(14, 'S'), C(11, 'C'), C(4, 'C')], {
      C: null,
      D: null,
      H: null,
      S: null,
    });
    expect(chosen(s)).toEqual(C(11, 'S'));
  });

  it('opens toward a suit where an opponent is blocked', () => {
    const s = sheddingState(
      [C(11, 'S'), C(14, 'S'), C(11, 'C'), C(3, 'C'), C(4, 'C')],
      { C: null, D: null, H: null, S: null },
      { exposedTwos: [{ card: C(2, 'S'), holder: 1 }] }, // opponent holds 2♠ → open spades
    );
    expect(chosen(s)).toEqual(C(11, 'S'));
  });
});

describe('trix partnership coordination', () => {
  it('does not dump a penalty onto a partner who is winning the trick', () => {
    // Queens; our partner (seat 2) leads the trick with the K♣; we are void in
    // clubs. Shed a plain card, not the Q♠ (we would be giving it to our team).
    const s = trixPlay(
      'queens',
      [C(12, 'S'), C(8, 'H'), C(3, 'H')],
      [
        [3, C(5, 'C')],
        [2, C(13, 'C')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(8, 'H'));
  });

  it('does dump the penalty when an OPPONENT is winning the trick', () => {
    const s = trixPlay(
      'queens',
      [C(12, 'S'), C(8, 'H'), C(3, 'H')],
      [[1, C(13, 'C')]],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(12, 'S')); // give the queen to the opponent
  });

  it('does not overtake a partner who is winning (ducks low)', () => {
    const s = trixPlay(
      'queens',
      [C(14, 'C'), C(5, 'C')],
      [[2, C(13, 'C')]], // partner (seat 2) winning with the K♣
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(5, 'C')); // keep the ace, don't take it from partner
  });

  it("leads a suit the partner is void in, low, so they can shed a penalty", () => {
    const s = trixPlay('queens', [C(8, 'S'), C(3, 'S'), C(13, 'D')], [], {
      partnership: true,
      voids: [[], [], ['S'], []], // partner (seat 2) is void in spades
    });
    expect(chosen(s)).toEqual(C(3, 'S'));
  });

  it('endgame solver: searches the last two tricks and picks the strictly better line', () => {
    // Full 52-card 2-cards-each endgame, Complex. We (seat 0) doubled the Q♥.
    //   Lead Q♥ → seat 1 must win it with the A♥ (we +25 for the dumped double), and we
    //     shed the A♣ on their next trick → net +25.
    //   Lead A♣ → we win that club trick (−15) first, then dump the Q♥ → net +10.
    // Only the exact search sees that leading the Q♥ first is worth +15 more.
    const hands = [
      [C(12, 'H'), C(14, 'C')], // seat 0: Q♥ (doubled by us), A♣
      [C(14, 'H'), C(13, 'S')], // seat 1: A♥, K♠
      [C(2, 'S'), C(3, 'S')],
      [C(4, 'S'), C(5, 'S')],
    ];
    const deck: Card[] = [];
    for (const su of ['C', 'D', 'H', 'S'] as Suit[]) for (let r = 2; r <= 14; r++) deck.push(C(r as Card['rank'], su));
    const inHand = (c: Card) => hands.flat().some((h) => h.suit === c.suit && h.rank === c.rank);
    const captured0 = deck.filter((c) => !inHand(c));

    const base = trixPlay('complex', [], [], { doubled: [{ card: C(12, 'H'), by: 0 }] });
    const s = { ...base, hands, captured: [captured0, [], [], []], turn: 0, leader: 0 } as unknown as TrixState;
    expect(chosen(s)).toEqual(C(12, 'H'));
  });

  it('endplay: leads the Q♥ to force an opponent to catch its own doubled K♥', () => {
    // Complex; the K♥ (doubled by seat 1) is the ONLY heart left outside our hand — the
    // other 11 are played and we hold the Q♥. Leading the Q♥ forces seat 1 to win with
    // the K♥ and catch it, plus our Q♥. The bot must find this even though it's a penalty.
    const playedHearts = [14, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((r) => C(r as Card['rank'], 'H'));
    const base = trixPlay('complex', [C(12, 'H'), C(5, 'C')], [], {
      doubled: [{ card: C(13, 'H'), by: 1 }],
    });
    const s = { ...base, captured: [playedHearts, [], [], []] } as TrixState;
    expect(chosen(s)).toEqual(C(12, 'H'));
  });

  it('endplay fires MID-game too, not just at the end (condition-based, not trick-count based)', () => {
    // Same forcing position but with a full mid-game hand (6 cards). As soon as the K♥
    // is the only heart out, leading the Q♥ springs it — regardless of how many cards remain.
    const playedHearts = [14, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((r) => C(r as Card['rank'], 'H'));
    const base = trixPlay(
      'complex',
      [C(12, 'H'), C(8, 'C'), C(5, 'C'), C(9, 'S'), C(4, 'D'), C(2, 'D')],
      [],
      { doubled: [{ card: C(13, 'H'), by: 1 }] },
    );
    const s = { ...base, captured: [playedHearts, [], [], []] } as TrixState;
    expect(chosen(s)).toEqual(C(12, 'H'));
  });

  it('does not lead a suit every opponent is void in (would win and collect penalties)', () => {
    // Diamonds; on lead. Every other player is known void in clubs, so leading a club
    // wins for sure and collects their discarded diamonds — lead hearts instead.
    const s = trixPlay('diamonds', [C(8, 'C'), C(7, 'C'), C(6, 'H'), C(5, 'H')], [], {
      voids: [[], ['C'], ['C'], ['C']],
    });
    expect(chosen(s).suit).toBe('H');
  });

  it('detects an exhausted suit by counting cards played (no discovered voids needed)', () => {
    // Diamonds; on lead with NO recorded voids, but the other 11 clubs are all in the
    // captured piles → counting shows clubs are exhausted outside our hand, so leading
    // one would win for sure. Lead hearts instead.
    const otherClubs = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14].map(
      (r) => C(r as Card['rank'], 'C'),
    );
    const base = trixPlay('diamonds', [C(8, 'C'), C(7, 'C'), C(6, 'H'), C(5, 'H')], [], {});
    const s = { ...base, captured: [otherClubs, [], [], []] } as TrixState;
    expect(chosen(s).suit).toBe('H');
  });

  it('does not lead a suit where SOME opponent is void and no non-void opponent can beat our low card', () => {
    // Queens; seat 1 is void in diamonds and every diamond above our 8♦ is already gone,
    // so nobody can beat it — leading it would win and rake in the void player's queen
    // discards. Lead a club instead (a non-void opponent can still take that).
    const capturedD = [9, 10, 11, 12, 13, 14].map((r) => C(r as Card['rank'], 'D'));
    const base = trixPlay('queens', [C(8, 'D'), C(2, 'C'), C(3, 'C')], [], {
      voids: [[], ['D'], [], []],
    });
    const s = { ...base, captured: [capturedD, [], [], []] } as unknown as TrixState;
    expect(chosen(s).suit).not.toBe('D');
  });

  it('does not lead a suit whose queen WE doubled (want an opponent to lead it instead)', () => {
    // Queens; we (seat 0) doubled the Q♦. On lead with low diamonds (shortest) and low
    // clubs → open clubs, keeping diamonds for an opponent to lead so we can dump the Q♦.
    const s = trixPlay('queens', [C(4, 'D'), C(3, 'D'), C(6, 'C'), C(5, 'C'), C(2, 'C')], [], {
      doubled: [{ card: C(12, 'D'), by: 0 }],
    });
    expect(chosen(s).suit).not.toBe('D');
  });

  it('never leads its own doubled queen suit in Complex, even holding low cards there', () => {
    // Complex; we (seat 0) doubled the Q♠ and still hold low spades. Leading spades would
    // develop the suit against us and let opponents shed high cards — open clubs instead.
    const s = trixPlay('complex', [C(12, 'S'), C(4, 'S'), C(3, 'S'), C(6, 'C'), C(2, 'C')], [], {
      doubled: [{ card: C(12, 'S'), by: 0 }],
    });
    expect(chosen(s).suit).not.toBe('S');
  });

  it('leads a heart to force an opponent’s doubled K♥ instead of winning a void suit', () => {
    // Complex; every opponent is void in spades, so leading a spade wins for sure and
    // rakes in their discards. We hold a J♥ and an opponent doubled the K♥ — lead the
    // heart to drive them toward catching their own doubled King.
    const s = trixPlay('complex', [C(5, 'S'), C(4, 'S'), C(11, 'H')], [], {
      voids: [[], ['S'], ['S'], ['S']],
      doubled: [{ card: C(13, 'H'), by: 1 }],
    });
    expect(chosen(s).suit).toBe('H');
  });

  it('sheds the A♦ when an opponent doubled the Q♦ and a diamond is led', () => {
    // Queens; the leader (seat 3) doubled the Q♦. A diamond is led and we hold A♦/2♦.
    // Win the (queen-free, free) trick with the A♦ so we are not left holding it to
    // catch the doubled Q♦ later.
    const s = trixPlay('queens', [C(14, 'D'), C(2, 'D')], [[3, C(4, 'D')]], {
      doubled: [{ card: C(12, 'D'), by: 3 }],
    });
    expect(chosen(s)).toEqual(C(14, 'D'));
  });

  it('does not lead a suit where our partner doubled a penalty (protects their cover)', () => {
    // K♥ contract; partner (seat 2) doubled the K♥. On lead we hold a low heart and
    // low clubs — leading hearts would burn partner's cover, so open clubs instead.
    const s = trixPlay('kingOfHearts', [C(4, 'H'), C(5, 'C'), C(6, 'C'), C(7, 'C')], [], {
      partnership: true,
      doubled: [{ card: C(13, 'H'), by: 2 }],
    });
    expect(chosen(s).suit).not.toBe('H');
  });

  it('partner winning and not last: sheds the highest safe card under them, keeps the low one', () => {
    // Queens; partner (seat 2) leads and is winning with K♠. Following at 2nd seat we
    // hold Q♠/9♠/3♠ — shed 9♠ (keep 3♠ as our best future duck; never add the Q♠).
    const s = trixPlay('queens', [C(12, 'S'), C(9, 'S'), C(3, 'S')], [[2, C(13, 'S')]], {
      partnership: true,
    });
    expect(chosen(s)).toEqual(C(9, 'S'));
  });

  it('complex: forced to win a heart trick takes it with a non-penalty heart, never its own K♥/Q♥', () => {
    // Hearts led; we are last holding K♥/Q♥/J♥/10♥ — all beat the 8♥, so we must win.
    // Take it with the J♥ and keep the K♥ and Q♥ to dump on an opponent later.
    const s = trixPlay('complex', [C(13, 'H'), C(12, 'H'), C(11, 'H'), C(10, 'H')], [
      [1, C(8, 'H')],
      [2, C(3, 'H')],
      [3, C(5, 'H')],
    ]);
    expect(chosen(s)).toEqual(C(11, 'H'));
  });

  it('forced to top, not last, but counting shows no one behind can over-take: dumps the biggest', () => {
    // Queens; opponent (seat 3) winning with Q♠, we are 3rd holding A♠/K♠ (both must
    // win). We hold the A♠, so the 4th player (seat 1) cannot over-take → we take it
    // regardless, so dump the A♠ and keep the K♠.
    const s = trixPlay(
      'queens',
      [C(14, 'S'), C(13, 'S')],
      [
        [2, C(9, 'S')],
        [3, C(12, 'S')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(14, 'S'));
  });

  it('forced to win a penalised trick as last hand: dumps the biggest liability', () => {
    // Queens; an opponent (seat 3) is winning with the Q♠, we play last holding only
    // A♠/K♠ (both must win) → we take it regardless, so dump the A♠ and keep the K♠.
    const s = trixPlay(
      'queens',
      [C(14, 'S'), C(13, 'S')],
      [
        [1, C(9, 'S')],
        [2, C(3, 'S')],
        [3, C(12, 'S')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(14, 'S'));
  });

  it('last to play with our side winning: unloads the highest safe card (not the low one)', () => {
    // Queens; clubs led, our partner (seat 2) is winning with 5♣, we play last.
    // The trick is locked to our team and carries no penalty → dump the K♣, keep the 2♣.
    const s = trixPlay(
      'queens',
      [C(13, 'C'), C(2, 'C')],
      [
        [3, C(4, 'C')],
        [1, C(3, 'C')],
        [2, C(5, 'C')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(13, 'C'));
  });

  it('last to play never dumps a penalty onto our own winning trick', () => {
    // Same, but our clubs are Q♣/9♣/2♣ — must shed the highest NON-queen (9♣),
    // never the Q♣ (that would hand our own team −25).
    const s = trixPlay(
      'queens',
      [C(12, 'C'), C(9, 'C'), C(2, 'C')],
      [
        [3, C(4, 'C')],
        [1, C(3, 'C')],
        [2, C(5, 'C')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(9, 'C'));
  });

  it('diamonds: when forced to add a diamond to our trick, sheds the highest (keeps low ones safe)', () => {
    // Diamonds led, partner (seat 2) winning, we play last holding only diamonds.
    // We must add one diamond either way — dump the dangerous A♦, keep the 6♦.
    const s = trixPlay(
      'diamonds',
      [C(14, 'D'), C(6, 'D')],
      [
        [3, C(4, 'D')],
        [1, C(3, 'D')],
        [2, C(9, 'D')],
      ],
      { partnership: true },
    );
    expect(chosen(s)).toEqual(C(14, 'D'));
  });
});
