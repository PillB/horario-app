import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RoleModelSummary } from '@/services/forecasting/statisticalForecast';
import {
  DemandForecast,
  ForecastFilters,
  ForecastDataStatus,
  ForecastGenerationResult,
  ForecastGenerationMetadata,
  ForecastNotices,
  ForecastOptions,
  generateDemandForecast,
  getForecastDataStatus,
  loadDemandTargets,
  upsertDemandTarget,
} from '@/services/demandForecast';

const mergeForecasts = (incoming: DemandForecast[], existing: DemandForecast[]) => {
  const lookup = new Map<string, DemandForecast>();
  existing.forEach((forecast) => lookup.set(`${forecast.date}::${forecast.role}`, forecast));
  incoming.forEach((forecast) => lookup.set(`${forecast.date}::${forecast.role}`, forecast));
  return Array.from(lookup.values()).sort((a, b) => `${a.date}-${a.role}`.localeCompare(`${b.date}-${b.role}`));
};

const forecastKey = (f: DemandForecast) => `${f.date}::${f.role}`;

const NO_MODELS: RoleModelSummary[] = [];
const NO_NOTICES: ForecastNotices = { historyEndsDaysAgo: null, signalsTruncated: false };

/**
 * `options` (service level, interval level, business time zone) is read when a
 * forecast runs, so passing a new object each render does not re-create
 * `triggerForecast`.
 */
export const useDemandForecast = (filters?: ForecastFilters, options?: ForecastOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [demandTargets, setDemandTargets] = useState<DemandForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerationMetadata, setLastGenerationMetadata] = useState<ForecastGenerationMetadata | null>(null);
  const [dataStatus, setDataStatus] = useState<ForecastDataStatus>({
    hasHistorical: false,
    hasExternalSignals: false,
    hasExistingTargets: false,
    apiAvailable: Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL),
  });

  const hydrateRequestIdRef = useRef(0);

  const hydrate = useCallback(async () => {
    /**
     * Guard hydration work by request id so stale responses cannot override
     * more recent filter changes. Each invocation receives its own id and
     * only the latest request is allowed to update loading/error/data state.
     */
    const requestId = ++hydrateRequestIdRef.current;
    try {
      setLoading(true);
      const [existing, status] = await Promise.all([
        loadDemandTargets(filters),
        getForecastDataStatus(filters),
      ]);
      if (hydrateRequestIdRef.current !== requestId) return;
      setDemandTargets(existing);
      setDataStatus(status);
      setError(null);
    } catch (err) {
      console.warn('Unable to hydrate demand targets', err);
      if (hydrateRequestIdRef.current !== requestId) return;
      setError('Unable to load demand targets');
    } finally {
      if (hydrateRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [filters]);

  const triggerForecast = useCallback(
    async (overrideFilters?: ForecastFilters) => {
      if (forecasting) return;
      try {
        setForecasting(true);
        setLoading(true);
        const { forecasts, metadata }: ForecastGenerationResult = await generateDemandForecast(
          { ...filters, ...overrideFilters },
          optionsRef.current,
        );
        setLastGenerationMetadata(metadata);
        // A manual override always beats a model forecast for the same date and role.
        setDemandTargets((prev) => {
          const overrides = prev.filter((item) => item.source === 'override');
          const overridden = new Set(overrides.map(forecastKey));
          return mergeForecasts(
            forecasts.filter((f) => f.source === 'override' || !overridden.has(forecastKey(f))),
            overrides,
          );
        });
        setDataStatus((prev) => ({
          ...prev,
          hasHistorical: prev.hasHistorical || metadata.hasHistorical,
          hasExternalSignals: prev.hasExternalSignals || metadata.hasExternalSignals,
          hasExistingTargets: forecasts.length > 0 || prev.hasExistingTargets,
          apiAvailable: metadata.apiAvailable,
        }));
        if (metadata.usedFallback) {
          setError(metadata.fallbackReason ?? 'Forecast generated using fallback logic.');
        } else {
          setError(null);
        }
      } catch (err) {
        console.warn('Unable to generate forecast', err);
        setLastGenerationMetadata(null);
        setError('Unable to generate forecast');
      } finally {
        setForecasting(false);
        setLoading(false);
      }
    },
    [filters, forecasting]
  );

  const overrideTarget = useCallback(async (target: DemandForecast) => {
    try {
      setLoading(true);
      const normalized = { ...target, required: Number(target.required), source: 'override' as const };
      const result = await upsertDemandTarget(normalized);
      if (result.success) {
        setDemandTargets((prev) => mergeForecasts([normalized], prev));
        setDataStatus((prev) => ({ ...prev, hasExistingTargets: true }));
        setError(null);
      } else {
        setError(result.error ?? 'Unable to save override');
      }
    } catch (err) {
      console.warn('Unable to persist override', err);
      setError('Unable to save override');
    } finally {
      setLoading(false);
    }
  }, []);

  const seedBaselineTargets = useCallback(async (targets: DemandForecast[]) => {
    try {
      setLoading(true);
      const normalized = targets.map((target) => ({
        ...target,
        required: Number(target.required),
        source: target.source ?? ('override' as const),
      }));
      const results = await Promise.all(normalized.map((target) => upsertDemandTarget(target)));
      const successfulTargets = results.filter((result) => result.success).map((result) => result.target);
      if (successfulTargets.length) {
        setDemandTargets((prev) => mergeForecasts(successfulTargets, prev));
        setDataStatus((prev) => ({ ...prev, hasExistingTargets: true }));
      }

      const failedResult = results.find((result) => !result.success);
      if (failedResult) {
        const message = failedResult.error ?? 'Unable to save baseline targets';
        setError(message);
        return { success: false, error: message } as const;
      }

      setError(null);
      return { success: true, error: null } as const;
    } catch (err) {
      console.warn('Unable to seed baseline targets', err);
      const message = 'Unable to save baseline targets';
      setError(message);
      return { success: false, error: message } as const;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
    return () => {
      hydrateRequestIdRef.current += 1;
    };
  }, [hydrate]);

  const forecastModels = useMemo(() => lastGenerationMetadata?.models ?? NO_MODELS, [lastGenerationMetadata]);
  const forecastNotices = useMemo<ForecastNotices>(
    () =>
      lastGenerationMetadata
        ? {
            historyEndsDaysAgo: lastGenerationMetadata.historyEndsDaysAgo ?? null,
            signalsTruncated: lastGenerationMetadata.signalsTruncated === true,
          }
        : NO_NOTICES,
    [lastGenerationMetadata],
  );

  return {
    demandTargets,
    loading,
    error,
    forecasting,
    dataStatus,
    lastGenerationMetadata,
    /** Statistical forecasts: model chosen per role and its backtest MASE (empty otherwise). */
    forecastModels,
    /** Statistical forecasts: history gap and signal truncation, for a note in the UI. */
    forecastNotices,
    refresh: hydrate,
    triggerForecast,
    overrideTarget,
    seedBaselineTargets,
  } as const;
};

export type UseDemandForecastReturn = ReturnType<typeof useDemandForecast>;
