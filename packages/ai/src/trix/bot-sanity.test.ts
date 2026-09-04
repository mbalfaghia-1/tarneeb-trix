import { describe, expect, it } from 'vitest';
import {
  applyTrixAction,
  avoidanceTrickWinner,
  createTrixGame,
  legalPlays,
  teamOf,
  type Card,
  type Seat,
  type TrixContract,
  type TrixMode,
} from '@tarneeb/engine';
import { chooseTrixAction } from './bot.js';

/**
 * Standing "bot sanity" harness for the Trix avoidance games.
 *
 * It plays many deterministic self-play deals across every penalty contract and both
 * modes, and asserts the bot never commits an AVOIDABLE blunder — one where it had a
 * strictly better legal option. Forced / unlucky outcomes (e.g. a doubled card that a
 * bot gets endplayed into) are allowed; only mistakes with a better choice available
 * fail. These are regression guards for the bugs we've fixed:
 *
 *   A. Self-catching your OWN doubled card when a non-penalty card was legal
 *      (the K♥ / Q self-catch — safe-take AND forced-to-top paths).
 *   B. Leading a suit no opponent can follow while holding a suit they can
 *      (the "collect everyone's discards" void-lead).
 *
 * If this test ever fails it prints the exact deal, seat, and cards — reproduce with
 * that seed/contract. Extend `check` with new guards as new blunder classes are found.
 */

const R = (r: number): string =>
  r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : r === 10 ? 'T' : String(r);
const show = (c: Card): string => `${R(c.rank)}${c.suit}`;

const isPenalty = (c: Card, contract: TrixContract): boolean => {
  const kh = c.suit === 'H' && c.rank === 13;
  if (contract === 'kingOfHearts') return kh;
  if (contract === 'queens') return c.rank === 12;
  if (contract === 'diamonds') return c.suit === 'D';
  if (contract === 'complex') return kh || c.rank === 12 || c.suit === 'D';
  return false;
};

interface PlayInfo {
  seat: Seat;
  card: Card;
  hadNonPenaltyAlt: boolean;
}

/** Play one avoidance deal, collecting any avoidable-blunder descriptions. */
function runDeal(seed: number, mode: TrixMode, contract: TrixContract, out: string[]): void {
  const tag = `seed ${seed} ${mode}/${contract}`;
  let s = createTrixGame({ seed, mode });
  s = applyTrixAction(s, { type: 'CHOOSE_CONTRACT', seat: s.king, contract });

  const opponentsOf = (seat: Seat): Seat[] =>
    ([0, 1, 2, 3] as Seat[]).filter((o) => o !== seat && (!s.partnership || teamOf(o) !== teamOf(seat)));

  let trickPlays: PlayInfo[] = [];
  let guard = 0;

  while (s.phase !== 'deal-over' && s.phase !== 'game-over') {
    if (++guard > 10_000) throw new Error(`${tag}: did not terminate`);
    const action = chooseTrixAction(s);

    // In the last two tricks the exact endgame solver takes over — its optimal play can
    // rightly break these heuristic guards (e.g. eat a small penalty to dodge a bigger
    // one), so only guard while the heuristics are driving (more than two cards in hand).
    const heuristicDomain = Math.max(...s.hands.map((h) => h.length)) > 2;
    if (s.phase === 'playing' && action.type === 'PLAY' && heuristicDomain) {
      const seat = s.turn;
      const hand = s.hands[seat] ?? [];
      const legal = legalPlays(hand, s.currentTrick);
      trickPlays.push({
        seat,
        card: action.card,
        hadNonPenaltyAlt: legal.some((c) => !isPenalty(c, contract)),
      });

      // Guard B — led into a suit no opponent can follow (a certain self-win that rakes
      // in their discards) when it held a genuinely better lead: a LOW, non-penalty card
      // in a suit an opponent CAN follow, which would lose the trick to them instead.
      if (s.currentTrick.length === 0) {
        const opps = opponentsOf(seat);
        const oppsHave = (suit: Card['suit']) =>
          opps.some((o) => (s.hands[o] ?? []).some((c) => c.suit === suit));
        if (!oppsHave(action.card.suit)) {
          const betterAlt = hand.some(
            (c) => c.rank <= 9 && !isPenalty(c, contract) && c.suit !== action.card.suit && oppsHave(c.suit),
          );
          if (betterAlt) {
            out.push(`${tag}: seat ${seat} led ${show(action.card)} into a no-follow suit with a low follow-able alternative`);
          }
        }
      }

      // Guard A — completing the trick: did its winner self-catch its own doubled card
      // when that play had a non-penalty alternative?
      if (s.currentTrick.length === 3) {
        const full = [...s.currentTrick, { seat, card: action.card }];
        const winner = avoidanceTrickWinner(full);
        const winCard = full.find((p) => p.seat === winner)!.card;
        const doubledBySelf = s.doubled.some(
          (d) => d.by === winner && d.card.rank === winCard.rank && d.card.suit === winCard.suit,
        );
        const wp = trickPlays.find((p) => p.seat === winner);
        if (doubledBySelf && wp?.hadNonPenaltyAlt) {
          out.push(`${tag}: seat ${winner} self-caught own doubled ${show(winCard)} with a non-penalty option`);
        }
        trickPlays = [];
      }
    }

    s = applyTrixAction(s, action);
  }
}

describe('trix bot sanity (regression guards)', () => {
  it('commits no avoidable self-catch or void-lead across many deals', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      runDeal(seed, 'regular', 'kingOfHearts', failures);
      runDeal(seed, 'regular', 'queens', failures);
      runDeal(seed, 'regular', 'diamonds', failures);
      runDeal(seed, 'regular', 'collection', failures);
      runDeal(seed, 'complex', 'complex', failures);
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
