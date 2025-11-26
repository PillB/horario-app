import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DemandForecast,
  ForecastFilters,
  ForecastDataStatus,
  ForecastGenerationResult,
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

export const useDemandForecast = (filters?: ForecastFilters) => {
  const [demandTargets, setDemandTargets] = useState<DemandForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<ForecastDataStatus>({
    hasHistorical: false,
    hasExternalSignals: false,
    hasExistingTargets: false,
    apiAvailable: Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL),
  });

  const hydrateAbortRef = useRef(false);

  const hydrate = useCallback(async () => {
    try {
      setLoading(true);
      const [existing, status] = await Promise.all([
        loadDemandTargets(filters),
        getForecastDataStatus(filters),
      ]);
      if (hydrateAbortRef.current) return;
      setDemandTargets(existing);
      setDataStatus(status);
      setError(null);
    } catch (err) {
      console.warn('Unable to hydrate demand targets', err);
      if (hydrateAbortRef.current) return;
      setError('Unable to load demand targets');
    } finally {
      if (!hydrateAbortRef.current) {
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
        const { forecasts, metadata }: ForecastGenerationResult = await generateDemandForecast({
          ...filters,
          ...overrideFilters,
        });
        setDemandTargets((prev) => mergeForecasts(forecasts, prev.filter((item) => item.source === 'override')));
        setDataStatus((prev) => ({
          ...prev,
          hasHistorical: prev.hasHistorical || metadata.hasHistorical,
          hasExternalSignals: prev.hasExternalSignals || metadata.hasExternalSignals,
          hasExistingTargets: forecasts.length > 0 || prev.hasExistingTargets,
          apiAvailable: metadata.apiAvailable,
        }));
        if (metadata.usedFallback && !metadata.hasHistorical && !metadata.hasExternalSignals) {
          setError('No historical shifts or external signals were found. Use quick setup to seed demand.');
        } else {
          setError(null);
        }
      } catch (err) {
        console.warn('Unable to generate forecast', err);
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
        setError(failedResult.error ?? 'Unable to save baseline targets');
      } else {
        setError(null);
      }
    } catch (err) {
      console.warn('Unable to seed baseline targets', err);
      setError('Unable to save baseline targets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrateAbortRef.current = false;
    hydrate();
    return () => {
      hydrateAbortRef.current = true;
    };
  }, [hydrate]);

  return {
    demandTargets,
    loading,
    error,
    forecasting,
    dataStatus,
    refresh: hydrate,
    triggerForecast,
    overrideTarget,
    seedBaselineTargets,
  } as const;
};

export type UseDemandForecastReturn = ReturnType<typeof useDemandForecast>;
