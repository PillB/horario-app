import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { createPublicKey, createVerify } from 'crypto';

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

const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL;
const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

type JWK = { kid?: string; kty: string; n: string; e: string; alg?: string; use?: string };
type JWKSet = { keys: JWK[] };

let jwksCache: JWKSet | null = null;
let jwksCacheExpiry = 0;

async function fetchJwks(): Promise<JWKSet> {
  if (jwksCache && Date.now() < jwksCacheExpiry) return jwksCache;
  const res = await fetch(CLERK_JWKS_URL!);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  jwksCache = (await res.json()) as JWKSet;
  jwksCacheExpiry = Date.now() + 5 * 60 * 1000; // 5 min
  return jwksCache;
}

async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { kid?: string; alg?: string };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { sub?: string; exp?: number };
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    const jwks = await fetchJwks();
    const jwk = (header.kid ? jwks.keys.find(k => k.kid === header.kid) : jwks.keys[0]);
    if (!jwk) return null;
    const publicKey = createPublicKey({ key: jwk as Parameters<typeof createPublicKey>[0], format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(publicKey, parts[2], 'base64url');
    return valid ? (payload.sub ?? null) : null;
  } catch {
    return null;
  }
}

async function getAuthorizedAccountId(request: Request): Promise<string | null> {
  if (!AUTH_ENABLED) return null;
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyClerkToken(auth.slice(7));
}

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

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// When auth is enabled, authorizedAccountId is the verified JWT sub.
// When disabled (dev), fall back to the account ID from the request body.
const resolveAccountId = (authorizedId: string | null, bodyId: string): string =>
  authorizedId ?? bodyId;

// ─── Shared validators ────────────────────────────────────────────────────────

const isHHMM = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

const isDayOfWeek = (v: unknown): v is string =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(v as string);

const isShiftStatus = (v: unknown): v is 'Draft' | 'Published' =>
  v === 'Draft' || v === 'Published';

const isISODate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const isNonEmptyString = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

// ─── Workers ─────────────────────────────────────────────────────────────────

type WorkerRow = {
  id: string;
  account_id: string;
  name: string;
  role: string;
  skills: string[];
  created_at?: string;
};

const rowToWorker = (row: WorkerRow) => ({
  id: row.id,
  accountId: row.account_id,
  name: row.name,
  role: row.role,
  skills: row.skills ?? [],
  createdAt: row.created_at,
});

const dbListWorkers = async (client: SupabaseClient, accountId: string) => {
  const { data, error } = await client
    .from('workers')
    .select('id, account_id, name, role, skills, created_at')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
    .limit(500);
  if (error) return { success: false as const, error: error.message, workers: [] };
  return { success: true as const, workers: (data ?? []).map(rowToWorker) };
};

const dbUpsertWorker = async (
  client: SupabaseClient,
  worker: { id?: string; accountId: string; name: string; role: string; skills?: string[] }
) => {
  if (!isNonEmptyString(worker.name, 100)) return { success: false as const, error: 'name is required (max 100 chars)' };
  if (!isNonEmptyString(worker.role, 100)) return { success: false as const, error: 'role is required (max 100 chars)' };
  if (!isNonEmptyString(worker.accountId)) return { success: false as const, error: 'accountId is required' };

  const payload: Record<string, unknown> = {
    account_id: worker.accountId,
    name: worker.name.trim(),
    role: worker.role.trim(),
    skills: worker.skills ?? [],
  };
  if (worker.id) payload.id = worker.id;

  const { data, error } = await client
    .from('workers')
    .upsert(payload, { onConflict: 'id' })
    .select('id, account_id, name, role, skills, created_at')
    .single();
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, worker: rowToWorker(data as WorkerRow) };
};

const dbDeleteWorker = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('workers').delete().eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

// ─── Worker Availability ──────────────────────────────────────────────────────

type AvailabilityRow = {
  id: string;
  account_id: string;
  worker_id: string;
  day_of_week: string;
  from_time: string;
  to_time: string;
};

