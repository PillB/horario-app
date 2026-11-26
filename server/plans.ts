/**
 * The plan an account has, decided on the server.
 *
 * Sources, highest plan wins:
 *   - `account_entitlements` rows that are active now (trial, tester, comp,
 *     paddle): not revoked, started, not ended;
 *   - the `subscriptions` row (the Paddle mirror, server/paddle.ts) while its
 *     status is active or trialing, or past_due for PAST_DUE_GRACE_DAYS after
 *     the first failed renewal; a Paddle subscription pays for `quantity`
 *     locations.
 * Nothing active = Gratis. The first time an account is seen it gets its one
 * Pro trial (TRIAL_DAYS, no card).
 *
 * The proxy calls `planGate` before every action, so limits hold whatever the
 * client shows.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  TIER_LIMITS,
  TIER_META,
  TRIAL_DAYS,
  TRIAL_PLAN,
  isSubscriptionTier,
  tierFromLegacy,
  tierMeetsRequirement,
  tierRank,
  type SubscriptionTier,
} from '@/constants/pricing';

export type EntitlementSource = 'paddle' | 'comp' | 'tester' | 'trial';
export const ENTITLEMENT_SOURCES: EntitlementSource[] = ['paddle', 'comp', 'tester', 'trial'];
/** Sources a platform admin may grant by hand. `paddle` rows come from webhooks, `trial` from first use. */
export const GRANTABLE_SOURCES: EntitlementSource[] = ['comp', 'tester'];

export type EntitlementRow = {
  id: string;
  account_id: string;
  plan: string;
  source: string;
  starts_at: string;
  ends_at: string | null;
  location_quota: number | null;
  granted_by: string;
  reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
};

export const ENTITLEMENT_COLUMNS =
  'id, account_id, plan, source, starts_at, ends_at, location_quota, granted_by, reason, revoked_at, revoked_by, created_at';

export type SubscriptionRow = {
  tier?: unknown;
  status?: unknown;
  current_period_end?: unknown;
  quantity?: unknown;
  past_due_since?: unknown;
  payment_provider?: unknown;
} | null;

export const SUBSCRIPTION_PLAN_COLUMNS = 'tier, status, current_period_end, quantity, past_due_since, payment_provider';

/**
 * Days a past_due subscription keeps its plan while Paddle retries the card.
 * Paddle keeps retrying for longer; cutting the team off at the first failed
 * renewal punishes an expired card, keeping the plan for the whole dunning run
 * gives a month away. Two weeks is the middle, and the data is never deleted.
 */
export const PAST_DUE_GRACE_DAYS = 14;

/** The subscription as a plan candidate, or null when it gives no plan at `now`. */
function subscriptionCandidate(subscription: SubscriptionRow, now: Date): Candidate | null {
  if (!subscription) return null;
  const plan = tierFromLegacy(subscription.tier);
  if (plan === 'gratis') return null;
  const periodEnd = typeof subscription.current_period_end === 'string' ? subscription.current_period_end : null;
  const quantity = Number(subscription.quantity);
  const locationQuota = subscription.payment_provider === 'paddle' && Number.isInteger(quantity) && quantity >= 1 ? quantity : null;
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    return { plan, source: 'subscription', endsAt: periodEnd, locationQuota };
  }
  if (subscription.status === 'past_due' && typeof subscription.past_due_since === 'string') {
    const graceEnds = Date.parse(subscription.past_due_since) + PAST_DUE_GRACE_DAYS * 86_400_000;
    if (Number.isFinite(graceEnds) && graceEnds > now.getTime()) {
      return { plan, source: 'subscription', endsAt: new Date(graceEnds).toISOString(), locationQuota };
    }
  }
  return null;
}

export type EffectivePlan = {
  plan: SubscriptionTier;
  /** Where the plan comes from; `default` = nothing active. */
  source: EntitlementSource | 'subscription' | 'default';
  /** When the winning grant ends (ISO), null = no end date. */
  endsAt: string | null;
  /** True while the winning grant is the trial. */
  isTrial: boolean;
  /** The account's trial end (ISO) if it ever had one, used or not. */
  trialEndsAt: string | null;
  limits: { maxWorkers: number | null; maxLocations: number | null; maxAutoSchedulesPerMonth: number | null };
};

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

type Candidate = { plan: SubscriptionTier; source: EffectivePlan['source']; endsAt: string | null; locationQuota: number | null };

const endTime = (endsAt: string | null): number => (endsAt === null ? Infinity : Date.parse(endsAt));

