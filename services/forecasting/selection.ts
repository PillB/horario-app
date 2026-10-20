/**
 * Model selection by rolling-origin backtesting, and prediction intervals
 * from the backtest errors. Pure functions.
 *
 * Backtest: for origins o = n − H, n − H − 7, … (newest first, up to
 * `maxOrigins`), fit each candidate on y[0, o) and forecast y[o, o + H).
 * Each origin is scored with MASE: the forecast MAE divided by the in-sample
 * MAE of the weekly seasonal naive on the same training data, so 1.0 means
 * "as good as repeating last week" and below 1.0 is better. A model's score
 * is the mean MASE over the origins. All candidates use the same origins.
 */
import {
  MIN_HISTORY,
  MODEL_ORDER,
  SEASON,
  fitModel,
  type FittedModel,
  type ForecastModelName,
} from './models';

export type BacktestConfig = {
  /** Days forecast from each origin. */
  horizon: number;
  /** Most origins used (newest first). */
  maxOrigins: number;
  /** Days between origins. */
  step: number;
  /** A model is only a candidate when it can be scored on this many origins. */
  minOrigins: number;
  /** A simpler model wins when its MASE is within this fraction of the best. */
  tieTolerance: number;
};

export const DEFAULT_BACKTEST: BacktestConfig = {
  horizon: 14,
  maxOrigins: 10,
  step: 7,
  minOrigins: 3,
  tieTolerance: 0.02,
};

/**
 * Days of history a model needs to take part in selection: its fitting
 * minimum plus a full horizon for each of `minOrigins` origins. With the
 * defaults: seasonal naive 35 days, weekday profile 42, Holt-Winters 56.
 * Below 35 days nothing can be compared and seasonal naive is used.
 */
export const minSelectionHistory = (model: ForecastModelName, cfg: BacktestConfig = DEFAULT_BACKTEST): number =>
  MIN_HISTORY[model] + cfg.horizon + (cfg.minOrigins - 1) * cfg.step;

export type ModelScore = { model: ForecastModelName; mase: number };

export type BacktestResult = {
  scores: ModelScore[];
  /** Training lengths used as origins, oldest first. */
  origins: number[];
  /** errors[model][h − 1] = actual − forecast at horizon h, one per origin. */
  errors: Partial<Record<ForecastModelName, number[][]>>;
  /** Each model as fitted at the newest origin (a warm start for the final fit). */
  lastFits: Partial<Record<ForecastModelName, FittedModel>>;
};

/** In-sample MAE of y_t − y_{t−7}. A flat series (0) scores errors in raw units instead. */
export function seasonalNaiveScale(y: ArrayLike<number>, to = y.length): number {
  let sum = 0;
  let count = 0;
  for (let t = SEASON; t < to; t += 1) {
    sum += Math.abs(y[t] - y[t - SEASON]);
    count += 1;
  }
  const scale = count ? sum / count : 0;
  return scale > 1e-9 ? scale : 1;
}

const clampForecast = (values: number[]) => values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));

export function backtest(
  y: ArrayLike<number>,
  models: readonly ForecastModelName[] = MODEL_ORDER,
  cfg: BacktestConfig = DEFAULT_BACKTEST,
): BacktestResult | null {
  const series = Float64Array.from(y as ArrayLike<number>);
  const n = series.length;
  const candidates = models.filter((m) => n >= minSelectionHistory(m, cfg));
  if (!candidates.length) return null;
  const minTrain = Math.max(...candidates.map((m) => MIN_HISTORY[m]));

  const origins: number[] = [];
  for (let k = 0; k < cfg.maxOrigins; k += 1) {
    const o = n - cfg.horizon - k * cfg.step;
    if (o < minTrain) break;
    origins.unshift(o);
  }

  const errors: Partial<Record<ForecastModelName, number[][]>> = {};
  const scaledSum: Partial<Record<ForecastModelName, number>> = {};
  for (const m of candidates) {
    errors[m] = Array.from({ length: cfg.horizon }, () => [] as number[]);
    scaledSum[m] = 0;
  }
  const last: Partial<Record<ForecastModelName, FittedModel>> = {};
  for (const o of origins) {
    const train = series.subarray(0, o);
    const scale = seasonalNaiveScale(train);
    for (const m of candidates) {
      // Origins run oldest first, so each fit can warm-start from the previous one.
      const fitted = fitModel(m, train, last[m]);
      last[m] = fitted;
      const f = clampForecast(fitted.forecast(cfg.horizon));
      let abs = 0;
      for (let h = 0; h < cfg.horizon; h += 1) {
        const e = series[o + h] - f[h];
        errors[m]![h].push(e);
        abs += Math.abs(e);
      }
      scaledSum[m]! += abs / cfg.horizon / scale;
    }
  }
  return {
    scores: candidates.map((m) => ({ model: m, mase: scaledSum[m]! / origins.length })),
    origins,
    errors,
    lastFits: last,
  };
}

/** The lowest MASE, except that a simpler model within `tieTolerance` of it wins. */
export function chooseModel(scores: readonly ModelScore[], tieTolerance = DEFAULT_BACKTEST.tieTolerance): ModelScore {
  const best = Math.min(...scores.map((s) => s.mase));
  const ordered = [...scores].sort((a, b) => MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model));
  return ordered.find((s) => s.mase <= best * (1 + tieTolerance) + 1e-12) ?? ordered[0];
}

