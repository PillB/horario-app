/**
 * Candidate demand models for one daily series (one role).
 *
 * A series is a dense array of daily values, oldest first, with one entry per
 * calendar day (missing days filled with 0 by `buildRoleSeries`). Index i and
 * i + 7 are always the same weekday, so weekly seasonality is positional and
 * never depends on a time zone or a Date object.
 *
 * Pure functions, no I/O, no dependencies.
 */

/** Weekly season length in days. */
export const SEASON = 7;

export type ForecastModelName = 'seasonalNaive' | 'dowProfile' | 'holtWinters';

/** Simplest first: model selection prefers the earlier model on a near tie. */
export const MODEL_ORDER: readonly ForecastModelName[] = ['seasonalNaive', 'dowProfile', 'holtWinters'];

/**
 * Days of history a model needs before it can be fitted.
 *  - seasonal naive: one week (every weekday seen once);
 *  - weekday profile: two weeks (two observations per weekday, so the
 *    recency weighting has something to weigh);
 *  - Holt-Winters: four weeks (two to initialise level, trend and the seven
 *    seasonal terms, two more so the in-sample error that picks α, β, γ, φ
 *    is not just the initialisation).
 * Model selection needs more on top: see MIN_SELECTION_HISTORY in selection.ts.
 */
export const MIN_HISTORY: Record<ForecastModelName, number> = {
  seasonalNaive: SEASON,
  dowProfile: 2 * SEASON,
  holtWinters: 4 * SEASON,
};

export type FittedModel = {
  name: ForecastModelName;
  /** Forecasts for the next `h` days after the end of the series (index 0 = the next day). */
  forecast: (h: number) => number[];
  /** Fitted parameters, for display and tests. */
  params: Record<string, number>;
};

const mean = (values: ArrayLike<number>, from = 0, to = values.length): number => {
  if (to <= from) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i];
  return sum / (to - from);
};

// ─── Seasonal naive ──────────────────────────────────────────────────────────

/**
 * Same weekday last week. With less than a week of history, a weekday that
 * was never observed gets the mean of what was observed (0 for no history).
 */
export function fitSeasonalNaive(y: ArrayLike<number>): FittedModel {
  const n = y.length;
  const fallback = mean(y);
  return {
    name: 'seasonalNaive',
    params: {},
    forecast: (h) => {
      const out: number[] = [];
      for (let k = 0; k < h; k += 1) {
        let idx = n + k;
        while (idx >= n) idx -= SEASON;
        out.push(idx >= 0 ? y[idx] : fallback);
      }
      return out;
    },
  };
}

// ─── Weekday profile with exponential recency weighting ─────────────────────

/** Half-lives tried, in weeks. 520 weeks is effectively an unweighted mean. */
export const DOW_HALF_LIVES_WEEKS: readonly number[] = [1, 2, 4, 8, 16, 520];

/**
 * One-step-ahead squared error of the weekday profile with decay `d` per week,
 * and the final weighted mean for each weekday position.
 */
function runDowProfile(y: ArrayLike<number>, d: number, scoreFrom: number): { sse: number; count: number; level: number[] } {
  const s = new Array<number>(SEASON).fill(0);
  const w = new Array<number>(SEASON).fill(0);
  let sse = 0;
  let count = 0;
  for (let t = 0; t < y.length; t += 1) {
    const c = t % SEASON;
    if (t >= scoreFrom && w[c] > 0) {
      const err = y[t] - s[c] / w[c];
      sse += err * err;
      count += 1;
    }
    s[c] = d * s[c] + y[t];
    w[c] = d * w[c] + 1;
  }
  const overall = mean(y);
  return { sse, count, level: s.map((v, c) => (w[c] > 0 ? v / w[c] : overall)) };
}

/**
 * Weighted mean of each weekday, older weeks weighted down by 0.5 per
 * half-life. The half-life is chosen from DOW_HALF_LIVES_WEEKS by in-sample
 * one-step-ahead squared error (scored from the third week on).
 */
export function fitDowProfile(y: ArrayLike<number>, halfLifeWeeks?: number): FittedModel {
  const n = y.length;
  const candidates = halfLifeWeeks !== undefined ? [halfLifeWeeks] : DOW_HALF_LIVES_WEEKS;
  let best = { halfLife: candidates[0], sse: Infinity, level: [] as number[] };
  for (const halfLife of candidates) {
    const run = runDowProfile(y, Math.pow(0.5, 1 / halfLife), 2 * SEASON);
    const score = run.count > 0 ? run.sse / run.count : 0;
    if (score < best.sse - 1e-12) best = { halfLife, sse: score, level: run.level };
  }
  const level = best.level;
  return {
    name: 'dowProfile',
    params: { halfLifeWeeks: best.halfLife },
    forecast: (h) => {
      const out: number[] = [];
      for (let k = 0; k < h; k += 1) out.push(level[(n + k) % SEASON]);
      return out;
    },
  };
}

