import { useCallback, useEffect, useState } from 'react';

import {
  DemandForecast,
  ForecastFilters,
  generateDemandForecast,
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
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      setLoading(true);
      const existing = await loadDemandTargets(filters);
      setDemandTargets(existing);
      setError(null);
    } catch (err) {
      console.warn('Unable to hydrate demand targets', err);
      setError('Unable to load demand targets');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const triggerForecast = useCallback(
    async (overrideFilters?: ForecastFilters) => {
      try {
        setLoading(true);
        const forecasts = await generateDemandForecast({ ...filters, ...overrideFilters });
        setDemandTargets((prev) => mergeForecasts(forecasts, prev.filter((item) => item.source === 'override')));
        setError(null);
      } catch (err) {
        console.warn('Unable to generate forecast', err);
        setError('Unable to generate forecast');
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  const overrideTarget = useCallback(async (target: DemandForecast) => {
    try {
      setLoading(true);
      const normalized = { ...target, required: Number(target.required), source: 'override' as const };
      setDemandTargets((prev) => mergeForecasts([normalized], prev));
      await upsertDemandTarget(normalized);
      setError(null);
    } catch (err) {
      console.warn('Unable to persist override', err);
      setError('Unable to save override');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return {
    demandTargets,
    loading,
    error,
    refresh: hydrate,
    triggerForecast,
    overrideTarget,
  } as const;
};

export type UseDemandForecastReturn = ReturnType<typeof useDemandForecast>;
