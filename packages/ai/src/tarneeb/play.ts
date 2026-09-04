import type { Card, Seat, Suit, TarneebState } from '@tarneeb/engine';
import { cardBeats, legalPlays, nextSeat, teamOf, trickWinner } from '@tarneeb/engine';
import { bothOpponentsVoidOfTrump, suitStrength, type Knowledge } from './knowledge.js';

// --- tiny helpers ----------------------------------------------------------

const byRank = (cards: readonly Card[]): Card[] => [...cards].sort((a, b) => a.rank - b.rank);
const lowest = (cards: readonly Card[]): Card => byRank(cards)[0]!;
const highest = (cards: readonly Card[]): Card => byRank(cards)[cards.length - 1]!;
const nonTrump = (cards: readonly Card[], trump: Suit): Card[] => cards.filter((c) => c.suit !== trump);

/** Seats that still play after `seat` in the current trick, in play order. */
function seatsAfter(seat: Seat, remaining: number): Seat[] {
  const out: Seat[] = [];
  let s = seat;
  for (let i = 0; i < remaining; i++) {
    s = nextSeat(s);
    out.push(s);
  }
  return out;
}

/** Could a specific opponent still to act beat the current winning card? */
function seatCanBeat(k: Knowledge, s: Seat, winning: Card, led: Suit): boolean {
  const trump = k.trump;
  const wcTrump = winning.suit === trump;

  if (led === trump) {
    // Trump trick: a higher trump wins.
    return k.outstanding(trump).some((r) => r > winning.rank && k.couldHold(s, trump, r));
  }
  if (wcTrump) {
    // Already ruffed: only a higher trump from a seat void in the led suit beats it.
    if (!k.isVoid(s, led)) return false;
    return k.outstanding(trump).some((r) => r > winning.rank && k.couldHold(s, trump, r));
  }
  // Winning card is a plain led-suit card.
  if (k.outstanding(led).some((r) => r > winning.rank && k.couldHold(s, led, r))) return true;
  // Or a void opponent could ruff it.
  if (k.isVoid(s, led) && k.outstanding(trump).some((r) => k.couldHold(s, trump, r))) return true;
  return false;
}

/** Any OPPONENT still to act who could beat the current winning card. */
function opponentThreatBehind(
  state: TarneebState,
  seat: Seat,
  k: Knowledge,
  winning: Card,
  led: Suit,
): boolean {
  const remaining = 3 - state.currentTrick.length;
  for (const s of seatsAfter(seat, remaining)) {
    if (teamOf(s) === teamOf(seat)) continue; // partner is not a threat
    if (seatCanBeat(k, s, winning, led)) return true;
  }
  return false;
}

/** Could a later opponent RUFF the led suit (void in it, holding a trump)?
 *  When true, no led-suit card of ours can secure the trick. */
function ruffThreatBehind(state: TarneebState, seat: Seat, k: Knowledge, led: Suit): boolean {
  if (led === k.trump) return false;
  const remaining = 3 - state.currentTrick.length;
  return seatsAfter(seat, remaining).some(
    (s) =>
      teamOf(s) !== teamOf(seat) &&
      k.isVoid(s, led) &&
      k.outstanding(k.trump).some((r) => k.couldHold(s, k.trump, r)),
  );
}

/** Non-trump cards I hold that are the highest card of their suit still out there. */
function establishedWinners(hand: readonly Card[], k: Knowledge): Card[] {
  return nonTrump(hand, k.trump).filter((c) => {
    const top = k.highestOutstanding(c.suit);
    return top === null || c.rank > top;
  });
}

/** Could an opponent ruff this non-trump suit if I lead it? */
function ruffRisk(suit: Suit, seat: Seat, k: Knowledge): boolean {
  if (k.trumpsOutstanding() === 0) return false;
  const opps: Seat[] = teamOf(seat) === 0 ? [1, 3] : [0, 2];
  return opps.some(
    (s) => k.isVoid(s, suit) && k.trump && k.outstanding(k.trump).some((r) => k.couldHold(s, k.trump, r)),
  );
}

/** Strongest non-trump suit I hold (for suit-preference signalling / cashing). */
function strongestSideSuit(hand: readonly Card[], trump: Suit): Suit | null {
  let best: Suit | null = null;
  let bestScore = 0;
  for (const suit of ['C', 'D', 'H', 'S'] as const) {
    if (suit === trump) continue;
    const len = hand.filter((c) => c.suit === suit).length;
    if (len === 0) continue;
    const score = suitStrength(hand, suit);
    if (score > bestScore) {
      bestScore = score;
      best = suit;
    }
  }
  return best;
}

/**
 * Would leading low from `suit` squander an honour? True when our top card of the
 * suit is an honour (Q+) that a higher card can still beat — under-leading it (or
 * leading it bare) throws it to the opponents for nothing.
 */
function honourAtRisk(suit: Suit, hand: readonly Card[], k: Knowledge): boolean {
  const mine = hand.filter((c) => c.suit === suit);
  if (mine.length === 0) return false;
  const myTop = highest(mine).rank;
  if (myTop < 12) return false; // no honour to protect
  const topOut = k.highestOutstanding(suit);
  return topOut !== null && topOut > myTop; // beatable honour → don't broach it
}

