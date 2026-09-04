import type { Card } from '../cards.js';
import { cardsEqual, shuffledDeck, sortHand } from '../cards.js';
import type { PlayedCard, Seat } from '../tarneeb/types.js';
import { SEATS, nextSeat } from '../tarneeb/types.js';
import { legalPlays } from '../tarneeb/rules.js';
import type { DealTally } from './rules.js';
import {
  avoidanceTrickWinner,
  emptyLayout,
  extendLayout,
  isAvoidanceDealOver,
  isDoubleable,
  scoreTrixDeal,
  sheddingPlayable,
} from './rules.js';
import type { TrixAction, TrixContract, TrixMode, TrixState } from './types.js';
import { KINGDOMS, contractsForMode, trixTeamScores } from './types.js';

export interface NewTrixGameOptions {
  seed?: number;
  mode?: TrixMode;
  partnership?: boolean;
}

function deal(seed: number, dealNumber: number): Card[][] {
  const deck = shuffledDeck(seed + dealNumber * 101 + 7);
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) hands[i % 4]!.push(deck[i]!);
  return hands.map((h) => sortHand(h));
}

function seatWith7H(hands: readonly (readonly Card[])[]): Seat {
  for (const s of SEATS) {
    if (hands[s]!.some((c) => c.suit === 'H' && c.rank === 7)) return s;
  }
  return 0;
}

/** Next seat (counter-clockwise) that still holds cards. */
function nextWithCards(from: Seat, hands: readonly (readonly Card[])[]): Seat {
  let s = nextSeat(from);
  for (let i = 0; i < 4; i++) {
    if (hands[s]!.length > 0) return s;
    s = nextSeat(s);
  }
  return from;
}

function contractSelectState(
  base: Pick<
    TrixState,
    | 'mode'
    | 'partnership'
    | 'seed'
    | 'dealNumber'
    | 'kingdomIndex'
    | 'king'
    | 'firstKing'
    | 'usedContracts'
    | 'scores'
  >,
  hands: readonly (readonly Card[])[],
): TrixState {
  return {
    ...base,
    contract: null,
    phase: 'contract-select',
    hands,
    turn: base.king,
    leader: null,
    currentTrick: [],
    captured: [[], [], [], []],
    tricksTaken: [0, 0, 0, 0],
    voids: [[], [], [], []],
    doublePending: [],
    doubled: [],
    layout: emptyLayout(),
    finishOrder: [],
    exposedTwos: [],
    dealResult: null,
    winner: null,
  };
}

/**
 * The four 2s and their holders, revealed only when the 2s span BOTH teams
 * (seats 0/2 vs 1/3) — i.e. at least one 2 on each side. If all the 2s are
 * within a single team they stay hidden.
 */
function computeExposedTwos(
  hands: readonly (readonly Card[])[],
): { card: Card; holder: Seat }[] {
  const twos: { card: Card; holder: Seat }[] = [];
  for (const seat of SEATS) {
    for (const c of hands[seat]!) if (c.rank === 2) twos.push({ card: c, holder: seat });
  }
  const teamA = twos.some((t) => t.holder % 2 === 0); // seats 0 & 2
  const teamB = twos.some((t) => t.holder % 2 === 1); // seats 1 & 3
  return teamA && teamB ? twos : [];
}

export function createTrixGame(opts: NewTrixGameOptions = {}): TrixState {
  const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0);
  const mode: TrixMode = opts.mode ?? 'regular';
  const hands = deal(seed, 0);
  const firstKing = seatWith7H(hands);
  return contractSelectState(
    {
      mode,
      partnership: opts.partnership ?? false,
      seed,
      dealNumber: 0,
      kingdomIndex: 0,
      king: firstKing,
      firstKing,
      usedContracts: [],
      scores: [0, 0, 0, 0],
    },
    hands,
  );
}

