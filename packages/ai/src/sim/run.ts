/**
 * Headless self-play CLI. Runs bot-vs-bot matches via the harness and prints a
 * win-rate report — the building block for parameter tuning (run a baseline vs a
 * candidate parameter set, keep the candidate if it wins more).
 *
 * Usage (from packages/ai):
 *   node src/sim/run.ts [--games N] [--game tarneeb|trix|both] [--seed N]
 *
 * Runs Node 22+'s native TypeScript support directly — no build step needed.
 */
import { DEFAULT_TARNEEB_PARAMS, type TarneebBotParams } from '../tarneeb/params.js';
import { DEFAULT_TRIX_PARAMS, type TrixBotParams } from '../trix/params.js';
import { runTarneebMatch, runTrixMatch, type MatchResult } from './harness.js';

function parseArgs(argv: readonly string[]): { games: number; game: string; seed: number } {
  let games = 200;
  let game = 'both';
  let seed = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--games') games = Number(argv[++i]);
    else if (argv[i] === '--game') game = String(argv[++i]);
    else if (argv[i] === '--seed') seed = Number(argv[++i]);
  }
  return { games, game, seed };
}

function report(label: string, r: MatchResult): void {
  const winRateA = (r.winsA / r.games) * 100;
  const winRateB = (r.winsB / r.games) * 100;
  console.log(
    `${label}: A ${r.winsA}/${r.games} (${winRateA.toFixed(1)}%)  ` +
      `B ${r.winsB}/${r.games} (${winRateB.toFixed(1)}%)  ` +
      `ties ${r.ties}  avg margin A ${r.avgMarginA >= 0 ? '+' : ''}${r.avgMarginA.toFixed(1)}`,
  );
}

function main(): void {
  const { games, game, seed } = parseArgs(process.argv.slice(2));
  console.log(`Self-play harness: ${games} games/match, seed start ${seed}\n`);

  // Baseline-vs-baseline sanity check: identical params on both teams should
  // produce a roughly even split (confirms the harness has no seat/team bias).
  const paramsA: TarneebBotParams = DEFAULT_TARNEEB_PARAMS;
  const paramsB: TarneebBotParams = DEFAULT_TARNEEB_PARAMS;
  const trixA: TrixBotParams = DEFAULT_TRIX_PARAMS;
  const trixB: TrixBotParams = DEFAULT_TRIX_PARAMS;

  if (game === 'tarneeb' || game === 'both') {
    report('Tarneeb (defaults vs defaults)', runTarneebMatch(paramsA, paramsB, games, seed));
  }
  if (game === 'trix' || game === 'both') {
    report('Trix regular (defaults vs defaults)', runTrixMatch(trixA, trixB, games, { seedStart: seed }));
    report(
      'Trix complex (defaults vs defaults)',
      runTrixMatch(trixA, trixB, games, { mode: 'complex', seedStart: seed }),
    );
  }
}

main();
