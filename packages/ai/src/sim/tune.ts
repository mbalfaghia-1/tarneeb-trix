/**
 * Parameter-tuning CLI: hill-climbs TarneebBotParams / TrixBotParams against the
 * current defaults via self-play, then RE-VALIDATES the winner on a large, fresh
 * (non-overlapping) seed range before reporting it — the climb itself reuses
 * seed blocks across iterations for speed, which risks overfitting quirks of the
 * tuning seeds rather than finding a genuinely better strategy, so the final
 * number you should trust is the "VALIDATION" line, not the climb's own report.
 *
 * Usage (from packages/ai):
 *   node src/sim/tune.ts [--game tarneeb|trix|both] [--iterations N]
 *                         [--games-per-eval N] [--validate-games N] [--seed N]
 *                         [--min-improvement F] [--trix-mode regular|complex]
 *
 * --min-improvement matters a lot: the acceptance bar must be sized relative to
 * the noise of a --games-per-eval-sized sample (std ~= sqrt(0.25 / (2*games)),
 * since every match is mirrored into 2x games). Too low a bar relative to that
 * noise floor means most "accepted" climb steps are statistical noise, not real
 * improvements — always trust the VALIDATION line, which re-checks on a much
 * larger, non-overlapping sample.
 *
 * This only PRINTS a candidate params object — it does not modify params.ts.
 * Promote a result manually (copy the printed object into DEFAULT_*_PARAMS) only
 * after it (a) clears validation by a healthy margin and (b) the full existing
 * test suite still passes unchanged — those tests encode explicit rule
 * corrections an optimizer must not be allowed to trade away for a numeric trick.
 */
import { DEFAULT_TARNEEB_PARAMS, type TarneebBotParams } from '../tarneeb/params.js';
import { DEFAULT_TRIX_PARAMS, type TrixBotParams } from '../trix/params.js';
import { runTarneebMatch, runTrixMatch } from './harness.js';
import { hillClimb, type HillClimbStep } from './optimize.js';

function parseArgs(argv: readonly string[]) {
  let iterations = 150;
  let gamesPerEval = 60;
  let validateGames = 400;
  let game = 'both';
  let seed = 0;
  let minImprovement = 0.02;
  let trixMode: 'regular' | 'complex' = 'regular';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--iterations') iterations = Number(argv[++i]);
    else if (argv[i] === '--games-per-eval') gamesPerEval = Number(argv[++i]);
    else if (argv[i] === '--validate-games') validateGames = Number(argv[++i]);
    else if (argv[i] === '--game') game = String(argv[++i]);
    else if (argv[i] === '--seed') seed = Number(argv[++i]);
    else if (argv[i] === '--min-improvement') minImprovement = Number(argv[++i]);
    else if (argv[i] === '--trix-mode') trixMode = argv[++i] as 'regular' | 'complex';
  }
  return { iterations, gamesPerEval, validateGames, game, seed, minImprovement, trixMode };
}

function logStep(label: string) {
  return (step: HillClimbStep): void => {
    if (!step.accepted) return;
    console.log(
      `  [${label}] iter ${step.iteration}: ${step.key} ${step.from.toFixed(2)} -> ${step.to.toFixed(2)}` +
        `  (win rate ${(step.winRate * 100).toFixed(1)}%)`,
    );
  };
}

function diffParams<T extends { [K in keyof T]: number }>(baselineIn: T, bestIn: T): string {
  const baseline = baselineIn as unknown as Record<string, number>;
  const best = bestIn as unknown as Record<string, number>;
  const changed = Object.keys(baseline).filter((k) => baseline[k] !== best[k]);
  if (changed.length === 0) return '  (no change found over the default)';
  return changed.map((k) => `  ${k}: ${baseline[k]} -> ${best[k]}`).join('\n');
}

function main(): void {
  const { iterations, gamesPerEval, validateGames, game, seed, minImprovement, trixMode } = parseArgs(
    process.argv.slice(2),
  );
  const noiseStd = Math.sqrt(0.25 / (2 * gamesPerEval));
  console.log(
    `Hill-climbing: ${iterations} iterations, ${gamesPerEval} mirrored games/eval ` +
      `(~${(noiseStd * 100).toFixed(1)}% noise std), min-improvement ${(minImprovement * 100).toFixed(1)}% ` +
      `(~${(minImprovement / noiseStd).toFixed(1)} std), validating winners on ${validateGames} fresh mirrored games.\n`,
  );

  if (game === 'tarneeb' || game === 'both') {
    console.log('=== Tarneeb ===');
    const climb = hillClimb<TarneebBotParams>({
      baseline: DEFAULT_TARNEEB_PARAMS,
      iterations,
      gamesPerEval,
      seedStart: seed,
      rngSeed: seed + 1,
      minImprovement,
      evaluate: runTarneebMatch,
      onStep: logStep('tarneeb'),
    });
    console.log(`  climb win rate vs defaults: ${(climb.bestWinRate * 100).toFixed(1)}%`);

    // Fresh, non-overlapping seed range so we're not just measuring overfit to
    // the tuning seeds above (which used seed..seed+iterations*10_000).
    const validationSeed = seed + iterations * 10_000 + 1_000_000;
    const validation = runTarneebMatch(climb.best, DEFAULT_TARNEEB_PARAMS, validateGames, validationSeed);
    const winRate = (validation.winsA / validation.games) * 100;
    console.log(`  VALIDATION (fresh seeds): ${winRate.toFixed(1)}% win rate, avg margin ${validation.avgMarginA.toFixed(1)}`);
    console.log('  changed params:');
    console.log(diffParams(DEFAULT_TARNEEB_PARAMS, climb.best));
    console.log();
  }

  if (game === 'trix' || game === 'both') {
    console.log(`=== Trix (${trixMode}) ===`);
    const climb = hillClimb<TrixBotParams>({
      baseline: DEFAULT_TRIX_PARAMS,
      iterations,
      gamesPerEval,
      seedStart: seed,
      rngSeed: seed + 2,
      minImprovement,
      evaluate: (candidate, baseline, games, seedStart) =>
        runTrixMatch(candidate, baseline, games, { seedStart, mode: trixMode }),
      onStep: logStep('trix'),
    });
    console.log(`  climb win rate vs defaults: ${(climb.bestWinRate * 100).toFixed(1)}%`);

    const validationSeed = seed + iterations * 10_000 + 1_000_000;
    const validation = runTrixMatch(climb.best, DEFAULT_TRIX_PARAMS, validateGames, {
      seedStart: validationSeed,
      mode: trixMode,
    });
    const winRate = (validation.winsA / validation.games) * 100;
    console.log(`  VALIDATION (fresh seeds): ${winRate.toFixed(1)}% win rate, avg margin ${validation.avgMarginA.toFixed(1)}`);
    console.log('  changed params:');
    console.log(diffParams(DEFAULT_TRIX_PARAMS, climb.best));
  }
}

main();
