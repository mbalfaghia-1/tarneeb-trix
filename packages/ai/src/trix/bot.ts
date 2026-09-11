import type { Card, Seat, Suit, TrixAction, TrixContract, TrixState } from '@tarneeb/engine';
import {
  applyTrixAction,
  contractsForMode,
  legalPlays,
  nextSeat,
  sheddingPlayable,
  teamOf,
} from '@tarneeb/engine';

/**
 * Trix bot. Deterministic, public-info only. Covers contract selection, the four
 * avoidance trick-games, and the shedding contract, following the PDF's
 * per-contract tactics. Upgradeable (doubling + finer play) later.
 */
export function chooseTrixAction(state: TrixState): TrixAction {
  switch (state.phase) {
    case 'contract-select':
      return { type: 'CHOOSE_CONTRACT', seat: state.king, contract: pickContract(state) };
    case 'doubling':
      return { type: 'SET_DOUBLE', seat: state.turn, cards: chooseDoubles(state) };
    case 'playing':
      return { type: 'PLAY', seat: state.turn, card: pickAvoidanceCard(state) };
    case 'shedding':
      return pickShedding(state);
    case 'deal-over':
      return { type: 'NEXT_DEAL' };
    default:
      throw new Error(`Trix bot cannot act in phase ${state.phase}`);
  }
}

/**
 * Doubling policy: double a penalty card only when we have enough LENGTH in its
 * suit to stay safe. Long holdings give us low cards to duck under every lead, so
 * we are rarely forced to win the trick that holds the penalty — the opposite of a
 * short holding, where a bare K♥/Q must be played early and gets caught.
 *
 *  - 4+ cards of the suit  → safe to double.
 *  - exactly 3 cards       → only if we are void in another suit (a discard escape
 *                            to dump the card if we do get stuck) — riskier.
 */
function chooseDoubles(state: TrixState): Card[] {
  const hand = state.hands[state.turn]!;
  const suitLen = (s: Suit) => hand.filter((c) => c.suit === s).length;
  const voidElsewhere = (s: Suit) => SUITS_ORDER.some((x) => x !== s && suitLen(x) === 0);
  const confident = (s: Suit) => suitLen(s) >= 4 || (suitLen(s) === 3 && voidElsewhere(s));

  const kh = hand.find((c) => c.suit === 'H' && c.rank === 13);
  const doubleKH = kh && confident('H') ? [kh] : [];
  const doubleQueens = hand.filter((c) => c.rank === 12 && confident(c.suit));

  if (state.contract === 'kingOfHearts') return doubleKH;
  if (state.contract === 'queens') return doubleQueens;
  if (state.contract === 'complex') return [...doubleKH, ...doubleQueens]; // both are doubleable
  return [];
}

// --- small helpers ---------------------------------------------------------

const lowest = (cards: readonly Card[]): Card =>
  cards.reduce((lo, c) => (c.rank < lo.rank ? c : lo), cards[0]!);
const highest = (cards: readonly Card[]): Card =>
  cards.reduce((hi, c) => (c.rank > hi.rank ? c : hi), cards[0]!);

const SUITS_ORDER: readonly Suit[] = ['C', 'D', 'H', 'S'];

function shortestSuit(hand: readonly Card[]): Suit {
  let best: Suit = 'C';
  let bestLen = Infinity;
  for (const suit of SUITS_ORDER) {
    const len = hand.filter((c) => c.suit === suit).length;
    if (len > 0 && len < bestLen) {
      bestLen = len;
      best = suit;
    }
  }
  return best;
}

// --- contract selection ----------------------------------------------------

function pickContract(state: TrixState): TrixContract {
  const hand = state.hands[state.king]!;
  const remaining = contractsForMode(state.mode).filter((c) => !state.usedContracts.includes(c));
  let best = remaining[0]!;
  let bestFit = -Infinity;
  for (const c of remaining) {
    const fit = contractFit(hand, c);
    if (fit > bestFit) {
      bestFit = fit;
      best = c;
    }
  }
  return best;
}