// ─── Holt-Winters: additive weekly seasonality, damped additive trend ───────

export type HoltWintersParams = {
  /** Level smoothing, 0 < α < 1. */
  alpha: number;
  /** Trend smoothing, 0 ≤ β ≤ α. */
  beta: number;
  /** Seasonal smoothing, 0 ≤ γ ≤ 1 − α. */
  gamma: number;
  /** Damping, 0.8 ≤ φ ≤ 0.98 (Hyndman & Athanasopoulos' usual bounds). */
  phi: number;
};

export const HW_BOUNDS = {
  alpha: [0.01, 0.95],
  phi: [0.8, 0.98],
} as const;

type HwState = { level: number; trend: number; season: Float64Array };

/**
 * Initial state from the first weeks: level = mean of week 1, trend = change
 * of the weekly mean between week 1 and week 2 per day, seasonal terms =
 * average deviation of each weekday from its week's mean over up to 4 weeks.
 * The level is moved back half a week so it sits just before day 0.
 */
function initialState(y: ArrayLike<number>): HwState {
  const weeks = Math.max(1, Math.min(4, Math.floor(y.length / SEASON)));
  const w1 = mean(y, 0, SEASON);
  const w2 = weeks >= 2 ? mean(y, SEASON, 2 * SEASON) : w1;
  const trend = (w2 - w1) / SEASON;
  const season = new Float64Array(SEASON);
  for (let k = 0; k < weeks; k += 1) {
    const weekMean = mean(y, k * SEASON, (k + 1) * SEASON);
    for (let j = 0; j < SEASON; j += 1) season[j] += (y[k * SEASON + j] - weekMean) / weeks;
  }
  return { level: w1 - trend * (SEASON + 1) / 2, trend, season };
}

/**
 * Runs the ETS(A,Ad,A) recursions over the whole series. Returns the
 * one-step-ahead SSE from day `scoreFrom` on and the final state.
 *   ŷ_t = l_{t−1} + φ b_{t−1} + s_{t−7}
 *   l_t = α (y_t − s_{t−7}) + (1 − α)(l_{t−1} + φ b_{t−1})
 *   b_t = β (l_t − l_{t−1}) + (1 − β) φ b_{t−1}
 *   s_t = γ (y_t − l_{t−1} − φ b_{t−1}) + (1 − γ) s_{t−7}
 */
function runHoltWinters(y: ArrayLike<number>, p: HoltWintersParams, init: HwState, scoreFrom: number) {
  const season = Float64Array.from(init.season);
  let level = init.level;
  let trend = init.trend;
  let sse = 0;
  const { alpha, beta, gamma, phi } = p;
  for (let t = 0; t < y.length; t += 1) {
    const j = t % SEASON;
    const base = level + phi * trend;
    const err = y[t] - (base + season[j]);
    if (t >= scoreFrom) sse += err * err;
    const newLevel = alpha * (y[t] - season[j]) + (1 - alpha) * base;
    trend = beta * (newLevel - level) + (1 - beta) * phi * trend;
    season[j] = gamma * (y[t] - base) + (1 - gamma) * season[j];
    level = newLevel;
  }
  return { sse, state: { level, trend, season } as HwState };
}

/** Maps the search box (α, β/α, γ/(1−α), φ) to parameters that satisfy the bounds. */
const toParams = (x: readonly number[]): HoltWintersParams => {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const alpha = clamp(x[0], HW_BOUNDS.alpha[0], HW_BOUNDS.alpha[1]);
  return {
    alpha,
    beta: clamp(x[1], 0, 1) * alpha,
    gamma: clamp(x[2], 0, 1) * (1 - alpha),
    phi: clamp(x[3], HW_BOUNDS.phi[0], HW_BOUNDS.phi[1]),
  };
};

const GRID: readonly (readonly number[])[] = [
  [0.05, 0.2, 0.5, 0.8], // α
  [0, 0.05, 0.3], // β / α
  [0.05, 0.2, 0.5], // γ / (1 − α)
  [0.8, 0.9, 0.98], // φ
];
const BOX_LO = [HW_BOUNDS.alpha[0], 0, 0, HW_BOUNDS.phi[0]];
const BOX_HI = [HW_BOUNDS.alpha[1], 1, 1, HW_BOUNDS.phi[1]];

/** Search box coordinates (α, β/α, γ/(1−α), φ) of fitted parameters. */
const toSearchPoint = (p: HoltWintersParams): number[] => [
  p.alpha,
  p.alpha > 0 ? p.beta / p.alpha : 0,
  p.alpha < 1 ? p.gamma / (1 - p.alpha) : 0,
  p.phi,
];

const START_STEP = [0.1, 0.1, 0.1, 0.04];