export function applyTrixAction(state: TrixState, action: TrixAction): TrixState {
  switch (action.type) {
    case 'CHOOSE_CONTRACT':
      return chooseContract(state, action.seat, action.contract);
    case 'SET_DOUBLE':
      return applyDouble(state, action.seat, action.cards);
    case 'PLAY':
      return play(state, action.seat, action.card);
    case 'PASS':
      return pass(state, action.seat);
    case 'NEXT_DEAL':
      return nextDeal(state);
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown Trix action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Seats holding a doubleable card for this contract, ordered king-first. */
function eligibleDoublers(
  hands: readonly (readonly Card[])[],
  contract: TrixContract,
  king: Seat,
): Seat[] {
  const order: Seat[] = [king, nextSeat(king), nextSeat(nextSeat(king)), nextSeat(nextSeat(nextSeat(king)))];
  return order.filter((s) => hands[s]!.some((c) => isDoubleable(c, contract)));
}

/** Enter the play phase for an avoidance contract (fresh trick state). */
function beginAvoidancePlay(state: TrixState): TrixState {
  return {
    ...state,
    phase: 'playing',
    leader: state.king,
    turn: state.king,
    currentTrick: [],
    captured: [[], [], [], []],
    tricksTaken: [0, 0, 0, 0],
    voids: [[], [], [], []],
  };
}

function chooseContract(state: TrixState, seat: Seat, contract: TrixContract): TrixState {
  if (state.phase !== 'contract-select') throw new Error('Not choosing a contract');
  if (seat !== state.king) throw new Error('Only the king chooses the contract');
  if (state.usedContracts.includes(contract)) throw new Error('Contract already used this kingdom');

  const base = { ...state, contract, doubled: [] };

  if (contract === 'trix') {
    return {
      ...base,
      phase: 'shedding',
      leader: state.king,
      turn: state.king,
      layout: emptyLayout(),
      finishOrder: [],
      // Exposing the 2s is a Trix Complex rule only — in regular Trix they stay hidden.
      exposedTwos: state.mode === 'complex' ? computeExposedTwos(state.hands) : [],
    };
  }

  // King of Hearts / Queens / Complex may be doubled by their holders before play.
  if (contract === 'kingOfHearts' || contract === 'queens' || contract === 'complex') {
    const eligible = eligibleDoublers(state.hands, contract, state.king);
    if (eligible.length > 0) {
      return { ...base, phase: 'doubling', doublePending: eligible, turn: eligible[0]! };
    }
  }
  return beginAvoidancePlay(base);
}

function applyDouble(state: TrixState, seat: Seat, cards: readonly Card[]): TrixState {
  if (state.phase !== 'doubling') throw new Error('Not a doubling decision');
  if (state.doublePending[0] !== seat) throw new Error('Not your doubling decision');
  const hand = state.hands[seat]!;
  for (const c of cards) {
    if (!hand.some((h) => cardsEqual(h, c)) || !isDoubleable(c, state.contract!)) {
      throw new Error('That card cannot be doubled');
    }
  }
  const doubled = [...state.doubled, ...cards.map((card) => ({ card, by: seat }))];
  const doublePending = state.doublePending.slice(1);
  if (doublePending.length === 0) return beginAvoidancePlay({ ...state, doubled, doublePending: [] });
  return { ...state, doubled, doublePending, turn: doublePending[0]! };
}

function endDeal(state: TrixState, tally: DealTally): TrixState {
  const delta = scoreTrixDeal(state.contract!, tally);
  const scores = state.scores.map((s, i) => s + (delta[i] ?? 0));
  return { ...state, phase: 'deal-over', scores, dealResult: { contract: state.contract!, delta } };
}

function play(state: TrixState, seat: Seat, card: Card): TrixState {
  if (state.phase === 'shedding') return playShedding(state, seat, card);
  if (state.phase === 'playing') return playAvoidance(state, seat, card);
  throw new Error(`Cannot PLAY in phase ${state.phase}`);
}

function playShedding(state: TrixState, seat: Seat, card: Card): TrixState {
  if (state.turn !== seat) throw new Error('Not your turn');
  if (!sheddingPlayable(state.hands[seat]!, state.layout).some((c) => cardsEqual(c, card))) {
    throw new Error('Illegal shedding play');
  }
  const hands = state.hands.map((h, i) => (i === seat ? h.filter((c) => !cardsEqual(c, card)) : h));
  const layout = extendLayout(state.layout, card);

  let finishOrder = state.finishOrder;
  if (hands[seat]!.length === 0) finishOrder = [...finishOrder, seat];

  if (finishOrder.length >= 3) {
    return endDeal(
      { ...state, hands, layout, finishOrder },
      { captured: [[], [], [], []], tricksTaken: [0, 0, 0, 0], finishOrder, doubled: state.doubled },
    );
  }
  return { ...state, hands, layout, finishOrder, turn: nextWithCards(seat, hands) };
}

function playAvoidance(state: TrixState, seat: Seat, card: Card): TrixState {
  if (state.turn !== seat) throw new Error('Not your turn');
  const hand = state.hands[seat]!;
  if (!legalPlays(hand, state.currentTrick).some((c) => cardsEqual(c, card))) {
    throw new Error('Illegal play (must follow suit)');
  }
  const hands = state.hands.map((h, i) => (i === seat ? h.filter((c) => !cardsEqual(c, card)) : h));
  const currentTrick: PlayedCard[] = [...state.currentTrick, { seat, card }];

  // Infer a void: playing off-suit when a led suit exists shows the seat is void in it.
  const led = state.currentTrick[0]?.card.suit;
  const voids =
    led !== undefined && card.suit !== led && !state.voids[seat]!.includes(led)
      ? state.voids.map((v, i) => (i === seat ? [...v, led] : v))
      : state.voids;

  if (currentTrick.length < 4) {
    return { ...state, hands, currentTrick, voids, turn: nextSeat(seat) };
  }

  // Trick complete.
  const winner = avoidanceTrickWinner(currentTrick);
  const captured = state.captured.map((pile, i) =>
    i === winner ? [...pile, ...currentTrick.map((pc) => pc.card)] : pile,
  );
  const tricksTaken = state.tricksTaken.map((n, i) => (i === winner ? n + 1 : n));
  const completed = tricksTaken.reduce((a, b) => a + b, 0);

  const next: TrixState = {
    ...state,
    hands,
    captured,
    tricksTaken,
    voids,
    currentTrick: [],
    leader: winner,
    turn: winner,
  };

  if (isAvoidanceDealOver(state.contract!, captured, completed)) {
    return endDeal(next, { captured, tricksTaken, finishOrder: [], doubled: state.doubled });
  }
  return next;
}

function pass(state: TrixState, seat: Seat): TrixState {
  if (state.phase !== 'shedding') throw new Error('PASS only valid while shedding');
  if (state.turn !== seat) throw new Error('Not your turn');
  if (sheddingPlayable(state.hands[seat]!, state.layout).length > 0) {
    throw new Error('You have a playable card; cannot pass');
  }
  return { ...state, turn: nextWithCards(seat, state.hands) };
}

function nextDeal(state: TrixState): TrixState {
  if (state.phase !== 'deal-over') throw new Error('NEXT_DEAL only valid at deal-over');
  const perKingdom = contractsForMode(state.mode).length; // 5 regular, 2 complex
  const used = [...state.usedContracts, state.contract!];
  const kingdomComplete = used.length >= perKingdom;

  if (kingdomComplete && state.kingdomIndex >= KINGDOMS - 1) {
    return { ...state, phase: 'game-over', winner: computeWinner(state.scores, state.partnership) };
  }

  const dealNumber = state.dealNumber + 1;
  const kingdomIndex = kingdomComplete ? state.kingdomIndex + 1 : state.kingdomIndex;
  const king = kingdomComplete ? nextSeat(state.king) : state.king;
  const usedContracts = kingdomComplete ? [] : used;

  return contractSelectState(
    {
      mode: state.mode,
      partnership: state.partnership,
      seed: state.seed,
      dealNumber,
      kingdomIndex,
      king,
      firstKing: state.firstKing,
      usedContracts,
      scores: state.scores,
    },
    deal(state.seed, dealNumber),
  );
}

function computeWinner(scores: readonly number[], partnership: boolean): Seat | 'tie' {
  if (partnership) {
    // Winner is the team with the higher summed total. Return 0 for team {0,2}
    // or 1 for team {1,3} (a representative seat of the winning team).
    const [t0, t1] = trixTeamScores(scores);
    if (t0 === t1) return 'tie';
    return t0 > t1 ? 0 : 1;
  }
  let best: Seat = 0;
  for (const s of SEATS) if (scores[s]! > scores[best]!) best = s;
  const tied = SEATS.filter((s) => scores[s] === scores[best]);
  return tied.length > 1 ? 'tie' : best;
}

/** Legal actions for the seat currently on turn (plus NEXT_DEAL at deal-over). */
export function getTrixLegalActions(state: TrixState): TrixAction[] {
  switch (state.phase) {
    case 'contract-select':
      return contractsForMode(state.mode)
        .filter((c) => !state.usedContracts.includes(c))
        .map((contract): TrixAction => ({ type: 'CHOOSE_CONTRACT', seat: state.king, contract }));
    case 'doubling':
      // The seat may double any subset of its eligible cards; the safe default
      // action is to decline. (Bots choose a subset via chooseTrixAction.)
      return [{ type: 'SET_DOUBLE', seat: state.turn, cards: [] }];
    case 'playing': {
      const seat = state.turn;
      return legalPlays(state.hands[seat]!, state.currentTrick).map(
        (card): TrixAction => ({ type: 'PLAY', seat, card }),
      );
    }
    case 'shedding': {
      const seat = state.turn;
      const playable = sheddingPlayable(state.hands[seat]!, state.layout);
      return playable.length > 0
        ? playable.map((card): TrixAction => ({ type: 'PLAY', seat, card }))
        : [{ type: 'PASS', seat }];
    }
    case 'deal-over':
      return [{ type: 'NEXT_DEAL' }];
    default:
      return [];
  }
}