/** Higher = better suited to play this contract now (least penalty risk). */
function contractFit(hand: readonly Card[], contract: TrixContract): number {
  const lows = hand.filter((c) => c.rank <= 6).length;
  const highs = hand.filter((c) => c.rank >= 12).length;
  const jacks = hand.filter((c) => c.rank === 11).length;
  const queens = hand.filter((c) => c.rank === 12).length;
  const diamonds = hand.filter((c) => c.suit === 'D');
  const highDiamonds = diamonds.filter((c) => c.rank >= 11).length;
  const hasKH = hand.some((c) => c.suit === 'H' && c.rank === 13);
  const hearts = hand.filter((c) => c.suit === 'H').length;
  const hasShort = SUITS_ORDER.some((s) => {
    const n = hand.filter((c) => c.suit === s).length;
    return n > 0 && n <= 2;
  });

  switch (contract) {
    case 'collection':
    case 'complex':
      return lows - highs; // mostly-low hand wins few tricks / avoids penalties
    case 'trix':
      return highs + jacks - lows; // mostly-high hand sheds well
    case 'queens':
      return (queens === 0 ? 6 : 3 - queens * 2) + (hasShort ? 2 : 0);
    case 'kingOfHearts':
      return hasKH ? (hearts >= 4 ? 1 : -3) : 5;
    case 'diamonds':
      return diamonds.length === 0 ? 6 : 4 - highDiamonds * 2 - Math.max(0, diamonds.length - 6);
  }
}

// --- avoidance play --------------------------------------------------------

// --- endgame lookahead ------------------------------------------------------

const ENDGAME_MAX_HAND = 2; // last two tricks — small enough to search instantly, and by
// then the layout is essentially deducible; wider searches are far too slow (each node
// copies the whole state) and start relying on hidden cards.
const ENDGAME_NODE_CAP = 20_000; // bail (fall back to heuristics) if the tree is too wide

/**
 * Double-dummy endgame solver. Once only a few cards remain, it searches every line of
 * the rest of the deal and returns the play that minimises our own (or, in partnership,
 * our team's) penalty, assuming every seat plays to minimise its own. It uses the whole
 * deal (a "double dummy" search — the standard endgame technique for trick games); this
 * is why bots get sharp forcing/endplay lines automatically in the last few tricks.
 * Returns null when it doesn't apply (large hands, not a real 52-card position, or the
 * search grew too big) so the heuristics take over.
 */
function endgameSolve(state: TrixState, seat: Seat): Card | null {
  if (state.phase !== 'playing') return null;
  // Only a genuine, fully-dealt position (all 52 cards accounted) — never a test stub.
  let total = state.currentTrick.length;
  for (const h of state.hands) total += h.length;
  for (const pile of state.captured ?? []) total += pile.length;
  if (total !== 52) return null;
  if ((state.hands[seat]?.length ?? 0) === 0) return null;
  if (Math.max(...state.hands.map((h) => h.length)) > ENDGAME_MAX_HAND) return null;

  const partnership = state.partnership;
  const teamValue = (vec: readonly number[], s: Seat): number =>
    partnership ? (vec[s] ?? 0) + (vec[((s + 2) % 4) as Seat] ?? 0) : vec[s] ?? 0;

  let nodes = 0;
  let bailed = false;

  // Max^n: every seat on the move picks the line that maximises its own team's final
  // score. Deal scores only change at deal end, so comparing final scores ranks lines
  // by the penalty each seat takes over the rest of the deal.
  const solve = (s: TrixState): readonly number[] => {
    if (s.phase === 'deal-over' || s.phase === 'game-over') return s.scores;
    if (++nodes > ENDGAME_NODE_CAP) {
      bailed = true;
      return s.scores;
    }
    const mover = s.turn;
    const legal = legalPlays(s.hands[mover] ?? [], s.currentTrick);
    let best: readonly number[] | null = null;
    for (const card of legal) {
      const vec = solve(applyTrixAction(s, { type: 'PLAY', seat: mover, card }));
      if (bailed) return s.scores;
      if (best === null || teamValue(vec, mover) > teamValue(best, mover)) best = vec;
    }
    return best ?? s.scores;
  };

  let bestCard: Card | null = null;
  let bestVal = -Infinity;
  for (const card of legalPlays(state.hands[seat] ?? [], state.currentTrick)) {
    const vec = solve(applyTrixAction(state, { type: 'PLAY', seat, card }));
    if (bailed) return null; // too big to search this deep — let the heuristics decide
    const v = teamValue(vec, seat);
    if (v > bestVal) {
      bestVal = v;
      bestCard = card;
    }
  }
  return bestCard;
}

