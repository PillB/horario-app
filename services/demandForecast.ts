import { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from './supabaseClient';

type HistoricalShift = {
  date: string;
  role: string;
  hours?: number;
  worker_id?: string;
};

type ExternalSignal = {
  date: string;
  role?: string;
  signal_type?: string;
  weight?: number;
};

export type DemandForecast = {
  date: string;
  role: string;
  required: number;
  notes?: string;
  confidence?: number;
  lowerBound?: number;
  upperBound?: number;
  source?: 'model' | 'override';
};

export type ForecastFilters = {
  date?: string;
  role?: string;
};

export type ForecastDataStatus = {
  hasHistorical: boolean;
  hasExternalSignals: boolean;
  hasExistingTargets: boolean;
  apiAvailable: boolean;
};

export type ForecastGenerationMetadata = ForecastDataStatus & {
  usedApi: boolean;
  usedFallback: boolean;
  apiCallFailed: boolean;
  fallbackReason?: string;
};

export type ForecastGenerationResult = {
  forecasts: DemandForecast[];
  metadata: ForecastGenerationMetadata;
};

const FORECAST_API_URL = process.env.EXPO_PUBLIC_FORECAST_API_URL;

const roundToInt = (value: number) => Math.max(0, Math.round(value));

const buildKey = (item: ForecastFilters & { date: string; role: string }) => `${item.date}::${item.role}`;

const selectFilters = (filters?: ForecastFilters) => {
  if (!filters) return undefined;
  const payload: ForecastFilters = {};
  if (filters.date) payload.date = filters.date;
  if (filters.role) payload.role = filters.role;
  return payload;
};

const fetchHistoricalShifts = async (
  client: SupabaseClient,
  filters?: ForecastFilters
): Promise<HistoricalShift[]> => {
  const query = client
    .from('shifts')
    .select('date, role, worker_id, hours')
    .order('date', { ascending: true })
    .limit(500);

  if (filters?.date) {
    query.gte('date', filters.date).lte('date', filters.date);
  }
  if (filters?.role) {
    query.eq('role', filters.role);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Unable to fetch historical shifts', error.message);
    return [];
  }

  return (data ?? []).map((shift) => ({
    date: shift.date,
    role: shift.role,
    hours: shift.hours ?? 8,
    worker_id: shift.worker_id,
  }));
};

const fetchExternalSignals = async (
  client: SupabaseClient,
  filters?: ForecastFilters
): Promise<ExternalSignal[]> => {
  const query = client
    .from('external_signals')
    .select('date, role, signal_type, weight')
    .order('date', { ascending: true })
    .limit(200);

  if (filters?.date) {
    query.eq('date', filters.date);
  }
  if (filters?.role) {
    query.eq('role', filters.role);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Unable to fetch external signals', error.message);
    return [];
  }

  return data ?? [];
};

const fetchExistingTargets = async (
  client: SupabaseClient,
  filters?: ForecastFilters
): Promise<DemandForecast[]> => {
  const query = client
    .from('demand_targets')
    .select('date, role, required, notes, confidence, lower_bound, upper_bound, source')
    .order('date', { ascending: true })
    .limit(500);

  if (filters?.date) {
    query.eq('date', filters.date);
  }
  if (filters?.role) {
    query.eq('role', filters.role);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Unable to fetch demand targets', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    date: row.date,
    role: row.role,
    required: Number(row.required ?? 0),
    notes: row.notes ?? undefined,
    confidence: row.confidence ?? undefined,
    lowerBound: row.lower_bound ?? undefined,
    upperBound: row.upper_bound ?? undefined,
    source: (row.source as 'model' | 'override') ?? 'model',
  }));
};

const persistForecasts = async (client: SupabaseClient, forecasts: DemandForecast[]) => {
  if (!forecasts.length) return;
  const payload = forecasts.map((forecast) => ({
    date: forecast.date,
    role: forecast.role,
    required: forecast.required,
    notes: forecast.notes,
    confidence: forecast.confidence,
    lower_bound: forecast.lowerBound,
    upper_bound: forecast.upperBound,
    source: forecast.source ?? 'model',
  }));

  const { error } = await client.from('demand_targets').upsert(payload, { onConflict: 'date,role' });
  if (error) {
    console.warn('Unable to persist demand targets', error.message);
  }
};

