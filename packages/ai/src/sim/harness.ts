import {
  applyAction,
  applyTrixAction,
  createGame,
  createTrixGame,
  trixTeamScores,
  type Seat,
  type TrixMode,
} from '@tarneeb/engine';
import { chooseTarneebAction } from '../tarneeb/bot.js';
import type { TarneebBotParams } from '../tarneeb/params.js';
import { chooseTrixAction } from '../trix/bot.js';
import type { TrixBotParams } from '../trix/params.js';

/** Result of a headless self-play match between two parameter sets, team A vs team B. */
export interface MatchResult {
  readonly games: number;
  readonly winsA: number;
  readonly winsB: number;
  readonly ties: number;
  /** Average (team A score - team B score) across all games. Positive favors A. */
  readonly avgMarginA: number;
}

/**
 * IMPORTANT — why every match here is "mirrored":
 *
 * A quick sanity check (identical params on both teams, which must converge to a
 * ~50/50 split) showed it did NOT: with one seed range team A (seats 0&2) won
 * ~58%, with another team B won ~68% — and the direction didn't depend on which
 * team dealt. That means the seeded shuffle has some correlation with seat
 * parity: certain seed blocks just deal stronger cards to seats {0,2} than
 * {1,3}, independent of play. An optimizer trained on a plain (unmirrored)
 * match would "win" by getting assigned a lucky seed block, not by having
 * better parameters — a silent, serious corruption of any tuning result.
 *
 * The fix (the same "duplicate" trick real bridge/card tournaments use to
 * separate skill from deal luck): play every seed TWICE, once with A in seats
 * {0,2} and once with the SAME seed but A in seats {1,3}, then sum results.
 * Any seat-parity card-strength bias appears equally for both teams across the
 * pair and cancels out, leaving only the effect of the parameter difference.
 * This means a `games: N` match actually simulates 2N games.
 */
function mirroredTeamIsA(mirror: boolean, seatParityIsEven: boolean): boolean {
  return mirror ? !seatParityIsEven : seatParityIsEven;
}

/**
 * Plays `games` distinct deals headless (no UI/server) as mirrored pairs — see
 * the module doc above — team A using `paramsA`, team B using `paramsB`. Each
 * deal uses a distinct seed (`seedStart + gameIndex`) so results are
 * deterministic and reproducible.
 */
export function runTarneebMatch(
  paramsA: TarneebBotParams,
  paramsB: TarneebBotParams,
  games: number,
  seedStart = 0,
): MatchResult {
  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  let marginSum = 0;
  let totalGames = 0;

  for (let g = 0; g < games; g++) {
    const seed = seedStart + g;
    for (const mirror of [false, true]) {
      let s = createGame({ seed, firstDealer: (g % 4) as Seat });
      let guard = 0;
      while (s.phase !== 'game-over') {
        if (++guard > 300_000) throw new Error(`tarneeb match did not terminate (seed ${seed})`);
        if (s.phase === 'hand-over') {
          s = applyAction(s, { type: 'NEXT_HAND' });
          continue;
        }
        const seatIsA = mirroredTeamIsA(mirror, s.turn % 2 === 0);
        s = applyAction(s, chooseTarneebAction(s, seatIsA ? paramsA : paramsB));
      }
      const [score0, score1] = s.scores; // team 0 = seats {0,2}, team 1 = seats {1,3}
      const [scoreA, scoreB] = mirror ? [score1, score0] : [score0, score1];
      const winnerIsA = mirror ? s.winner === 1 : s.winner === 0;
      const winnerIsB = mirror ? s.winner === 0 : s.winner === 1;
      marginSum += scoreA - scoreB;
      totalGames++;
      if (winnerIsA) winsA++;
      else if (winnerIsB) winsB++;
      else ties++;
    }
  }

  return { games: totalGames, winsA, winsB, ties, avgMarginA: marginSum / totalGames };
}

/**
 * Plays `games` distinct deals headless as mirrored pairs (see module doc
 * above), always in PARTNERSHIP mode (team A vs team B) so results are directly
 * comparable to the Tarneeb harness. `mode` picks regular Trix (5
 * contracts/kingdom) or Trix Complex (2 contracts/kingdom); defaults to regular.
 */
export function runTrixMatch(
  paramsA: TrixBotParams,
  paramsB: TrixBotParams,
  games: number,
  opts: { readonly mode?: TrixMode; readonly seedStart?: number } = {},
): MatchResult {
  const mode = opts.mode ?? 'regular';
  const seedStart = opts.seedStart ?? 0;
  let winsA = 0;
  let winsB = 0;
  let ties = 0;
  let marginSum = 0;
  let totalGames = 0;

  for (let g = 0; g < games; g++) {
    const seed = seedStart + g;
    for (const mirror of [false, true]) {
      let s = createTrixGame({ seed, mode, partnership: true });
      let guard = 0;
      while (s.phase !== 'game-over') {
        if (++guard > 500_000) throw new Error(`trix match did not terminate (seed ${seed})`);
        const seatIsA = mirroredTeamIsA(mirror, s.turn % 2 === 0);
        s = applyTrixAction(s, chooseTrixAction(s, seatIsA ? paramsA : paramsB));
      }
      const [team0, team1] = trixTeamScores(s.scores); // team 0 = seats {0,2}, team 1 = seats {1,3}
      const [teamA, teamB] = mirror ? [team1, team0] : [team0, team1];
      const winnerIsA = mirror ? s.winner === 1 : s.winner === 0;
      const winnerIsB = mirror ? s.winner === 0 : s.winner === 1;
      marginSum += teamA - teamB;
      totalGames++;
      if (winnerIsA) winsA++;
      else if (winnerIsB) winsB++;
      else ties++;
    }
  }

  return { games: totalGames, winsA, winsB, ties, avgMarginA: marginSum / totalGames };
}