function pickAvoidanceCard(state: TrixState): Card {
  const contract = state.contract!;
  const seat = state.turn;
  const hand = state.hands[seat]!;
  const trick = state.currentTrick;
  const legal = legalPlays(hand, trick);
  if (legal.length === 1) return legal[0]!;

  // Exact endgame search takes over in the last few tricks; heuristics handle the rest.
  const solved = endgameSolve(state, seat);
  if (solved) return solved;

  const count = buildCount(state, seat);
  if (trick.length === 0) return leadAvoidance(hand, contract, state, seat, count);

  const led = trick[0]!.card.suit;
  let winTop = -1;
  let winnerSeat = trick[0]!.seat;
  for (const pc of trick) {
    if (pc.card.suit === led && pc.card.rank > winTop) {
      winTop = pc.card.rank;
      winnerSeat = pc.seat;
    }
  }
  const canFollow = legal.every((c) => c.suit === led);
  const partnerWinning =
    state.partnership && winnerSeat !== seat && teamOf(winnerSeat) === teamOf(seat);

  // Partnership: our partner is taking the trick — the penalty (if any) already
  // sits on our team, so never add a penalty to it. When we are LAST to play the
  // trick is locked to our side, so unload our highest non-penalty card (dumping a
  // liability while it's safe). When we are NOT last, an opponent behind could be
  // forced to cap a penalty onto us, so duck low and keep our high card out of it.
  if (partnerWinning) {
    if (canFollow) {
      // Last: the trick is locked to us — unload our highest non-penalty card.
      if (trick.length === 3) return safeDiscard(legal, contract);
      // Not last: shed our biggest safe card that stays UNDER our partner (keeps the
      // winning bar unchanged, so an opponent behind can still be forced to take it),
      // rather than hoarding a low card we don't need.
      return duckBelow(legal, winTop, contract);
    }
    // void → shed strategically. In Complex, dump diamonds to get diamond-void:
    // eating -10 (or Q♦ at -25) now unlocks dumping K♥ (-150) on a future diamond
    // trick, and signals our partner that we're out of diamonds.
    if (contract === 'complex' || contract === 'diamonds') {
      const diamonds = legal.filter((c) => c.suit === 'D');
      if (diamonds.length > 0) return highest(diamonds);
    }
    return safeDiscard(legal, contract);
  }

  if (canFollow) {
    if (safeToTake(state, contract, trick.length === 3, count)) {
      // Harmless trick — win with our highest card to shed a liability and take the
      // lead. But NEVER win by playing a penalty into our own trick (e.g. the K♥ its
      // holder still holds): if the only winning cards are penalties, duck instead.
      const winners = legal.filter((c) => c.rank > winTop && !isPenaltyCard(c, contract));
      if (winners.length > 0) return highest(winners);
      // fall through to ducking below rather than self-catching a penalty.
    }

    const losers = legal.filter((c) => c.rank < winTop);
    if (losers.length > 0) return highest(losers); // duck under, shedding our highest loser (a penalty here lands on the current winner — good)

    // Forced to top: every legal card beats the current winner, so we WILL win this
    // trick. Never take it by playing a penalty into our own trick (that catches our
    // own K♥ / queen) — take it with our highest NON-penalty card and keep the penalties
    // in hand to dump on an opponent later. Only if we hold nothing but penalties do we
    // give up the least costly one.
    const nonPenalty = legal.filter((c) => !isPenaltyCard(c, contract));
    const mustWin = trick.length === 3 || !overtakePossible(state, count, seat, led, lowest(legal).rank);
    if (mustWin) {
      return nonPenalty.length > 0 ? highest(nonPenalty) : safeDiscard(legal, contract);
    }
    // A later opponent might still over-take — play low to invite that, still deferring
    // our penalties (if overtaken they take the trick; if not we catch only a low card).
    return nonPenalty.length > 0 ? lowest(nonPenalty) : lowest(legal);
  }
  return worstDiscard(legal, contract); // opponent winning → dump our worst liability on them
}

/** Is this card a penalty card for the contract (K♥ / a queen / a diamond)? */
function isPenaltyCard(c: Card, contract: TrixContract): boolean {
  const isKH = c.suit === 'H' && c.rank === 13;
  switch (contract) {
    case 'kingOfHearts':
      return isKH;
    case 'queens':
      return c.rank === 12;
    case 'diamonds':
      return c.suit === 'D';
    case 'complex':
      return isKH || c.rank === 12 || c.suit === 'D';
    default:
      return false; // collection: no specific penalty card
  }
}

/** How costly is this penalty card to add to our own team's trick? */
function penaltyWeight(c: Card, contract: TrixContract): number {
  if (!isPenaltyCard(c, contract)) return 0;
  if (c.suit === 'H' && c.rank === 13) return 75; // K♥
  if (c.rank === 12) return 25; // a queen
  return 10; // a diamond
}

