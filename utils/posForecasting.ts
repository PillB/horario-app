/**
 * @fileoverview POS-based demand forecasting utilities for the Horario scheduling app.
 * Derives staffing requirements from historical Point-of-Sale revenue data.
 */

/**
 * Represents a single row of POS (Point-of-Sale) data for a given date.
 */
export type PosRow = {
  /** ISO 8601 date string (e.g. "2024-03-15") */
  date: string;
  /** Total revenue recorded for this date */
  revenue: number;
  /** Number of covers (guests/transactions) for this date, if available */
  covers: number | null;
  /** Optional free-text notes about this date */
  notes: string | null;
};

/**
 * Configuration for the POS-based demand forecaster.
 */
export type PosForecasterConfig = {
  /** The staff role this forecast applies to (e.g. "server", "cook") */
  role: string;
  /** Expected revenue generated per worker per hour */
  revenuePerWorkerHour: number;
  /** Average number of hours per shift */
  avgShiftHours: number;
  /** Number of days to use for the rolling average smoothing window */
  smoothingWindow: number;
};

/**
 * Default configuration values for the POS forecaster.
 * Provides sensible starting defaults that can be overridden per role.
 */
export const DEFAULT_POS_CONFIG: PosForecasterConfig = {
  role: '',
  revenuePerWorkerHour: 50,
  avgShiftHours: 8,
  smoothingWindow: 7,
};

/**
 * Computes a centered rolling average over an array of numeric values.
 *
 * For each position i, the average is taken over the window centered on i.
 * Edge positions where a full window is not available are padded by replicating
 * the nearest valid (fully-contained) average — the first valid average is
 * replicated leftward, and the last valid average is replicated rightward.
 *
 * @param values - The input array of numbers to smooth.
 * @param window - The size of the rolling window (should be a positive integer).
 *                 If window <= 1 or larger than the input, the original values
 *                 are returned unchanged (or full-array average is used).
 * @returns A new array of the same length as `values` containing the smoothed values.
 *
 * @example
 * rollingAverage([10, 20, 30, 40, 50], 3);
 * // => [20, 20, 30, 40, 40]
 */
export function rollingAverage(values: number[], window: number): number[] {
  const n = values.length;

  if (n === 0) {
    return [];
  }

  if (window <= 1) {
    return [...values];
  }

  const result = new Array<number>(n);
  const half = Math.floor(window / 2);

  // Compute the centered average for each position where a full window fits,
  // then track the first and last valid averages for edge padding.
  let firstValidAvg: number | null = null;
  let lastValidAvg: number | null = null;
  const validStartIdx = half;
  const validEndIdx = n - 1 - half;

  // If the window is larger than the array, fall back to the overall mean
  // for every position.
  if (validStartIdx > validEndIdx) {
    const total = values.reduce((sum, v) => sum + v, 0);
    const mean = total / n;
    return new Array<number>(n).fill(mean);
  }

  // Compute valid (fully-windowed) averages and store in result temporarily.
  for (let i = validStartIdx; i <= validEndIdx; i++) {
    let sum = 0;
    for (let j = i - half; j <= i + half; j++) {
      sum += values[j];
    }
    const avg = sum / window;
    result[i] = avg;

    if (firstValidAvg === null) {
      firstValidAvg = avg;
    }
    lastValidAvg = avg;
  }

  // Pad left edges with the first valid average.
  for (let i = 0; i < validStartIdx; i++) {
    result[i] = firstValidAvg as number;
  }

  // Pad right edges with the last valid average.
  for (let i = validEndIdx + 1; i < n; i++) {
    result[i] = lastValidAvg as number;
  }

  return result;
}

