import { makeRng } from '@tarneeb/engine';
import type { MatchResult } from './harness.js';

/**
 * Constrains T to "an object whose every property is a number" (TarneebBotParams
 * or TrixBotParams) without requiring an explicit index signature — a plain
 * `Record<string, number>` constraint rejects those interfaces outright, since
 * TS treats a declared interface as not structurally assignable to an indexed
 * type even when every member happens to be a number.
 */
type NumericParams<T> = { [K in keyof T]: number };

export interface HillClimbStep {
  readonly iteration: number;
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly winRate: number;
  readonly accepted: boolean;
}

export interface HillClimbResult<T extends NumericParams<T>> {
  readonly best: T;
  /** Win rate of `best` vs the frozen baseline, measured during the climb (not a final re-validation). */
  readonly bestWinRate: number;
  readonly history: readonly HillClimbStep[];
}

export interface HillClimbOptions<T extends NumericParams<T>> {
  /** Frozen opponent every candidate is measured against — never mutated. */
  readonly baseline: T;
  /** Starting point for the climb. Defaults to `baseline` (start from today's values). */
  readonly start?: T;
  readonly iterations: number;
  /** Mirrored-deal count per evaluation (see harness.ts) — higher = less noisy, slower. */
  readonly gamesPerEval: number;
  /**
   * Plays `candidate` (as team A) vs `baseline` (as team B) for `games` mirrored
   * deals starting at `seedStart` and returns the match result. Bind this to
   * runTarneebMatch/runTrixMatch from harness.ts.
   */
  readonly evaluate: (candidate: T, baseline: T, games: number, seedStart: number) => MatchResult;
  readonly rngSeed?: number;
  /** Base seed for evaluation matches; each iteration uses a disjoint seed block. */
  readonly seedStart?: number;
  /** A candidate must beat 50% by at least this much to be accepted — guards against noise. */
  readonly minImprovement?: number;
  readonly onStep?: (step: HillClimbStep) => void;
}

/**
 * (1+1) evolution-strategy hill-climbing over a flat numeric params object: each
 * iteration perturbs ONE random knob of the current best by a random-sign step,
 * measures the mutant's win rate against the frozen `baseline` via the self-play
 * harness, and keeps the mutation only if it's a clear win-rate improvement
 * (beyond `minImprovement`, to avoid chasing evaluation noise). Step size per
 * knob grows on acceptance and shrinks on rejection (the classic "1/5 success
 * rule"), so it explores faster early and settles down as it converges.
 *
 * This is intentionally simple — with only ~10-15 knobs (see params.ts in each
 * game folder) a full genetic algorithm is unnecessary overhead; coordinate-wise
 * hill-climbing finds nearby local improvements, which is exactly the scope of
 * "tune the existing heuristics," not a replacement for the discrete tactics.
 *
 * IMPORTANT: use a LARGE, FRESH (non-overlapping) seed range to re-validate the
 * returned `best` before trusting it — this function reuses seed blocks across
 * many iterations for speed, which risks the climb overfitting quirks of the
 * tuning seed set rather than finding a genuinely better strategy.
 */
export function hillClimb<T extends NumericParams<T>>(opts: HillClimbOptions<T>): HillClimbResult<T> {
  // Work internally with a plain index-able record (safe: the NumericParams<T>
  // constraint guarantees every property of T is a number), casting back to T
  // only at the boundaries the caller sees.
  const baseline = opts.baseline as unknown as Record<string, number>;
  const keys = Object.keys(baseline);
  const rng = makeRng(opts.rngSeed ?? 42);
  const seedStart = opts.seedStart ?? 0;
  const minImprovement = opts.minImprovement ?? 0.02;

  let best: Record<string, number> = { ...((opts.start ?? opts.baseline) as unknown as Record<string, number>) };
  let bestWinRate = 0.5; // best === baseline-equivalent at worst; measured properly below on first real move
  const stepScale: Record<string, number> = {};
  for (const k of keys) stepScale[k] = Math.max(0.1, Math.abs(baseline[k]!) * 0.15);

  const history: HillClimbStep[] = [];

  for (let i = 0; i < opts.iterations; i++) {
    const key = keys[rng.int(keys.length)]!;
    const sign = rng.next() < 0.5 ? -1 : 1;
    const from = best[key]!;
    const to = from + sign * stepScale[key]!;
    const candidate: Record<string, number> = { ...best, [key]: to };

    // Each iteration gets its own seed block so the climb doesn't overfit one set of deals.
    const iterSeedStart = seedStart + i * 10_000;
    const result = opts.evaluate(candidate as unknown as T, opts.baseline, opts.gamesPerEval, iterSeedStart);
    const winRate = result.winsA / result.games;
    const accepted = winRate > bestWinRate + minImprovement;

    if (accepted) {
      best = candidate;
      bestWinRate = winRate;
      stepScale[key]! *= 1.2; // grow: this direction is working
    } else {
      stepScale[key]! *= 0.9; // shrink: step was too big or wrong direction
    }

    const step: HillClimbStep = { iteration: i, key, from, to, winRate, accepted };
    history.push(step);
    opts.onStep?.(step);
  }

  return { best: best as unknown as T, bestWinRate, history };
}