/**
 * Our partner is winning and we must follow. Shed the highest card that stays
 * BELOW their winning rank (so we don't raise the bar / can't add value the wrong
 * way) and isn't a penalty (a penalty on our own winning trick costs our team) —
 * keeping our low cards for future ducks. Falls back sensibly when boxed in.
 */
function duckBelow(legal: readonly Card[], capRank: number, contract: TrixContract): Card {
  const safe = legal.filter((c) => c.rank < capRank && !isPenaltyCard(c, contract));
  if (safe.length > 0) return highest(safe); // shed our biggest safe liability, keep the low cards
  const below = legal.filter((c) => c.rank < capRank);
  if (below.length > 0) return lowest(below); // only penalties stay below → add the cheapest, don't overtake
  return lowest(legal); // every card overtakes our partner → keep the winning bar as low as we can
}

/** Discard without giving a penalty away — used when our partner holds the trick. */
function safeDiscard(legal: readonly Card[], contract: TrixContract): Card {
  const nonPenalty = legal.filter((c) => !isPenaltyCard(c, contract));
  if (nonPenalty.length > 0) return highest(nonPenalty); // shed a high, harmless card
  // Only penalties left and we must contribute one: add the least-costly penalty,
  // and among equals shed the highest rank (unload the most dangerous card).
  return legal.reduce((best, c) => {
    const wb = penaltyWeight(best, contract);
    const wc = penaltyWeight(c, contract);
    if (wc < wb) return c;
    if (wc === wb && c.rank > best.rank) return c;
    return best;
  }, legal[0]!);
}

/** Does the current trick already contain a card this contract penalises? */
function trickHasPenalty(state: TrixState, contract: TrixContract): boolean {
  return state.currentTrick.some((pc) => {
    const c = pc.card;
    switch (contract) {
      case 'kingOfHearts':
        return c.suit === 'H' && c.rank === 13;
      case 'queens':
        return c.rank === 12;
      case 'diamonds':
        return c.suit === 'D';
      case 'complex':
        return (c.suit === 'H' && c.rank === 13) || c.rank === 12 || c.suit === 'D';
      default:
        return false;
    }
  });
}

/**
 * Is it safe to win the current trick? A trick is safe when no card that penalises
 * this contract is in it AND none can still be ADDED by a later player. "Cannot be
 * added" is judged by counting: if every penalty card is already accounted for (ours
 * or played), nobody can drop one on us — so we needn't wait until last.
 *  - Diamonds: a diamond-free trick is only harmless if no later player can still
 *    discard a diamond onto it — safe when last, when diamonds are exhausted, or when
 *    every later player is known void in diamonds.
 *  - King of Hearts: the only penalty is the K♥ → safe once it is ours/played, or
 *    when we are last (a later void player could otherwise discard it onto us).
 *  - Queens: safe when last, or once all four queens are accounted for.
 *  - Collection: taking any trick costs, so never "safe".
 */
function safeToTake(
  state: TrixState,
  contract: TrixContract,
  lastToPlay: boolean,
  count: TrixCount,
): boolean {
  if (contract === 'collection' || contract === 'complex') return false; // every trick costs
  if (trickHasPenalty(state, contract)) return false;

  const led = state.currentTrick[0]!.card.suit;
  const laterVoidInLed = (seat: Seat): boolean =>
    laterPlayers(state, seat).some((o) => (state.voids[o] ?? []).includes(led));

  switch (contract) {
    case 'diamonds':
      // A later player can dump a diamond only if void in the led suit.
      // Safe when nobody behind is known-void — aggressive early, cautious as voids reveal.
      return lastToPlay || count.outstanding.D === 0 || !laterVoidInLed(state.turn);
    case 'kingOfHearts':
      if (lastToPlay || count.accountedFor(13, 'H')) return true;
      // K♥ can be dumped only by a player void in the led suit. If led is hearts,
      // a follower could play K♥ normally — stay cautious in that suit.
      return led !== 'H' && !laterVoidInLed(state.turn);
    case 'queens': {
      if (lastToPlay) return true;
      // A later player who DOUBLED the led-suit queen will dump it UNDER our winning
      // card (they pocket +25, we eat −50), so never win the trick into that.
      const doubledQueenBehind = state.doubled.some(
        (d) => d.card.rank === 12 && d.card.suit === led && laterPlayers(state, state.turn).includes(d.by),
      );
      if (doubledQueenBehind) return false;
      // Otherwise take the trick to shed a high card, unless a later player is KNOWN
      // void in the led suit and could discard a queen on us. Early on (no revealed
      // voids) this stays aggressive; it tightens automatically as voids come to light.
      return !laterVoidCouldDumpQueen(state, count, state.turn, led);
    }
    default:
      return false;
  }
}

