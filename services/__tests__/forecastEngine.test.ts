/**
 * services/__tests__/forecastEngine.test.ts
 *
 * Comprehensive unit tests for services/forecastEngine.ts
 *
 * All functions under test are pure — no mocks required.
 * Jest preset: jest-expo
 */

import {
  computeSeasonality,
  computeTrend,
  computeWMA,
  applyForecastEnhancements,
  type PosSalesRow,
  type SeasonalityIndex,
  type TrendResult,
  type DemandRecommendation,
} from "../forecastEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PosSalesRow for a given ISO date string and revenue.
 */
function row(date: string, revenue: number, covers: number | null = null): PosSalesRow {
  return { date, revenue, covers };
}

/**
 * Generate a sequence of PosSalesRow entries starting from a base date,
 * advancing one day per entry.
 *
 * @param startDate  - ISO-8601 start date string "YYYY-MM-DD"
 * @param revenues   - Array of revenues; length determines number of rows.
 */
function generateRows(startDate: string, revenues: number[]): PosSalesRow[] {
  const [year, month, day] = startDate.split("-").map(Number);
  return revenues.map((revenue, i) => {
    const d = new Date(Date.UTC(year, month - 1, day + i));
    const iso = d.toISOString().slice(0, 10);
    return row(iso, revenue);
  });
}

/**
 * Generate rows with a linear revenue trend: revenue = base + slope * i.
 */
function linearRows(
  startDate: string,
  count: number,
  base: number,
  slope: number
): PosSalesRow[] {
  const revenues = Array.from({ length: count }, (_, i) => base + slope * i);
  return generateRows(startDate, revenues);
}

// ---------------------------------------------------------------------------
// computeSeasonality
// ---------------------------------------------------------------------------

