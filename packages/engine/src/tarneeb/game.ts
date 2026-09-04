import type { Card } from '../cards.js';
import { cardsEqual, shuffledDeck, sortHand } from '../cards.js';
import type { Seat, TarneebAction, TarneebState, Team } from './types.js';
import { GAME_TARGET, MAX_BID, SEATS, nextSeat, teamOf } from './types.js';
import { canPlay, legalBidAmounts, minLegalBid, scoreHand, trickWinner } from './rules.js';

export interface NewGameOptions {
  seed?: number;
  /** Dealer for the very first hand. Defaults to a value derived from the seed. */
  firstDealer?: Seat;
}

/** Deal 13 cards to each seat from a deterministic shuffle, hand sorted for display. */
function dealHands(seed: number, handNumber: number): Card[][] {
  const deck = shuffledDeck(seed + handNumber);
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) {
    hands[i % 4]!.push(deck[i]!);
  }
  return hands.map((h) => sortHand(h));
}

/** Build a fresh bidding state for a new deal, preserving cumulative scores. */
function startHand(
  seed: number,
  handNumber: number,
  dealer: Seat,
  scores: readonly [number, number],
): TarneebState {
  return {
    phase: 'bidding',
    handNumber,
    seed,
    dealer,
    turn: nextSeat(dealer), // bidding starts to the dealer's right
    hands: dealHands(seed, handNumber),
    passed: [false, false, false, false],
    bidLog: [],
    highBid: null,
    declarer: null,
    trump: null,
    contract: null,
    leader: null,
    currentTrick: [],
    tricks: [],
    tricksWon: [0, 0],
    scores: [scores[0], scores[1]],
    lastHand: null,
    winner: null,
  };
}

export function createGame(opts: NewGameOptions = {}): TarneebState {
  const seed = opts.seed ?? (Math.floor(Math.random() * 0x7fffffff) | 0);
  const firstDealer = opts.firstDealer ?? ((seed % 4) as Seat);
  return startHand(seed, 0, firstDealer, [0, 0]);
}

/** Next seat, counter-clockwise, that has not passed. */
function nextActiveSeat(from: Seat, passed: readonly boolean[]): Seat {
  let s = nextSeat(from);
  for (let i = 0; i < 4; i++) {
    if (!passed[s]) return s;
    s = nextSeat(s);
  }
  return from; // should not happen while a hand is live
}

function activeCount(passed: readonly boolean[]): number {
  return passed.reduce((n, p) => n + (p ? 0 : 1), 0);
}

/** Team(s) at or above the target become the winner; higher score breaks ties. */
function computeWinner(scores: readonly [number, number]): Team | null {
  const c0 = scores[0] >= GAME_TARGET;
  const c1 = scores[1] >= GAME_TARGET;
  if (!c0 && !c1) return null;
  if (c0 && !c1) return 0;
  if (c1 && !c0) return 1;
  if (scores[0] === scores[1]) return null; // exact tie: keep playing
  return scores[0] > scores[1] ? 0 : 1;
}

