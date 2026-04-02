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