import { describe, expect, it } from 'vitest';
import {
  applyAction,
  cardBeats,
  createGame,
  getLegalActions,
  legalPlays,
  makeRng,
  teamOf,
  trickWinner,
  type Card,
  type PlayedCard,
  type Seat,
  type Suit,
  type TarneebState,
} from '@tarneeb/engine';
import { chooseTarneebAction } from './bot.js';
import { buildKnowledge } from './knowledge.js';

const C = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });

/** Minimal playing-phase state; override just what a scenario needs. */
function playState(over: Partial<TarneebState>): TarneebState {
  return {
    phase: 'playing',
    handNumber: 0,
    seed: 0,
    dealer: 0,
    turn: 0,
    hands: [[], [], [], []],
    passed: [false, false, false, false],
    bidLog: [],
    highBid: null,
    declarer: 0,
    trump: 'S',
    contract: 8,
    leader: 0,
    currentTrick: [],
    tricks: [],
    tricksWon: [0, 0],
    scores: [0, 0],
    lastHand: null,
    winner: null,
    ...over,
  } as TarneebState;
}

function playedCards(...pcs: [Seat, Card][]): PlayedCard[] {
  return pcs.map(([seat, card]) => ({ seat, card }));
}

const bidState = (hand: Card[], highBid: TarneebState['highBid'] = null): TarneebState =>
  playState({ phase: 'bidding', turn: 0, highBid, hands: [hand, [], [], []] });

describe('bidding', () => {
  const weak: Card[] = [
    C(2, 'S'), C(3, 'S'), C(4, 'S'), C(5, 'S'),
    C(2, 'H'), C(3, 'H'), C(4, 'H'),
    C(2, 'D'), C(3, 'D'), C(4, 'D'),
    C(2, 'C'), C(3, 'C'), C(4, 'C'),
  ];
  // A-K + five spades (2 honour tricks + 2 length) ≈ 4 own tricks.
  const decent: Card[] = [
    C(14, 'S'), C(13, 'S'), C(5, 'S'), C(4, 'S'), C(3, 'S'),
    C(2, 'H'), C(3, 'H'), C(4, 'H'), C(5, 'H'),
    C(2, 'D'), C(3, 'D'),
    C(2, 'C'), C(3, 'C'),
  ];

  it('passes a weak hand instead of always opening at 7', () => {
    expect(chooseTarneebAction(bidState(weak))).toEqual({ type: 'PASS', seat: 0 });
  });

  it('opens a decent hand with the minimum bid', () => {
    expect(chooseTarneebAction(bidState(decent))).toEqual({ type: 'BID', seat: 0, amount: 7 });
  });

  it('does not chase a bid beyond its ceiling', () => {
    // Someone already bid 7 → the minimum is now 8, above a ~7-ceiling hand → pass.
    const s = bidState(decent, { seat: 1, amount: 7 });
    expect(chooseTarneebAction(s)).toEqual({ type: 'PASS', seat: 0 });
  });
});

describe('knowledge / card counting', () => {
  it('infers voids, outstanding cards, and who could hold them', () => {
    const state = playState({
      turn: 0,
      hands: [[C(5, 'H'), C(13, 'D')], [], [], []],
      tricks: [
        {
          leader: 0,
          winner: 0,
          cards: playedCards([0, C(14, 'H')], [1, C(2, 'S')], [2, C(3, 'H')], [3, C(4, 'H')]),
        },
      ],
    });
    const k = buildKnowledge(state, 0);

    expect(k.isVoid(1, 'H')).toBe(true); // seat 1 ruffed instead of following hearts
    expect(k.isVoid(2, 'H')).toBe(false);

    // Hearts seen: A,3,4; mine: 5 → K is the top heart still out.
    expect(k.highestOutstanding('H')).toBe(13);
    expect(k.couldHold(2, 'H', 13)).toBe(true);
    expect(k.couldHold(1, 'H', 13)).toBe(false); // seat 1 is void in hearts

    // One trump (2S) already seen, none of mine → 12 trumps still out.
    expect(k.trumpsOutstanding()).toBe(12);
  });
});