/**
 * T9 / D2 develop lead: lead a low card to develop / head toward a void, but only
 * from a suit that isn't guarding a beatable honour — never under-lead a K/Q or
 * throw a bare honour. Prefer the shortest safe suit (fastest to a ruffing void).
 * Returns null when every side suit guards an honour (caller falls back to trumps).
 */
function developLead(hand: readonly Card[], k: Knowledge, trump: Suit): Card | null {
  const safe = (['C', 'D', 'H', 'S'] as const).filter(
    (s) => s !== trump && hand.some((c) => c.suit === s) && !honourAtRisk(s, hand, k),
  );
  if (safe.length === 0) return null;
  let best: Suit | null = null;
  let bestLen = Infinity;
  let bestLow = Infinity;
  for (const suit of safe) {
    const mine = hand.filter((c) => c.suit === suit);
    const low = lowest(mine).rank;
    if (mine.length < bestLen || (mine.length === bestLen && low < bestLow)) {
      best = suit;
      bestLen = mine.length;
      bestLow = low;
    }
  }
  return lowest(hand.filter((c) => c.suit === best!));
}

// --- discarding ------------------------------------------------------------

/**
 * Play the lowest useful card when we can't/shouldn't win. When following we
 * must play the led suit; when void we discard, keeping trumps, and — on a
 * trump-led trick while void in trump — signal our strongest side suit (T11).
 */
function discardLow(
  hand: readonly Card[],
  legal: readonly Card[],
  led: Suit,
  trump: Suit,
): Card {
  const following = legal.every((c) => c.suit === led);
  if (following) return lowest(legal); // must follow: shed the lowest

  // We are void in the led suit → we get to choose a discard.
  if (led === trump) {
    // Discarding on a trump lead while void in trump: suit-preference signal.
    const sig = strongestSideSuit(hand, trump);
    if (sig) {
      const cards = hand.filter((c) => c.suit === sig);
      const low = lowest(cards);
      // With only honours to spare (e.g. bare A-K-Q), don't burn one — dump a plain loser instead.
      if (low.rank >= 12 && cards.length <= 3) {
        const losers = nonTrump(hand, trump).filter((c) => c.suit !== sig && c.rank < 12);
        if (losers.length) return lowest(losers);
      }
      return low;
    }
  }

  const plain = nonTrump(legal, trump);
  return lowest(plain.length ? plain : legal);
}

// --- leads -----------------------------------------------------------------

/**
 * S6: if our partner led a (non-trump) suit in the previous trick and we hold a
 * low card of it, return that card so partner's remaining honour can score —
 * e.g. partner's A cashes, we lead back low, our K wins the next round.
 */
function returnPartnersSuit(
  state: TarneebState,
  seat: Seat,
  k: Knowledge,
  hand: readonly Card[],
): Card | null {
  const last = state.tricks[state.tricks.length - 1];
  if (!last) return null;
  if (last.leader === seat || teamOf(last.leader) !== teamOf(seat)) return null;
  const suit = last.cards[0]!.card.suit;
  if (suit === k.trump) return null;
  const mine = hand.filter((c) => c.suit === suit);
  if (mine.length === 0) return null;
  if (k.highestOutstanding(suit) === null) return null; // no honour left to promote
  if (ruffRisk(suit, seat, k)) return null;
  return lowest(mine);
}

/**
 * S7c / T8: honour promotion (finesse). With the Q and J of a side suit where
 * the Ace is gone (played or ours) but the King is still out, lead the Q to
 * force the King and promote our Jack.
 */
function finesseLead(hand: readonly Card[], k: Knowledge, trump: Suit): Card | null {
  for (const suit of ['C', 'D', 'H', 'S'] as const) {
    if (suit === trump) continue;
    const cards = hand.filter((c) => c.suit === suit);
    const queen = cards.find((c) => c.rank === 12);
    if (!queen || !cards.some((c) => c.rank === 11)) continue;
    const out = k.outstanding(suit);
    if (!out.includes(14) && out.includes(13)) return queen; // A gone, K still out
  }
  return null;
}