export const entitlementIsActive = (row: EntitlementRow, now: Date): boolean =>
  row.revoked_at === null &&
  isSubscriptionTier(row.plan) &&
  Date.parse(row.starts_at) <= now.getTime() &&
  (row.ends_at === null || Date.parse(row.ends_at) > now.getTime());

/** Pure: the plan in force at `now`. */
export function effectivePlanFrom(rows: EntitlementRow[], subscription: SubscriptionRow, now: Date): EffectivePlan {
  const candidates: Candidate[] = rows
    .filter((row) => entitlementIsActive(row, now))
    .map((row) => ({
      plan: row.plan as SubscriptionTier,
      source: row.source as EntitlementSource,
      endsAt: row.ends_at,
      locationQuota: row.location_quota,
    }));

  const paid = subscriptionCandidate(subscription, now);
  if (paid) candidates.push(paid);

  // Highest plan; then a paid or granted source before the trial; then the one that lasts longest.
  candidates.sort(
    (a, b) =>
      tierRank(b.plan) - tierRank(a.plan) ||
      Number(a.source === 'trial') - Number(b.source === 'trial') ||
      endTime(b.endsAt) - endTime(a.endsAt),
  );
  const winner: Candidate = candidates[0] ?? { plan: 'gratis', source: 'default', endsAt: null, locationQuota: null };
  const trial = rows.find((row) => row.source === 'trial') ?? null;
  const base = TIER_LIMITS[winner.plan];

  return {
    plan: winner.plan,
    source: winner.source,
    endsAt: winner.endsAt,
    isTrial: winner.source === 'trial',
    trialEndsAt: trial?.ends_at ?? null,
    limits: {
      maxWorkers: finite(base.maxWorkers),
      maxLocations: winner.locationQuota ?? finite(base.maxLocations),
      maxAutoSchedulesPerMonth: finite(base.maxAutoSchedulesPerMonth),
    },
  };
}

/** With no entitlements table (migration not applied yet) nothing is limited, so a deploy never locks the app. */
const UNLIMITED: EffectivePlan = {
  plan: 'pro',
  source: 'default',
  endsAt: null,
  isTrial: false,
  trialEndsAt: null,
  limits: { maxWorkers: null, maxLocations: null, maxAutoSchedulesPerMonth: null },
};

const tableMissing = (error: { code?: string } | null): boolean => error?.code === '42P01' || error?.code === 'PGRST205';

export type PlanResult = { ok: true; plan: EffectivePlan } | { ok: false; error: { message?: string; code?: string } | null };

export type ResolvePlanOptions = {
  /**
   * False reads the plan without starting the account's one trial. A platform
   * admin looking up an account id must not use up that account's trial (it
   * may not exist yet, or not have signed in); only the account's own requests
   * start it. Default true.
   */
  startTrial?: boolean;
};