describe('play tactics', () => {
  it('T2: does not overtake a partner who is safely winning', () => {
    const state = playState({
      turn: 2,
      trump: 'S',
      hands: [[], [], [C(13, 'H'), C(5, 'H'), C(2, 'C')], []],
      leader: 0,
      currentTrick: playedCards([0, C(14, 'H')], [1, C(3, 'H')]), // partner (seat 0) winning
    });
    const action = chooseTarneebAction(state);
    expect(action).toMatchObject({ type: 'PLAY' });
    // Should keep the K and duck with the 5, not waste the honour.
    expect((action as { card: Card }).card).toEqual(C(5, 'H'));
  });

  it('T2: overtakes a partner only with the MASTER when a later opponent is a threat', () => {
    // Partner (seat 2) leads 5♦, an opponent (seat 3) plays 4♦ — our side is winning.
    // We sit third; a later opponent (seat 1) could hold a higher diamond, so we must
    // secure the trick with the A♦ (the master), not the useless 8♦.
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(14, 'D'), C(8, 'D')], [], [], []],
      leader: 2,
      currentTrick: playedCards([2, C(5, 'D')], [3, C(4, 'D')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'D'));
  });

  it('T2: 3rd hand high — plays highest even without the master', () => {
    // Partner (seat 2) leads 5♦, opponent (seat 3) plays 4♦. We (seat 0) are 3rd
    // with 8♦/3♦. Play 8♦ (3rd hand high) to try to secure against the 4th opponent.
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(8, 'D'), C(3, 'D')], [], [], []],
      leader: 2,
      currentTrick: playedCards([2, C(5, 'D')], [3, C(4, 'D')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(8, 'D'));
  });

  it('T3: third hand secures with the master under threat, not a middle card', () => {
    // Partner led 3♥, an opponent is winning with 9♥, a later opponent is a threat.
    // We hold A♥ (master) and 5♥ → win with the A♥.
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(14, 'H'), C(5, 'H')], [], [], []],
      leader: 2,
      currentTrick: playedCards([2, C(3, 'H')], [3, C(9, 'H')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'H'));
  });

  it('T3: third hand plays HIGH to contest when an opponent is winning', () => {
    // Partner led 3♥, an opponent is winning with 9♥. We sit third with Q♥,5♥ and a
    // later opponent could hold a higher heart. Ducking would simply concede the
    // trick, so we contest with the Q — it wins whenever the ace/king isn't behind.
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(12, 'H'), C(5, 'H')], [], [], []],
      leader: 2,
      currentTrick: playedCards([2, C(3, 'H')], [3, C(9, 'H')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(12, 'H'));
  });

  it('T3: third hand still ducks when a later opponent can RUFF (no card can win)', () => {
    // Partner led 3♥; opponent winning 9♥. Seat 1 (the last to play) is void in hearts
    // and holds trumps → it will ruff, so no heart of ours can win. Keep the Q, duck.
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(12, 'H'), C(5, 'H')], [], [], []],
      leader: 2,
      currentTrick: playedCards([2, C(3, 'H')], [3, C(9, 'H')]),
      // Seat 1 showed void in hearts earlier (ruffed a heart) and still holds trumps.
      tricks: [
        { leader: 2, winner: 1, cards: playedCards([2, C(14, 'H')], [3, C(6, 'H')], [0, C(7, 'H')], [1, C(2, 'S')]) },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(5, 'H'));
  });

  it('ruffs cheaply to beat an opponent when void in the led suit', () => {
    const state = playState({
      turn: 1,
      trump: 'S',
      hands: [[], [C(2, 'S'), C(7, 'S'), C(14, 'D')], [], []],
      leader: 0,
      currentTrick: playedCards([0, C(14, 'H')]), // opponent leads the ace of hearts
    });
    const action = chooseTarneebAction(state) as { card: Card };
    expect(action.card).toEqual(C(2, 'S')); // cheapest winning ruff
  });

  it('ruffs with the lowest trump, never wasting a high one', () => {
    const state = playState({
      turn: 1,
      trump: 'S',
      hands: [[], [C(2, 'S'), C(14, 'S'), C(3, 'D')], [], []], // holds low AND high trump
      leader: 0,
      currentTrick: playedCards([0, C(14, 'H')]),
    });
    const action = chooseTarneebAction(state) as { card: Card };
    expect(action.card).toEqual(C(2, 'S')); // the 2, not the ace
  });

  it('T7: second hand ducks an unsupported honour (does not commit the King)', () => {
    // Opponent leads 8♠ (a side suit; trump hearts). Seat 1 sits second with an
    // unsupported K♠ — a later opponent may hold the ace, so duck low.
    const state = playState({
      turn: 1,
      trump: 'H',
      hands: [[], [C(13, 'S'), C(5, 'S'), C(2, 'D')], [], []],
      leader: 0,
      currentTrick: playedCards([0, C(8, 'S')]),
    });
    const action = chooseTarneebAction(state) as { card: Card };
    expect(action.card).toEqual(C(5, 'S'));
  });

  it('T7 exception: second hand wins with a supported A-K (plays the King, keeps the ace)', () => {
    const state = playState({
      turn: 1,
      trump: 'H',
      hands: [[], [C(14, 'S'), C(13, 'S'), C(2, 'D')], [], []],
      leader: 0,
      currentTrick: playedCards([0, C(8, 'S')]),
    });
    const action = chooseTarneebAction(state) as { card: Card };
    expect(action.card).toEqual(C(13, 'S'));
  });

  it('second hand takes an opponent\'s KING lead with the ace (captures the top honour)', () => {
    // An opponent (declarer, seat 3) leads the K♣. We sit second with A♣ + a low club.
    // The king is the highest club still out, so we take it now with the ace rather
    // than ducking and later wasting the ace on a smaller card.
    const state = playState({
      turn: 0,
      trump: 'S',
      declarer: 3,
      hands: [[C(14, 'C'), C(4, 'C'), C(2, 'D')], [], [], []],
      leader: 3,
      currentTrick: playedCards([3, C(13, 'C')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'C'));
  });

  it('second hand ducks a QUEEN lead when a higher honour (the king) is still out', () => {
    // Opponent leads Q♣; we hold A♣ + low, but the K♣ is still out. Duck and keep the
    // ace to capture the KING later, rather than spending it on the queen now.
    const state = playState({
      turn: 0,
      trump: 'S',
      declarer: 3,
      hands: [[C(14, 'C'), C(4, 'C'), C(2, 'D')], [], [], []],
      leader: 3,
      currentTrick: playedCards([3, C(12, 'C')]),
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(4, 'C'));
  });

  it('T1: as declarer on lead, draws trumps with the master', () => {
    const state = playState({
      turn: 0,
      declarer: 0,
      trump: 'S',
      hands: [[C(14, 'S'), C(13, 'S'), C(12, 'S'), C(4, 'H'), C(3, 'C')], [], [], []],
      currentTrick: [],
    });
    const action = chooseTarneebAction(state) as { card: Card };
    expect(action.card).toEqual(C(14, 'S'));
  });

  it('T11: signals the strong side suit when discarding on a trump lead', () => {
    const state = playState({
      turn: 0,
      trump: 'S',
      hands: [[C(14, 'H'), C(13, 'H'), C(4, 'H'), C(2, 'C'), C(7, 'D')], [], [], []],
      leader: 3,
      currentTrick: playedCards([3, C(5, 'S')]), // trump led; seat 0 is void in trump
    });
    const action = chooseTarneebAction(state) as { card: Card };
    // Discard the low card of the strongest side suit (hearts) as the signal.
    expect(action.card).toEqual(C(4, 'H'));
  });
});

describe('declarer / partner coordination', () => {
  it('S7c: leads the Q to force the King (finesse) when the Ace is gone', () => {
    // Seat 0 holds Q-J of diamonds; the A♦ was played last trick (by an opponent),
    // the K♦ is still out → lead the Q to force the King and promote the Jack.
    const state = playState({
      turn: 0,
      trump: 'S',
      declarer: 2,
      hands: [[C(12, 'D'), C(11, 'D'), C(5, 'C')], [], [], []],
      currentTrick: [],
      tricks: [
        {
          leader: 1,
          winner: 1,
          cards: playedCards([1, C(14, 'D')], [2, C(2, 'D')], [3, C(3, 'D')], [0, C(4, 'D')]),
        },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(12, 'D'));
  });

  it('S6: returns partner\'s led suit low to promote their honour', () => {
    // Partner (seat 2) led 7♦ last trick; we hold low diamonds → lead one back so
    // partner's remaining diamond honour can win.
    const state = playState({
      turn: 0,
      trump: 'S',
      declarer: 0,
      hands: [[C(5, 'D'), C(3, 'D'), C(9, 'C')], [], [], []],
      currentTrick: [],
      tricks: [
        {
          leader: 2,
          winner: 0,
          cards: playedCards([2, C(7, 'D')], [3, C(6, 'D')], [0, C(14, 'D')], [1, C(8, 'D')]),
        },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(3, 'D'));
  });

  it('S5: the declarer\'s partner does not waste a trump honour (leads low trump)', () => {
    // Seat 0 (partner of declarer seat 2) holds only trumps → lead the low one,
    // not the Queen; leave trump control to the declarer.
    const state = playState({
      turn: 0,
      trump: 'S',
      declarer: 2,
      hands: [[C(12, 'S'), C(9, 'S'), C(4, 'S')], [], [], []],
      currentTrick: [],
      tricks: [],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(4, 'S'));
  });
});

describe('declarer trump management', () => {
  // Two rounds of trumps already drawn by the declarer (seat 0), all spades so the
  // side suits are untouched. Declarer still holds Q♠,4♠ + the master A♥ to cash.
  const drewTwice = {
    turn: 0 as Seat,
    declarer: 0 as Seat,
    trump: 'S' as Suit,
    hands: [[C(12, 'S'), C(4, 'S'), C(14, 'H'), C(3, 'C')], [], [], []] as Card[][],
    currentTrick: [],
    tricks: [
      { leader: 0 as Seat, winner: 0 as Seat, cards: playedCards([0, C(13, 'S')], [1, C(2, 'S')], [2, C(3, 'S')], [3, C(5, 'S')]) },
      { leader: 0 as Seat, winner: 0 as Seat, cards: playedCards([0, C(14, 'S')], [1, C(6, 'S')], [2, C(7, 'S')], [3, C(8, 'S')]) },
    ],
  };

  it('a low (7) contract stops drawing after a round or two and switches to cashing', () => {
    const state = playState({ ...drewTwice, contract: 7 });
    // Cap reached for a 7-bid → do NOT lead a third trump; cash the master A♥ instead.
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'H'));
  });

  it('a high (9) contract keeps drawing trumps past the low-bid cap', () => {
    const state = playState({ ...drewTwice, contract: 9 });
    // We still hold the master trump and opponents can hold trumps → keep drawing.
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(12, 'S'));
  });

  it('stops drawing once a forcing round shows opponents outrank us on trumps', () => {
    // Declarer (bid 9) led J♠; an opponent won with A♠. Declarer now holds Q♠,5♠,4♠,
    // but the K♠ is still out with an opponent → drawing only feeds them. Cash A♥.
    const state = playState({
      turn: 0,
      declarer: 0,
      trump: 'S',
      contract: 9,
      hands: [[C(12, 'S'), C(5, 'S'), C(4, 'S'), C(14, 'H')], [], [], []],
      currentTrick: [],
      tricks: [
        { leader: 0, winner: 1, cards: playedCards([0, C(11, 'S')], [1, C(14, 'S')], [2, C(3, 'S')], [3, C(2, 'S')]) },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'H'));
  });

  it('partner of a 9+ declarer who won a trick continues the draw with the highest trump', () => {
    // Contract 9, declarer is seat 2; its partner (seat 0) just won the previous
    // trick with the K♥ and is on lead holding A♠,5♠. It leads the A♠ (highest trump)
    // to keep drawing and signal the declarer that the top trumps are on our side.
    const state = playState({
      turn: 0,
      declarer: 2,
      trump: 'S',
      contract: 9,
      hands: [[C(14, 'S'), C(5, 'S'), C(7, 'H')], [], [], []],
      currentTrick: [],
      tricks: [
        { leader: 3, winner: 0, cards: playedCards([3, C(9, 'H')], [0, C(13, 'H')], [1, C(2, 'H')], [2, C(3, 'H')]) },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(14, 'S'));
  });

  it('partner does NOT force trumps high on a modest (8) contract', () => {
    // Same shape but contract 8 → the partner should not blow its high trump; it
    // reverts to normal play (does not lead the A♠).
    const state = playState({
      turn: 0,
      declarer: 2,
      trump: 'S',
      contract: 8,
      hands: [[C(14, 'S'), C(5, 'S'), C(7, 'H')], [], [], []],
      currentTrick: [],
      tricks: [
        { leader: 3, winner: 0, cards: playedCards([3, C(9, 'H')], [0, C(13, 'H')], [1, C(2, 'H')], [2, C(3, 'H')]) },
      ],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).not.toEqual(C(14, 'S'));
  });

  it('keeps its last trump in reserve rather than leading it out', () => {
    // Declarer holds a single trump (K♠) plus a heart holding whose Q is beatable.
    // With no safe side suit to develop, it still refuses to lead its last trump —
    // it keeps it for late control and leads a low heart instead.
    const state = playState({
      turn: 0,
      declarer: 0,
      trump: 'S',
      contract: 8,
      hands: [[C(13, 'S'), C(12, 'H'), C(5, 'H')], [], [], []],
      currentTrick: [],
    });
    expect((chooseTarneebAction(state) as { card: Card }).card).toEqual(C(5, 'H'));
  });
});

describe('strength', () => {
  it('an all-smart game reaches a 31+ winner', () => {
    let s = createGame({ seed: 5, firstDealer: 0 });
    let guard = 0;
    while (s.phase !== 'game-over') {
      if (++guard > 300_000) throw new Error('smart self-play did not terminate');
      s = s.phase === 'hand-over' ? applyAction(s, { type: 'NEXT_HAND' }) : applyAction(s, chooseTarneebAction(s));
    }
    expect(s.winner).not.toBeNull();
    expect(s.scores[s.winner!]).toBeGreaterThanOrEqual(31);
  });

  it('beats random opponents in a clear majority of games', () => {
    const rng = makeRng(2024);
    const randomAction = (s: TarneebState) => {
      const acts = getLegalActions(s);
      return acts[rng.int(acts.length)]!;
    };

    const GAMES = 40;
    let smartWins = 0;
    for (let g = 0; g < GAMES; g++) {
      let s = createGame({ seed: 100 + g, firstDealer: (g % 4) as Seat });
      let guard = 0;
      while (s.phase !== 'game-over') {
        if (++guard > 300_000) throw new Error('match did not terminate');
        if (s.phase === 'hand-over') {
          s = applyAction(s, { type: 'NEXT_HAND' });
          continue;
        }
        // Team 0 (seats 0 & 2) plays smart; team 1 (seats 1 & 3) plays random.
        const smartTurn = s.turn % 2 === 0;
        s = applyAction(s, smartTurn ? chooseTarneebAction(s) : randomAction(s));
      }
      if (s.winner === 0) smartWins++;
    }
    // Smart play should dominate random play.
    expect(smartWins / GAMES).toBeGreaterThanOrEqual(0.7);
  });
});

describe('tarneeb play hardening (stress)', () => {
  it('never overtakes its own partner with a beatable card when it could duck', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let s = createGame({ seed, firstDealer: (seed % 4) as Seat });
      let guard = 0;
      while (s.phase !== 'game-over') {
        if (++guard > 300_000) throw new Error('did not terminate');
        if (s.phase === 'hand-over') {
          s = applyAction(s, { type: 'NEXT_HAND' });
          continue;
        }
        const action = chooseTarneebAction(s);

        if (s.phase === 'playing' && action.type === 'PLAY' && s.currentTrick.length >= 1) {
          const trump = s.trump!;
          const led = s.currentTrick[0]!.card.suit;
          const seat = s.turn;
          const winnerBefore = trickWinner(s.currentTrick, trump);
          const partnerWinning = teamOf(winnerBefore) === teamOf(seat) && winnerBefore !== seat;
          const newWinner = trickWinner([...s.currentTrick, { seat, card: action.card }], trump);

          if (partnerWinning && newWinner === seat && action.card.suit === led && s.currentTrick.length !== 2) {
            // Skip 3rd hand (trick.length === 2): playing high is intentional.
            const remaining = 3 - s.currentTrick.length;
            let laterOppHigher = false;
            let sAfter = seat;
            for (let i = 0; i < remaining; i++) {
              sAfter = (((sAfter + 1) % 4) as Seat);
              if (teamOf(sAfter) === teamOf(seat)) continue;
              if ((s.hands[sAfter] ?? []).some((c) => c.suit === led && c.rank > action.card.rank)) {
                laterOppHigher = true;
              }
            }
            const couldDuck = legalPlays(s.hands[seat]!, s.currentTrick).some(
              (c) => trickWinner([...s.currentTrick, { seat, card: c }], trump) !== seat,
            );
            if (laterOppHigher && couldDuck) {
              throw new Error(
                `seat ${seat} overtook partner with a beatable ${action.card.rank}${action.card.suit}`,
              );
            }
          }

          // When ruffing (void in led, playing a trump that wins), it must be the
          // LOWEST trump that wins — never waste a high one.
          const voidInLed = !(s.hands[seat] ?? []).some((c) => c.suit === led);
          if (voidInLed && action.card.suit === trump && led !== trump && newWinner === seat) {
            const winCard = s.currentTrick.find((pc) => pc.seat === winnerBefore)!.card;
            const cheaperWin = (s.hands[seat] ?? []).some(
              (c) => c.suit === trump && c.rank < action.card.rank && cardBeats(c, winCard, trump, led),
            );
            if (cheaperWin) {
              throw new Error(
                `seat ${seat} ruffed with ${action.card.rank}${action.card.suit} when a lower trump would win`,
              );
            }
          }

          // OPENING LEAD: never squander an honour (throw a bare Q/K, or under-lead a
          // beatable honour) while a safe alternative exists — a trump to lead, or a
          // side suit not guarding a beatable honour.
          if (s.currentTrick.length === 0) {
            const suitCards = (s.hands[seat] ?? []).filter((c) => c.suit === action.card.suit);
            const topOther = (o: Seat, suit: string) =>
              Math.max(0, ...(s.hands[o] ?? []).filter((c) => c.suit === suit).map((c) => c.rank));
            const outTop = (suit: string) =>
              Math.max(0, ...([0, 1, 2, 3] as Seat[]).filter((o) => o !== seat).map((o) => topOther(o, suit)));
            const bareHonour =
              suitCards.length === 1 && action.card.rank >= 12 && action.card.rank < outTop(action.card.suit);
            const underLed =
              action.card.rank <= 9 &&
              suitCards.some((c) => c.rank >= 12 && c.rank < outTop(c.suit));
            if (bareHonour || underLed) {
              const hasTrump = (s.hands[seat] ?? []).some((c) => c.suit === trump);
              const safeSide = (['C', 'D', 'H', 'S'] as const).some((suit) => {
                if (suit === trump) return false;
                const mine = (s.hands[seat] ?? []).filter((c) => c.suit === suit);
                if (mine.length === 0) return false;
                const myTop = Math.max(...mine.map((c) => c.rank));
                return myTop < 12 || myTop > outTop(suit); // no honour, or a master
              });
              if (hasTrump || safeSide) {
                throw new Error(
                  `seat ${seat} wasted honour ${action.card.rank}${action.card.suit} on lead (safe: trump=${hasTrump} side=${safeSide})`,
                );
              }
            }
          }

          // 4th hand (last to play): if we take an opponent's trick, do it with the
          // CHEAPEST winning card — there is nobody left to beat, so overpaying wastes.
          const winCard = s.currentTrick.find((pc) => pc.seat === winnerBefore)!.card;
          if (s.currentTrick.length === 3 && !partnerWinning && newWinner === seat) {
            const legal4 = legalPlays(s.hands[seat]!, s.currentTrick);
            const cheapestWin = legal4
              .filter((c) => cardBeats(c, winCard, trump, led))
              .sort((a, b) => a.rank - b.rank)[0];
            if (
              cheapestWin &&
              !(cheapestWin.suit === action.card.suit && cheapestWin.rank === action.card.rank)
            ) {
              throw new Error(
                `seat ${seat} won 4th hand with ${action.card.rank}${action.card.suit} when ${cheapestWin.rank}${cheapestWin.suit} was cheaper`,
              );
            }
          }
        }
        s = applyAction(s, action);
      }
    }
  });
});