const rowToAvailability = (row: AvailabilityRow) => ({
  id: row.id,
  accountId: row.account_id,
  workerId: row.worker_id,
  dayOfWeek: row.day_of_week,
  fromTime: row.from_time,
  toTime: row.to_time,
});

const dbUpsertAvailability = async (
  client: SupabaseClient,
  av: { id?: string; accountId: string; workerId: string; dayOfWeek: string; fromTime: string; toTime: string }
) => {
  if (!isDayOfWeek(av.dayOfWeek)) return { success: false as const, error: 'dayOfWeek must be Mon–Sun' };
  if (!isHHMM(av.fromTime)) return { success: false as const, error: 'fromTime must be HH:MM' };
  if (!isHHMM(av.toTime)) return { success: false as const, error: 'toTime must be HH:MM' };
  if (av.fromTime >= av.toTime) return { success: false as const, error: 'fromTime must be earlier than toTime' };

  const payload: Record<string, unknown> = {
    account_id: av.accountId,
    worker_id: av.workerId,
    day_of_week: av.dayOfWeek,
    from_time: av.fromTime,
    to_time: av.toTime,
  };
  if (av.id) payload.id = av.id;

  const { data, error } = await client
    .from('worker_availability')
    .upsert(payload, { onConflict: 'worker_id,day_of_week,from_time' })
    .select('id, account_id, worker_id, day_of_week, from_time, to_time')
    .single();
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, availability: rowToAvailability(data as AvailabilityRow) };
};

const dbDeleteAvailability = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('worker_availability').delete().eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

const dbListWorkerAvailability = async (client: SupabaseClient, accountId: string) => {
  const { data, error } = await client
    .from('worker_availability')
    .select('id, account_id, worker_id, day_of_week, from_time, to_time')
    .eq('account_id', accountId)
    .order('worker_id', { ascending: true })
    .limit(2000);
  if (error) return { success: false as const, error: error.message, availabilities: [] };
  return { success: true as const, availabilities: (data ?? []).map(rowToAvailability) };
};

// ─── Shift Templates ──────────────────────────────────────────────────────────

type TemplateRow = {
  id: string;
  account_id: string;
  name: string;
  role: string;
  start_time: string;
  end_time: string;
  coverage: number;
  created_at?: string;
};

const rowToTemplate = (row: TemplateRow) => ({
  id: row.id,
  accountId: row.account_id,
  name: row.name,
  role: row.role,
  startTime: row.start_time,
  endTime: row.end_time,
  coverage: row.coverage,
  createdAt: row.created_at,
});

const dbListShiftTemplates = async (client: SupabaseClient, accountId: string) => {
  const { data, error } = await client
    .from('shift_templates')
    .select('id, account_id, name, role, start_time, end_time, coverage, created_at')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
    .limit(500);
  if (error) return { success: false as const, error: error.message, templates: [] };
  return { success: true as const, templates: (data ?? []).map(rowToTemplate) };
};

const dbUpsertShiftTemplate = async (
  client: SupabaseClient,
  tmpl: { id?: string; accountId: string; name: string; role: string; startTime: string; endTime: string; coverage: number }
) => {
  if (!isNonEmptyString(tmpl.name, 100)) return { success: false as const, error: 'name is required (max 100 chars)' };
  if (!isNonEmptyString(tmpl.role, 100)) return { success: false as const, error: 'role is required (max 100 chars)' };
  if (!isHHMM(tmpl.startTime)) return { success: false as const, error: 'startTime must be HH:MM' };
  if (!isHHMM(tmpl.endTime)) return { success: false as const, error: 'endTime must be HH:MM' };
  if (tmpl.startTime >= tmpl.endTime) return { success: false as const, error: 'startTime must be before endTime' };
  if (!Number.isInteger(tmpl.coverage) || tmpl.coverage < 1) return { success: false as const, error: 'coverage must be >= 1' };

  const payload: Record<string, unknown> = {
    account_id: tmpl.accountId,
    name: tmpl.name.trim(),
    role: tmpl.role.trim(),
    start_time: tmpl.startTime,
    end_time: tmpl.endTime,
    coverage: tmpl.coverage,
  };
  if (tmpl.id) payload.id = tmpl.id;

  const { data, error } = await client
    .from('shift_templates')
    .upsert(payload, { onConflict: 'id' })
    .select('id, account_id, name, role, start_time, end_time, coverage, created_at')
    .single();
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, template: rowToTemplate(data as TemplateRow) };
};