/** Reads the account's grants and subscription; starts the trial on first sight (unless `startTrial: false`). */
export async function resolvePlan(
  client: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
  options: ResolvePlanOptions = {},
): Promise<PlanResult> {
  const read = () =>
    client
      .from('account_entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .eq('account_id', accountId)
      .order('starts_at', { ascending: false })
      .limit(200);

  let { data, error } = await read();
  if (error) {
    if (tableMissing(error)) {
      console.error('[plans] account_entitlements is missing; apply migration 20261111000099. No plan limits are enforced.');
      return { ok: true, plan: UNLIMITED };
    }
    return { ok: false, error };
  }
  let rows = (data ?? []) as unknown as EntitlementRow[];

  if (options.startTrial !== false && !rows.some((row) => row.source === 'trial')) {
    const { error: insertError } = await client.from('account_entitlements').insert({
      account_id: accountId,
      plan: TRIAL_PLAN,
      source: 'trial',
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString(),
      granted_by: 'system',
      reason: `${TRIAL_DAYS}-day trial`,
    });
    // 23505: a concurrent request started the trial first.
    if (insertError && insertError.code !== '23505') return { ok: false, error: insertError };
    ({ data, error } = await read());
    if (error) return { ok: false, error };
    rows = (data ?? []) as unknown as EntitlementRow[];
  }

  const { data: subscription, error: subError } = await client
    .from('subscriptions')
    .select(SUBSCRIPTION_PLAN_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (subError) return { ok: false, error: subError };

  return { ok: true, plan: effectivePlanFrom(rows, subscription as SubscriptionRow, now) };
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

/** Actions only Pro includes: the demand forecast and the sales feed behind it. */
export const PRO_ACTIONS = new Set(['forecast', 'forecastHistory', 'listForecastSignals', 'uploadPosSales']);

export type GateRefusal = { status: 402 | 500 | 503; error: string };

/** A gated action never runs on a plan nobody could read: fail closed (CHG-109). */
export const PLAN_UNREADABLE: GateRefusal = { status: 503, error: 'Could not check your plan; try again' };

const DB_FAILED: GateRefusal = { status: 500, error: 'Database request failed' };

const label = (plan: SubscriptionTier) => TIER_META[plan].label;

const workerLimitRefusal = (plan: SubscriptionTier, max: number): GateRefusal => ({
  status: 402,
  error: `The ${label(plan)} plan covers up to ${max} people. Upgrade to add more`,
});

const locationLimitRefusal = (plan: SubscriptionTier, max: number): GateRefusal => ({
  status: 402,
  // Paid plans are per location: on Pro, or on Esencial with a quota, another location is one more on the subscription.
  error: `Your ${label(plan)} plan covers ${max} location${max === 1 ? '' : 's'}. Add a location to your plan in Plans to open another`,
});

const proOnlyRefusal = (plan: SubscriptionTier): GateRefusal => ({
  status: 402,
  error: `The demand forecast and sales upload are part of the Pro plan. You are on ${label(plan)}. Manual demand targets still work`,
});

const uncoveredLocation = (name: string, plan: SubscriptionTier, max: number): GateRefusal => ({
  status: 402,
  error: `${name} is not covered by your ${label(plan)} plan, which covers ${max} location${max === 1 ? '' : 's'}. Shifts there are read-only until you add it to your plan or remove a location`,
});

async function countRows(client: SupabaseClient, table: string, accountId: string): Promise<number | null> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  return error || typeof count !== 'number' ? null : count;
}

async function isNewRow(client: SupabaseClient, table: string, accountId: string, input: unknown): Promise<boolean> {
  const id = typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || !id) return true;
  const { data } = await client.from(table).select('id').eq('account_id', accountId).eq('id', id).maybeSingle();
  return !data;
}

type GateArgs = { client: SupabaseClient; accountId: string; payload: Record<string, unknown>; plan: SubscriptionTier; limits: EffectivePlan['limits'] };

type LocationRef = { id: string; name: string };

/**
 * The locations beyond the plan: the plan covers the oldest `max` (created_at, then id), the
 * rest are extra. Reads only the extras (offset `max`). Null when the database cannot be read.
 */
async function extraLocations(client: SupabaseClient, accountId: string, max: number): Promise<{ count: number; extras: LocationRef[] } | null> {
  const count = await countRows(client, 'locations', accountId);
  if (count === null) return null;
  if (count <= max) return { count, extras: [] };
  const { data, error } = await client
    .from('locations')
    .select('id, name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(max, count - 1);
  if (error) return null;
  return { count, extras: (data ?? []) as LocationRef[] };
}

/** Roster writes, which belong to one location each: refused at a location beyond the plan. */
const ROSTER_LOCATION_ACTIONS = new Set(['upsertRosterShift', 'addRosterShifts', 'updateShiftStatus', 'markShiftNotified']);

const idOf = (value: unknown): string | null => {
  const id = typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : value;
  return typeof id === 'string' && id ? id : null;
};

const locationOf = (value: unknown): string => {
  const location = typeof value === 'object' && value !== null ? (value as { location?: unknown }).location : undefined;
  return typeof location === 'string' ? location.trim() : '';
};

/** The stored location of the caller's roster row `id` ('' when none or not found); null on a database error. */
async function storedShiftLocation(client: SupabaseClient, accountId: string, id: string | null): Promise<string | null> {
  if (!id) return '';
  const { data, error } = await client.from('roster').select('location').eq('account_id', accountId).eq('id', id).maybeSingle();
  if (error) return null;
  return locationOf(data);
}

/**
 * The location values a roster write touches: the new shifts' locations, and for an edit, a status
 * change or a notify the stored row's location too (moving a shift away from a locked location is
 * still a change there). Null on a database error.
 */
async function rosterWriteLocations(client: SupabaseClient, accountId: string, payload: Record<string, unknown>): Promise<string[] | null> {
  if (payload.action === 'addRosterShifts') return Array.isArray(payload.shifts) ? payload.shifts.map(locationOf) : [];
  const shift = payload.action === 'upsertRosterShift' ? payload.shift : undefined;
  const stored = await storedShiftLocation(client, accountId, idOf(shift ?? payload.id));
  if (stored === null) return null;
  return shift === undefined ? [stored] : [locationOf(shift), stored];
}

/** The location id a write would touch that is beyond the plan, if any. */
async function lockedTarget(args: GateArgs, extras: LocationRef[]): Promise<LocationRef | 'error' | null> {
  const { client, accountId, payload } = args;
  if (payload.action === 'upsertLocation') return extras.find((l) => l.id === idOf(payload.location)) ?? null;
  if (!ROSTER_LOCATION_ACTIONS.has(String(payload.action))) return null;
  const touched = await rosterWriteLocations(client, accountId, payload);
  if (touched === null) return 'error';
  // '' (no location) and values that are not a location id (old free text) are not locked.
  return extras.find((l) => touched.includes(l.id)) ?? null;
}

/**
 * Locations: a new one needs room under the quota. With more locations than the plan covers (a
 * trial, grant or paid plan ended, or a downgrade), only the locations beyond the plan are locked:
 * editing one, and writing shifts there, is refused (CHG-109). The covered locations, shifts with
 * no location, and the team, templates, availability, time off and demand stay writable.
 * deleteLocation and every delete are not gated, so the account can always get back under the quota.
 */
async function locationRefusal(args: GateArgs): Promise<GateRefusal | null> {
  const { client, accountId, payload, plan, limits } = args;
  const max = limits.maxLocations;
  if (max === null) return null;
  const stored = await extraLocations(client, accountId, max);
  if (stored === null) return DB_FAILED;
  const locked = await lockedTarget(args, stored.extras);
  if (locked === 'error') return DB_FAILED;
  if (locked) return uncoveredLocation(locked.name, plan, max);
  if (payload.action === 'upsertLocation' && stored.count >= max && (await isNewRow(client, 'locations', accountId, payload.location))) {
    return locationLimitRefusal(plan, max);
  }
  return null;
}

/** People: with more people than the plan covers the schedule is read-only; a new person needs room. */
async function workerRefusal({ client, accountId, payload, plan, limits }: GateArgs): Promise<GateRefusal | null> {
  const max = limits.maxWorkers;
  if (max === null) return null;
  const count = await countRows(client, 'workers', accountId);
  if (count === null) return DB_FAILED;
  if (count > max) {
    return {
      status: 402,
      error: `Your team has ${count} people and the ${label(plan)} plan covers ${max}. The schedule is read-only until you upgrade or remove people`,
    };
  }
  if (payload.action === 'upsertWorker' && count >= max && (await isNewRow(client, 'workers', accountId, payload.worker))) {
    return workerLimitRefusal(plan, max);
  }
  return null;
}

/** Actions the people and location counts apply to: scheduling writes except deletes, and saving a location. */
const underCountLimits = (action: string, writeActions: ReadonlySet<string>): boolean =>
  action === 'upsertLocation' || (writeActions.has(action) && !action.startsWith('delete'));

/**
 * Whether the gate must read the plan for this action. A delete is never refused by the plan, so it
 * needs no plan read: it stays open even when the plan cannot be read, and the account can always
 * get back under a limit.
 */
export const needsPlan = (action: string, writeActions: ReadonlySet<string>): boolean => {
  if (PRO_ACTIONS.has(action)) return true;
  if (action.startsWith('delete')) return false;
  return writeActions.has(action) || action === 'upsertLocation';
};

/**
 * Refuses what the account's plan does not include. `writeActions` are the
 * scheduling writes: with more people than the plan covers (after a trial or
 * a paid plan ends) they are refused, deletes excepted, so nothing is lost and
 * the account can be brought back under the limit; with more locations, only
 * the locations beyond the plan are locked (locationRefusal). A plan
 * that cannot be read refuses every gated action except deletes with 503 (fail closed).
 */
export async function planGate(
  client: SupabaseClient,
  accountId: string,
  payload: Record<string, unknown>,
  writeActions: ReadonlySet<string>,
  readPlan: () => Promise<PlanResult> = () => resolvePlan(client, accountId),
): Promise<GateRefusal | null> {
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!needsPlan(action, writeActions)) return null;

  const resolved = await readPlan();
  if (!resolved.ok) {
    console.error('[plans] could not read the plan:', resolved.error?.message ?? '');
    return PLAN_UNREADABLE;
  }
  const { plan, limits } = resolved.plan;

  if (PRO_ACTIONS.has(action) && !tierMeetsRequirement(plan, 'pro')) return proOnlyRefusal(plan);

  if (!underCountLimits(action, writeActions)) return null;
  const args: GateArgs = { client, accountId, payload, plan, limits };
  const [locations, workers] = await Promise.all([locationRefusal(args), action === 'upsertLocation' ? null : workerRefusal(args)]);
  return locations ?? workers;
}

/** Thrown by a gated client when the plan refuses the action; the proxy turns it into the response. */
export class PlanRefusal extends Error {
  constructor(readonly refusal: GateRefusal) {
    super(refusal.error);
  }
}

/**
 * The client an action runs with. The plan is checked once, right before the
 * action's first database request: an action validates its input first (a bad
 * request is a 400 that never reaches the database), and no request of a
 * gated action can go out unchecked. A refusal rejects that request with
 * PlanRefusal.
 */
export function gatedClient(
  client: SupabaseClient,
  accountId: string,
  payload: Record<string, unknown>,
  writeActions: ReadonlySet<string>,
): SupabaseClient {
  let plan: Promise<PlanResult> | null = null;
  const readPlan = () =>
    (plan ??= resolvePlan(client, accountId).catch((error: unknown) => ({ ok: false as const, error: error as { message?: string } })));
  let check: Promise<GateRefusal | null> | null = null;
  const gate = () => (check ??= planGate(client, accountId, payload, writeActions, readPlan));

  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop, obj) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'then') {
          return (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            gate()
              .then((refusal) => {
                if (refusal) throw new PlanRefusal(refusal);
                return obj as unknown as PromiseLike<unknown>;
              })
              .then(resolve, reject);
        }
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
          return result !== null && typeof result === 'object' ? wrap(result as object) : result;
        };
      },
    });

  const gated = new Proxy(client, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj) as unknown;
      if (prop !== 'from' && prop !== 'rpc') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
      return (...args: unknown[]) => wrap((value as (...a: unknown[]) => object).apply(obj, args));
    },
  });
  planReaders.set(gated, readPlan);
  return gated;
}