function chooseLead(state: TarneebState, seat: Seat, k: Knowledge, hand: readonly Card[]): Card {
  const trump = state.trump!;
  const myTeam = teamOf(seat);
  const isDeclarer = state.declarer === seat;
  const myTrumps = hand.filter((c) => c.suit === trump);
  const oppsVoidTrump = bothOpponentsVoidOfTrump(k, myTeam);

  // T1: as declarer, draw the opponents' trumps while they still hold some.
  if (isDeclarer && k.trumpsOutstanding() > 0 && !oppsVoidTrump && myTrumps.length > 0) {
    const topOut = k.highestOutstanding(trump);
    const myTop = highest(myTrumps);
    if (topOut === null || myTop.rank > topOut || myTrumps.length >= 4) {
      return myTop; // lead the master / from length to strip opponents
    }
  }

  // T6 / T8: cash an established side-suit winner that can't be ruffed.
  const cashable = establishedWinners(hand, k).filter((c) => !ruffRisk(c.suit, seat, k));
  if (cashable.length > 0) return highest(cashable);

  // S6: return partner's established suit to promote their honour.
  const returned = returnPartnersSuit(state, seat, k, hand);
  if (returned) return returned;

  // S7c / T8: lead the Q to force out the King and promote our Jack.
  const finesse = finesseLead(hand, k, trump);
  if (finesse) return finesse;

  // T9 / D2: develop a low card from a safe side suit (heads toward a ruffing
  // void) — but never under-lead a beatable honour or throw a bare Q/K.
  const dev = developLead(hand, k, trump);
  if (dev) return dev;

  // No safe side suit to broach. Prefer leading a trump over squandering an honour:
  // the declarer keeps drawing (lead high); a partner leads low and lets the
  // declarer control trumps. Only if we're out of trumps do we lead a side card.
  if (myTrumps.length > 0) return isDeclarer ? highest(myTrumps) : lowest(myTrumps);
  const side = nonTrump(hand, trump);
  return lowest(side.length ? side : hand);
}

// --- follows ---------------------------------------------------------------

/**
 * If we hold the two highest cards of the led suit still in play (an A-K style
 * supported top), return the lower of the two — safe to win in second seat.
 * Otherwise null (an unsupported honour should duck).
 */
function supportedTopWinner(hand: readonly Card[], led: Suit, k: Knowledge): Card | null {
  const mine = hand.filter((c) => c.suit === led).sort((a, b) => b.rank - a.rank);
  if (mine.length < 2) return null;
  const top = k.highestOutstanding(led);
  const haveMaster = top === null || mine[0]!.rank > top;
  const haveSecond = top === null || mine[1]!.rank > top;
  return haveMaster && haveSecond ? mine[1]! : null;
}

function chooseFollow(state: TarneebState, seat: Seat, k: Knowledge, legal: readonly Card[]): Card {
  const trump = state.trump!;
  const hand = state.hands[seat] ?? [];
  const trick = state.currentTrick;
  const led = trick[0]!.card.suit;
  const winnerSeat = trickWinner(trick, trump);
  const winning = trick.find((pc) => pc.seat === winnerSeat)!.card;
  const partnerWins = teamOf(winnerSeat) === teamOf(seat);
  const lastToPlay = trick.length === 3;
  const canFollow = hand.some((c) => c.suit === led);
  const threat = opponentThreatBehind(state, seat, k, winning, led);

  const winners = legal.filter((c) => cardBeats(c, winning, trump, led));

  if (partnerWins) {
    // T2: overtake our own side only to SECURE the trick against a real threat —
    // and then with a card that actually beats the THREAT (a master beating every
    // outstanding card), not merely the current card. A middle card a later
    // opponent can still top would be wasted, so otherwise conserve.
    if (threat && !ruffThreatBehind(state, seat, k, led)) {
      const top = k.highestOutstanding(led);
      const masters = legal.filter((c) => c.suit === led && (top === null || c.rank > top));
      if (masters.length > 0) return lowest(masters);
    }
    return discardLow(hand, legal, led, trump);
  }

  // An opponent is winning.
  if (winners.length > 0) {
    if (lastToPlay) return lowest(winners); // 4th hand: cheapest win
    if (canFollow) {
      const secondHand = trick.length === 1;
      if (secondHand) {
        // T7: second hand low — never commit an unsupported honour (a later
        // opponent may hold a higher one). Win only with a supported top: we
        // hold the two highest cards still out in the suit (e.g. A-K).
        return supportedTopWinner(hand, led, k) ?? lowest(legal);
      }
      // T3: third hand. With no threat behind, win as cheaply as possible. With a
      // threat, only commit if we can SECURE the trick with a master (a card that
      // beats every outstanding card); otherwise duck and conserve — don't burn a
      // high card a later opponent can still top.
      if (!threat) return lowest(winners);
      if (!ruffThreatBehind(state, seat, k, led)) {
        const top = k.highestOutstanding(led);
        const masters = winners.filter((c) => top === null || c.rank > top);
        if (masters.length > 0) return lowest(masters);
      }
      const losers = legal.filter((c) => c.rank < winning.rank);
      return losers.length > 0 ? highest(losers) : lowest(winners);
    }
    // Void → ruff with the cheapest trump that wins; never waste a high trump.
    return lowest(winners);
  }

  // Can't win — shed low / signal.
  return discardLow(hand, legal, led, trump);
}

/** Choose a card to play for the seat on turn during the play phase. */
export function choosePlay(state: TarneebState, seat: Seat, k: Knowledge): Card {
  const hand = state.hands[seat] ?? [];
  const legal = legalPlays(hand, state.currentTrick);
  if (legal.length === 1) return legal[0]!;
  if (state.currentTrick.length === 0) return chooseLead(state, seat, k, hand);
  return chooseFollow(state, seat, k, legal);
}