type ForecastApiOutcome = {
  forecasts: DemandForecast[];
  attempted: boolean;
  failed: boolean;
  failureReason?: string;
};

const callForecastApi = async (
  inputs: {
    shifts: HistoricalShift[];
    signals: ExternalSignal[];
    filters?: ForecastFilters;
  }
): Promise<ForecastApiOutcome> => {
  if (!FORECAST_API_URL) {
    return { forecasts: [], attempted: false, failed: false };
  }

  try {
    const response = await fetch(FORECAST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });

    if (!response.ok) {
      const failureReason = `Forecast API responded with status ${response.status}`;
      console.warn(failureReason);
      return { forecasts: [], attempted: true, failed: true, failureReason };
    }

    const payload = (await response.json()) as DemandForecast[];
    const normalized = payload.map((item) => ({
      ...item,
      required: Number(item.required ?? 0),
      source: item.source ?? 'model',
    }));

    return { forecasts: normalized, attempted: true, failed: false };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unknown error';
    console.warn('Forecast API call failed', error);
    return { forecasts: [], attempted: true, failed: true, failureReason };
  }
};

const computeDailyAverages = (
  shifts: HistoricalShift[],
  signals: ExternalSignal[],
  filters?: ForecastFilters
): DemandForecast[] => {
  const grouped = shifts.reduce<Record<string, number[]>>((acc, shift) => {
    if (filters?.role && shift.role !== filters.role) return acc;
    const key = buildKey({ date: shift.date, role: shift.role });
    if (!acc[key]) acc[key] = [];
    acc[key].push(shift.hours ?? 8);
    return acc;
  }, {});

  const signalMap = signals.reduce<Record<string, number>>((acc, signal) => {
    if (filters?.role && signal.role && signal.role !== filters.role) return acc;
    if (!signal.weight) return acc;
    const key = buildKey({ date: signal.date, role: signal.role ?? 'global' });
    acc[key] = (acc[key] ?? 0) + signal.weight;
    return acc;
  }, {});

  const keys = new Set<string>();
  Object.keys(grouped).forEach((key) => keys.add(key));
  Object.keys(signalMap).forEach((key) => keys.add(key));
  if (filters?.date && filters?.role) {
    keys.add(buildKey({ date: filters.date, role: filters.role }));
  }

  const forecasts: DemandForecast[] = [];

  keys.forEach((key) => {
    const [date, ...roleParts] = key.split('::');
    const role = roleParts.join('::');
    const samples = grouped[key] ?? [];
    const mean = samples.length
      ? samples.reduce((sum, value) => sum + value, 0) / samples.length
      : 4; // fallback baseline
    const variance = samples.length
      ? samples.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / samples.length
      : 1.5;
    const stdDev = Math.sqrt(variance);

    const signalBoost = signalMap[key] ?? signalMap[buildKey({ date, role: 'global' })] ?? 0;
    const required = roundToInt(mean + signalBoost);

    forecasts.push({
      date,
      role,
      required,
      lowerBound: Math.max(0, Math.floor(required - stdDev)),
      upperBound: roundToInt(required + stdDev),
      confidence: Math.max(0, Math.min(1, samples.length ? 0.7 + Math.min(samples.length / 20, 0.2) : 0.55)),
      source: 'model',
    });
  });

  return forecasts.sort((a, b) => a.date.localeCompare(b.date));
};

const mergeForecasts = (forecasts: DemandForecast[], overrides: DemandForecast[] = []) => {
  const lookup = new Map<string, DemandForecast>();
  forecasts.forEach((forecast) => lookup.set(buildKey(forecast), forecast));
  overrides.forEach((override) => lookup.set(buildKey(override), override));
  return Array.from(lookup.values());
};