/**
 * Bounded search for (α, β, γ, φ) minimising in-sample one-step SSE: a coarse
 * 4×3×3×3 grid, then a Hooke-Jeeves pattern search inside the box, halving the
 * step until it is below 1/64 of the starting step (at most 200 rounds).
 * With `warmStart` (parameters fitted on a slightly shorter series, as in a
 * backtest) the grid is skipped and the pattern search starts from it with a
 * quarter of the step.
 */
function searchParams(
  y: ArrayLike<number>,
  init: HwState,
  scoreFrom: number,
  warmStart?: HoltWintersParams,
): HoltWintersParams {
  const sseAt = (x: number[]) => runHoltWinters(y, toParams(x), init, scoreFrom).sse;
  let bestX: number[];
  let bestF: number;
  let step: number[];
  if (warmStart) {
    bestX = toSearchPoint(warmStart);
    bestF = sseAt(bestX);
    step = START_STEP.map((v) => v / 4);
  } else {
    bestX = [GRID[0][0], GRID[1][0], GRID[2][0], GRID[3][0]];
    bestF = Infinity;
    for (const a of GRID[0]) for (const b of GRID[1]) for (const g of GRID[2]) for (const f of GRID[3]) {
      const x = [a, b, g, f];
      const v = sseAt(x);
      if (v < bestF) {
        bestF = v;
        bestX = x;
      }
    }
    step = START_STEP.slice();
  }
  const minStep = START_STEP.map((v) => v / 64);
  for (let iter = 0; iter < 200 && step.some((v, i) => v >= minStep[i]); iter += 1) {
    let improved = false;
    for (let i = 0; i < 4; i += 1) {
      for (const dir of [1, -1]) {
        const x = bestX.slice();
        x[i] = Math.min(BOX_HI[i], Math.max(BOX_LO[i], x[i] + dir * step[i]));
        if (x[i] === bestX[i]) continue;
        const v = sseAt(x);
        // Relative threshold: tiny gains on a flat surface do not count as progress.
        if (v < bestF * (1 - 1e-4)) {
          bestF = v;
          bestX = x;
          improved = true;
          break;
        }
      }
    }
    if (!improved) for (let i = 0; i < 4; i += 1) step[i] /= 2;
  }
  return toParams(bestX);
}

/**
 * Holt-Winters fits on at most the last 53 weeks: with the small α and γ the
 * search finds on daily staffing data, older days have almost no weight in
 * the final state, and the cap keeps a 2-year history cheap to fit.
 */
export const HW_MAX_TRAIN_DAYS = 53 * SEASON;

export type HoltWintersOptions = {
  /** Fixed parameters (no search). */
  params?: HoltWintersParams;
  /** Start the search from these parameters (see searchParams). */
  warmStart?: HoltWintersParams;
};

/**
 * Holt-Winters with additive weekly seasonality and a damped additive trend.
 * Parameters are fitted by bounded search on the in-sample one-step error
 * (scored after the first week), unless `params` is given.
 *
 * The h-step forecast is l + (φ + φ² + … + φ^h) b + s, so the trend's total
 * contribution is bounded by b φ / (1 − φ): forecasts level off instead of
 * extrapolating a line forever.
 */
export function fitHoltWinters(series: ArrayLike<number>, options: HoltWintersOptions = {}): FittedModel {
  if (series.length < SEASON) return { ...fitSeasonalNaive(series), name: 'holtWinters' };
  // Drop whole weeks from the front so positions keep their weekday.
  const drop = Math.max(0, Math.ceil((series.length - HW_MAX_TRAIN_DAYS) / SEASON) * SEASON);
  const y = Float64Array.from({ length: series.length - drop }, (_, i) => series[drop + i]);
  const n = y.length;
  const init = initialState(y);
  const p = options.params ?? searchParams(y, init, SEASON, options.warmStart);
  const { state } = runHoltWinters(y, p, init, n);
  return {
    name: 'holtWinters',
    params: { ...p },
    forecast: (h) => {
      const out: number[] = [];
      let damp = 0;
      let phiPow = 1;
      for (let k = 1; k <= h; k += 1) {
        phiPow *= p.phi;
        damp += phiPow;
        out.push(state.level + damp * state.trend + state.season[(n + k - 1) % SEASON]);
      }
      return out;
    },
  };
}

const isHwParams = (p: Record<string, number> | undefined): p is HoltWintersParams =>
  !!p && ['alpha', 'beta', 'gamma', 'phi'].every((k) => Number.isFinite(p[k]));

/**
 * Fits model `name` on `y`. `previous` is the same model fitted on a shorter
 * prefix of the series (a backtest origin); Holt-Winters warm-starts from it.
 */
export function fitModel(name: ForecastModelName, y: ArrayLike<number>, previous?: FittedModel): FittedModel {
  switch (name) {
    case 'seasonalNaive':
      return fitSeasonalNaive(y);
    case 'dowProfile':
      return fitDowProfile(y);
    case 'holtWinters':
      return fitHoltWinters(y, isHwParams(previous?.params) ? { warmStart: previous.params } : {});
  }
}
