import type { Card, Seat, Suit, TarneebState } from '@tarneeb/engine';
import { cardBeats, legalPlays, nextSeat, teamOf, trickWinner } from '@tarneeb/engine';
import { suitStrength, type Knowledge } from './knowledge.js';

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

/** Highest trump rank an OPPONENT of `seat` could still hold (null if none can). */
function highestOppTrump(seat: Seat, k: Knowledge): number | null {
  const trump = k.trump;
  const opps: Seat[] = teamOf(seat) === 0 ? [1, 3] : [0, 2];
  let best: number | null = null;
  for (const r of k.outstanding(trump)) {
    // outstanding() is ascending, so the last qualifying rank is the highest.
    if (opps.some((s) => k.couldHold(s, trump, r))) best = r;
  }
  return best;
}

/** How many completed tricks the declarer has led with a trump (drawing rounds). */
function trumpDrawRounds(state: TarneebState, declarer: Seat, trump: Suit): number {
  let n = 0;
  for (const t of state.tricks) {
    if (t.leader === declarer && t.cards[0]?.card.suit === trump) n++;
  }
  return n;
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
  const isDeclarer = state.declarer === seat;
  const myTrumps = hand.filter((c) => c.suit === trump);

  // T1: as declarer, draw the opponents' trumps — but calibrate the effort to the
  // contract and to how the trumps are actually splitting:
  //   • Keep at least one trump in reserve for late control (never lead the last).
  //   • Stop once no opponent can hold a trump (only partner's / none remain) —
  //     drawing then only strips our own side.
  //   • A low contract (7) means a short trump holding, so draw just a round or two;
  //     a high contract (9+) can keep drawing until the opponents are dry.
  //   • Once a forcing round has shown the opponents still outrank us on trumps,
  //     stop — we would only be feeding them our own good trumps.
  if (isDeclarer && myTrumps.length >= 2) {
    const topOut = k.highestOutstanding(trump);
    const myTop = highest(myTrumps);
    const oppTop = highestOppTrump(seat, k);
    const holdMaster = topOut === null || myTop.rank > topOut;
    const contract = state.contract ?? 7;
    const worthDrawing =
      holdMaster || myTrumps.length >= 4 || (contract >= 9 && myTrumps.length >= 3);
    const draws = trumpDrawRounds(state, seat, trump);
    const cap = contract <= 7 ? 2 : contract === 8 ? 3 : Infinity;
    const outgunned = draws >= 1 && oppTop !== null && oppTop > myTop.rank;
    if (oppTop !== null && worthDrawing && draws < cap && !outgunned) {
      return myTop; // cash the master, or force out a higher trump
    }
  }

  // T1-partner: on an ambitious contract (9+), when the declarer's partner has just
  // won a trick, continue the draw by leading the HIGHEST trump. This both strips the
  // opponents and tells the declarer the top trumps are safely on our side, so they
  // can relax their own trump control. Keep the last trump in reserve.
  const isDeclarerPartner = state.declarer !== null && !isDeclarer && teamOf(seat) === teamOf(state.declarer);
  if (isDeclarerPartner && (state.contract ?? 7) >= 9 && myTrumps.length >= 2) {
    const wonLast = state.tricks[state.tricks.length - 1]?.winner === seat;
    if (wonLast && highestOppTrump(seat, k) !== null) {
      return highest(myTrumps);
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
  // a partner leads low and lets the declarer keep trump control. The declarer,
  // though, holds its LAST trump in reserve for late control rather than burning it.
  if (myTrumps.length > 0) {
    if (isDeclarer && myTrumps.length === 1) {
      const sideCards = nonTrump(hand, trump);
      if (sideCards.length) return lowest(sideCards);
    }
    return isDeclarer ? highest(myTrumps) : lowest(myTrumps);
  }
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
    if (lastToPlay) {
      return discardLow(hand, legal, led, trump);
    }
    // T2: 3rd hand, partner winning — an opponent plays last and could overtake.
    // Play our highest card of the led suit to secure, UNLESS partner already
    // holds the master (nothing outstanding beats them — ducking is safe).
    if (trick.length === 2 && canFollow) {
      const topOut = k.highestOutstanding(led);
      const partnerSecure = topOut === null || winning.rank > topOut;
      if (!partnerSecure) {
        return highest(legal.filter((c) => c.suit === led));
      }
    }
    // Partner is master (safe) or 2nd hand: conservative play.
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
        const top = k.highestOutstanding(led);
        const masters = winners.filter((c) => top === null || c.rank > top);
        // Capture an opponent's TOP honour with our master. If they lead the highest
        // card still out (nothing bigger for us to wait for) and we hold the master,
        // take it now — a master wins only once, so spend it on their biggest card
        // rather than ducking and later wasting it on a smaller one. But if a higher
        // enemy honour is still out, duck and wait to capture THAT one instead.
        const ledTopHonour = winning.rank >= 11 && (top === null || winning.rank >= top);
        if (ledTopHonour && masters.length > 0) return lowest(masters);
        // T7: otherwise second hand low — never commit an unsupported honour (a later
        // opponent may hold a higher one). Win only with a supported top: we hold the
        // two highest cards still out in the suit (e.g. A-K).
        return supportedTopWinner(hand, led, k) ?? lowest(legal);
      }
      // T3: third hand HIGH — always commit the highest winner. The 4th
      // player (opponent) plays last, so playing anything less risks losing
      // the trick to a card we could have beaten.
      // Exception: if a later opponent can ruff, no led-suit card secures
      // the trick, so keep our honour and duck low.
      if (ruffThreatBehind(state, seat, k, led)) {
        const losers = legal.filter((c) => c.rank < winning.rank);
        return losers.length > 0 ? highest(losers) : lowest(legal);
      }
      return highest(winners);
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