export const getForecastDataStatus = async (filters?: ForecastFilters): Promise<ForecastDataStatus> => {
  const baseStatus: ForecastDataStatus = {
    hasHistorical: false,
    hasExternalSignals: false,
    hasExistingTargets: false,
    apiAvailable: Boolean(FORECAST_API_URL),
  };

  const client = getSupabaseClient();
  if (!client) return baseStatus;

  const [historical, signals, existingTargets] = await Promise.all([
    fetchHistoricalShifts(client, filters),
    fetchExternalSignals(client, filters),
    fetchExistingTargets(client, filters),
  ]);

  return {
    hasHistorical: historical.length > 0,
    hasExternalSignals: signals.length > 0,
    hasExistingTargets: existingTargets.length > 0,
    apiAvailable: Boolean(FORECAST_API_URL),
  };
};

export const generateDemandForecast = async (
  filters?: ForecastFilters
): Promise<ForecastGenerationResult> => {
  const client = getSupabaseClient();
  const metadata: ForecastGenerationMetadata = {
    hasHistorical: false,
    hasExternalSignals: false,
    hasExistingTargets: false,
    apiAvailable: Boolean(FORECAST_API_URL),
    usedApi: false,
    usedFallback: false,
    apiCallFailed: false,
    fallbackReason: undefined,
  };

  if (!client) {
    metadata.usedFallback = true;
    metadata.fallbackReason = 'Unable to reach data services; using local averages.';
    return { forecasts: computeDailyAverages([], [], filters), metadata };
  }

  const [shifts, signals, storedOverrides] = await Promise.all([
    fetchHistoricalShifts(client, filters),
    fetchExternalSignals(client, filters),
    fetchExistingTargets(client, filters),
  ]);

  metadata.hasHistorical = shifts.length > 0;
  metadata.hasExternalSignals = signals.length > 0;
  metadata.hasExistingTargets = storedOverrides.length > 0;

  const apiOutcome = await callForecastApi({ shifts, signals, filters: selectFilters(filters) });
  metadata.usedApi = apiOutcome.forecasts.length > 0;
  metadata.apiCallFailed = apiOutcome.failed;

  const localForecasts = metadata.usedApi
    ? apiOutcome.forecasts
    : computeDailyAverages(shifts, signals, filters);

  metadata.usedFallback = !metadata.usedApi;

  if (metadata.usedFallback) {
    if (!metadata.apiAvailable) {
      metadata.fallbackReason = 'Forecast API is not configured; using local averages.';
    } else if (apiOutcome.failed) {
      metadata.fallbackReason = 'Forecast API request failed; using local averages.';
    } else if (apiOutcome.attempted) {
      metadata.fallbackReason = 'Forecast API returned no data; using local averages.';
    } else {
      metadata.fallbackReason = 'Using local averages to generate forecasts.';
    }
  }

  const merged = mergeForecasts(localForecasts, storedOverrides.filter((t) => t.source === 'override'));
  await persistForecasts(client, merged.filter((forecast) => forecast.source !== 'override'));

  return { forecasts: merged, metadata };
};

export const loadDemandTargets = async (filters?: ForecastFilters): Promise<DemandForecast[]> => {
  const client = getSupabaseClient();
  if (!client) return [];
  return fetchExistingTargets(client, filters);
};

export type UpsertDemandTargetResult = {
  success: boolean;
  target: DemandForecast;
  error?: string;
};

export const upsertDemandTarget = async (
  target: DemandForecast
): Promise<UpsertDemandTargetResult> => {
  const client = getSupabaseClient();
  if (!client) {
    const errorMessage = 'Supabase client is not available';
    console.warn('Unable to upsert target override', errorMessage);
    return { success: false, target, error: errorMessage };
  }

  const payload = {
    date: target.date,
    role: target.role,
    required: target.required,
    notes: target.notes,
    confidence: target.confidence,
    lower_bound: target.lowerBound,
    upper_bound: target.upperBound,
    source: target.source ?? 'override',
  };

  const { error } = await client.from('demand_targets').upsert(payload, { onConflict: 'date,role' });
  if (error) {
    console.warn('Unable to upsert target override', error.message);
    return { success: false, target, error: error.message };
  }

  return { success: true, target };
};