/**
 * Shared card-counting for the avoidance games: everything a seat can deduce from
 * public info (its own hand + every card already played). Built once per decision
 * and used consistently by both the lead and the follow logic.
 *
 *  - `outstanding[suit]`  — cards of that suit still held by the OTHER three players
 *    (13 − played − ours). Zero ⇒ the suit is dead everywhere but our hand.
 *  - `accountedFor(r,s)`  — that exact card is ours or already played, so no later
 *    player can still add it to a trick.
 */
interface TrixCount {
  readonly outstanding: Record<Suit, number>;
  readonly accountedFor: (rank: number, suit: Suit) => boolean;
}

function buildCount(state: TrixState, seat: Seat): TrixCount {
  const suitSeen: Record<Suit, number> = { C: 0, D: 0, H: 0, S: 0 };
  const seen = new Set<string>();
  const add = (c: Card): void => {
    suitSeen[c.suit]++;
    seen.add(`${c.rank}${c.suit}`);
  };
  for (const pile of state.captured ?? []) for (const c of pile) add(c);
  for (const pc of state.currentTrick) add(pc.card);
  for (const c of state.hands[seat] ?? []) add(c);
  return {
    outstanding: { C: 13 - suitSeen.C, D: 13 - suitSeen.D, H: 13 - suitSeen.H, S: 13 - suitSeen.S },
    accountedFor: (rank, suit) => seen.has(`${rank}${suit}`),
  };
}

/** Every player still to act after `seat` in the current trick, in play order. */
function laterPlayers(state: TrixState, seat: Seat): Seat[] {
  const remaining = 3 - state.currentTrick.length;
  const out: Seat[] = [];
  let s = seat;
  for (let i = 0; i < remaining; i++) {
    s = nextSeat(s);
    out.push(s);
  }
  return out;
}

/** Those later players who are our opponents (all of them, outside partnership). */
function laterOpponents(state: TrixState, seat: Seat): Seat[] {
  return laterPlayers(state, seat).filter(
    (o) => !state.partnership || teamOf(o) !== teamOf(seat),
  );
}

/** Could seat `o` still hold this card? Not if it's ours/played, if o is known void in
 *  the suit, or if the card was doubled (revealed) by a DIFFERENT seat — a doubled
 *  card's location is public, so nobody else can be holding it. */
function couldHold(state: TrixState, count: TrixCount, o: Seat, rank: number, suit: Suit): boolean {
  if (count.accountedFor(rank, suit)) return false;
  if ((state.voids[o] ?? []).includes(suit)) return false;
  const dbl = state.doubled.find((d) => d.card.rank === rank && d.card.suit === suit);
  if (dbl && dbl.by !== o) return false; // known to sit with its revealer, not o
  return true;
}

/**
 * A later player who is KNOWN void in the led suit and could still hold a queen — i.e.
 * one who will certainly discard, and might discard a queen onto us. We deliberately
 * do NOT worry about players who could merely turn out to be void, nor about a follower
 * holding the led-suit queen: a rational follower ducks their own queen, so unloading
 * a high card early is a risk worth taking to avoid hoarding liabilities for the endgame.
 * As opponents actually reveal voids the check tightens on its own — bold early, safe late.
 */
function laterVoidCouldDumpQueen(state: TrixState, count: TrixCount, seat: Seat, led: Suit): boolean {
  return laterPlayers(state, seat).some(
    (o) =>
      (state.voids[o] ?? []).includes(led) &&
      SUITS_ORDER.some((s) => couldHold(state, count, o, 12, s)),
  );
}

/** Could any later opponent over-take our card of the led suit (hold a higher one)? */
function overtakePossible(
  state: TrixState,
  count: TrixCount,
  seat: Seat,
  led: Suit,
  aboveRank: number,
): boolean {
  const later = laterOpponents(state, seat);
  for (let r = aboveRank + 1; r <= 14; r++) {
    if (later.some((o) => couldHold(state, count, o, r, led))) return true;
  }
  return false;
}