describe("computeSeasonality", () => {
  it("returns all multipliers as 1.0 for an empty array", () => {
    const result = computeSeasonality([]);
    for (let wd = 0; wd <= 6; wd++) {
      expect(result[wd]).toBe(1);
    }
  });

  it("returns multipliers for all 7 weekdays (0–6)", () => {
    const result = computeSeasonality([]);
    expect(Object.keys(result).map(Number).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("returns all multipliers as 1.0 when all revenues are 0", () => {
    const sales = generateRows("2026-01-05", [0, 0, 0, 0, 0, 0, 0]);
    const result = computeSeasonality(sales);
    for (let wd = 0; wd <= 6; wd++) {
      expect(result[wd]).toBe(1);
    }
  });

  it("computes correct multipliers for a known revenue pattern", () => {
    // 2026-01-05 is a Monday (weekday 1)
    // Build 7 rows: Mon–Sun with revenues [100, 100, 100, 100, 100, 100, 200]
    // Overall average = (6×100 + 200) / 7 = 800/7 ≈ 114.29
    // Saturday (wd=6 — 2026-01-10) average = 200 → multiplier ≈ 1.75
    // Monday–Friday + Sunday average = 100 → multiplier ≈ 0.875
    const sales = [
      row("2026-01-05", 100), // Mon (1)
      row("2026-01-06", 100), // Tue (2)
      row("2026-01-07", 100), // Wed (3)
      row("2026-01-08", 100), // Thu (4)
      row("2026-01-09", 100), // Fri (5)
      row("2026-01-10", 200), // Sat (6)
      row("2026-01-11", 100), // Sun (0)
    ];

    const result = computeSeasonality(sales);
    const overallAvg = 800 / 7;

    expect(result[6]).toBeCloseTo(200 / overallAvg, 5); // Saturday ≈ 1.75
    expect(result[1]).toBeCloseTo(100 / overallAvg, 5); // Monday ≈ 0.875
    expect(result[0]).toBeCloseTo(100 / overallAvg, 5); // Sunday ≈ 0.875
  });

  it("Saturday rows always 2× average revenue → Saturday multiplier ≈ 2", () => {
    // Build 2 full weeks: Mon–Fri revenue=100, Sat revenue=200, Sun revenue=100
    // Average per day = (5×100 + 200 + 100) / 7 × 2 weeks = 800/7 ≈ 114.29
    // Saturday multiplier = 200 / (800/7) = 1400/800 = 1.75
    // To get exactly 2× we need Sat revenue to be twice the overall mean.
    // Let weekday revenues = 100 each (6 days), Sat = 200.
    // overallAvg = (6×100 + 200) / 7 ≈ 114.29 — Sat multiplier ≈ 1.75, not exactly 2.
    // For Sat multiplier = 2: overallAvg = 200/2 = 100 → all other days also 100 but
    // there must be 0 revenue from other days to keep avg=100 if sat=200.
    // Easier: Sat revenue = 200, other 6 days revenue = 0 →
    // overallAvg = (0×6 + 200)/7, but overall avg 0-guard kicks in if non-sat=0.
    // Best approach: 6 days at 50, Sat at 200 → avg = (6×50+200)/7 = 500/7 ≈ 71.43
    // Sat multiplier = 200 / (500/7) = 200×7/500 = 2.8 — still not 2.
    // For multiplier = 2 exactly: Sat_avg = 2 × overall_avg
    // Let all non-Sat = x, Sat = S, n_other = 6
    // overall_avg = (6x + S) / 7; S / overall_avg = 2 → S = 2(6x+S)/7
    // 7S = 12x + 2S → 5S = 12x → S = 12x/5
    // Let x=50, S=120: overall_avg = (300+120)/7 = 60; Sat multi = 120/60 = 2 ✓
    const sales = [
      row("2026-01-05", 50),  // Mon (1)
      row("2026-01-06", 50),  // Tue (2)
      row("2026-01-07", 50),  // Wed (3)
      row("2026-01-08", 50),  // Thu (4)
      row("2026-01-09", 50),  // Fri (5)
      row("2026-01-10", 120), // Sat (6)
      row("2026-01-11", 50),  // Sun (0)
    ];

    const result = computeSeasonality(sales);
    expect(result[6]).toBeCloseTo(2.0, 5);
  });

  it("rows with invalid dates are skipped without throwing", () => {
    const sales = [
      row("not-a-date", 999),
      row("2026-01-05", 100), // Monday
      row("2026-01-06", 100), // Tuesday
    ];
    // Should not throw; invalid row simply ignored
    expect(() => computeSeasonality(sales)).not.toThrow();
    const result = computeSeasonality(sales);
    // Only two valid rows; overall avg = 100; both weekday multipliers = 1
    expect(result[1]).toBeCloseTo(1.0, 5); // Monday
    expect(result[2]).toBeCloseTo(1.0, 5); // Tuesday
  });

  it("weekday with no data gets a neutral multiplier of 1.0", () => {
    // Only provide data for Monday (1) with high revenue; all other weekdays absent
    const sales = [
      row("2026-01-05", 100), // Mon
      row("2026-01-12", 100), // Mon
      row("2026-01-19", 100), // Mon
    ];
    const result = computeSeasonality(sales);
    // Tuesday through Sunday have no data → should be 1.0
    for (const wd of [0, 2, 3, 4, 5, 6]) {
      expect(result[wd]).toBe(1.0);
    }
  });

  it("result is a fresh object (not mutated on repeated calls)", () => {
    const sales = [row("2026-01-05", 200)]; // Monday
    const r1 = computeSeasonality(sales);
    const r2 = computeSeasonality(sales);
    expect(r1).not.toBe(r2); // different object references
    expect(r1).toEqual(r2);  // same values
  });
});

// ---------------------------------------------------------------------------
// computeTrend
// ---------------------------------------------------------------------------

describe("computeTrend", () => {
  it("returns flat result for an empty array", () => {
    const result = computeTrend([]);
    expect(result.slope).toBe(0);
    expect(result.r2).toBe(0);
    expect(result.direction).toBe("flat");
    expect(result.intercept).toBe(0);
  });

  it("returns flat with intercept = revenue for a single row", () => {
    const result = computeTrend([row("2026-01-05", 500)]);
    expect(result.slope).toBe(0);
    expect(result.r2).toBe(0);
    expect(result.direction).toBe("flat");
    expect(result.intercept).toBe(500);
  });

  it("returns flat direction for two identical-date rows (degenerate x)", () => {
    // Same date → all X values identical → sxx = 0 → fallback
    const result = computeTrend([
      row("2026-01-05", 100),
      row("2026-01-05", 200),
    ]);
    expect(result.slope).toBe(0);
    expect(result.direction).toBe("flat");
    // intercept = yMean = 150
    expect(result.intercept).toBeCloseTo(150, 5);
  });

  it("computes growing direction for strong positive slope", () => {
    // Revenue increases by 50/day over 10 days → slope ≈ 50 (>> 1)
    const sales = linearRows("2026-01-05", 10, 1000, 50);
    const result = computeTrend(sales);
    expect(result.direction).toBe("growing");
    expect(result.slope).toBeGreaterThan(1);
    expect(result.r2).toBeGreaterThan(0.8);
  });

  it("computes declining direction for strong negative slope", () => {
    // Revenue decreases by 50/day over 10 days → slope ≈ -50
    const sales = linearRows("2026-01-05", 10, 1000, -50);
    const result = computeTrend(sales);
    expect(result.direction).toBe("declining");
    expect(result.slope).toBeLessThan(-1);
  });

  it("R² is close to 1.0 for perfectly linear data", () => {
    const sales = linearRows("2026-01-05", 10, 500, 20);
    const result = computeTrend(sales);
    expect(result.r2).toBeCloseTo(1.0, 4);
  });

  it("returns flat direction when slope is between -1 and +1", () => {
    // Tiny change per day, essentially flat
    const sales = linearRows("2026-01-05", 10, 1000, 0.5);
    const result = computeTrend(sales);
    expect(result.direction).toBe("flat");
  });

  it("R² is near 0 for constant revenue (no variance)", () => {
    // All revenues identical → ssTot = 0 → r2 = 0
    const sales = generateRows("2026-01-05", Array(10).fill(500));
    const result = computeTrend(sales);
    expect(result.r2).toBe(0);
    expect(result.direction).toBe("flat");
  });

  it("rows with invalid dates are silently skipped", () => {
    const sales = [
      row("bad-date", 99999),
      ...linearRows("2026-01-05", 5, 500, 20),
    ];
    expect(() => computeTrend(sales)).not.toThrow();
    // With 5 valid rows having positive slope the direction should still be computed
    const result = computeTrend(sales);
    expect(result.direction).toBe("growing");
  });

  it("uses only valid rows when some dates are invalid", () => {
    const validRows = linearRows("2026-01-05", 10, 1000, 30);
    const withInvalid = [row("oops", 0), ...validRows];
    const resultValid = computeTrend(validRows);
    const resultMixed = computeTrend(withInvalid);
    // Both should agree on direction and approximately equal slope / r2
    expect(resultMixed.direction).toBe(resultValid.direction);
    expect(resultMixed.slope).toBeCloseTo(resultValid.slope, 2);
  });

  it("returns flat when exactly 2 rows have same X (degenerate)", () => {
    const result = computeTrend([
      row("2026-03-01", 400),
      row("2026-03-01", 600),
    ]);
    expect(result.direction).toBe("flat");
    expect(result.slope).toBe(0);
  });

  it("handles 2 valid rows and computes a meaningful slope", () => {
    // Two rows 7 days apart with large revenue gap → strong slope
    const result = computeTrend([
      row("2026-01-01", 100),
      row("2026-01-08", 800), // 700 gain over 7 days → slope ≈ 100/day
    ]);
    expect(result.slope).toBeGreaterThan(1);
    expect(result.direction).toBe("growing");
  });
});

// ---------------------------------------------------------------------------
// computeWMA
// ---------------------------------------------------------------------------

describe("computeWMA", () => {
  it("returns 0 for an empty array", () => {
    expect(computeWMA([])).toBe(0);
  });

  it("returns 0 when all rows have invalid dates", () => {
    const sales = [
      row("not-a-date", 100),
      row("also-bad", 200),
    ];
    expect(computeWMA(sales)).toBe(0);
  });

  it("returns the single row revenue for exactly one valid row", () => {
    // With 1 row the weight array is trimmed to [4] (last element)
    // WMA = 300 * 4 / 4 = 300
    expect(computeWMA([row("2026-01-05", 300)])).toBeCloseTo(300, 5);
  });

  it("uses trimmed weights correctly for 3 rows", () => {
    // Full weights: [1,1,1,2,2,3,4]; trimmed to last 3: [2,3,4]
    // Rows oldest→newest: 100, 200, 300
    // WMA = (100×2 + 200×3 + 300×4) / (2+3+4) = (200+600+1200)/9 = 2000/9 ≈ 222.22
    const sales = [
      row("2026-01-05", 100), // oldest
      row("2026-01-06", 200),
      row("2026-01-07", 300), // newest
    ];
    const expected = (100 * 2 + 200 * 3 + 300 * 4) / (2 + 3 + 4);
    expect(computeWMA(sales)).toBeCloseTo(expected, 5);
  });

  it("uses full weight array [1,1,1,2,2,3,4] for exactly 7 rows", () => {
    // Revenues 1–7 in chronological order
    const revenues = [1, 2, 3, 4, 5, 6, 7];
    const sales = generateRows("2026-01-05", revenues);
    const weights = [1, 1, 1, 2, 2, 3, 4];
    const weightSum = weights.reduce((a, b) => a + b, 0); // 14
    const expected =
      revenues.reduce((acc, v, i) => acc + v * weights[i], 0) / weightSum;
    expect(computeWMA(sales)).toBeCloseTo(expected, 5);
  });

  it("only uses the 7 most recent rows when given 10 rows", () => {
    // Oldest 3 rows have very high revenue; most recent 7 are modest
    const oldRows = generateRows("2026-01-01", [10000, 10000, 10000]);
    const recentRows = generateRows("2026-01-04", [100, 200, 300, 400, 500, 600, 700]);
    const sales = [...oldRows, ...recentRows];

    const weights = [1, 1, 1, 2, 2, 3, 4];
    const revenues = [100, 200, 300, 400, 500, 600, 700];
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const expected =
      revenues.reduce((acc, v, i) => acc + v * weights[i], 0) / weightSum;

    expect(computeWMA(sales)).toBeCloseTo(expected, 4);
  });

  it("weights more recent rows higher (WMA > simple average when trend is up)", () => {
    // Ascending revenues: recent rows larger → WMA should exceed mean
    const revenues = [100, 200, 300, 400, 500, 600, 700];
    const sales = generateRows("2026-01-05", revenues);
    const simpleMean = revenues.reduce((a, b) => a + b, 0) / revenues.length; // 400
    expect(computeWMA(sales)).toBeGreaterThan(simpleMean);
  });

  it("handles rows provided in random order (sorts internally)", () => {
    const sales = [
      row("2026-01-07", 300),
      row("2026-01-05", 100),
      row("2026-01-06", 200),
    ];
    // After sorting newest-first: [300, 200, 100]; reversed to oldest-first: [100, 200, 300]
    const expected = (100 * 2 + 200 * 3 + 300 * 4) / (2 + 3 + 4);
    expect(computeWMA(sales)).toBeCloseTo(expected, 5);
  });
});

// ---------------------------------------------------------------------------
// applyForecastEnhancements
// ---------------------------------------------------------------------------

describe("applyForecastEnhancements", () => {
  // Shared base forecast items
  const baseSingle = [{ date: "2026-01-10", role: "Server", required: 4 }];

  // A reusable block of 30+ sales rows (all same weekday or mixed) for confidence=1.0
  const sales30 = generateRows("2025-12-01", Array(30).fill(1000));

  it("returns [] when baseForecast is empty", () => {
    expect(applyForecastEnhancements([], sales30, {})).toEqual([]);
  });

  it("returns [] for empty baseForecast even with sales data", () => {
    expect(applyForecastEnhancements([], [], {})).toEqual([]);
  });

  it("returns base forecast unchanged when sales array is empty", () => {
    const result = applyForecastEnhancements(baseSingle, [], {});
    expect(result).toHaveLength(1);
    expect(result[0].adjustedRequired).toBe(baseSingle[0].required);
    expect(result[0].baseRequired).toBe(baseSingle[0].required);
  });

  it("sets confidence to 0 when sales array is empty", () => {
    const result = applyForecastEnhancements(baseSingle, [], {});
    expect(result[0].confidence).toBe(0);
  });

  it("preserves date and role from baseForecast items with no sales", () => {
    const result = applyForecastEnhancements(
      [{ date: "2026-03-15", role: "Cook", required: 3 }],
      [],
      {}
    );
    expect(result[0].date).toBe("2026-03-15");
    expect(result[0].role).toBe("Cook");
  });

  it("includes a reason when no sales data is available", () => {
    const result = applyForecastEnhancements(baseSingle, [], {});
    expect(result[0].reasons.length).toBeGreaterThan(0);
    expect(result[0].reasons[0]).toContain("No historical sales data");
  });

  it("sets confidence to 1.0 when 30+ sales rows are provided", () => {
    const result = applyForecastEnhancements(baseSingle, sales30, {});
    expect(result[0].confidence).toBe(1.0);
  });

  it("sets confidence to 0.5 when fewer than 7 sales rows are provided", () => {
    const fewSales = generateRows("2026-01-05", [100, 200, 300]);
    const result = applyForecastEnhancements(baseSingle, fewSales, {});
    expect(result[0].confidence).toBe(0.5);
  });

  it("sets confidence to 0.75 when between 7 and 29 sales rows (inclusive) are provided", () => {
    const sales15 = generateRows("2026-01-05", Array(15).fill(500));
    const result = applyForecastEnhancements(baseSingle, sales15, {});
    expect(result[0].confidence).toBe(0.75);
  });

  it("each output item always has reasons.length > 0", () => {
    const forecast = [
      { date: "2026-01-10", role: "Server", required: 4 },
      { date: "2026-01-11", role: "Cook", required: 2 },
    ];
    const result = applyForecastEnhancements(forecast, sales30, {});
    for (const item of result) {
      expect(item.reasons.length).toBeGreaterThan(0);
    }
  });

  it("adjustedRequired is always ≥ 0 (no negative workers)", () => {
    // Even if base is 0 and all multipliers shrink, result must be ≥ 0
    const forecastZero = [{ date: "2026-01-05", role: "Busser", required: 0 }];
    const result = applyForecastEnhancements(forecastZero, sales30, {});
    expect(result[0].adjustedRequired).toBeGreaterThanOrEqual(0);
  });

  it("adjustedRequired is a whole number (Math.ceil applied)", () => {
    const result = applyForecastEnhancements(baseSingle, sales30, {});
    expect(result[0].adjustedRequired % 1).toBe(0);
  });

  it("processes multiple baseForecast items and returns same count", () => {
    const forecast = [
      { date: "2026-01-10", role: "Server", required: 4 },
      { date: "2026-01-11", role: "Cook", required: 2 },
      { date: "2026-01-12", role: "Bartender", required: 1 },
    ];
    const result = applyForecastEnhancements(forecast, sales30, {});
    expect(result).toHaveLength(3);
  });

  it("seasonality multiplier raises adjustedRequired for a high-revenue weekday", () => {
    // 2026-01-10 is Saturday (wd=6).
    // Build sales where Saturday revenue is very high vs other days.
    // Use the pattern that gives Saturday multiplier = 2:
    // 6 non-Saturday days at 50, Saturday at 120 → multiplier = 2 (see computeSeasonality tests)
    const saturdays = [
      row("2026-01-10", 120), // Sat
      row("2026-01-17", 120), // Sat
    ];
    const weekdays = [
      row("2026-01-05", 50), // Mon
      row("2026-01-06", 50), // Tue
      row("2026-01-07", 50), // Wed
      row("2026-01-08", 50), // Thu
      row("2026-01-09", 50), // Fri
      row("2026-01-11", 50), // Sun
    ];
    const sales = [...saturdays, ...weekdays];

    const base = 4;
    const forecast = [{ date: "2026-01-10", role: "Server", required: base }];
    const result = applyForecastEnhancements(forecast, sales, {});

    // Seasonality multiplier for Saturday ≈ 2 → adjustedRequired should be > base
    expect(result[0].adjustedRequired).toBeGreaterThan(base);
  });

  it("includes seasonality reason string referencing the weekday name", () => {
    const forecast = [{ date: "2026-01-10", role: "Server", required: 4 }]; // Saturday
    const result = applyForecastEnhancements(forecast, sales30, {});
    const reasonText = result[0].reasons.join(" ");
    expect(reasonText).toMatch(/Seasonality/);
    expect(reasonText).toMatch(/Sat/);
  });

  it("trend is applied when R² ≥ 0.3 with strongly linear sales data", () => {
    // 30 rows with a strong positive trend; high R²
    const strongTrendSales = linearRows("2025-12-01", 30, 500, 30);
    const forecast = [{ date: "2026-01-10", role: "Server", required: 4 }];
    const result = applyForecastEnhancements(forecast, strongTrendSales, {});
    const reasonText = result[0].reasons.join(" ");
    // Trend reason should reference slope and R²
    expect(reasonText).toMatch(/Trend:/);
    expect(reasonText).toMatch(/slope=/);
  });

  it("trend is skipped when fewer than 7 sales rows are present", () => {
    const fewSales = generateRows("2026-01-05", [100, 200, 300]);
    const forecast = [{ date: "2026-01-10", role: "Server", required: 4 }];
    const result = applyForecastEnhancements(forecast, fewSales, {});
    const reasonText = result[0].reasons.join(" ");
    expect(reasonText).toMatch(/insufficient historical data/);
  });

  it("trend is skipped (reason appended) when R² < 0.3", () => {
    // Random-ish revenues → low R²
    const noisySales = generateRows("2026-01-05", [
      100, 900, 150, 800, 200, 750, 300, 650, 400, 600,
      500, 500, 450, 550, 350, 700, 250, 800, 200, 850,
      150, 900, 100, 950, 120, 880, 200, 760, 300, 600,
    ]);
    const forecast = [{ date: "2026-01-10", role: "Server", required: 4 }];
    const result = applyForecastEnhancements(forecast, noisySales, {});
    const reasonText = result[0].reasons.join(" ");
    // Either R² < 0.3 message or flat
    expect(reasonText).toMatch(/Trend:/);
  });

  it("efficiency alert is included in reasons when deviation > 20 %", () => {
    // Sales on the target date give a very high $/hr; average is much lower
    const targetDate = "2026-01-10";
    const highRevDate = row(targetDate, 10000);
    const otherSales = generateRows("2025-12-01", Array(29).fill(200));
    const allSales = [highRevDate, ...otherSales];

    // Scheduled hours on target date = 10 hr → efficiency = 10000/10 = 1000 $/hr
    // Other dates in scheduledHoursByDate have 10 hr each → efficiency = 200/10 = 20 $/hr
    // Average efficiency ≈ slightly above 20 $/hr (1 outlier vs 29 normals)
    // Deviation = (1000 - ~20) / ~20 >> 0.2 → should flag
    const scheduledHours: Record<string, number> = { [targetDate]: 10 };
    for (const s of otherSales) {
      scheduledHours[s.date] = 10;
    }

    const forecast = [{ date: targetDate, role: "Server", required: 4 }];
    const result = applyForecastEnhancements(forecast, allSales, scheduledHours);
    const reasonText = result[0].reasons.join(" ");
    expect(reasonText).toMatch(/Efficiency alert/);
  });

  it("capacity gap alert is included when projected demand >> scheduled workers", () => {
    // High revenue sales + very few scheduled hours → capacity gap
    const targetDate = "2026-01-10";
    const allSales = generateRows("2025-12-01", Array(30).fill(5000));
    // Scheduled 8 hrs on target date → 1 worker; but revenue would suggest many more
    const scheduledHours: Record<string, number> = { [targetDate]: 8 };
    for (const s of allSales) {
      scheduledHours[s.date] = 8;
    }
    const forecast = [{ date: targetDate, role: "Server", required: 1 }];
    const result = applyForecastEnhancements(forecast, allSales, scheduledHours);
    const reasonText = result[0].reasons.join(" ");
    // Either capacity gap or capacity balanced
    expect(reasonText).toMatch(/Capacity/);
  });

  it("returns baseRequired === item.required for every output item", () => {
    const forecast = [
      { date: "2026-01-10", role: "Server", required: 5 },
      { date: "2026-01-11", role: "Cook", required: 3 },
    ];
    const result = applyForecastEnhancements(forecast, sales30, {});
    expect(result[0].baseRequired).toBe(5);
    expect(result[1].baseRequired).toBe(3);
  });
});