/** Pure reducer. Throws on an illegal action (the engine is authoritative). */
export function applyAction(state: TarneebState, action: TarneebAction): TarneebState {
  switch (action.type) {
    case 'BID':
      return applyBid(state, action.seat, action.amount);
    case 'PASS':
      return applyPass(state, action.seat);
    case 'SELECT_TRUMP':
      return applySelectTrump(state, action.seat, action.suit);
    case 'PLAY':
      return applyPlay(state, action.seat, action.card);
    case 'NEXT_HAND':
      return applyNextHand(state);
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function requireTurn(state: TarneebState, seat: Seat, phase: TarneebState['phase']): void {
  if (state.phase !== phase) throw new Error(`Expected phase ${phase}, got ${state.phase}`);
  if (state.turn !== seat) throw new Error(`Not seat ${seat}'s turn (turn=${state.turn})`);
}

function applyBid(state: TarneebState, seat: Seat, amount: number): TarneebState {
  requireTurn(state, seat, 'bidding');
  const allowed = legalBidAmounts(state.highBid?.amount ?? null);
  if (!allowed.includes(amount)) {
    throw new Error(`Illegal bid ${amount}; must be ${minLegalBid(state.highBid?.amount ?? null)}..${MAX_BID}`);
  }
  const highBid = { seat, amount };
  const bidLog = [...state.bidLog, highBid];
  return resolveBidding({ ...state, highBid, bidLog }, seat);
}

function applyPass(state: TarneebState, seat: Seat): TarneebState {
  requireTurn(state, seat, 'bidding');
  const passed = state.passed.slice();
  passed[seat] = true;
  const bidLog = [...state.bidLog, { seat, amount: 'pass' as const }];
  return resolveBidding({ ...state, passed, bidLog }, seat);
}

/** After a bid/pass, either advance the turn, resolve to a declarer, or redeal. */
function resolveBidding(state: TarneebState, lastActor: Seat): TarneebState {
  const remaining = activeCount(state.passed);

  if (state.highBid !== null && remaining === 1) {
    // Only the high bidder is left standing → they declare trump.
    const declarer = state.highBid.seat;
    return { ...state, phase: 'trump-select', declarer, turn: declarer };
  }

  if (state.highBid === null && remaining === 0) {
    // Everyone passed → throw-in. Redeal with the deal moving to the right.
    const handNumber = state.handNumber + 1;
    const dealer = nextSeat(state.dealer);
    return startHand(state.seed, handNumber, dealer, state.scores);
  }

  return { ...state, turn: nextActiveSeat(lastActor, state.passed) };
}

function applySelectTrump(
  state: TarneebState,
  seat: Seat,
  suit: TarneebState['trump'],
): TarneebState {
  requireTurn(state, seat, 'trump-select');
  if (state.declarer !== seat) throw new Error('Only the declarer may select trump');
  if (suit === null) throw new Error('Trump suit required');
  if (state.highBid === null) throw new Error('No winning bid');
  return {
    ...state,
    phase: 'playing',
    trump: suit,
    contract: state.highBid.amount,
    leader: seat,
    turn: seat,
    currentTrick: [],
  };
}

function applyPlay(state: TarneebState, seat: Seat, card: Card): TarneebState {
  requireTurn(state, seat, 'playing');
  const hand = state.hands[seat]!;
  if (!canPlay(hand, state.currentTrick, card)) {
    throw new Error(`Illegal play ${card.rank}${card.suit} by seat ${seat}`);
  }

  const hands = state.hands.map((h, i) => (i === seat ? h.filter((c) => !cardsEqual(c, card)) : h));
  const currentTrick = [...state.currentTrick, { seat, card }];

  if (currentTrick.length < 4) {
    return { ...state, hands, currentTrick, turn: nextSeat(seat) };
  }

  // Trick complete.
  const winner = trickWinner(currentTrick, state.trump!);
  const completed = { leader: state.leader!, cards: currentTrick, winner };
  const tricks = [...state.tricks, completed];
  const tricksWon: [number, number] = [state.tricksWon[0], state.tricksWon[1]];
  tricksWon[teamOf(winner)] += 1;

  if (tricks.length < 13) {
    return {
      ...state,
      hands,
      tricks,
      tricksWon,
      currentTrick: [],
      leader: winner,
      turn: winner,
    };
  }

  // Hand complete → score it.
  const contract = state.contract!;
  const declarer = state.declarer!;
  const declarerTricks = tricksWon[teamOf(declarer)];
  const delta = scoreHand(contract, declarer, declarerTricks);
  const scores: [number, number] = [state.scores[0] + delta[0], state.scores[1] + delta[1]];
  const winnerTeam = computeWinner(scores);

  return {
    ...state,
    hands,
    tricks,
    tricksWon,
    currentTrick: [],
    leader: winner,
    scores,
    phase: winnerTeam !== null ? 'game-over' : 'hand-over',
    winner: winnerTeam,
    lastHand: {
      contract,
      declarer,
      trump: state.trump!,
      declarerTricks,
      delta,
    },
  };
}

function applyNextHand(state: TarneebState): TarneebState {
  if (state.phase !== 'hand-over') {
    throw new Error(`NEXT_HAND only valid at hand-over (phase=${state.phase})`);
  }
  const handNumber = state.handNumber + 1;
  const dealer = nextSeat(state.dealer);
  return startHand(state.seed, handNumber, dealer, state.scores);
}

/**
 * Can `seat` claim the rest of the hand — is it provably winning every remaining
 * trick? True only when the seat is on lead and each of its cards is unbeatable:
 * a trump higher than every trump still out, or the top card of its suit that no
 * one can ruff (no other player is void in that suit while holding a trump).
 */
export function canClaimRemaining(state: TarneebState, seat: Seat): boolean {
  if (state.phase !== 'playing' || state.turn !== seat) return false;
  if (state.currentTrick.length !== 0) return false; // only when on lead
  const hand = state.hands[seat] ?? [];
  if (hand.length === 0) return false;
  const trump = state.trump!;
  const others: Card[] = [];
  for (const s of SEATS) if (s !== seat) others.push(...(state.hands[s] ?? []));

  for (const c of hand) {
    if (c.suit === trump) {
      if (others.some((o) => o.suit === trump && o.rank > c.rank)) return false;
    } else {
      if (others.some((o) => o.suit === c.suit && o.rank > c.rank)) return false;
      const canBeRuffed = SEATS.some(
        (s) =>
          s !== seat &&
          !(state.hands[s] ?? []).some((x) => x.suit === c.suit) &&
          (state.hands[s] ?? []).some((x) => x.suit === trump),
      );
      if (canBeRuffed) return false;
    }
  }
  return true;
}

/** All legal actions for the seat currently on turn. Empty at hand-over/game-over
 *  except that hand-over offers NEXT_HAND. */
export function getLegalActions(state: TarneebState): TarneebAction[] {
  switch (state.phase) {
    case 'bidding': {
      const seat = state.turn;
      const bids = legalBidAmounts(state.highBid?.amount ?? null).map(
        (amount): TarneebAction => ({ type: 'BID', seat, amount }),
      );
      return [...bids, { type: 'PASS', seat }];
    }
    case 'trump-select': {
      const seat = state.turn;
      return (['C', 'D', 'H', 'S'] as const).map((suit) => ({ type: 'SELECT_TRUMP', seat, suit }));
    }
    case 'playing': {
      const seat = state.turn;
      const hand = state.hands[seat]!;
      const led = state.currentTrick[0]?.card.suit;
      const legal = led === undefined ? hand : hand.filter((c) => c.suit === led);
      const playable = legal.length > 0 ? legal : hand;
      return playable.map((card): TarneebAction => ({ type: 'PLAY', seat, card }));
    }
    case 'hand-over':
      return [{ type: 'NEXT_HAND' }];
    case 'game-over':
      return [];
    default:
      return [];
  }
}