function leadAvoidance(
  hand: readonly Card[],
  contract: TrixContract,
  state: TrixState,
  seat: Seat,
  count: TrixCount,
): Card {
  // A suit every opponent is KNOWN void in is a trap to lead: nobody can beat us, so
  // we win the trick for sure and collect whatever penalties they discard onto it.
  const opponents = ([0, 1, 2, 3] as Seat[]).filter(
    (o) => o !== seat && (!state.partnership || teamOf(o) !== teamOf(seat)),
  );
  const allOppsVoid = (suit: Suit): boolean =>
    // By count: the suit is exhausted outside our hand → nobody can follow at all.
    count.outstanding[suit] === 0 ||
    // Or every opponent has shown void in it (discarded off-suit on an earlier lead).
    (opponents.length > 0 && opponents.every((o) => (state.voids[o] ?? []).includes(suit)));

  // Is leading this low card safe? Once SOME opponent is void in its suit, leading it
  // risks them discarding a penalty onto our trick — safe only if a NON-void opponent
  // can still beat our card and take it instead (the dumps then land on them, not us).
  const safeLowLead = (c: Card): boolean => {
    const suit = c.suit;
    if (count.outstanding[suit] === 0) return false; // nobody else has it → we win it
    const someOppVoid = opponents.some((o) => (state.voids[o] ?? []).includes(suit));
    if (!someOppVoid) return true; // no void opponent → an ordinary losing lead
    return opponents.some((o) => {
      if ((state.voids[o] ?? []).includes(suit)) return false; // a void opponent can't take it
      for (let r = c.rank + 1; r <= 14; r++) if (couldHold(state, count, o, r, suit)) return true;
      return false;
    });
  };

  // Endplay: an opponent's DOUBLED penalty that is the ONLY outstanding card of its
  // suit means they hold nothing else in it — so the instant we lead that suit they are
  // FORCED to win with it and catch their own doubled card, plus whatever we throw in.
  // Lead our highest card of that suit (dumping our own penalty there too) to spring it.
  for (const d of state.doubled) {
    if (!opponents.includes(d.by)) continue;
    const suit = d.card.suit;
    if (count.accountedFor(d.card.rank, suit)) continue; // the doubled card has already been played
    let onlyOutstanding = true;
    for (let r = 2; r <= 14 && onlyOutstanding; r++) {
      if (r !== d.card.rank && !count.accountedFor(r, suit)) onlyOutstanding = false;
    }
    if (!onlyOutstanding) continue; // they may hold a lower card and duck — no forced win
    const mine = hand.filter((c) => c.suit === suit && c.rank < d.card.rank);
    if (mine.length > 0) return highest(mine);
  }

  // FROZEN SUITS: NEVER lead the suit of one of OUR (or our partner's) still-live
  // doubled penalty cards. Broaching it develops the suit against us — it lets opponents
  // shed their high honours cheaply and risks catching our own doubled card. We want an
  // OPPONENT to open it instead. Applied as a hard filter on candidates below — yields
  // only when literally every card in hand is frozen. Unfreezes once the doubled card
  // is played.
  const partner = (((seat + 2) % 4) as Seat);
  const wasPlayed = (card: Card): boolean => {
    for (const pile of state.captured ?? [])
      if (pile.some((c) => c.suit === card.suit && c.rank === card.rank)) return true;
    return state.currentTrick.some((pc) => pc.card.suit === card.suit && pc.card.rank === card.rank);
  };
  const protect = new Set<Suit>();
  for (const d of state.doubled) {
    if (d.by === seat || (state.partnership && d.by === partner)) {
      if (!wasPlayed(d.card)) protect.add(d.card.suit);
    }
  }

  // Partnership: lead a suit our partner is void in (low) so they can shed a
  // penalty onto an opponent, who is likely to win a low lead.
  if (state.partnership) {
    for (const suit of state.voids[partner] ?? []) {
      if ((contract === 'diamonds' || contract === 'complex') && suit === 'D') continue; // don't lead diamonds ourselves
      if (protect.has(suit)) continue; // never broach our own/partner's frozen doubled suit
      if (allOppsVoid(suit)) continue; // no opponent left to take it — we'd win and catch it ourselves
      // Only lead it if we hold a LOW card there — a high lead would win the
      // trick ourselves and catch our partner's dumped penalty.
      const low = hand.filter((c) => c.suit === suit && c.rank <= 9);
      if (low.length > 0) return lowest(low);
    }
  }

  // Never lead a penalty card (you'd risk catching it yourself), nor the A♥
  // under King-of-Hearts / Complex (it catches the K♥).
  const isKH = (c: Card) => c.suit === 'H' && c.rank === 13;
  const isPenalty = (c: Card): boolean =>
    (contract === 'kingOfHearts' && isKH(c)) ||
    (contract === 'queens' && c.rank === 12) ||
    (contract === 'diamonds' && c.suit === 'D') ||
    (contract === 'complex' && (isKH(c) || c.rank === 12 || c.suit === 'D'));
  // The A♥ only "catches" the K♥ while the King is still live; once it is ours or
  // already played, the ace is just another high card and is safe to lead.
  const khLive = (contract === 'kingOfHearts' || contract === 'complex') && !count.accountedFor(13, 'H');
  const isDanger = (c: Card): boolean => khLive && c.suit === 'H' && c.rank === 14;

  let candidates = hand.filter((c) => !isPenalty(c) && !isDanger(c));
  if (candidates.length === 0) candidates = [...hand]; // only penalties left — forced

  // Hard frozen-suit filter: never lead our/partner's doubled suit unless every
  // single candidate is frozen (absolute last resort).
  if (protect.size > 0) {
    const unfrozen = candidates.filter((c) => !protect.has(c.suit));
    if (unfrozen.length > 0) candidates = unfrozen;
  }

  // Lead a genuinely LOW card so we LOSE the trick to an opponent (winning collects
  // penalties, and once anyone is void they dump on us). Only lead a low card a non-void
  // opponent can still take; among those prefer suits outside a partner's doubled penalty,
  // then head toward a void via our shortest suit. Never lead a high singleton.
  const lowCards = candidates.filter((c) => c.rank <= 9);
  // Best: a low card a NON-VOID opponent can beat and take (dumps land on them). If none,
  // fall back to any suit opponents can at least FOLLOW (one may dump, but not everyone),
  // which is still far better than a suit they are ALL void in (everyone dumps on us).
  const losable = lowCards.filter(safeLowLead);
  const followable = lowCards.filter((c) => !allOppsVoid(c.suit));
  const pool0 = losable.length > 0 ? losable : followable;
  if (pool0.length > 0) {
    // Prefer a suit where we hold NO high honour (A/K): leading the low card of an
    // A/K suit throws away the cover that keeps that honour from being forced to win a
    // later trick and catch penalties. Keep those suits frozen; broach a "soft" one.
    const suitTop = (suit: Suit) =>
      Math.max(...hand.filter((c) => c.suit === suit).map((c) => c.rank));
    const soft = pool0.filter((c) => suitTop(c.suit) < 13);
    const pool = soft.length > 0 ? soft : pool0;
    const suit = shortestSuit(pool);
    const inSuit = pool.filter((c) => c.suit === suit);
    return lowest(inSuit.length > 0 ? inSuit : pool);
  }

  // No SAFE low lead. Concede via a genuinely low diamond under Diamonds/Complex so an
  // opponent takes the diamond trick — unless diamonds is a frozen suit (our own/partner's
  // doubled queen sits there), in which case we must not broach it.
  if ((contract === 'diamonds' || contract === 'complex') && !protect.has('D')) {
    const lowDiamonds = hand.filter((c) => c.suit === 'D' && c.rank <= 9);
    if (lowDiamonds.length > 0) return lowest(lowDiamonds);
  }

  // Otherwise prefer leading a suit an opponent can still FOLLOW — but never an honour
  // (≤ J) while we hold a low card — over a low card in a suit they are ALL void in
  // (which we'd win for sure and rake in their discards). Best is a suit where a LIVE
  // opponent DOUBLED a penalty: leading it (e.g. a heart) drives them toward catching
  // their own doubled card, instead of us hoarding a forcing card while we win side
  // tricks. Prefer non-frozen suits, and don't lead an honour if a low card is in hand.
  const holdsLow = hand.some((c) => c.rank <= 9); // full hand: never lead an honour over any low card
  const followableAny = candidates.filter(
    (c) => !allOppsVoid(c.suit) && (!holdsLow || c.rank <= 11),
  );
  if (followableAny.length > 0) {
    const oppDoubledSuits = new Set<Suit>();
    for (const d of state.doubled) {
      if (!opponents.includes(d.by)) continue;
      if (count.accountedFor(d.card.rank, d.card.suit)) continue; // already played
      oppDoubledSuits.add(d.card.suit);
    }
    const attack = followableAny.filter((c) => oppDoubledSuits.has(c.suit));
    const base = attack.length > 0 ? attack : followableAny;
    const suit = shortestSuit(base);
    const inSuit = base.filter((c) => c.suit === suit);
    return lowest(inSuit.length > 0 ? inSuit : base);
  }

  // No concede available — lead the least-damaging card, never an honour while we still
  // hold a low card: our lowest non-penalty low card, else our lowest non-honour, else
  // (boxed) any low card in hand, else our lowest card.
  if (lowCards.length > 0) return lowest(lowCards);
  const modest = candidates.filter((c) => c.rank <= 11);
  if (modest.length > 0) return lowest(modest);
  const handLow = hand.filter((c) => c.rank <= 9);
  if (handLow.length > 0) return lowest(handLow);
  return lowest(candidates);
}

