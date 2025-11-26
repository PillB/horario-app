import { SupabaseClient, createClient } from '@supabase/supabase-js';

import {
  DemandForecast,
  ForecastFilters,
  ForecastGenerationMetadata,
  ForecastGenerationResult,
} from '@/services/demandForecast';
import { OnboardingProgress } from '@/services/onboardingProgress';

const FORECAST_API_URL = process.env.EXPO_PUBLIC_FORECAST_API_URL;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

const roundToInt = (value: number) => Math.max(0, Math.round(value));

const buildKey = (item: ForecastFilters & { date: string; role: string }) => `${item.date}::${item.role}`;

const getServiceClient = (): SupabaseClient => {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing service-role Supabase credentials');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'horario-forecast-admin' } },
  });
};

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

const selectFilters = (filters?: ForecastFilters) => {
  if (!filters) return undefined;
  const payload: ForecastFilters = {};
  if (filters.date) payload.date = filters.date;
  if (filters.role) payload.role = filters.role;
  return payload;
};

const fetchHistoricalShifts = async (client: SupabaseClient, filters?: ForecastFilters): Promise<HistoricalShift[]> => {
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

const fetchExternalSignals = async (client: SupabaseClient, filters?: ForecastFilters): Promise<ExternalSignal[]> => {
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

const callForecastApi = async (inputs: {
  shifts: HistoricalShift[];
  signals: ExternalSignal[];
  filters?: ForecastFilters;
}): Promise<ForecastApiOutcome> => {
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
      : 4;
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

const forecastWithServiceRole = async (
  client: SupabaseClient,
  filters?: ForecastFilters
): Promise<ForecastGenerationResult> => {
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

  const localForecasts = metadata.usedApi ? apiOutcome.forecasts : computeDailyAverages(shifts, signals, filters);

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

const upsertTargets = async (client: SupabaseClient, targets: DemandForecast[]) => {
  if (!targets.length) return { success: true, targets: [] } as const;

  const payload = targets.map((target) => ({
    date: target.date,
    role: target.role,
    required: target.required,
    notes: target.notes,
    confidence: target.confidence,
    lower_bound: target.lowerBound,
    upper_bound: target.upperBound,
    source: target.source ?? 'override',
  }));

  const { error } = await client.from('demand_targets').upsert(payload, { onConflict: 'date,role' });
  if (error) {
    return { success: false, error: error.message, targets: [] } as const;
  }

  return { success: true, targets } as const;
};

const upsertOnboarding = async (client: SupabaseClient, accountId: string, flags: OnboardingProgress, userId?: string | null) => {
  const payload = {
    account_id: accountId,
    user_id: userId ?? null,
    workers_completed: flags.workers,
    templates_completed: flags.templates,
    forecast_completed: flags.forecast,
  };

  const { error } = await client
    .from('onboarding_progress')
    .upsert(payload, { onConflict: 'account_id,user_id' })
    .select('workers_completed, templates_completed, forecast_completed')
    .single();

  if (error) {
    return { success: false, error: error.message, progress: null } as const;
  }

  return { success: true, progress: flags } as const;
};

const buildErrorResponse = (message: string, status = 500) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type ProxyRequest =
  | { action: 'forecast'; filters?: ForecastFilters }
  | { action: 'status'; filters?: ForecastFilters }
  | { action: 'loadTargets'; filters?: ForecastFilters }
  | { action: 'upsertTargets'; targets: DemandForecast[] }
  | { action: 'upsertOnboarding'; accountId: string; flags: OnboardingProgress; userId?: string | null };

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let client: SupabaseClient;
  try {
    client = getServiceClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to initialize service client';
    return buildErrorResponse(message, 500);
  }

  let payload: ProxyRequest;
  try {
    payload = (await request.json()) as ProxyRequest;
  } catch {
    return buildErrorResponse('Invalid request payload', 400);
  }

  try {
    switch (payload.action) {
      case 'forecast': {
        const result = await forecastWithServiceRole(client, payload.filters);
        return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      case 'status': {
        const status: ForecastGenerationMetadata = {
          hasHistorical: false,
          hasExternalSignals: false,
          hasExistingTargets: false,
          apiAvailable: Boolean(FORECAST_API_URL),
          usedApi: false,
          usedFallback: false,
          apiCallFailed: false,
          fallbackReason: undefined,
        };

        const [historical, signals, existingTargets] = await Promise.all([
          fetchHistoricalShifts(client, payload.filters),
          fetchExternalSignals(client, payload.filters),
          fetchExistingTargets(client, payload.filters),
        ]);

        status.hasHistorical = historical.length > 0;
        status.hasExternalSignals = signals.length > 0;
        status.hasExistingTargets = existingTargets.length > 0;

        return new Response(JSON.stringify(status), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      case 'upsertTargets': {
        const targets = payload.targets?.map((target) => ({ ...target, required: Number(target.required) })) ?? [];
        const result = await upsertTargets(client, targets);
        const statusCode = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
      }
      case 'loadTargets': {
        const targets = await fetchExistingTargets(client, payload.filters);
        return new Response(JSON.stringify({ targets }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'upsertOnboarding': {
        const { accountId, flags, userId } = payload;
        if (!accountId || !flags) {
          return buildErrorResponse('Missing onboarding payload', 400);
        }
        const result = await upsertOnboarding(client, accountId, flags, userId);
        const statusCode = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
      }
      default:
        return buildErrorResponse('Unsupported action', 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Secure proxy request failed', error);
    return buildErrorResponse(message, 500);
  }
}
