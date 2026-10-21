/**
 * Secure proxy: the only place the Supabase service-role key is used.
 *
 * The service-role client bypasses row-level security, so this file is the
 * tenant boundary. Every statement is scoped by the tenant taken from the
 * verified Clerk session (server/proxyAuth.ts) — never by an id the client
 * sends. Rules:
 *   - reads filter by account_id;
 *   - updates and deletes match id AND account_id, and report 404 when no row
 *     matched;
 *   - writes that reference another row (availability → worker, roster →
 *     worker and template) first check that row belongs to the same tenant;
 *   - an upsert with a client-generated id updates only the caller's row; if
 *     no such row exists it inserts, and a primary-key clash with another
 *     tenant's row fails instead of overwriting it.
 * Database error details are logged, not returned to the client.
 */
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { authenticate, type AuthContext } from '@/server/proxyAuth';
import { jsonResponse, optionsResponse } from '@/server/http';
import {
  DemandForecast,
  ForecastFilters,
  ForecastGenerationMetadata,
  ForecastGenerationResult,
} from '@/services/demandForecast';
import { resolvePack } from '@/services/labor/engine';
import { validateOverrides } from '@/services/labor/overrides';
import { OnboardingProgress } from '@/services/onboardingProgress';
import { isDateKey, todayKey } from '@/utils/dateKeys';
import {
  type BusinessLocation,
  type LocationHistoryEntry,
  type LocationHistoryValues,
  validateLocationInput,
} from '@/utils/locationValidation';
import { validateWorkerLabor } from '@/utils/workerLaborValidation';

const FORECAST_API_URL = process.env.EXPO_PUBLIC_FORECAST_API_URL;

export const runtime = 'nodejs';

// ─── Result plumbing ──────────────────────────────────────────────────────────

type Result = { status: number; body: unknown };

const ok = (body: unknown): Result => ({ status: 200, body });
const fail = (status: number, error: string): Result => ({ status, body: { error } });
const badRequest = (error: string) => fail(400, error);
const notFound = () => fail(404, 'Not found');

/** Deletes and billing changes need a personal account or an org admin. */
const MANAGER_ACTIONS = new Set([
  'deleteWorker',
  'deleteAvailability',
  'deleteShiftTemplate',
  'deleteRosterShift',
  // A location decides which labor rules apply, so only admins set it (QA, CHG-080).
  'upsertLocation',
  'deleteLocation',
  'cancelSubscription',
  'createCheckoutSession',
  'createBillingPortalSession',
]);

/** Logs the database error and returns a generic message. */
const dbFailure = (context: string, error: { message?: string; code?: string } | null): Result => {
  console.error(`[secure-proxy] ${context}:`, error?.code ?? '', error?.message ?? error);
  if (error?.code === '23505') return fail(409, 'Conflicting record');
  if (error?.code === '23503') return fail(409, 'Record is still referenced');
  return fail(500, 'Database request failed');
};

const getServiceClient = (): SupabaseClient | null => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'horario-secure-proxy' } },
  });
};

// ─── Validators ───────────────────────────────────────────────────────────────

const isHHMM = (v: unknown): v is string =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const isDayOfWeek = (v: unknown): v is string =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(v as string);

const isShiftStatus = (v: unknown): v is 'Draft' | 'Published' =>
  v === 'Draft' || v === 'Published';

/**
 * A real calendar date as YYYY-MM-DD. `isDateKey` round-trips the parts, so 2026-02-31
 * is refused (Date.parse rolls it over to 2026-03-03, and Postgres then rejects it with
 * a 500) (CHG-087).
 */
const isISODate = (v: unknown): v is string => typeof v === 'string' && isDateKey(v);

const isNonEmptyString = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── Tenant-scoped write helpers ──────────────────────────────────────────────

/**
 * Updates the caller's row when `id` names one, otherwise inserts. Never
 * touches another tenant's row: the update matches id AND account_id, and an
 * insert reusing another tenant's id fails on the primary key.
 */
async function updateOrInsert<Row>(
  client: SupabaseClient,
  table: string,
  ctx: AuthContext,
  id: string | undefined,
  values: Record<string, unknown>,
  columns: string,
): Promise<{ row: Row } | { error: Result }> {
  if (id !== undefined) {
    if (!isUuid(id)) return { error: badRequest('id must be a UUID') };
    const { data, error } = await client
      .from(table)
      .update(values)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(columns)
      .maybeSingle();
    if (error) return { error: dbFailure(`update ${table}`, error) };
    if (data) return { row: data as Row };
  }

  const insertValues = { ...values, account_id: ctx.accountId, ...(id !== undefined ? { id } : {}) };
  const { data, error } = await client.from(table).insert(insertValues).select(columns).single();
  if (error) return { error: dbFailure(`insert ${table}`, error) };
  return { row: data as Row };
}

async function deleteOwned(client: SupabaseClient, table: string, ctx: AuthContext, id: unknown): Promise<Result> {
  if (!isUuid(id)) return badRequest('id must be a UUID');
  const { data, error } = await client
    .from(table)
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id');
  if (error) return dbFailure(`delete ${table}`, error);
  return (data ?? []).length ? ok({ success: true }) : notFound();
}

async function updateOwned(
  client: SupabaseClient,
  table: string,
  ctx: AuthContext,
  id: unknown,
  values: Record<string, unknown>,
): Promise<Result> {
  if (!isUuid(id)) return badRequest('id must be a UUID');
  const { data, error } = await client
    .from(table)
    .update(values)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id');
  if (error) return dbFailure(`update ${table}`, error);
  return (data ?? []).length ? ok({ success: true }) : notFound();
}

/** True when every id exists in `table` for the caller's tenant. */
async function ownsAll(client: SupabaseClient, table: string, ctx: AuthContext, ids: string[]): Promise<boolean | Result> {
  const unique = Array.from(new Set(ids));
  if (!unique.every(isUuid)) return badRequest('referenced id must be a UUID');
  const { data, error } = await client
    .from(table)
    .select('id')
    .eq('account_id', ctx.accountId)
    .in('id', unique);
  if (error) return dbFailure(`ownership check ${table}`, error);
  return (data ?? []).length === unique.length;
}