function worstDiscard(legal: readonly Card[], contract: TrixContract): Card {
  const isKH = (c: Card) => c.suit === 'H' && c.rank === 13;
  const score = (c: Card): number => {
    switch (contract) {
      case 'kingOfHearts':
        return isKH(c) ? 1000 : c.rank;
      case 'queens':
        return c.rank === 12 ? 1000 : c.rank;
      case 'diamonds':
        return c.suit === 'D' ? 500 + c.rank : c.rank;
      case 'complex':
        // Shed the biggest liability first: K♥, then queens, then diamonds, then highs.
        return isKH(c) ? 2000 : c.rank === 12 ? 1000 : c.suit === 'D' ? 500 + c.rank : c.rank;
      default: // collection: shed the highest card
        return c.rank;
    }
  };
  return legal.reduce((best, c) => (score(c) > score(best) ? c : best), legal[0]!);
}

// --- shedding --------------------------------------------------------------

/**
 * Suits where an exposed 2 is still stuck (unplayed): held by an opponent (we
 * should NOT extend down toward it — keep them blocked) or by an ally partner
 * (we SHOULD help by extending down toward it).
 */
function exposedTwoSuits(state: TrixState, seat: Seat): { block: Set<Suit>; help: Set<Suit> } {
  const block = new Set<Suit>();
  const help = new Set<Suit>();
  for (const { card, holder } of state.exposedTwos ?? []) {
    const range = state.layout[card.suit];
    if (range !== null && range.low <= 2) continue; // the 2 has already been played
    if (holder === seat) continue; // our own 2 — handled by the toward-scoring
    if (state.partnership && teamOf(holder) === teamOf(seat)) help.add(card.suit);
    else block.add(card.suit);
  }
  return { block, help };
}