/**
 * Forecasts staffing demand for a given role based on historical POS revenue data.
 *
 * The algorithm:
 * 1. Sorts input rows chronologically.
 * 2. Smooths the revenue series using a centered rolling average.
 * 3. Converts smoothed revenue to required worker-shifts via the config parameters.
 * 4. Produces a forecast record per date including confidence bounds.
 *
 * @param rows   - Array of historical POS data rows.
 * @param config - Forecaster configuration (role, rates, shift length, window).
 * @returns An array of forecast objects, one per input date, sorted ascending by date.
 *
 * @example
 * const rows: PosRow[] = [
 *   { date: '2024-01-01', revenue: 4000, covers: null, notes: null },
 *   { date: '2024-01-02', revenue: 4800, covers: null, notes: null },
 * ];
 * const forecasts = forecastDemandFromPOS(rows, {
 *   ...DEFAULT_POS_CONFIG,
 *   role: 'server',
 * });
 */
export function forecastDemandFromPOS(
  rows: PosRow[],
  config: PosForecasterConfig,
): Array<{
  date: string;
  role: string;
  required: number;
  source: string;
  notes: string;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}> {
  if (rows.length === 0) {
    return [];
  }

  // 1. Sort rows by date ascending (lexicographic sort works for ISO 8601 dates).
  const sorted = [...rows].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });

  // 2. Extract the revenue series and apply rolling average smoothing.
  const revenues = sorted.map((row) => row.revenue);
  const smoothed = rollingAverage(revenues, config.smoothingWindow);

  // 3. Build forecast records.
  return sorted.map((row, idx) => {
    const smoothedRevenue = smoothed[idx];

    // Workers required = ceiling of (smoothed revenue / revenue per worker-shift).
    const required = Math.max(
      1,
      Math.ceil(smoothedRevenue / (config.revenuePerWorkerHour * config.avgShiftHours)),
    );

    const lowerBound = Math.max(1, required - 1);
    const upperBound = required + 1;

    return {
      date: row.date,
      role: config.role,
      required,
      source: 'pos_forecast',
      notes: `POS: $${smoothedRevenue.toFixed(0)} rev → ${required} workers`,
      lowerBound,
      upperBound,
      confidence: 0.80,
    };
  });
}

// ─── Multi-role forecasting ────────────────────────────────────────────────────

/**
 * A single role's staffing ratio configuration within a staffing mix.
 *
 * ratioMode determines which demand metric drives headcount:
 *   'covers'  → required = ceil(smoothedCovers / coversPerWorker)  [falls back to revenue if no covers column]
 *   'revenue' → required = ceil(smoothedRevenue / (revenuePerWorkerHour * avgShiftHours))
 */
export type RoleRatio = {
  /** Human-readable role name, e.g. "Server" or "Barista". */
  role: string;
  /** Which demand metric drives headcount calculation. */
  ratioMode: 'covers' | 'revenue';
  /** Number of covers one worker can handle (used in 'covers' mode). */
  coversPerWorker: number;
  /** Revenue generated per worker per hour in dollars (used in 'revenue' mode or as fallback). */
  revenuePerWorkerHour: number;
  /** Expected length of a single shift in hours (used in 'revenue' mode or as fallback). */
  avgShiftHours: number;
  /** Minimum number of workers to schedule regardless of demand. */
  minWorkers: number;
  /** Optional upper cap on scheduled workers; null means no ceiling is applied. */
  maxWorkers: number | null;
};

/**
 * Configuration for multi-role POS-based demand forecasting.
 * Combines a collection of {@link RoleRatio} definitions with a shared
 * smoothing window applied to all demand series.
 */
export type StaffingMix = {
  /** One entry per role to forecast. */
  roles: RoleRatio[];
  /** Rolling-average window size in days applied to both revenue and covers series. Default: 7. */
  smoothingWindow?: number;
};

/**
 * Keys that identify a named staffing preset or a fully custom configuration.
 *
 * - `fine_dining`   – White-tablecloth, high-touch service ratios.
 * - `casual_dining` – Mid-scale full-service restaurant ratios.
 * - `bar_cafe`      – Counter/bar service with barista and bartender roles.
 * - `qsr`           – Quick-service / fast-food counter and cook ratios.
 * - `custom`        – Empty template for caller-supplied role definitions.
 */