// ─── Forecasting ──────────────────────────────────────────────────────────────

type HistoricalShift = { date: string; role: string; hours?: number; worker_id?: string };
type ExternalSignal = { date: string; role?: string; signal_type?: string; weight?: number };

const roundToInt = (value: number) => Math.max(0, Math.round(value));
const buildKey = (item: { date: string; role: string }) => `${item.date}::${item.role}`;

/** 400 message for forecast filters with a date that is not a real YYYY-MM-DD date, else null. */
const filtersDateError = (filters: unknown): string | null =>
  isRecord(filters) && filters.date !== undefined && filters.date !== null && filters.date !== '' && !isISODate(filters.date)
    ? 'filters.date must be a real YYYY-MM-DD date'
    : null;

const cleanFilters = (filters: unknown): ForecastFilters | undefined => {
  if (!isRecord(filters)) return undefined;
  const result: ForecastFilters = {};
  if (isISODate(filters.date)) result.date = filters.date;
  if (isNonEmptyString(filters.role, 100)) result.role = filters.role;
  return result;
};

const fetchHistoricalShifts = async (client: SupabaseClient, ctx: AuthContext, filters?: ForecastFilters) => {
  let query = client
    .from('shifts')
    .select('date, role, worker_id, hours')
    .eq('account_id', ctx.accountId)
    .order('date', { ascending: true })
    .limit(500);
  if (filters?.date) query = query.eq('date', filters.date);
  if (filters?.role) query = query.eq('role', filters.role);
  const { data, error } = await query;
  if (error) {
    console.warn('[secure-proxy] historical shifts unavailable:', error.message);
    return [] as HistoricalShift[];
  }
  return (data ?? []).map((s) => ({ date: s.date, role: s.role, hours: s.hours ?? 8, worker_id: s.worker_id }));
};

const fetchExternalSignals = async (client: SupabaseClient, ctx: AuthContext, filters?: ForecastFilters) => {
  let query = client
    .from('external_signals')
    .select('date, role, signal_type, weight')
    .eq('account_id', ctx.accountId)
    .order('date', { ascending: true })
    .limit(200);
  if (filters?.date) query = query.eq('date', filters.date);
  if (filters?.role) query = query.eq('role', filters.role);
  const { data, error } = await query;
  if (error) {
    console.warn('[secure-proxy] external signals unavailable:', error.message);
    return [] as ExternalSignal[];
  }
  return (data ?? []) as ExternalSignal[];
};