// ─── Limited inserts ──────────────────────────────────────────────────────────

/** The plan a gated client already read (or will read) for its request. */
const planReaders = new WeakMap<object, () => Promise<PlanResult>>();

export type LimitedTable = 'workers' | 'locations';

type InsertAnswer = { data: unknown; error: { message?: string; code?: string } | null };

/**
 * Inserts a person or a location (or a batch of them, all or nothing) when the
 * plan still has room.
 *
 * The gate's own count is a separate request, so two simultaneous adds could
 * both pass it. Here the count and the insert are one database transaction
 * behind a per-account lock (insert_within_limit, migration 20261111000101):
 * the second of two simultaneous requests counts the first one's row and is
 * refused with PlanRefusal.
 *
 * Returns null when there is nothing to enforce (a plan without this limit, a
 * client that is not gated, or a database without the function yet); the
 * caller then inserts directly. A plan that cannot be read refuses with 503.
 */
export async function insertWithinLimit(
  client: SupabaseClient,
  table: LimitedTable,
  accountId: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
): Promise<InsertAnswer | null> {
  const readPlan = planReaders.get(client);
  if (!readPlan) return null;
  const resolved = await readPlan();
  // Never insert without the limit because the plan could not be read (CHG-109).
  if (!resolved.ok) throw new PlanRefusal(PLAN_UNREADABLE);
  const { plan, limits } = resolved.plan;
  const max = table === 'workers' ? limits.maxWorkers : limits.maxLocations;
  if (max === null) return null;

  const { data, error } = await client.rpc('insert_within_limit', {
    p_table: table,
    p_account_id: accountId,
    p_limit: max,
    p_rows: rows,
  });
  if (error) {
    // PGRST202 / 42883: the function is not there yet (migration pending).
    if (error.code === 'PGRST202' || error.code === '42883') {
      console.error('[plans] insert_within_limit is missing; apply migration 20261111000101. Inserting without the lock.');
      return null;
    }
    return { data: null, error };
  }
  const answer = data as { rows?: unknown[]; limited?: boolean } | null;
  if (answer?.limited) {
    throw new PlanRefusal(table === 'workers' ? workerLimitRefusal(plan, max) : locationLimitRefusal(plan, max));
  }
  const stored = answer?.rows ?? [];
  return { data: Array.isArray(rows) ? stored : (stored[0] ?? null), error: null };
}
