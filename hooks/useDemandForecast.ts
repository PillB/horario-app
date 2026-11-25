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
  deleteDemandTarget,
  upsertDemandTargets,
  fetchOverrideTargets,
  generateDemandForecast,
  getForecastDataStatus,
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

const NO_TARGETS: DemandForecast[] = [];

const initialDataStatus = (): ForecastDataStatus => ({
  hasHistorical: false,
  hasExternalSignals: false,
  hasExistingTargets: false,
  apiAvailable: Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL),
});

/**
 * `accountId` names the tenant (the proxy takes it from the session): a new
 * one drops the previous tenant's targets and forecast, reloads, and any
 * answer still on its way for the old tenant is ignored (CHG-109; before, the
 * Scheduler kept showing the previous organization's demand after a switch).
 *
 * `options` (service level, interval level, business time zone) is read when a
 * forecast runs, so passing a new object each render does not re-create
 * `triggerForecast`.
 */
export const useDemandForecast = (accountId: string, filters?: ForecastFilters, options?: ForecastOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  /** The tenant the state below belongs to; the render in which it changes shows none of it. */
  const [stateKey, setStateKey] = useState(accountId);
  const [demandTargetsState, setDemandTargets] = useState<DemandForecast[]>([]);
  const demandTargets = stateKey === accountId ? demandTargetsState : NO_TARGETS;
  const demandTargetsRef = useRef(demandTargets);
  demandTargetsRef.current = demandTargets;
  const [loading, setLoading] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True once the stored overrides have loaded (CHG-088). */
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  /** The last load of the stored overrides failed (kept apart from forecast errors). */
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [lastGenerationMetadata, setLastGenerationMetadata] = useState<ForecastGenerationMetadata | null>(null);
  const [dataStatus, setDataStatus] = useState<ForecastDataStatus>(initialDataStatus);

  const hydrateRequestIdRef = useRef(0);
  const forecastRequestIdRef = useRef(0);

  // A new tenant starts empty; a forecast still running for the old one is dropped.
  useEffect(() => {
    if (stateKey === accountId) return;
    forecastRequestIdRef.current += 1;
    setDemandTargets([]);
    setTargetsLoaded(false);
    setTargetsError(null);
    setError(null);
    setLastGenerationMetadata(null);
    setDataStatus(initialDataStatus());
    setForecasting(false);
    setStateKey(accountId);
  }, [accountId, stateKey]);

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
        fetchOverrideTargets(filters),
        getForecastDataStatus(filters),
      ]);
      if (hydrateRequestIdRef.current !== requestId) return;
      setDataStatus(status);
      if (!existing.ok) {
        // Keep what is shown; a failed load is not "no overrides".
        setError('Unable to load demand targets');
        setTargetsError(existing.error);
        return;
      }
      setDemandTargets(existing.targets);
      setTargetsLoaded(true);
      setTargetsError(null);
      setError(null);
    } catch (err) {
      console.warn('Unable to hydrate demand targets', err);
      if (hydrateRequestIdRef.current !== requestId) return;
      setError('Unable to load demand targets');
      setTargetsError(err instanceof Error ? err.message : 'Unable to load demand targets');
    } finally {
      if (hydrateRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  // accountId is not sent (the server takes the tenant from the session), but
  // a tenant switch must reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, accountId]);

  const triggerForecast = useCallback(
    async (overrideFilters?: ForecastFilters) => {
      if (forecasting) return;
      // Only the newest run for the current tenant may change state.
      const requestId = ++forecastRequestIdRef.current;
      const tenant = accountIdRef.current;
      const current = () => forecastRequestIdRef.current === requestId && accountIdRef.current === tenant;
      try {
        setForecasting(true);
        setLoading(true);
        const { forecasts, metadata }: ForecastGenerationResult = await generateDemandForecast(
          { ...filters, ...overrideFilters },
          optionsRef.current,
        );
        if (!current()) return;
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
        if (!current()) return;
        setLastGenerationMetadata(null);
        setError('Unable to generate forecast');
      } finally {
        if (current()) {
          setForecasting(false);
          setLoading(false);
        }
      }
    },
    [filters, forecasting]
  );

  const overrideTarget = useCallback(async (target: DemandForecast) => {
    const tenant = accountIdRef.current;
    try {
      setLoading(true);
      const normalized = { ...target, required: Number(target.required), source: 'override' as const };
      const result = await upsertDemandTarget(normalized);
      // Saved for the tenant it was made in; another tenant's list is not touched.
      if (accountIdRef.current !== tenant) return;
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

  /**
   * Removes the stored override for a date and role. Optimistic: the row goes
   * at once and comes back, with the server's error, if the delete fails.
   */
  const removeOverride = useCallback(async (target: { date: string; role: string }) => {
    const key = forecastKey({ ...target, required: 0 });
    const removed = demandTargetsRef.current.find((f) => forecastKey(f) === key && f.source === 'override');
    if (removed) setDemandTargets((prev) => prev.filter((f) => forecastKey(f) !== key));
    const tenant = accountIdRef.current;
    const result = await deleteDemandTarget(target);
    // Another tenant's list never gets this row back.
    if (accountIdRef.current !== tenant) {
      return result.success
        ? ({ success: true, error: null } as const)
        : ({ success: false, error: result.error ?? 'Unable to remove override' } as const);
    }
    if (!result.success) {
      if (removed) setDemandTargets((prev) => (prev.some((f) => forecastKey(f) === key) ? prev : mergeForecasts([removed], prev)));
      setError(result.error ?? 'Unable to remove override');
      return { success: false, error: result.error ?? 'Unable to remove override' } as const;
    }
    setError(null);
    return { success: true, error: null } as const;
  }, []);

  const seedBaselineTargets = useCallback(async (targets: DemandForecast[]) => {
    try {
      setLoading(true);
      const normalized = targets.map((target) => ({
        ...target,
        required: Number(target.required),
        source: target.source ?? ('override' as const),
      }));
      const tenant = accountIdRef.current;
      const results = await upsertDemandTargets(normalized);
      const successfulTargets = results.filter((result) => result.success).map((result) => result.target);
      if (successfulTargets.length && accountIdRef.current === tenant) {
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
    targetsLoaded,
    targetsError,
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
    removeOverride,
    seedBaselineTargets,
  } as const;
};

export type UseDemandForecastReturn = ReturnType<typeof useDemandForecast>;