export type StaffingPresetKey = 'fine_dining' | 'casual_dining' | 'bar_cafe' | 'qsr' | 'custom';

/**
 * Named staffing-mix presets derived from published hospitality benchmarks
 * (sources: 7shifts, Oysterlink, Escoffier).
 *
 * Each entry provides a ready-to-use `roles` array that can be passed directly
 * into {@link forecastDemandFromPOSMultiRole} via a {@link StaffingMix}.
 *
 * @example
 * const mix: StaffingMix = {
 *   ...STAFFING_PRESETS.fine_dining,
 *   smoothingWindow: 7,
 * };
 */
export const STAFFING_PRESETS: Record<
  StaffingPresetKey,
  { key: StaffingPresetKey; roles: RoleRatio[] }
> = {
  fine_dining: {
    key: 'fine_dining',
    roles: [
      {
        role: 'Server',
        ratioMode: 'covers',
        coversPerWorker: 4,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Cook',
        ratioMode: 'covers',
        coversPerWorker: 8,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Host',
        ratioMode: 'covers',
        coversPerWorker: 20,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: 2,
      },
      {
        role: 'Bartender',
        ratioMode: 'covers',
        coversPerWorker: 15,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
    ],
  },

  casual_dining: {
    key: 'casual_dining',
    roles: [
      {
        role: 'Server',
        ratioMode: 'covers',
        coversPerWorker: 6,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Cook',
        ratioMode: 'covers',
        coversPerWorker: 15,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Host',
        ratioMode: 'covers',
        coversPerWorker: 30,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: 2,
      },
    ],
  },

  bar_cafe: {
    key: 'bar_cafe',
    roles: [
      {
        role: 'Barista',
        ratioMode: 'covers',
        coversPerWorker: 15,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Bartender',
        ratioMode: 'covers',
        coversPerWorker: 10,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
    ],
  },

  qsr: {
    key: 'qsr',
    roles: [
      {
        role: 'Counter',
        ratioMode: 'covers',
        coversPerWorker: 20,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
      {
        role: 'Cook',
        ratioMode: 'covers',
        coversPerWorker: 25,
        revenuePerWorkerHour: 50,
        avgShiftHours: 8,
        minWorkers: 1,
        maxWorkers: null,
      },
    ],
  },

  custom: {
    key: 'custom',
    roles: [],
  },
};

/**
 * Forecasts staffing demand for multiple roles simultaneously using historical
 * POS data and a {@link StaffingMix} configuration.
 *
 * The algorithm:
 * 1. Returns an empty array when `rows` or `mix.roles` is empty.
 * 2. Sorts rows chronologically (ISO 8601 lexicographic order).
 * 3. Smooths the revenue series via {@link rollingAverage} using `mix.smoothingWindow`.
 * 4. If any row contains a positive covers value, also smooths the covers series;
 *    otherwise `smoothedCovers` is treated as unavailable (`null`).
 * 5. For each date × role combination, calculates the required headcount:
 *    - **covers mode** (when covers data is available and `ratioMode === 'covers'`):
 *      `required = ceil(smoothedCovers / coversPerWorker)`
 *    - **revenue fallback** (covers unavailable or `ratioMode === 'revenue'`):
 *      `required = ceil(smoothedRevenue / (revenuePerWorkerHour * avgShiftHours))`
 * 6. Applies `minWorkers` floor, optional `maxWorkers` ceiling, and an absolute
 *    minimum of 1 to every result.
 * 7. Derives `lowerBound` and `upperBound` as ±1 around `required`.
 *
 * @param rows - Array of historical POS data rows (unsorted is acceptable).
 * @param mix  - Staffing-mix configuration containing role ratios and smoothing window.
 * @returns An array of forecast records sorted by date then role; one entry per
 *          date × role pair. Returns `[]` when inputs are empty.
 *
 * @example
 * const rows: PosRow[] = [
 *   { date: '2024-03-01', revenue: 8000, covers: 80,   notes: null },
 *   { date: '2024-03-02', revenue: 9500, covers: 100,  notes: null },
 * ];
 * const mix: StaffingMix = {
 *   ...STAFFING_PRESETS.casual_dining,
 *   smoothingWindow: 7,
 * };
 * const forecasts = forecastDemandFromPOSMultiRole(rows, mix);
 */
export function forecastDemandFromPOSMultiRole(
  rows: PosRow[],
  mix: StaffingMix,
  smoothingWindowOverride?: number,
): Array<{
  date: string;
  role: string;
  required: number;
  source: string;
  notes: string;
  lowerBound: number;
  upperBound: number;
  confidence: number;
}> {
  // 1. Guard: nothing to forecast when inputs are empty.
  if (rows.length === 0 || mix.roles.length === 0) {
    return [];
  }

  const effectiveWindow = smoothingWindowOverride ?? mix.smoothingWindow ?? 7;

  // 2. Sort rows by date ascending (lexicographic sort is valid for ISO 8601).
  const sorted = [...rows].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });

  // 3. Smooth the revenue series.
  const revenues = sorted.map((row) => row.revenue);
  const smoothedRevenues = rollingAverage(revenues, effectiveWindow);

  // 4. Smooth the covers series only when at least one row has a positive value.
  const hasCovers = sorted.some((row) => row.covers !== null && row.covers > 0);
  const smoothedCovers: number[] | null = hasCovers
    ? rollingAverage(
        sorted.map((row) => (row.covers !== null ? row.covers : 0)),
        effectiveWindow,
      )
    : null;

  // 5–8. Build one forecast record per date × role combination.
  const results: Array<{
    date: string;
    role: string;
    required: number;
    source: string;
    notes: string;
    lowerBound: number;
    upperBound: number;
    confidence: number;
  }> = [];

  for (let idx = 0; idx < sorted.length; idx++) {
    const row = sorted[idx];
    const rev = smoothedRevenues[idx];
    const cov = smoothedCovers !== null ? smoothedCovers[idx] : null;

    for (const roleRatio of mix.roles) {
      let rawRequired: number;
      let notesSuffix: string;

      // 5a. Covers mode — use smoothed covers when available and positive.
      if (roleRatio.ratioMode === 'covers' && cov !== null && cov > 0) {
        rawRequired = Math.ceil(cov / roleRatio.coversPerWorker);
        notesSuffix = `${cov.toFixed(0)} covers → ${rawRequired}`;
      } else {
        // 5b. Revenue fallback (also used when ratioMode === 'revenue').
        const denominator = roleRatio.revenuePerWorkerHour * roleRatio.avgShiftHours;
        rawRequired = denominator > 0 ? Math.ceil(rev / denominator) : 1;
        notesSuffix = `$${rev.toFixed(0)} → ${rawRequired}`;
      }

      // 5c. Apply minWorkers floor.
      let required = Math.max(roleRatio.minWorkers, rawRequired);

      // 5d. Apply maxWorkers ceiling when specified.
      if (roleRatio.maxWorkers !== null) {
        required = Math.min(roleRatio.maxWorkers, required);
      }

      // 5e. Ensure absolute minimum of 1 worker.
      required = Math.max(1, required);

      // 5f–g. Derive confidence bounds (±1, lower never below minWorkers).
      const lowerBound = Math.max(roleRatio.minWorkers, required - 1);
      const upperBound = required + 1;

      // 5h. Append the forecast record.
      results.push({
        date: row.date,
        role: roleRatio.role,
        required,
        source: 'pos_forecast',
        notes: `POS: ${notesSuffix}`,
        lowerBound,
        upperBound,
        confidence: 0.80,
      });
    }
  }

  return results;
}