// ─── Empirical quantiles ─────────────────────────────────────────────────────

/** Quantile p of an ascending array, linear interpolation (Hyndman & Fan type 7). */
export function quantileSorted(sorted: readonly number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type IntervalSource = 'backtest' | 'in-sample' | 'none';

/** Fewest errors an interval is computed from. */
export const MIN_INTERVAL_ERRORS = 6;
/** Errors from horizons within ±3 days are pooled when there are at least this many. */
const MIN_WINDOW_ERRORS = 20;
const HORIZON_WINDOW = 3;

export type ErrorModel = {
  source: IntervalSource;
  /** Quantile p of (actual − forecast) at horizon h ≥ 1; 0 when source is 'none'. */
  quantile: (h: number, p: number) => number;
};

/**
 * Error quantiles from the chosen model's backtest errors. For horizon h the
 * errors at horizons h−3 … h+3 are pooled (errors grow with the horizon); when
 * that window has fewer than 20 errors, all horizons are pooled. Horizons past
 * the backtest horizon use the last window.
 */
export function errorModelFromBacktest(errorsByH: number[][]): ErrorModel {
  const H = errorsByH.length;
  const all = errorsByH.flat().sort((a, b) => a - b);
  if (all.length < MIN_INTERVAL_ERRORS) return NO_ERRORS;
  const windows: number[][] = [];
  for (let h = 1; h <= H; h += 1) {
    const pooled: number[] = [];
    for (let k = Math.max(1, h - HORIZON_WINDOW); k <= Math.min(H, h + HORIZON_WINDOW); k += 1) pooled.push(...errorsByH[k - 1]);
    windows.push(pooled.length >= MIN_WINDOW_ERRORS ? pooled.sort((a, b) => a - b) : all);
  }
  return {
    source: 'backtest',
    quantile: (h, p) => quantileSorted(windows[Math.min(H, Math.max(1, Math.round(h))) - 1], p),
  };
}

/**
 * For history too short to backtest: quantiles of the in-sample seasonal
 * naive errors y_t − y_{t−7}, the same at every horizon.
 */
export function errorModelInSample(y: ArrayLike<number>): ErrorModel {
  const diffs: number[] = [];
  for (let t = SEASON; t < y.length; t += 1) diffs.push(y[t] - y[t - SEASON]);
  if (diffs.length < MIN_INTERVAL_ERRORS) return NO_ERRORS;
  diffs.sort((a, b) => a - b);
  return { source: 'in-sample', quantile: (_h, p) => quantileSorted(diffs, p) };
}

const NO_ERRORS: ErrorModel = { source: 'none', quantile: () => 0 };

// ─── One series end to end ───────────────────────────────────────────────────

export type SeriesForecastOptions = {
  /** Central coverage of [lower, upper], e.g. 0.8 for the 10th–90th percentile. */
  intervalLevel: number;
  /** Quantile the planned headcount is taken at, e.g. 0.8. */
  serviceLevel: number;
  backtest: BacktestConfig;
};

export type SeriesPoint = {
  /** Days after the end of the series, ≥ 1. */
  h: number;
  /** Point forecast (mean), ≥ 0. */
  expected: number;
  lower: number | null;
  upper: number | null;
  /**
   * Forecast plus the service-level quantile of the errors, ≥ 0, not rounded.
   * It can sit below `expected` when the backtest shows the model forecasts high.
   */
  atServiceLevel: number;
};

export type SeriesForecast = {
  model: ForecastModelName;
  params: Record<string, number>;
  /** MASE of the chosen model, null when there was too little history to backtest. */
  mase: number | null;
  scores: ModelScore[];
  backtestOrigins: number;
  intervalSource: IntervalSource;
  points: SeriesPoint[];
};

export function forecastSeries(
  y: ArrayLike<number>,
  horizons: readonly number[],
  options: SeriesForecastOptions,
): SeriesForecast {
  const result = backtest(y, MODEL_ORDER, options.backtest);
  let chosen: ModelScore | null = null;
  let errorModel: ErrorModel;
  if (result) {
    chosen = chooseModel(result.scores, options.backtest.tieTolerance);
    errorModel = errorModelFromBacktest(result.errors[chosen.model] ?? []);
  } else {
    errorModel = errorModelInSample(y);
  }
  const name = chosen?.model ?? 'seasonalNaive';
  const fitted: FittedModel = fitModel(name, y, result?.lastFits[name]);
  const maxH = Math.max(0, ...horizons);
  const path = clampForecast(fitted.forecast(maxH));
  const lowP = (1 - options.intervalLevel) / 2;
  const highP = 1 - lowP;
  const points = horizons.map((h): SeriesPoint => {
    const expected = path[h - 1] ?? 0;
    const withError = (p: number) => Math.max(0, expected + errorModel.quantile(h, p));
    const hasInterval = errorModel.source !== 'none';
    return {
      h,
      expected,
      lower: hasInterval ? withError(lowP) : null,
      upper: hasInterval ? withError(highP) : null,
      atServiceLevel: hasInterval ? withError(options.serviceLevel) : expected,
    };
  });
  return {
    model: fitted.name,
    params: fitted.params,
    mase: chosen ? chosen.mase : null,
    scores: result?.scores ?? [],
    backtestOrigins: result?.origins.length ?? 0,
    intervalSource: errorModel.source,
    points,
  };
}