const fetchExistingTargets = async (
  client: SupabaseClient,
  ctx: AuthContext,
  filters?: ForecastFilters,
): Promise<DemandForecast[]> => {
  let query = client
    .from('demand_targets')
    .select('date, role, required, notes, confidence, lower_bound, upper_bound, source')
    .eq('account_id', ctx.accountId)
    .order('date', { ascending: true })
    .limit(500);
  if (filters?.date) query = query.eq('date', filters.date);
  if (filters?.role) query = query.eq('role', filters.role);
  const { data, error } = await query;
  if (error) {
    console.warn('[secure-proxy] demand targets unavailable:', error.message);
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

const toTargetRow = (ctx: AuthContext, t: DemandForecast, defaultSource: 'model' | 'override') => ({
  account_id: ctx.accountId,
  date: t.date,
  role: t.role,
  required: t.required,
  notes: t.notes,
  confidence: t.confidence,
  lower_bound: t.lowerBound,
  upper_bound: t.upperBound,
  source: t.source ?? defaultSource,
});

const callForecastApi = async (inputs: { shifts: HistoricalShift[]; signals: ExternalSignal[]; filters?: ForecastFilters }) => {
  if (!FORECAST_API_URL) return { forecasts: [] as DemandForecast[], attempted: false, failed: false };
  try {
    const response = await fetch(FORECAST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!response.ok) {
      console.warn(`[secure-proxy] forecast API responded with status ${response.status}`);
      return { forecasts: [] as DemandForecast[], attempted: true, failed: true };
    }
    const payload = (await response.json()) as DemandForecast[];
    const forecasts = (Array.isArray(payload) ? payload : [])
      .filter((item) => isISODate(item?.date) && isNonEmptyString(item?.role, 100))
      .map((item) => ({ ...item, required: roundToInt(Number(item.required ?? 0)), source: item.source ?? 'model' }));
    return { forecasts, attempted: true, failed: false };
  } catch (error) {
    console.warn('[secure-proxy] forecast API call failed', error);
    return { forecasts: [] as DemandForecast[], attempted: true, failed: true };
  }
};

async function generateForecast(client: SupabaseClient, ctx: AuthContext, filters?: ForecastFilters): Promise<ForecastGenerationResult> {
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

  const [shifts, signals, stored] = await Promise.all([
    fetchHistoricalShifts(client, ctx, filters),
    fetchExternalSignals(client, ctx, filters),
    fetchExistingTargets(client, ctx, filters),
  ]);
  metadata.hasHistorical = shifts.length > 0;
  metadata.hasExternalSignals = signals.length > 0;
  metadata.hasExistingTargets = stored.length > 0;

  const api = await callForecastApi({ shifts, signals, filters });
  metadata.usedApi = api.forecasts.length > 0;
  metadata.apiCallFailed = api.failed;
  metadata.usedFallback = !metadata.usedApi;
  if (metadata.usedFallback) {
    // The statistical forecast runs on the client (services/forecasting/):
    // Workers Free allows 10 ms of CPU per request, so this route only
    // fetches history (forecastHistory, listForecastSignals).
    metadata.fallbackReason = !metadata.apiAvailable
      ? 'Forecast API is not configured; use the statistical forecast.'
      : api.failed
        ? 'Forecast API request failed; use the statistical forecast.'
        : 'Forecast API returned no data; use the statistical forecast.';
  }

  const generated = metadata.usedApi ? api.forecasts : [];
  const lookup = new Map<string, DemandForecast>();
  generated.forEach((f) => lookup.set(buildKey(f), f));
  stored.filter((t) => t.source === 'override').forEach((o) => lookup.set(buildKey(o), o));
  const merged = Array.from(lookup.values());

  const modelRows = merged.filter((f) => f.source !== 'override').map((f) => toTargetRow(ctx, f, 'model'));
  if (modelRows.length) {
    const { error } = await client.from('demand_targets').upsert(modelRows, { onConflict: 'account_id,date,role' });
    if (error) console.warn('[secure-proxy] unable to persist demand targets:', error.message);
  }
  return { forecasts: merged, metadata };
}

/** Rows per history page (Supabase's default max-rows). */
const FORECAST_HISTORY_PAGE_SIZE = 1000;
/** Pages a client may request: 40 000 shifts, newest first. */
const FORECAST_HISTORY_MAX_PAGES = 40;
/** Longest history window, in days (3 years). */
const FORECAST_HISTORY_MAX_DAYS = 1100;

const daysBetweenIso = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Validates a [from, to) date window; returns an error message or null. */
const historyWindowError = (from: unknown, to: unknown): string | null => {
  if (!isISODate(from) || !isISODate(to)) return 'from and to must be YYYY-MM-DD dates';
  const span = daysBetweenIso(from, to);
  if (span <= 0) return 'from must be before to';
  if (span > FORECAST_HISTORY_MAX_DAYS) return `The window is limited to ${FORECAST_HISTORY_MAX_DAYS} days`;
  return null;
};

/**
 * One page of shift history in [from, to), newest first, summed per date ×
 * role ({ date, role, shifts, hours }). The client adds the pages up and fits
 * the forecast itself; this action does no modelling. Page 0 also returns the
 * total row count so the client can fetch the other pages in parallel.
 */
async function forecastHistory(client: SupabaseClient, ctx: AuthContext, p: Record<string, unknown>): Promise<Result> {
  const windowError = historyWindowError(p.from, p.to);
  if (windowError) return badRequest(windowError);
  if (p.role !== undefined && !isNonEmptyString(p.role, 100)) return badRequest('role must be a non-empty string');
  const page = p.page === undefined ? 0 : Number(p.page);
  if (!Number.isInteger(page) || page < 0 || page >= FORECAST_HISTORY_MAX_PAGES) {
    return badRequest(`page must be an integer from 0 to ${FORECAST_HISTORY_MAX_PAGES - 1}`);
  }
  const offset = page * FORECAST_HISTORY_PAGE_SIZE;
  let query = client
    .from('shifts')
    .select('date, role, hours', page === 0 ? { count: 'exact' } : undefined)
    .eq('account_id', ctx.accountId)
    .gte('date', p.from as string)
    .lt('date', p.to as string);
  if (typeof p.role === 'string') query = query.eq('role', p.role);
  const { data, error, count } = await query
    .order('date', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + FORECAST_HISTORY_PAGE_SIZE - 1);
  if (error) return dbFailure('select shifts history', error);
  const rows = data ?? [];
  const days = new Map<string, { date: string; role: string; shifts: number; hours: number }>();
  for (const row of rows) {
    const key = buildKey(row);
    const day = days.get(key) ?? { date: row.date, role: row.role, shifts: 0, hours: 0 };
    day.shifts += 1;
    day.hours += Number(row.hours ?? 0);
    days.set(key, day);
  }
  return ok({
    days: Array.from(days.values()),
    page,
    pageSize: FORECAST_HISTORY_PAGE_SIZE,
    rows: rows.length,
    total: page === 0 ? count ?? null : null,
  });
}

/** Most signals one listForecastSignals call returns. */
const FORECAST_SIGNALS_LIMIT = 1000;

type SignalRow = { date: string; role: string | null; signal_type: string | null; weight: number | string | null };

/**
 * External signals in [from, to); with a role, that role's and the global ones. At most
 * FORECAST_SIGNALS_LIMIT are returned, and `truncated` says whether some were left out
 * (CHG-087). With `targetsFrom` (the first forecast date, inside the window) the
 * signals in [targetsFrom, to) come first, nearest first, and the history signals fill
 * the rest, newest first; without it the window is read newest first. Either way the
 * oldest history signals are the ones dropped, never the future ones being forecast
 * (before, the window was read oldest first and the future was cut off).
 */
async function listForecastSignals(client: SupabaseClient, ctx: AuthContext, p: Record<string, unknown>): Promise<Result> {
  const windowError = historyWindowError(p.from, p.to);
  if (windowError) return badRequest(windowError);
  if (p.role !== undefined && !isNonEmptyString(p.role, 100)) return badRequest('role must be a non-empty string');
  const from = p.from as string;
  const to = p.to as string;
  if (p.targetsFrom !== undefined && (!isISODate(p.targetsFrom) || p.targetsFrom <= from || p.targetsFrom > to)) {
    return badRequest('targetsFrom must be a YYYY-MM-DD date after from and not after to');
  }
  const split = p.targetsFrom as string | undefined;
  // Each query asks for one row more than it may keep, to tell whether rows were left out.
  const read = (gte: string, lt: string, ascending: boolean) => {
    let query = client
      .from('external_signals')
      .select('date, role, signal_type, weight')
      .eq('account_id', ctx.accountId)
      .gte('date', gte)
      .lt('date', lt);
    if (typeof p.role === 'string') query = query.in('role', [p.role, 'global']);
    return query.order('date', { ascending }).limit(FORECAST_SIGNALS_LIMIT + 1);
  };
  const [future, past] = await Promise.all(
    split ? [read(split, to, true), read(from, split, false)] : [read(from, to, false)],
  );
  if (future.error) return dbFailure('select external_signals', future.error);
  if (past?.error) return dbFailure('select external_signals', past.error);
  const futureRows = (future.data ?? []) as SignalRow[];
  const pastRows = (past?.data ?? []) as SignalRow[];
  const keptFuture = futureRows.slice(0, FORECAST_SIGNALS_LIMIT);
  const room = FORECAST_SIGNALS_LIMIT - keptFuture.length;
  const keptPast = pastRows.slice(0, room);
  const truncated = futureRows.length > keptFuture.length || pastRows.length > keptPast.length;
  return ok({
    signals: [...keptFuture, ...keptPast].map((s) => ({ ...s, weight: s.weight === null ? null : Number(s.weight) })),
    truncated,
  });
}

/** True when the tenant has at least one row in `table` (matching the filters). */
async function hasRows(client: SupabaseClient, table: string, ctx: AuthContext, filters?: ForecastFilters): Promise<boolean> {
  let query = client.from(table).select('date').eq('account_id', ctx.accountId);
  if (filters?.date) query = query.eq('date', filters.date);
  if (filters?.role) query = query.eq('role', filters.role);
  const { data, error } = await query.limit(1);
  if (error) {
    console.warn(`[secure-proxy] ${table} unavailable:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

async function upsertTargets(client: SupabaseClient, ctx: AuthContext, targets: unknown): Promise<Result> {
  if (!Array.isArray(targets)) return badRequest('targets must be an array');
  if (targets.length > 500) return badRequest('Maximum 500 targets per request');
  const valid: DemandForecast[] = [];
  for (const t of targets) {
    if (!isRecord(t) || !isISODate(t.date) || !isNonEmptyString(t.role, 100)) return badRequest('Each target needs date and role');
    const required = Number(t.required);
    if (!Number.isFinite(required) || required < 0 || required > 10_000) return badRequest('required must be a number between 0 and 10000');
    valid.push({ ...(t as unknown as DemandForecast), required: Math.round(required) });
  }
  if (!valid.length) return ok({ success: true, targets: [] });
  const { error } = await client
    .from('demand_targets')
    .upsert(valid.map((t) => toTargetRow(ctx, t, 'override')), { onConflict: 'account_id,date,role' });
  if (error) return dbFailure('upsert demand_targets', error);
  return ok({ success: true, targets: valid });
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

const ONBOARDING_COLUMNS = 'workers_completed, templates_completed, forecast_completed';

const rowToOnboarding = (row: Record<string, unknown>): OnboardingProgress => ({
  workers: Boolean(row.workers_completed),
  templates: Boolean(row.templates_completed),
  forecast: Boolean(row.forecast_completed),
});

async function getOnboarding(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('onboarding_progress')
    .select(ONBOARDING_COLUMNS)
    .eq('account_id', ctx.accountId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) return dbFailure('select onboarding_progress', error);
  return ok({ progress: data ? rowToOnboarding(data) : null });
}

async function upsertOnboarding(client: SupabaseClient, ctx: AuthContext, flags: unknown): Promise<Result> {
  if (!isRecord(flags)) return badRequest('Missing onboarding payload');
  const progress: OnboardingProgress = {
    workers: Boolean(flags.workers),
    templates: Boolean(flags.templates),
    forecast: Boolean(flags.forecast),
  };
  const { error } = await client.from('onboarding_progress').upsert(
    {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      workers_completed: progress.workers,
      templates_completed: progress.templates,
      forecast_completed: progress.forecast,
    },
    { onConflict: 'account_id,user_id' },
  );
  if (error) return dbFailure('upsert onboarding_progress', error);
  return ok({ success: true, progress });
}

// ─── Workers ──────────────────────────────────────────────────────────────────

const WORKER_COLUMNS = 'id, account_id, name, role, skills, birth_date, night_worker, weekly_limit_opt_out, no_fixed_hours, created_at';
type WorkerRow = {
  id: string; account_id: string; name: string; role: string; skills: string[] | null;
  birth_date: string | null; night_worker: boolean | null; weekly_limit_opt_out: boolean | null; no_fixed_hours: boolean | null;
  created_at?: string;
};

const rowToWorker = (row: WorkerRow) => ({
  id: row.id,
  accountId: row.account_id,
  name: row.name,
  role: row.role,
  skills: row.skills ?? [],
  birthDate: row.birth_date ?? null,
  nightWorker: Boolean(row.night_worker),
  weeklyLimitOptOut: Boolean(row.weekly_limit_opt_out),
  noFixedHours: Boolean(row.no_fixed_hours),
  createdAt: row.created_at,
});

async function listWorkers(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('workers')
    .select(WORKER_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('name', { ascending: true })
    .limit(500);
  if (error) return dbFailure('list workers', error);
  return ok({ workers: (data as WorkerRow[]).map(rowToWorker) });
}

async function upsertWorker(client: SupabaseClient, ctx: AuthContext, worker: unknown): Promise<Result> {
  if (!isRecord(worker)) return badRequest('worker is required');
  if (!isNonEmptyString(worker.name, 100)) return badRequest('name is required (max 100 chars)');
  if (!isNonEmptyString(worker.role, 100)) return badRequest('role is required (max 100 chars)');
  const skills = Array.isArray(worker.skills) ? worker.skills : [];
  if (skills.length > 50 || !skills.every((s) => isNonEmptyString(s, 100))) return badRequest('skills must be up to 50 short strings');
  // Labor attributes: absent fields are left as stored (or the column default on insert).
  const labor = validateWorkerLabor(worker);
  if (!labor.ok) return badRequest(labor.error);
  const { birthDate, nightWorker, weeklyLimitOptOut, noFixedHours } = labor.values;

  const result = await updateOrInsert<WorkerRow>(
    client, 'workers', ctx, worker.id as string | undefined,
    {
      name: worker.name.trim(),
      role: worker.role.trim(),
      skills,
      ...(birthDate !== undefined ? { birth_date: birthDate } : {}),
      ...(nightWorker !== undefined ? { night_worker: nightWorker } : {}),
      ...(weeklyLimitOptOut !== undefined ? { weekly_limit_opt_out: weeklyLimitOptOut } : {}),
      ...(noFixedHours !== undefined ? { no_fixed_hours: noFixedHours } : {}),
    },
    WORKER_COLUMNS,
  );
  return 'error' in result ? result.error : ok({ success: true, worker: rowToWorker(result.row) });
}

// ─── Worker availability ──────────────────────────────────────────────────────

const AVAILABILITY_COLUMNS = 'id, account_id, worker_id, day_of_week, from_time, to_time';
type AvailabilityRow = { id: string; account_id: string; worker_id: string; day_of_week: string; from_time: string; to_time: string };

const rowToAvailability = (row: AvailabilityRow) => ({
  id: row.id,
  accountId: row.account_id,
  workerId: row.worker_id,
  dayOfWeek: row.day_of_week,
  fromTime: row.from_time,
  toTime: row.to_time,
});

async function listAvailability(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('worker_availability')
    .select(AVAILABILITY_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('worker_id', { ascending: true })
    .limit(2000);
  if (error) return dbFailure('list worker_availability', error);
  return ok({ availabilities: (data as AvailabilityRow[]).map(rowToAvailability) });
}

async function upsertAvailability(client: SupabaseClient, ctx: AuthContext, av: unknown): Promise<Result> {
  if (!isRecord(av)) return badRequest('availability is required');
  if (!isUuid(av.workerId)) return badRequest('workerId must be a UUID');
  if (!isDayOfWeek(av.dayOfWeek)) return badRequest('dayOfWeek must be Mon–Sun');
  if (!isHHMM(av.fromTime)) return badRequest('fromTime must be HH:MM');
  if (!isHHMM(av.toTime)) return badRequest('toTime must be HH:MM');
  // An earlier end time means the window ends the next day.
  if (av.fromTime === av.toTime) return badRequest('fromTime and toTime must differ');

  const owns = await ownsAll(client, 'workers', ctx, [av.workerId]);
  if (owns !== true) return owns === false ? notFound() : owns;

  const values = { worker_id: av.workerId, day_of_week: av.dayOfWeek, from_time: av.fromTime, to_time: av.toTime };

  if (av.id !== undefined) {
    const result = await updateOrInsert<AvailabilityRow>(client, 'worker_availability', ctx, av.id as string, values, AVAILABILITY_COLUMNS);
    return 'error' in result ? result.error : ok({ success: true, availability: rowToAvailability(result.row) });
  }

  // No id: one slot per worker/day/start. The worker is the caller's, so a
  // conflicting slot is too.
  const { data, error } = await client
    .from('worker_availability')
    .upsert({ ...values, account_id: ctx.accountId }, { onConflict: 'worker_id,day_of_week,from_time' })
    .select(AVAILABILITY_COLUMNS)
    .single();
  if (error) return dbFailure('upsert worker_availability', error);
  return ok({ success: true, availability: rowToAvailability(data as AvailabilityRow) });
}

// ─── Shift templates ──────────────────────────────────────────────────────────

const TEMPLATE_COLUMNS = 'id, account_id, name, role, start_time, end_time, coverage, created_at';
type TemplateRow = { id: string; account_id: string; name: string; role: string; start_time: string; end_time: string; coverage: number; created_at?: string };

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

async function listTemplates(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('shift_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('name', { ascending: true })
    .limit(500);
  if (error) return dbFailure('list shift_templates', error);
  return ok({ templates: (data as TemplateRow[]).map(rowToTemplate) });
}

async function upsertTemplate(client: SupabaseClient, ctx: AuthContext, tmpl: unknown): Promise<Result> {
  if (!isRecord(tmpl)) return badRequest('template is required');
  if (!isNonEmptyString(tmpl.name, 100)) return badRequest('name is required (max 100 chars)');
  if (!isNonEmptyString(tmpl.role, 100)) return badRequest('role is required (max 100 chars)');
  if (!isHHMM(tmpl.startTime)) return badRequest('startTime must be HH:MM');
  if (!isHHMM(tmpl.endTime)) return badRequest('endTime must be HH:MM');
  // An earlier end time is an overnight shift.
  if (tmpl.startTime === tmpl.endTime) return badRequest('startTime and endTime must differ');
  if (!Number.isInteger(tmpl.coverage) || (tmpl.coverage as number) < 1 || (tmpl.coverage as number) > 500) {
    return badRequest('coverage must be an integer between 1 and 500');
  }

  const result = await updateOrInsert<TemplateRow>(
    client, 'shift_templates', ctx, tmpl.id as string | undefined,
    { name: tmpl.name.trim(), role: tmpl.role.trim(), start_time: tmpl.startTime, end_time: tmpl.endTime, coverage: tmpl.coverage },
    TEMPLATE_COLUMNS,
  );
  return 'error' in result ? result.error : ok({ success: true, template: rowToTemplate(result.row) });
}

// ─── Roster ───────────────────────────────────────────────────────────────────

const ROSTER_COLUMNS = 'id, account_id, date, worker_id, template_id, location, status, notified, created_at, updated_at';
type RosterRow = {
  id: string; account_id: string; date: string; worker_id: string; template_id: string;
  location: string | null; status: string; notified: boolean; created_at?: string; updated_at?: string;
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

async function listRoster(client: SupabaseClient, ctx: AuthContext, fromDate: unknown, toDate: unknown): Promise<Result> {
  if (fromDate !== undefined && !isISODate(fromDate)) return badRequest('fromDate must be YYYY-MM-DD');
  if (toDate !== undefined && !isISODate(toDate)) return badRequest('toDate must be YYYY-MM-DD');
  let query = client
    .from('roster')
    .select(ROSTER_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('date', { ascending: true })
    .limit(500);
  if (fromDate) query = query.gte('date', fromDate);
  if (toDate) query = query.lte('date', toDate);
  const { data, error } = await query;
  if (error) return dbFailure('list roster', error);
  return ok({ shifts: (data as RosterRow[]).map(rowToRosterShift) });
}

async function upsertRosterShift(client: SupabaseClient, ctx: AuthContext, shift: unknown): Promise<Result> {
  if (!isRecord(shift)) return badRequest('shift is required');
  if (!isISODate(shift.date)) return badRequest('date must be YYYY-MM-DD');
  if (!isUuid(shift.workerId)) return badRequest('workerId must be a UUID');
  if (!isUuid(shift.templateId)) return badRequest('templateId must be a UUID');
  if (shift.status !== undefined && !isShiftStatus(shift.status)) return badRequest('status must be Draft or Published');
  if (shift.location !== undefined && typeof shift.location !== 'string') return badRequest('location must be a string');

  const [ownsWorker, ownsTemplate] = await Promise.all([
    ownsAll(client, 'workers', ctx, [shift.workerId]),
    ownsAll(client, 'shift_templates', ctx, [shift.templateId]),
  ]);
  if (ownsWorker !== true) return ownsWorker === false ? notFound() : ownsWorker;
  if (ownsTemplate !== true) return ownsTemplate === false ? notFound() : ownsTemplate;

  const result = await updateOrInsert<RosterRow>(
    client, 'roster', ctx, shift.id as string | undefined,
    {
      date: shift.date,
      worker_id: shift.workerId,
      template_id: shift.templateId,
      location: ((shift.location as string | undefined) ?? '').slice(0, 200),
      status: shift.status ?? 'Draft',
      notified: shift.notified === true,
    },
    ROSTER_COLUMNS,
  );
  return 'error' in result ? result.error : ok({ success: true, shift: rowToRosterShift(result.row) });
}

// ─── Business locations ───────────────────────────────────────────────────────
// Labor law follows the work location, so the jurisdiction lives here. The
// jurisdiction code must be the one the confirmed place resolves to
// (utils/locationValidation.ts), and the server records who confirmed it.

const LOCATION_COLUMNS =
  'id, account_id, name, country_code, region_code, city_code, jurisdiction_code, time_zone, industry, ' +
  'employer_headcount, locations_count, detected_hint, overrides, confirmed_by, confirmed_at, created_at, updated_at';
type LocationRow = {
  id: string; account_id: string; name: string; country_code: string; region_code: string | null; city_code: string | null;
  jurisdiction_code: string; time_zone: string; industry: BusinessLocation['industry']; employer_headcount: number | null;
  locations_count: number | null; detected_hint: BusinessLocation['detectedHint']; overrides: BusinessLocation['overrides'] | null;
  confirmed_by: string; confirmed_at: string; created_at?: string; updated_at?: string;
};

const rowToLocation = (row: LocationRow): BusinessLocation => ({
  id: row.id,
  name: row.name,
  countryCode: row.country_code,
  regionCode: row.region_code,
  cityCode: row.city_code,
  jurisdictionCode: row.jurisdiction_code,
  timeZone: row.time_zone,
  industry: row.industry,
  employerHeadcount: row.employer_headcount,
  locationsCount: row.locations_count,
  detectedHint: row.detected_hint,
  overrides: row.overrides ?? [],
  confirmedBy: row.confirmed_by,
  confirmedAt: row.confirmed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function listLocations(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('locations')
    .select(LOCATION_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) return dbFailure('list locations', error);
  return ok({ locations: (data as unknown as LocationRow[]).map(rowToLocation) });
}

async function upsertLocation(client: SupabaseClient, ctx: AuthContext, location: unknown): Promise<Result> {
  const checked = validateLocationInput(location);
  if (!checked.ok) return badRequest(checked.message);
  const { id, ...values } = checked.value;
  if (values.overrides === undefined && id !== undefined && isUuid(id)) {
    // An update that keeps the stored overrides may change the jurisdiction:
    // they must still be stricter than the new place's rules (CHG-089).
    const { data, error } = await client
      .from('locations')
      .select('jurisdiction_code, overrides')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) return dbFailure('read location overrides', error);
    const stored = data as { jurisdiction_code: string; overrides: unknown } | null;
    if (stored && stored.jurisdiction_code !== values.jurisdiction_code && Array.isArray(stored.overrides) && stored.overrides.length) {
      const recheck = validateOverrides(stored.overrides, resolvePack(values.jurisdiction_code), todayKey(values.time_zone));
      if (!recheck.ok) {
        return badRequest(`The saved overrides do not fit the new jurisdiction: ${recheck.message} Send overrides with this change.`);
      }
    }
  }
  const result = await updateOrInsert<LocationRow>(
    client, 'locations', ctx, id,
    { ...values, confirmed_by: ctx.userId, confirmed_at: new Date().toISOString() },
    LOCATION_COLUMNS,
  );
  return 'error' in result ? result.error : ok({ success: true, location: rowToLocation(result.row) });
}

/**
 * Deletes through public.delete_location so the history trigger records who
 * deleted it (the service-role connection cannot see the Clerk user).
 */
async function deleteLocation(client: SupabaseClient, ctx: AuthContext, id: unknown): Promise<Result> {
  if (!isUuid(id)) return badRequest('id must be a UUID');
  const { data, error } = await client.rpc('delete_location', {
    p_account_id: ctx.accountId,
    p_location_id: id,
    p_actor: ctx.userId,
  });
  if (error) return dbFailure('delete locations', error);
  return data === true ? ok({ success: true }) : notFound();
}

// Change history, written only by the locations trigger
// (20261021000089_location_history.sql). Read-only here.
const LOCATION_HISTORY_COLUMNS =
  'id, location_id, location_name, action, changed_by, changed_at, old_jurisdiction_code, new_jurisdiction_code, ' +
  'old_time_zone, new_time_zone, old_industry, new_industry, old_employer_headcount, new_employer_headcount, old_overrides, new_overrides';
const LOCATION_HISTORY_DEFAULT_LIMIT = 50;
const LOCATION_HISTORY_MAX_LIMIT = 200;
type LocationHistoryRow = {
  id: number; location_id: string; location_name: string; action: LocationHistoryEntry['action']; changed_by: string | null;
  changed_at: string; old_jurisdiction_code: string | null; new_jurisdiction_code: string | null; old_time_zone: string | null;
  new_time_zone: string | null; old_industry: string | null; new_industry: string | null; old_employer_headcount: number | null;
  new_employer_headcount: number | null; old_overrides: unknown[] | null; new_overrides: unknown[] | null;
};

const rowToHistoryEntry = (row: LocationHistoryRow): LocationHistoryEntry => {
  const side = (which: 'old' | 'new'): LocationHistoryValues | null => {
    if ((which === 'old' && row.action === 'insert') || (which === 'new' && row.action === 'delete')) return null;
    return {
      jurisdictionCode: row[`${which}_jurisdiction_code`],
      timeZone: row[`${which}_time_zone`],
      industry: row[`${which}_industry`],
      employerHeadcount: row[`${which}_employer_headcount`],
      overrides: row[`${which}_overrides`],
    };
  };
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name,
    action: row.action,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    old: side('old'),
    new: side('new'),
  };
};

async function listLocationHistory(client: SupabaseClient, ctx: AuthContext, p: Record<string, unknown>): Promise<Result> {
  if (p.locationId !== undefined && !isUuid(p.locationId)) return badRequest('locationId must be a UUID');
  if (p.limit !== undefined && (!Number.isInteger(p.limit) || (p.limit as number) < 1 || (p.limit as number) > LOCATION_HISTORY_MAX_LIMIT)) {
    return badRequest(`limit must be a whole number from 1 to ${LOCATION_HISTORY_MAX_LIMIT}`);
  }
  let query = client
    .from('location_history')
    .select(LOCATION_HISTORY_COLUMNS)
    .eq('account_id', ctx.accountId);
  if (p.locationId !== undefined) query = query.eq('location_id', p.locationId as string);
  const { data, error } = await query
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false })
    .limit((p.limit as number | undefined) ?? LOCATION_HISTORY_DEFAULT_LIMIT);
  if (error) return dbFailure('list location history', error);
  return ok({ history: (data as unknown as LocationHistoryRow[]).map(rowToHistoryEntry) });
}

// ─── Usage limits ─────────────────────────────────────────────────────────────

const FREE_AUTO_ASSIGN_LIMIT = 1;

async function getUsageLimit(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client
    .from('usage_limits')
    .select('auto_assign_count')
    .eq('user_id', ctx.userId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) return dbFailure('select usage_limits', error);
  const count = (data as { auto_assign_count?: number } | null)?.auto_assign_count ?? 0;
  return ok({ count, canAutoAssign: count < FREE_AUTO_ASSIGN_LIMIT });
}

async function incrementAutoAssign(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client.rpc('increment_auto_assign', { p_user_id: ctx.userId, p_account_id: ctx.accountId });
  if (error) return dbFailure('increment_auto_assign', error);
  return ok({ success: true, count: Number(data ?? 0) });
}

// ─── POS sales ────────────────────────────────────────────────────────────────

async function uploadPosSales(client: SupabaseClient, ctx: AuthContext, rows: unknown): Promise<Result> {
  if (!Array.isArray(rows) || rows.length === 0) return badRequest('rows must be a non-empty array');
  if (rows.length > 1000) return badRequest('Maximum 1000 rows per upload');
  const clean = [];
  for (const [index, r] of rows.entries()) {
    const revenue = isRecord(r) ? Number(r.revenue) : NaN;
    if (!isRecord(r) || !isISODate(r.date) || !Number.isFinite(revenue) || revenue < 0 || revenue > 1e10) {
      return badRequest(`Invalid row ${index + 1}: needs a YYYY-MM-DD date and a non-negative revenue`);
    }
    const covers = r.covers == null ? null : Number(r.covers);
    if (covers !== null && (!Number.isInteger(covers) || covers < 0)) return badRequest(`Invalid covers in row ${index + 1}`);
    clean.push({
      account_id: ctx.accountId,
      date: r.date,
      revenue,
      covers,
      notes: typeof r.notes === 'string' ? r.notes.slice(0, 500) : null,
      source: r.source === 'manual' ? 'manual' : 'upload',
    });
  }
  const { error } = await client.from('pos_sales').upsert(clean, { onConflict: 'account_id,date' });
  if (error) return dbFailure('upsert pos_sales', error);
  return ok({ inserted: clean.length });
}

async function listPosSales(client: SupabaseClient, ctx: AuthContext, limit: unknown, offset: unknown): Promise<Result> {
  const safeLimit = Math.min(Math.max(1, Number.isInteger(limit) ? (limit as number) : 90), 365);
  const safeOffset = Math.max(0, Number.isInteger(offset) ? (offset as number) : 0);
  const { data, error, count } = await client
    .from('pos_sales')
    .select('id, account_id, date, revenue, covers, notes, source, created_at', { count: 'exact' })
    .eq('account_id', ctx.accountId)
    .order('date', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);
  if (error) return dbFailure('list pos_sales', error);
  return ok({ rows: data ?? [], total: count ?? 0 });
}

// ─── Subscriptions ────────────────────────────────────────────────────────────
// Only reads and the user's own cancel request live here. Plan changes are
// written exclusively by signature-verified payment webhooks (not yet built);
// no client-callable action can change a tier.

function rowToSubscription(row: Record<string, unknown>) {
  return {
    id: row.id,
    accountId: row.account_id,
    tier: row.tier ?? 'free',
    status: row.status ?? 'active',
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    stripePriceId: row.stripe_price_id ?? null,
    currentPeriodStart: row.current_period_start ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    trialEndsAt: row.trial_ends_at ?? null,
    paymentProvider: row.payment_provider ?? null,
    billingInterval: row.billing_interval ?? 'month',
    countryCode: row.country_code ?? 'PE',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getSubscription(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { data, error } = await client.from('subscriptions').select('*').eq('account_id', ctx.accountId).maybeSingle();
  if (error) return dbFailure('select subscriptions', error);
  if (data) return ok({ subscription: rowToSubscription(data) });

  // First read provisions the free tier. ignoreDuplicates makes concurrent
  // first reads safe.
  const { error: insertErr } = await client
    .from('subscriptions')
    .upsert({ account_id: ctx.accountId, tier: 'free', status: 'active' }, { onConflict: 'account_id', ignoreDuplicates: true });
  if (insertErr) return dbFailure('provision subscriptions', insertErr);
  const { data: created, error: reread } = await client.from('subscriptions').select('*').eq('account_id', ctx.accountId).single();
  if (reread) return dbFailure('select subscriptions', reread);
  return ok({ subscription: rowToSubscription(created) });
}

async function cancelSubscription(client: SupabaseClient, ctx: AuthContext): Promise<Result> {
  const { error } = await client.from('subscriptions').update({ cancel_at_period_end: true }).eq('account_id', ctx.accountId);
  if (error) return dbFailure('cancel subscription', error);
  return ok({ success: true });
}

const paymentsNotConfigured = () => fail(501, 'Payment integration not yet configured. See docs/manual-setup/SETUP_STRIPE.md');

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function dispatch(client: SupabaseClient, ctx: AuthContext, p: Record<string, unknown>): Promise<Result> {
  switch (p.action) {
    case 'forecast': {
      const dateError = filtersDateError(p.filters);
      if (dateError) return badRequest(dateError);
      return ok(await generateForecast(client, ctx, cleanFilters(p.filters)));
    }
    case 'status': {
      const dateError = filtersDateError(p.filters);
      if (dateError) return badRequest(dateError);
      // History is checked for the role only: a forecast for a date is made
      // from earlier days, so the date filter does not apply to history.
      const filters = cleanFilters(p.filters);
      const roleOnly = filters?.role ? { role: filters.role } : undefined;
      const [hasHistorical, hasExternalSignals, hasExistingTargets] = await Promise.all([
        hasRows(client, 'shifts', ctx, roleOnly),
        hasRows(client, 'external_signals', ctx, filters),
        hasRows(client, 'demand_targets', ctx, filters),
      ]);
      const status: ForecastGenerationMetadata = {
        hasHistorical,
        hasExternalSignals,
        hasExistingTargets,
        apiAvailable: Boolean(FORECAST_API_URL),
        usedApi: false,
        usedFallback: false,
        apiCallFailed: false,
        fallbackReason: undefined,
      };
      return ok(status);
    }
    case 'forecastHistory':
      return forecastHistory(client, ctx, p);
    case 'listForecastSignals':
      return listForecastSignals(client, ctx, p);
    case 'loadTargets': {
      const dateError = filtersDateError(p.filters);
      if (dateError) return badRequest(dateError);
      return ok({ targets: await fetchExistingTargets(client, ctx, cleanFilters(p.filters)) });
    }
    case 'upsertTargets':
      return upsertTargets(client, ctx, p.targets);
    case 'getOnboarding':
      return getOnboarding(client, ctx);
    case 'upsertOnboarding':
      return upsertOnboarding(client, ctx, p.flags);
    case 'listWorkers':
      return listWorkers(client, ctx);
    case 'upsertWorker':
      return upsertWorker(client, ctx, p.worker);
    case 'deleteWorker':
      return deleteOwned(client, 'workers', ctx, p.id);
    case 'listWorkerAvailability':
      return listAvailability(client, ctx);
    case 'upsertAvailability':
      return upsertAvailability(client, ctx, p.availability);
    case 'deleteAvailability':
      return deleteOwned(client, 'worker_availability', ctx, p.id);
    case 'listShiftTemplates':
      return listTemplates(client, ctx);
    case 'upsertShiftTemplate':
      return upsertTemplate(client, ctx, p.template);
    case 'deleteShiftTemplate':
      return deleteOwned(client, 'shift_templates', ctx, p.id);
    case 'listRoster':
      return listRoster(client, ctx, p.fromDate, p.toDate);
    case 'upsertRosterShift':
      return upsertRosterShift(client, ctx, p.shift);
    case 'updateShiftStatus':
      return isShiftStatus(p.status)
        ? updateOwned(client, 'roster', ctx, p.id, { status: p.status })
        : badRequest('status must be Draft or Published');
    case 'markShiftNotified':
      return updateOwned(client, 'roster', ctx, p.id, { notified: true });
    case 'deleteRosterShift':
      return deleteOwned(client, 'roster', ctx, p.id);
    case 'listLocations':
      return listLocations(client, ctx);
    case 'upsertLocation':
      return upsertLocation(client, ctx, p.location);
    case 'deleteLocation':
      return deleteLocation(client, ctx, p.id);
    case 'listLocationHistory':
      return listLocationHistory(client, ctx, p);
    case 'getUsageLimit':
      return getUsageLimit(client, ctx);
    case 'incrementAutoAssign':
      return incrementAutoAssign(client, ctx);
    case 'uploadPosSales':
      return uploadPosSales(client, ctx, p.rows);
    case 'listPosSales':
      return listPosSales(client, ctx, p.limit, p.offset);
    case 'getSubscription':
      return getSubscription(client, ctx);
    case 'cancelSubscription':
      return cancelSubscription(client, ctx);
    case 'createCheckoutSession':
    case 'createBillingPortalSession':
      return paymentsNotConfigured();
    default:
      return badRequest('Unsupported action');
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  const respond = (r: Result) => jsonResponse(r.body, r.status, origin);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(badRequest('Invalid request payload'));
  }
  if (!isRecord(payload) || typeof payload.action !== 'string') {
    return respond(badRequest('Missing action'));
  }

  const auth = await authenticate(request);
  if (!auth.ok) return respond(fail(auth.status, auth.error));
  if (MANAGER_ACTIONS.has(payload.action) && !auth.ctx.canManage) {
    return respond(fail(403, 'Only an admin of this business can do this'));
  }

  const client = getServiceClient();
  if (!client) {
    console.error('[secure-proxy] Supabase service credentials are not configured');
    return respond(fail(503, 'Database is not configured'));
  }

  try {
    return respond(await dispatch(client, auth.ctx, payload));
  } catch (error) {
    console.error('[secure-proxy] request failed', error);
    return respond(fail(500, 'Request failed'));
  }
}

export function OPTIONS(request: Request): Response {
  return optionsResponse(request.headers.get('origin'));
}
