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

const callForecastApi = async (
  inputs: {
    shifts: HistoricalShift[];
    signals: ExternalSignal[];
    filters?: ForecastFilters;
  }
): Promise<DemandForecast[]> => {
  if (!FORECAST_API_URL) return [];

  try {
    const response = await fetch(FORECAST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });

    if (!response.ok) {
      console.warn('Forecast API responded with non-200 status', response.status);
      return [];
    }

    const payload = (await response.json()) as DemandForecast[];
    return payload.map((item) => ({
      ...item,
      required: Number(item.required ?? 0),
      source: item.source ?? 'model',
    }));
  } catch (error) {
    console.warn('Forecast API call failed', error);
    return [];
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
    usedFallback: true,
  };

  if (!client) {
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

  const apiForecasts = await callForecastApi({ shifts, signals, filters: selectFilters(filters) });
  metadata.usedApi = apiForecasts.length > 0;

  const localForecasts = apiForecasts.length ? apiForecasts : computeDailyAverages(shifts, signals, filters);
  metadata.usedFallback = !apiForecasts.length && !metadata.hasHistorical && !metadata.hasExternalSignals;

  const merged = mergeForecasts(localForecasts, storedOverrides.filter((t) => t.source === 'override'));
  await persistForecasts(client, merged.filter((forecast) => forecast.source !== 'override'));

  return { forecasts: merged, metadata };
};

export const loadDemandTargets = async (filters?: ForecastFilters): Promise<DemandForecast[]> => {
  const client = getSupabaseClient();
  if (!client) return [];
  return fetchExistingTargets(client, filters);
};

export const upsertDemandTarget = async (target: DemandForecast): Promise<DemandForecast> => {
  const client = getSupabaseClient();
  if (!client) return target;

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
  }

  return target;
};
