/**
 * services/forecastEngine.ts
 *
 * Pure TypeScript forecast engine for Horario workforce scheduling.
 * Uses POS sales data to produce statistically-enhanced demand recommendations.
 *
 * No external ML libraries — all algorithms implemented from scratch.
 * All functions are pure (no I/O, no side effects).
 */
import { isDateKey } from '@/utils/dateKeys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single row from the pos_sales table (only fields needed for forecasting). */
export type PosSalesRow = {
  date: string; // ISO-8601 date string, e.g. "2026-03-15"
  revenue: number; // daily revenue in local currency
  covers: number | null; // number of covers/guests served (may be null)
};

/**
 * Maps weekday index (0 = Sunday … 6 = Saturday) to a seasonality multiplier.
 * A value of 1.0 means "average day"; 1.3 means 30 % above average.
 */
export type SeasonalityIndex = Record<number, number>;

/** Result of an OLS linear regression over time-series revenue data. */
export type TrendResult = {
  slope: number; // revenue change per calendar day
  intercept: number; // estimated revenue on day-0 (epoch)
  r2: number; // coefficient of determination [0, 1]
  direction: "growing" | "flat" | "declining";
};

/** Enhanced staffing recommendation produced by applyForecastEnhancements(). */
export type DemandRecommendation = {
  date: string; // ISO-8601 date string
  role: string; // job role (e.g. "Server", "Cook")
  baseRequired: number; // original required headcount from base forecast
  adjustedRequired: number; // seasonality + trend adjusted headcount (rounded up)
  confidence: number; // [0, 1] — higher means more historical data available
  reasons: string[]; // human-readable explanation of adjustments applied
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse an ISO-8601 date string ("YYYY-MM-DD") into a UTC midnight Date.
 * Returns null for invalid strings, including days that do not exist
 * (2026-02-31: `Date` would roll it over to March) (CHG-089).
 */
function parseDate(dateStr: string): Date | null {
  if (typeof dateStr !== 'string' || !isDateKey(dateStr)) return null;
  return new Date(`${dateStr}T00:00:00Z`);
}

/**
 * Return the UTC weekday (0 = Sunday … 6 = Saturday) for a date string.
 * Returns null when the date string is invalid.
 */
function weekdayOf(dateStr: string): number | null {
  const d = parseDate(dateStr);
  return d !== null ? d.getUTCDay() : null;
}

/**
 * Convert a Date to the number of whole days since the Unix epoch (day 0).
 * Used as the X-axis in OLS regression.
 */
function toDayIndex(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/**
 * Arithmetic mean of a numeric array.
 * Returns 0 for empty arrays to avoid division-by-zero upstream.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

// ---------------------------------------------------------------------------
// 1. Day-of-week seasonality index
// ---------------------------------------------------------------------------

/**
 * Compute a day-of-week seasonality multiplier from historical POS sales data.
 *
 * Algorithm:
 *  1. Group revenues by weekday (0–6).
 *  2. Compute the average revenue per weekday.
 *  3. Divide each weekday average by the overall average across all days.
 *
 * Edge cases:
 *  - Empty input → all multipliers default to 1.0 (neutral).
 *  - A weekday with no data → multiplier defaults to 1.0.
 *  - Overall average of 0 (e.g. all revenues are 0) → all multipliers 1.0.
 *
 * @param sales - Array of POS sales rows (order does not matter).
 * @returns SeasonalityIndex mapping weekday 0–6 to a multiplier.
 */
export function computeSeasonality(sales: PosSalesRow[]): SeasonalityIndex {
  // Initialise with neutral multipliers for every weekday
  const defaultIndex: SeasonalityIndex = {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
  };

  if (sales.length === 0) return { ...defaultIndex };

  // Bucket revenues by weekday
  const buckets: Record<number, number[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };

  for (const row of sales) {
    const wd = weekdayOf(row.date);
    if (wd === null) continue; // skip rows with unparseable dates
    buckets[wd].push(row.revenue);
  }

  // Overall average (across all valid rows)
  const allRevenues = Object.values(buckets).flat();
  const overallAvg = mean(allRevenues);

  // Guard against division-by-zero when all revenues are 0
  if (overallAvg === 0) return { ...defaultIndex };

  const index: SeasonalityIndex = { ...defaultIndex };
  for (let wd = 0; wd <= 6; wd++) {
    const wdRevenues = buckets[wd];
    if (wdRevenues.length === 0) {
      // No data for this weekday → neutral
      index[wd] = 1;
    } else {
      index[wd] = mean(wdRevenues) / overallAvg;
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// 2. Linear trend detection (OLS regression)
// ---------------------------------------------------------------------------

/**
 * Fit an Ordinary Least Squares (OLS) linear regression to time-series revenue
 * data and classify the result as growing / flat / declining.
 *
 * Model: revenue = slope × dayIndex + intercept
 *
 * The X-axis is the number of days since the Unix epoch so that the intercept
 * retains a meaningful (though large) value. Callers typically care only about
 * slope and direction.
 *
 * Thresholds for direction:
 *  - |slope| < 1 (less than $1/day change) → "flat"
 *  - slope ≥ 1 → "growing"
 *  - slope ≤ -1 → "declining"
 *
 * Edge cases:
 *  - Fewer than 2 data points → slope 0, intercept = mean revenue (or 0), R² 0, direction "flat".
 *  - All X values identical (degenerate) → same fallback.
 *  - Rows with invalid dates are silently skipped.
 *
 * @param sales - Array of POS sales rows. Internally sorted by date ascending.
 * @returns TrendResult with slope, intercept, r2, and direction.
 */
export function computeTrend(sales: PosSalesRow[]): TrendResult {
  const FLAT_RESULT: TrendResult = {
    slope: 0,
    intercept: 0,
    r2: 0,
    direction: "flat",
  };

  if (sales.length === 0) return { ...FLAT_RESULT };

  // Build (x, y) pairs, skipping invalid dates
  const points: { x: number; y: number }[] = [];
  for (const row of sales) {
    const d = parseDate(row.date);
    if (d === null) continue;
    points.push({ x: toDayIndex(d), y: row.revenue });
  }

  if (points.length < 2) {
    return {
      ...FLAT_RESULT,
      intercept: points.length === 1 ? points[0].y : 0,
    };
  }

  // Sort ascending by day index
  points.sort((a, b) => a.x - b.x);

  const n = points.length;
  const xValues = points.map((p) => p.x);
  const yValues = points.map((p) => p.y);

  const xMean = mean(xValues);
  const yMean = mean(yValues);

  // Σ(xi - x̄)(yi - ȳ)
  let sxy = 0;
  // Σ(xi - x̄)²
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xValues[i] - xMean;
    const dy = yValues[i] - yMean;
    sxy += dx * dy;
    sxx += dx * dx;
  }

  // Guard against degenerate case where all x values are identical
  if (sxx === 0) {
    return { ...FLAT_RESULT, intercept: yMean };
  }

  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;

  // Compute R²
  // R² = 1 - SS_res / SS_tot
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xValues[i] + intercept;
    ssRes += (yValues[i] - predicted) ** 2;
    ssTot += (yValues[i] - yMean) ** 2;
  }

  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  // Classify direction
  let direction: TrendResult["direction"];
  if (slope >= 1) {
    direction = "growing";
  } else if (slope <= -1) {
    direction = "declining";
  } else {
    direction = "flat";
  }

  return { slope, intercept, r2, direction };
}

// ---------------------------------------------------------------------------
// 3. Weighted moving average (WMA)
// ---------------------------------------------------------------------------

/**
 * Compute a 7-day Weighted Moving Average (WMA) over the most recent `days`
 * data points, using weights [1, 1, 1, 2, 2, 3, 4] (oldest → newest).
 *
 * The result is the WMA of daily revenues — a single smoothed revenue estimate
 * representing "likely revenue on the next day".
 *
 * Edge cases:
 *  - Fewer than 7 rows: uses available rows, trimming weights from the front.
 *  - Empty input → returns 0.
 *  - Rows with invalid dates are silently skipped before sorting.
 *
 * @param sales - POS sales rows (will be sorted internally by date descending).
 * @param days  - How many of the most recent rows to consider (default 7).
 * @returns Smoothed revenue estimate as a number.
 */
export function computeWMA(sales: PosSalesRow[], days = 7): number {
  if (sales.length === 0) return 0;

  // Filter out rows with invalid dates, then sort by date descending
  const valid = sales
    .filter((r) => parseDate(r.date) !== null)
    .sort((a, b) => {
      // descending: most recent first
      const da = parseDate(a.date)!;
      const db = parseDate(b.date)!;
      return db.getTime() - da.getTime();
    });

  if (valid.length === 0) return 0;

  // Take the most recent `days` rows
  const recent = valid.slice(0, Math.min(days, valid.length));

  // Reverse so index 0 is oldest (aligns with weight array)
  const chronological = [...recent].reverse();

  // Full weight array for 7 days (oldest → newest)
  const WEIGHTS_7 = [1, 1, 1, 2, 2, 3, 4];

  // Trim weight array to match available data length
  const n = chronological.length;
  const weights = WEIGHTS_7.slice(WEIGHTS_7.length - n);

  const weightSum = weights.reduce((acc, w) => acc + w, 0);

  // Guard against zero weight sum (should not happen with hardcoded weights, but be safe)
  if (weightSum === 0) return 0;

  let wmaRevenue = 0;
  for (let i = 0; i < n; i++) {
    wmaRevenue += chronological[i].revenue * weights[i];
  }

  return wmaRevenue / weightSum;
}

// ---------------------------------------------------------------------------
// 4 & 5. Core enhancement engine
// ---------------------------------------------------------------------------

/** Minimum number of historical sales rows to give high confidence. */
const HIGH_CONFIDENCE_THRESHOLD = 30;

/** Minimum rows for any meaningful statistical inference. */
const MIN_ROWS_FOR_STATS = 7;

/** Slope magnitude ($/day) threshold below which trend is treated as flat. */
const FLAT_SLOPE_THRESHOLD = 1;

/** Efficiency deviation fraction that triggers a flag (0.20 = 20 %). */
const EFFICIENCY_DEVIATION_THRESHOLD = 0.2;

/**
 * Apply all forecast enhancements (seasonality, trend, WMA, efficiency, capacity
 * gap) to a base forecast and return enriched DemandRecommendation objects.
 *
 * ### Adjustments applied (in order):
 *
 * 1. **Seasonality** — multiply baseRequired by the day-of-week index.
 * 2. **Trend** — if slope is statistically meaningful (R² ≥ 0.3), project
 *    revenue at target date using the OLS line, compute a scaling ratio vs.
 *    recent WMA, and scale adjusted headcount proportionally.
 * 3. **Efficiency flag** — compute revenue-per-worker-hour for each date;
 *    if it deviates >20 % from the historical average, append a reason string.
 * 4. **Capacity gap** — estimate workers_needed from projected revenue ÷
 *    avg-revenue-per-worker-hour; if gap vs scheduled > 0.5 workers, append a
 *    capacity warning reason.
 *
 * ### Confidence score
 * - 0.0  → no sales data at all
 * - 0.5  → fewer than MIN_ROWS_FOR_STATS rows
 * - 0.75 → MIN_ROWS_FOR_STATS ≤ rows < HIGH_CONFIDENCE_THRESHOLD
 * - 1.0  → ≥ HIGH_CONFIDENCE_THRESHOLD rows
 *
 * ### Edge cases
 * - Empty sales array → returns base forecast unchanged with confidence 0.
 * - Empty baseForecast → returns [].
 * - Missing scheduledHours for a date → treated as 0 (efficiency n/a).
 * - Division by zero guarded throughout.
 *
 * @param baseForecast        - Array of {date, role, required} from the existing demand engine.
 * @param sales               - Historical POS sales rows (any date range).
 * @param scheduledHoursByDate - Map of date string → total scheduled worker-hours that day.
 * @returns Array of DemandRecommendation, one per item in baseForecast.
 */
export function applyForecastEnhancements(
  baseForecast: { date: string; role: string; required: number }[],
  sales: PosSalesRow[],
  scheduledHoursByDate: Record<string, number>
): DemandRecommendation[] {
  // --- No base forecast ---
  if (baseForecast.length === 0) return [];

  // --- Confidence score based on available data volume ---
  let confidence: number;
  if (sales.length === 0) {
    confidence = 0;
  } else if (sales.length < MIN_ROWS_FOR_STATS) {
    confidence = 0.5;
  } else if (sales.length < HIGH_CONFIDENCE_THRESHOLD) {
    confidence = 0.75;
  } else {
    confidence = 1.0;
  }

  // --- No sales data: return base forecast unchanged ---
  if (sales.length === 0) {
    return baseForecast.map((item) => ({
      date: item.date,
      role: item.role,
      baseRequired: item.required,
      adjustedRequired: item.required,
      confidence: 0,
      reasons: ["No historical sales data available; using base forecast only."],
    }));
  }

  // --- Pre-compute statistics (once, not per item) ---

  const seasonality = computeSeasonality(sales);
  const trend = computeTrend(sales);
  const wmaRevenue = computeWMA(sales);

  // Revenue-per-worker-hour: collect ratios for all dates that have both
  // revenue data and scheduled hours
  const salesByDate: Record<string, PosSalesRow> = {};
  for (const row of sales) {
    salesByDate[row.date] = row;
  }

  const efficiencyRatios: number[] = [];
  for (const [date, hours] of Object.entries(scheduledHoursByDate)) {
    if (hours > 0 && salesByDate[date] !== undefined) {
      efficiencyRatios.push(salesByDate[date].revenue / hours);
    }
  }
  const avgEfficiency = mean(efficiencyRatios); // $/hr; 0 if no data

  // --- Process each base forecast item ---
  return baseForecast.map((item) => {
    const reasons: string[] = [];
    let adjusted = item.required; // start from base

    // ------------------------------------------------------------------ //
    // Step 1: Seasonality adjustment
    // ------------------------------------------------------------------ //
    const wd = weekdayOf(item.date);
    if (wd !== null) {
      const multiplier = seasonality[wd] ?? 1;
      if (multiplier !== 1) {
        const prev = adjusted;
        adjusted = adjusted * multiplier;
        reasons.push(
          `Seasonality (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][wd]}): ` +
          `×${multiplier.toFixed(2)} (${multiplier > 1 ? "above" : "below"} average traffic day); ` +
          `${prev.toFixed(2)} → ${adjusted.toFixed(2)} workers.`
        );
      } else {
        reasons.push(
          `Seasonality (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][wd]}): ×1.00 (average day).`
        );
      }
    } else {
      reasons.push("Seasonality: skipped (unparseable date).");
    }

    // ------------------------------------------------------------------ //
    // Step 2: Trend-based scaling
    // ------------------------------------------------------------------ //
    if (sales.length < MIN_ROWS_FOR_STATS) {
      reasons.push("Trend: skipped (insufficient historical data — need ≥7 days).");
    } else if (trend.r2 < 0.3) {
      reasons.push(
        `Trend: not applied (R²=${trend.r2.toFixed(2)} < 0.30 — relationship too weak).`
      );
    } else if (trend.direction === "flat" || Math.abs(trend.slope) < FLAT_SLOPE_THRESHOLD) {
      reasons.push(
        `Trend: flat (slope=${trend.slope.toFixed(2)} $/day, R²=${trend.r2.toFixed(2)}).`
      );
    } else {
      // Project revenue on the target date using OLS
      const targetDate = parseDate(item.date);
      if (targetDate !== null && wmaRevenue > 0) {
        const targetDayIdx = toDayIndex(targetDate);
        const projectedRevenue = trend.slope * targetDayIdx + trend.intercept;

        // Scale ratio: how much higher/lower than the recent WMA baseline?
        const trendScaleRatio = projectedRevenue / wmaRevenue;

        // Clamp ratio to [0.5, 2.0] to avoid extreme swings from noisy data
        const clampedRatio = Math.max(0.5, Math.min(2.0, trendScaleRatio));

        const prev = adjusted;
        adjusted = adjusted * clampedRatio;
        reasons.push(
          `Trend: ${trend.direction} (slope=${trend.slope.toFixed(2)} $/day, R²=${trend.r2.toFixed(2)}); ` +
          `projected revenue $${projectedRevenue.toFixed(0)} vs WMA $${wmaRevenue.toFixed(0)}; ` +
          `scale ×${clampedRatio.toFixed(2)}; ${prev.toFixed(2)} → ${adjusted.toFixed(2)} workers.`
        );
      } else {
        reasons.push("Trend: skipped (unparseable date or zero WMA baseline).");
      }
    }

    // ------------------------------------------------------------------ //
    // Step 3: Revenue-per-worker-hour efficiency flag
    // ------------------------------------------------------------------ //
    const scheduledHours = scheduledHoursByDate[item.date] ?? 0;
    const dayRevenue = salesByDate[item.date]?.revenue;

    if (scheduledHours > 0 && dayRevenue !== undefined && avgEfficiency > 0) {
      const dayEfficiency = dayRevenue / scheduledHours;
      const deviation = (dayEfficiency - avgEfficiency) / avgEfficiency;

      if (Math.abs(deviation) > EFFICIENCY_DEVIATION_THRESHOLD) {
        const pct = (deviation * 100).toFixed(1);
        const direction = deviation > 0 ? "above" : "below";
        reasons.push(
          `Efficiency alert: $${dayEfficiency.toFixed(2)}/hr is ${Math.abs(parseFloat(pct)).toFixed(1)}% ` +
          `${direction} average $${avgEfficiency.toFixed(2)}/hr — ` +
          `${deviation > 0 ? "strong revenue day, consider extra coverage" : "low revenue day, review staffing levels"}.`
        );
      }
    } else if (scheduledHours === 0) {
      reasons.push("Efficiency: no scheduled hours recorded for this date.");
    } else {
      reasons.push("Efficiency: insufficient data for efficiency calculation.");
    }

    // ------------------------------------------------------------------ //
    // Step 4: Capacity gap alert
    // ------------------------------------------------------------------ //
    if (avgEfficiency > 0 && wmaRevenue > 0) {
      // Use projected revenue on the target date (or WMA if trend not reliable)
      let projectedForCapacity = wmaRevenue;

      if (trend.r2 >= 0.3 && trend.direction !== "flat") {
        const targetDate = parseDate(item.date);
        if (targetDate !== null) {
          const rawProjected = trend.slope * toDayIndex(targetDate) + trend.intercept;
          // Only use OLS projection if it's positive (sanity check)
          if (rawProjected > 0) {
            projectedForCapacity = rawProjected;
          }
        }
      }

      // Apply seasonality to projected revenue so capacity is weekday-aware
      const seaMultiplier = wd !== null ? (seasonality[wd] ?? 1) : 1;
      const seasonalProjected = projectedForCapacity * seaMultiplier;

      // Assume workers work ~8-hour shifts; convert projected revenue to workers needed
      const ASSUMED_SHIFT_HOURS = 8;
      const workersNeeded = seasonalProjected / (avgEfficiency * ASSUMED_SHIFT_HOURS);

      // scheduledWorkers: derive from scheduled hours assuming same 8-hr shift
      const scheduledWorkers = scheduledHours / ASSUMED_SHIFT_HOURS;

      const gap = workersNeeded - scheduledWorkers;
      if (gap > 0.5) {
        reasons.push(
          `Capacity gap: projected revenue $${seasonalProjected.toFixed(0)} ` +
          `needs ~${workersNeeded.toFixed(1)} workers but only ` +
          `${scheduledWorkers.toFixed(1)} scheduled — ` +
          `consider adding ${Math.ceil(gap)} worker(s).`
        );
        // Nudge adjusted upward if capacity model suggests more than current adjusted
        if (Math.ceil(workersNeeded) > adjusted) {
          const prev = adjusted;
          adjusted = Math.ceil(workersNeeded);
          reasons.push(
            `Capacity model raised requirement: ${prev.toFixed(2)} → ${adjusted} workers.`
          );
        }
      } else if (gap < -0.5) {
        reasons.push(
          `Capacity surplus: projected revenue suggests ` +
          `~${workersNeeded.toFixed(1)} workers needed; ` +
          `${scheduledWorkers.toFixed(1)} scheduled — possible over-staffing.`
        );
      } else {
        reasons.push(
          `Capacity: staffing looks balanced (gap=${gap.toFixed(2)} workers).`
        );
      }
    } else {
      reasons.push("Capacity gap: skipped (insufficient revenue or efficiency data).");
    }

    // ------------------------------------------------------------------ //
    // Finalise: round up to whole workers, ensure ≥ 0
    // ------------------------------------------------------------------ //
    const adjustedRequired = Math.max(0, Math.ceil(adjusted));

    return {
      date: item.date,
      role: item.role,
      baseRequired: item.required,
      adjustedRequired,
      confidence,
      reasons,
    };
  });
}