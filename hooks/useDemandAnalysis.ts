import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DemandForecast,
  ForecastFilters,
  loadDemandTargets,
} from '@/services/demandForecast';

import { useRoster } from '@/hooks/useRoster';
import { useShiftTemplates } from '@/hooks/useShiftTemplates';
import { addDaysToKey, isDateKey, todayKey } from '@/utils/dateKeys';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DemandVsPrior = {
  date: string;
  role: string;
  current: number;
  prior: number;
  changePct: number;
};

export type ForecastExplanationEntry = {
  date: string;
  role: string;
  factors: string[];
};

export type ForecastAccuracyEntry = {
  date: string;
  role: string;
  predicted: number;
  actual: number;
  errorPct: number;
};

export type WeeklyDemandSummary = {
  role: string;
  avgRequired: number;
  peakDay: string;
  peakRequired: number;
};

export type ConfidenceIntervalPoint = {
  date: string;
  role: string;
  required: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
};

export type UseDemandAnalysisReturn = {
  demandVsPrior: DemandVsPrior[];
  forecastExplanation: ForecastExplanationEntry[];
  forecastAccuracy: ForecastAccuracyEntry[];
  weeklyDemandSummary: WeeklyDemandSummary[];
  confidenceIntervals: ConfidenceIntervalPoint[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DAY_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

const WEEKEND_DAYS = new Set([0, 6]);

const WEEKDAY_PREMIUM_MULTIPLIERS: Record<number, number> = {
  0: 1.15,
  1: 0.85,
  2: 0.88,
  3: 0.92,
  4: 1.05,
  5: 1.28,
  6: 1.30,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseIsoDate(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function utcWeekday(dateStr: string): number | null {
  const d = parseIsoDate(dateStr);
  return d !== null ? d.getUTCDay() : null;
}

function addDays(dateStr: string, days: number): string | null {
  return isDateKey(dateStr) ? addDaysToKey(dateStr, days) : null;
}

function isoToday(): string {
  return todayKey();
}

function subtractDays(dateStr: string, days: number): string | null {
  return addDays(dateStr, -days);
}

function isoPast(dateStr: string): boolean {
  return dateStr < isoToday();
}

function buildWeekRange(anchorDate: string, offsetWeeks: number): { start: string; end: string } | null {
  const start = subtractDays(anchorDate, offsetWeeks * 7 + 6);
  const end = subtractDays(anchorDate, offsetWeeks * 7);
  if (!start || !end) return null;
  return { start, end };
}

function targetsInRange(
  targets: DemandForecast[],
  start: string,
  end: string,
): DemandForecast[] {
  return targets.filter((t) => t.date >= start && t.date <= end);
}

function toDayIndex(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

function olsTrendPct(targets: DemandForecast[]): number {
  if (targets.length < 2) return 0;
  const sorted = [...targets].sort((a, b) => a.date.localeCompare(b.date));
  const xs = sorted.map((t) => {
    const d = parseIsoDate(t.date);
    return d ? toDayIndex(d) : 0;
  });
  const ys = sorted.map((t) => t.required);
  const n = xs.length;
  const xMean = xs.reduce((s, x) => s + x, 0) / n;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  if (den === 0 || yMean === 0) return 0;
  return (num / den / yMean) * 7 * 100;
}

function weekendPremiumPct(dateStr: string): number {
  const wd = utcWeekday(dateStr);
  if (wd === null) return 0;
  const multiplier = WEEKDAY_PREMIUM_MULTIPLIERS[wd] ?? 1.0;
  return Math.round((multiplier - 1) * 100);
}

function hasExternalSignalNote(target: DemandForecast): string | null {
  if (!target.notes) return null;
  const trimmed = target.notes.trim();
  if (trimmed.length === 0) return null;
  return `External signal: ${trimmed}`;
}

function buildExplanationFactors(
  target: DemandForecast,
  allTargetsForRole: DemandForecast[],
): string[] {
  const factors: string[] = [];

  const wd = utcWeekday(target.date);
  if (wd !== null) {
    const premiumPct = weekendPremiumPct(target.date);
    const dayLabel = DAY_LABELS[wd] ?? 'Unknown';
    if (WEEKEND_DAYS.has(wd)) {
      factors.push(`Weekend premium (${dayLabel}) +${premiumPct}%`);
    } else if (premiumPct < 0) {
      factors.push(`Weekday discount (${dayLabel}) ${premiumPct}%`);
    } else if (premiumPct > 0) {
      factors.push(`Weekday lift (${dayLabel}) +${premiumPct}%`);
    }
  }

  const trendPct = olsTrendPct(allTargetsForRole);
  if (Math.abs(trendPct) >= 1) {
    const sign = trendPct >= 0 ? '+' : '';
    factors.push(`OLS trend ${sign}${trendPct.toFixed(1)}% per week`);
  }

  const externalNote = hasExternalSignalNote(target);
  if (externalNote) {
    factors.push(externalNote);
  }

  if (target.confidence !== undefined) {
    const confPct = Math.round(target.confidence * 100);
    factors.push(`Model confidence ${confPct}%`);
  }

  if (target.source === 'model') {
    factors.push('Source: AI demand model');
  } else if (target.source === 'override') {
    factors.push('Source: Manual override');
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDemandAnalysis(filters?: ForecastFilters): UseDemandAnalysisReturn {
  const [currentWeekTargets, setCurrentWeekTargets] = useState<DemandForecast[]>([]);
  const [priorWeekTargets, setPriorWeekTargets] = useState<DemandForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const accountId = process.env.EXPO_PUBLIC_ACCOUNT_ID ?? '';
  const roster = useRoster(accountId);
  const { shiftTemplates: templates } = useShiftTemplates(accountId);

  const today = useMemo(() => isoToday(), []);

  const currentWeekRange = useMemo(() => buildWeekRange(today, 0), [today]);
  const priorWeekRange = useMemo(() => buildWeekRange(today, 1), [today]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const [allCurrent, allPrior] = await Promise.all([
        currentWeekRange
          ? loadDemandTargets({ ...filters, date: currentWeekRange.start })
          : Promise.resolve([] as DemandForecast[]),
        priorWeekRange
          ? loadDemandTargets({ ...filters, date: priorWeekRange.start })
          : Promise.resolve([] as DemandForecast[]),
      ]);

      if (requestIdRef.current !== requestId) return;

      const filteredCurrent = currentWeekRange
        ? targetsInRange(allCurrent, currentWeekRange.start, currentWeekRange.end)
        : allCurrent;

      const filteredPrior = priorWeekRange
        ? targetsInRange(allPrior, priorWeekRange.start, priorWeekRange.end)
        : allPrior;

      setCurrentWeekTargets(filteredCurrent);
      setPriorWeekTargets(filteredPrior);
      setError(null);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.warn('[useDemandAnalysis] Failed to load demand targets', err);
      setError('Unable to load demand analysis data');
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [filters, currentWeekRange, priorWeekRange]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  // -------------------------------------------------------------------------
  // demandVsPrior
  // -------------------------------------------------------------------------

  const demandVsPrior = useMemo<DemandVsPrior[]>(() => {
    const priorLookup = new Map<string, number>();
    priorWeekTargets.forEach((t) => {
      priorLookup.set(`${t.role}`, (priorLookup.get(t.role) ?? 0) + t.required);
    });

    const priorByRoleDay = new Map<string, DemandForecast>();
    priorWeekTargets.forEach((t) => {
      priorByRoleDay.set(`${t.role}::${t.date}`, t);
    });

    return currentWeekTargets.map((current) => {
      const priorDate = subtractDays(current.date, 7);
      const priorKey = priorDate ? `${current.role}::${priorDate}` : null;
      const priorTarget = priorKey ? priorByRoleDay.get(priorKey) : undefined;
      const prior = priorTarget?.required ?? 0;
      const changePct =
        prior === 0
          ? current.required === 0
            ? 0
            : 100
          : Math.round(((current.required - prior) / prior) * 100);

      return {
        date: current.date,
        role: current.role,
        current: current.required,
        prior,
        changePct,
      };
    });
  }, [currentWeekTargets, priorWeekTargets]);

  // -------------------------------------------------------------------------
  // forecastExplanation
  // -------------------------------------------------------------------------

  const forecastExplanation = useMemo<ForecastExplanationEntry[]>(() => {
    const allTargets = [...currentWeekTargets, ...priorWeekTargets];

    return currentWeekTargets.map((target) => {
      const allTargetsForRole = allTargets.filter((t) => t.role === target.role);
      const factors = buildExplanationFactors(target, allTargetsForRole);
      return { date: target.date, role: target.role, factors };
    });
  }, [currentWeekTargets, priorWeekTargets]);

  // -------------------------------------------------------------------------
  // forecastAccuracy — compare past demand targets to actual roster fills
  // -------------------------------------------------------------------------

  const forecastAccuracy = useMemo<ForecastAccuracyEntry[]>(() => {
    const pastTargets = currentWeekTargets.filter((t) => isoPast(t.date));
    if (pastTargets.length === 0) return [];

    const publishedShifts = (roster.roster ?? []).filter(
      (s) => s.status === 'Published',
    );

    return pastTargets.map((target) => {
      const actualFills = publishedShifts.filter(
        (s) => s.date === target.date && templates.find((tpl) => tpl.id === s.templateId)?.role === target.role,
      ).length;

      const predicted = target.required;
      const errorPct =
        predicted === 0
          ? actualFills === 0
            ? 0
            : 100
          : Math.round((Math.abs(actualFills - predicted) / predicted) * 100);

      return {
        date: target.date,
        role: target.role,
        predicted,
        actual: actualFills,
        errorPct,
      };
    });
  }, [currentWeekTargets, roster.roster, templates]);

  // -------------------------------------------------------------------------
  // weeklyDemandSummary
  // -------------------------------------------------------------------------

  const weeklyDemandSummary = useMemo<WeeklyDemandSummary[]>(() => {
    const byRole = new Map<
      string,
      { total: number; count: number; peak: DemandForecast | null }
    >();

    currentWeekTargets.forEach((t) => {
      const existing = byRole.get(t.role) ?? { total: 0, count: 0, peak: null };
      const newPeak =
        existing.peak === null || t.required > existing.peak.required
          ? t
          : existing.peak;
      byRole.set(t.role, {
        total: existing.total + t.required,
        count: existing.count + 1,
        peak: newPeak,
      });
    });

    const summaries: WeeklyDemandSummary[] = [];

    byRole.forEach((data, role) => {
      const avgRequired =
        data.count > 0 ? Math.round((data.total / data.count) * 10) / 10 : 0;
      const peakDay = data.peak?.date ?? '';
      const peakRequired = data.peak?.required ?? 0;
      summaries.push({ role, avgRequired, peakDay, peakRequired });
    });

    return summaries.sort((a, b) => a.role.localeCompare(b.role));
  }, [currentWeekTargets]);

  // -------------------------------------------------------------------------
  // confidenceIntervals
  // -------------------------------------------------------------------------

  const confidenceIntervals = useMemo<ConfidenceIntervalPoint[]>(() => {
    return currentWeekTargets
      .filter(
        (t) =>
          t.lowerBound !== undefined &&
          t.upperBound !== undefined &&
          t.confidence !== undefined,
      )
      .map((t) => ({
        date: t.date,
        role: t.role,
        required: t.required,
        lowerBound: t.lowerBound as number,
        upperBound: t.upperBound as number,
        confidence: t.confidence as number,
      }));
  }, [currentWeekTargets]);

  return {
    demandVsPrior,
    forecastExplanation,
    forecastAccuracy,
    weeklyDemandSummary,
    confidenceIntervals,
    loading: loading || roster.loading,
    error,
    refresh: load,
  };
}