const dbDeleteShiftTemplate = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('shift_templates').delete().eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

// ─── Roster ───────────────────────────────────────────────────────────────────

type RosterRow = {
  id: string;
  account_id: string;
  date: string;
  worker_id: string;
  template_id: string;
  location: string;
  status: string;
  notified: boolean;
  created_at?: string;
  updated_at?: string;
};

const rowToRosterShift = (row: RosterRow) => ({
  id: row.id,
  accountId: row.account_id,
  date: row.date,
  workerId: row.worker_id,
  templateId: row.template_id,
  location: row.location ?? '',
  status: row.status as 'Draft' | 'Published',
  notified: row.notified,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const dbListRoster = async (
  client: SupabaseClient,
  accountId: string,
  fromDate?: string,
  toDate?: string
) => {
  const query = client
    .from('roster')
    .select('id, account_id, date, worker_id, template_id, location, status, notified, created_at, updated_at')
    .eq('account_id', accountId)
    .order('date', { ascending: true })
    .limit(500);

  if (fromDate) query.gte('date', fromDate);
  if (toDate) query.lte('date', toDate);

  const { data, error } = await query;
  if (error) return { success: false as const, error: error.message, shifts: [] };
  return { success: true as const, shifts: (data ?? []).map(rowToRosterShift) };
};

const dbUpsertRosterShift = async (
  client: SupabaseClient,
  shift: { id?: string; accountId: string; date: string; workerId: string; templateId: string; location?: string; status?: string; notified?: boolean }
) => {
  if (!isISODate(shift.date)) return { success: false as const, error: 'date must be YYYY-MM-DD' };
  if (!isNonEmptyString(shift.workerId)) return { success: false as const, error: 'workerId is required' };
  if (!isNonEmptyString(shift.templateId)) return { success: false as const, error: 'templateId is required' };
  if (shift.status && !isShiftStatus(shift.status)) return { success: false as const, error: 'status must be Draft or Published' };

  const payload: Record<string, unknown> = {
    account_id: shift.accountId,
    date: shift.date,
    worker_id: shift.workerId,
    template_id: shift.templateId,
    location: (shift.location ?? '').slice(0, 200),
    status: shift.status ?? 'Draft',
    notified: shift.notified ?? false,
  };
  if (shift.id) payload.id = shift.id;

  const { data, error } = await client
    .from('roster')
    .upsert(payload, { onConflict: 'id' })
    .select('id, account_id, date, worker_id, template_id, location, status, notified, created_at, updated_at')
    .single();
  if (error) return { success: false as const, error: error.message };
  return { success: true as const, shift: rowToRosterShift(data as RosterRow) };
};

const dbUpdateShiftStatus = async (client: SupabaseClient, id: string, status: string) => {
  if (!isShiftStatus(status)) return { success: false as const, error: 'status must be Draft or Published' };
  const { error } = await client.from('roster').update({ status }).eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

const dbMarkShiftNotified = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('roster').update({ notified: true }).eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

const dbDeleteRosterShift = async (client: SupabaseClient, id: string) => {
  const { error } = await client.from('roster').delete().eq('id', id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
};

// ─── Usage limits ─────────────────────────────────────────────────────────────

const FREE_AUTO_ASSIGN_LIMIT = 1;

type UsageLimitRow = {
  user_id: string;
  account_id: string;
  auto_assign_count: number;
};

const dbGetUsageLimit = async (client: SupabaseClient, userId: string, accountId: string) => {
  const { data, error } = await client
    .from('usage_limits')
    .select('user_id, account_id, auto_assign_count')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  const count = (data as UsageLimitRow | null)?.auto_assign_count ?? 0;
  return { success: true as const, count, canAutoAssign: count < FREE_AUTO_ASSIGN_LIMIT };
};

const dbIncrementAutoAssign = async (client: SupabaseClient, userId: string, accountId: string) => {
  if (!isNonEmptyString(userId, 200) || !isNonEmptyString(accountId, 200)) {
    return { success: false as const, error: 'userId and accountId are required' };
  }
  const { data, error } = await client
    .from('usage_limits')
    .upsert(
      { user_id: userId, account_id: accountId, auto_assign_count: 1 },
      { onConflict: 'user_id,account_id', ignoreDuplicates: false }
    )
    .select('auto_assign_count')
    .maybeSingle();

  if (error) {
    const { data: existing } = await client
      .from('usage_limits')
      .select('auto_assign_count')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    const currentCount = (existing as UsageLimitRow | null)?.auto_assign_count ?? 0;
    const { error: updateError } = await client
      .from('usage_limits')
      .update({ auto_assign_count: currentCount + 1 })
      .eq('user_id', userId)
      .eq('account_id', accountId);
    if (updateError) return { success: false as const, error: updateError.message };
    return { success: true as const, count: currentCount + 1 };
  }

  const newCount = (data as UsageLimitRow | null)?.auto_assign_count ?? 1;
  return { success: true as const, count: newCount };
};

// ─── ProxyRequest union ───────────────────────────────────────────────────────

type ProxyRequest =
  | { action: 'forecast'; filters?: ForecastFilters }
  | { action: 'status'; filters?: ForecastFilters }
  | { action: 'loadTargets'; filters?: ForecastFilters }
  | { action: 'upsertTargets'; targets: DemandForecast[] }
  | { action: 'upsertOnboarding'; accountId: string; flags: OnboardingProgress; userId?: string | null }
  | { action: 'listWorkers'; accountId: string }
  | { action: 'upsertWorker'; worker: Record<string, unknown> }
  | { action: 'deleteWorker'; id: string }
  | { action: 'listWorkerAvailability'; accountId: string }
  | { action: 'upsertAvailability'; availability: Record<string, unknown> }
  | { action: 'deleteAvailability'; id: string }
  | { action: 'listShiftTemplates'; accountId: string }
  | { action: 'upsertShiftTemplate'; template: Record<string, unknown> }
  | { action: 'deleteShiftTemplate'; id: string }
  | { action: 'listRoster'; accountId: string; fromDate?: string; toDate?: string }
  | { action: 'upsertRosterShift'; shift: Record<string, unknown> }
  | { action: 'updateShiftStatus'; id: string; status: string }
  | { action: 'markShiftNotified'; id: string }
  | { action: 'deleteRosterShift'; id: string }
  | { action: 'getUsageLimit'; userId: string; accountId: string }
  | { action: 'incrementAutoAssign'; userId: string; accountId: string };

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let client: SupabaseClient;
  try {
    client = getServiceClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to initialize service client';
    return buildErrorResponse(message, 500);
  }

  // Verify Clerk JWT when auth is enabled; extract sub as authoritative accountId.
  const authorizedAccountId = await getAuthorizedAccountId(request);
  if (AUTH_ENABLED && !authorizedAccountId) {
    return buildErrorResponse('Unauthorized', 401);
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
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
      }
      case 'loadTargets': {
        const targets = await fetchExistingTargets(client, payload.filters);
        return new Response(JSON.stringify({ targets }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      case 'upsertOnboarding': {
        const acctId = resolveAccountId(authorizedAccountId, payload.accountId);
        if (!acctId || !payload.flags) return buildErrorResponse('Missing onboarding payload', 400);
        const result = await upsertOnboarding(client, acctId, payload.flags, payload.userId);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
      }
      case 'listWorkers': {
        const result = await dbListWorkers(client, resolveAccountId(authorizedAccountId, payload.accountId));
        return result.success ? jsonOk({ workers: result.workers }) : buildErrorResponse(result.error, 400);
      }
      case 'upsertWorker': {
        const worker = { ...payload.worker as Parameters<typeof dbUpsertWorker>[1], accountId: resolveAccountId(authorizedAccountId, (payload.worker as Record<string, unknown>).accountId as string) };
        const result = await dbUpsertWorker(client, worker);
        return result.success ? jsonOk({ success: true, worker: result.worker }) : buildErrorResponse(result.error, 400);
      }
      case 'deleteWorker': {
        const result = await dbDeleteWorker(client, payload.id);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'listWorkerAvailability': {
        const result = await dbListWorkerAvailability(client, resolveAccountId(authorizedAccountId, payload.accountId));
        return result.success ? jsonOk({ availabilities: result.availabilities }) : buildErrorResponse(result.error, 400);
      }
      case 'upsertAvailability': {
        const av = { ...payload.availability as Parameters<typeof dbUpsertAvailability>[1], accountId: resolveAccountId(authorizedAccountId, (payload.availability as Record<string, unknown>).accountId as string) };
        const result = await dbUpsertAvailability(client, av);
        return result.success ? jsonOk({ success: true, availability: result.availability }) : buildErrorResponse(result.error, 400);
      }
      case 'deleteAvailability': {
        const result = await dbDeleteAvailability(client, payload.id);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'listShiftTemplates': {
        const result = await dbListShiftTemplates(client, resolveAccountId(authorizedAccountId, payload.accountId));
        return result.success ? jsonOk({ templates: result.templates }) : buildErrorResponse(result.error, 400);
      }
      case 'upsertShiftTemplate': {
        const tmpl = { ...payload.template as Parameters<typeof dbUpsertShiftTemplate>[1], accountId: resolveAccountId(authorizedAccountId, (payload.template as Record<string, unknown>).accountId as string) };
        const result = await dbUpsertShiftTemplate(client, tmpl);
        return result.success ? jsonOk({ success: true, template: result.template }) : buildErrorResponse(result.error, 400);
      }
      case 'deleteShiftTemplate': {
        const result = await dbDeleteShiftTemplate(client, payload.id);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'listRoster': {
        const result = await dbListRoster(client, resolveAccountId(authorizedAccountId, payload.accountId), payload.fromDate, payload.toDate);
        return result.success ? jsonOk({ shifts: result.shifts }) : buildErrorResponse(result.error, 400);
      }
      case 'upsertRosterShift': {
        const shift = { ...payload.shift as Parameters<typeof dbUpsertRosterShift>[1], accountId: resolveAccountId(authorizedAccountId, (payload.shift as Record<string, unknown>).accountId as string) };
        const result = await dbUpsertRosterShift(client, shift);
        return result.success ? jsonOk({ success: true, shift: result.shift }) : buildErrorResponse(result.error, 400);
      }
      case 'updateShiftStatus': {
        const result = await dbUpdateShiftStatus(client, payload.id, payload.status);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'markShiftNotified': {
        const result = await dbMarkShiftNotified(client, payload.id);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'deleteRosterShift': {
        const result = await dbDeleteRosterShift(client, payload.id);
        return result.success ? jsonOk({ success: true }) : buildErrorResponse(result.error, 400);
      }
      case 'getUsageLimit': {
        const acct = resolveAccountId(authorizedAccountId, payload.accountId);
        const uid = resolveAccountId(authorizedAccountId, payload.userId);
        const result = await dbGetUsageLimit(client, uid, acct);
        return result.success
          ? jsonOk({ count: result.count, canAutoAssign: result.canAutoAssign })
          : buildErrorResponse(result.error, 400);
      }
      case 'incrementAutoAssign': {
        const acct = resolveAccountId(authorizedAccountId, payload.accountId);
        const uid = resolveAccountId(authorizedAccountId, payload.userId);
        const result = await dbIncrementAutoAssign(client, uid, acct);
        return result.success
          ? jsonOk({ success: true, count: result.count })
          : buildErrorResponse(result.error, 400);
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