function pickShedding(state: TrixState): TrixAction {
  const seat = state.turn;
  const hand = state.hands[seat]!;
  const playable = sheddingPlayable(hand, state.layout);
  if (playable.length === 0) return { type: 'PASS', seat };

  const openings = playable.filter((c) => c.rank === 11 && state.layout[c.suit] === null);
  const extensions = playable.filter((c) => !(c.rank === 11 && state.layout[c.suit] === null));
  const pick = (cards: Card[], score: (c: Card) => number): Card =>
    cards.reduce((best, c) => (score(c) > score(best) ? c : best), cards[0]!);

  const { block, help } = exposedTwoSuits(state, seat);

  // Prefer extending an open chain over opening a new suit (delaying our jacks
  // forces opponents to open other suits). Extend toward the cards we still hold
  // in that suit — and exploit the exposed 2s: avoid unblocking an opponent's
  // stuck 2 (keeps them from shedding it), and help a partner reach theirs.
  const extScore = (c: Card): number => {
    const range = state.layout[c.suit]!;
    const down = c.rank === range.low - 1;
    const mine = hand.filter((x) => x.suit === c.suit);
    const toward = down
      ? mine.filter((x) => x.rank < c.rank).length
      : mine.filter((x) => x.rank > c.rank).length;
    let s = toward * 100 + Math.abs(c.rank - 11);
    if (down && block.has(c.suit)) s -= 500; // don't unblock an opponent's 2
    if (down && help.has(c.suit)) s += 300; // help our partner reach their 2
    return s;
  };

  if (extensions.length > 0) {
    const best = pick(extensions, extScore);
    // If the best extension only unblocks an opponent's 2 (negative score) and we
    // could open a suit instead, do that rather than help them.
    if (extScore(best) >= 0 || openings.length === 0) {
      return { type: 'PLAY', seat, card: best };
    }
  }

  // Open a suit. Prefer one where an opponent is blocked (holds the exposed 2): we
  // shed our high cards upward while they stay stuck at the bottom (only the up run
  // is safe — going down would unblock them). Otherwise open the suit that lets us
  // shed the MOST of our own cards — count both directions, not just the low side.
  return {
    type: 'PLAY',
    seat,
    card: pick(openings, (c) => {
      const mine = hand.filter((x) => x.suit === c.suit);
      return block.has(c.suit)
        ? 50 + mine.filter((x) => x.rank > 11).length
        : mine.filter((x) => x.rank !== 11).length;
    }),
  };
}
