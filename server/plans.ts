/**
 * The plan an account has, decided on the server.
 *
 * Sources, highest plan wins:
 *   - `account_entitlements` rows that are active now (trial, tester, comp,
 *     paddle): not revoked, started, not ended;
 *   - the `subscriptions` row while its status is active or trialing.
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

export type SubscriptionRow = { tier?: unknown; status?: unknown; current_period_end?: unknown } | null;

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

  if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
    const plan = tierFromLegacy(subscription.tier);
    if (plan !== 'gratis') {
      candidates.push({
        plan,
        source: 'subscription',
        endsAt: typeof subscription.current_period_end === 'string' ? subscription.current_period_end : null,
        locationQuota: null,
      });
    }
  }

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

/** Reads the account's grants and subscription; starts the trial on first sight. */
export async function resolvePlan(client: SupabaseClient, accountId: string, now: Date = new Date()): Promise<PlanResult> {
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

  if (!rows.some((row) => row.source === 'trial')) {
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
    .select('tier, status, current_period_end')
    .eq('account_id', accountId)
    .maybeSingle();
  if (subError) return { ok: false, error: subError };

  return { ok: true, plan: effectivePlanFrom(rows, subscription as SubscriptionRow, now) };
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

/** Actions only Pro includes: the demand forecast and the sales feed behind it. */
export const PRO_ACTIONS = new Set(['forecast', 'forecastHistory', 'listForecastSignals', 'uploadPosSales']);

export type GateRefusal = { status: 402 | 500; error: string };

const label = (plan: SubscriptionTier) => TIER_META[plan].label;

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

/**
 * Refuses what the account's plan does not include. `writeActions` are the
 * scheduling writes: with more people than the plan covers (after a trial or a
 * paid plan ends) they are refused, deletes excepted, so nothing is lost and
 * the team can be brought back under the limit.
 */
export async function planGate(
  client: SupabaseClient,
  accountId: string,
  payload: Record<string, unknown>,
  writeActions: ReadonlySet<string>,
): Promise<GateRefusal | null> {
  const action = typeof payload.action === 'string' ? payload.action : '';
  const gated = PRO_ACTIONS.has(action) || writeActions.has(action) || action === 'upsertLocation';
  if (!gated) return null;

  const resolved = await resolvePlan(client, accountId).catch((error: unknown) => ({ ok: false as const, error: error as { message?: string } }));
  if (!resolved.ok) {
    // The database is unreachable: let the action run and fail (or reject its
    // input) by itself, so a bad request is still a 400 and not a 500.
    console.error('[plans] could not read the plan:', resolved.error?.message ?? '');
    return null;
  }
  const { plan, limits } = resolved.plan;

  if (PRO_ACTIONS.has(action) && !tierMeetsRequirement(plan, 'pro')) {
    return {
      status: 402,
      error: `The demand forecast and sales upload are part of the Pro plan. You are on ${label(plan)}. Manual demand targets still work`,
    };
  }

  if (action === 'upsertLocation' && limits.maxLocations !== null) {
    if (await isNewRow(client, 'locations', accountId, payload.location)) {
      const count = await countRows(client, 'locations', accountId);
      if (count === null) return { status: 500, error: 'Database request failed' };
      if (count >= limits.maxLocations) {
        return {
          status: 402,
          error: `Your ${label(plan)} plan covers ${limits.maxLocations} location${limits.maxLocations === 1 ? '' : 's'}. Upgrade to add another`,
        };
      }
    }
    return null;
  }

  if (writeActions.has(action) && limits.maxWorkers !== null && !action.startsWith('delete')) {
    const count = await countRows(client, 'workers', accountId);
    if (count === null) return { status: 500, error: 'Database request failed' };
    if (count > limits.maxWorkers) {
      return {
        status: 402,
        error: `Your team has ${count} people and the ${label(plan)} plan covers ${limits.maxWorkers}. The schedule is read-only until you upgrade or remove people`,
      };
    }
    if (action === 'upsertWorker' && count >= limits.maxWorkers && (await isNewRow(client, 'workers', accountId, payload.worker))) {
      return {
        status: 402,
        error: `The ${label(plan)} plan covers up to ${limits.maxWorkers} people. Upgrade to add more`,
      };
    }
  }
  return null;
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
  let check: Promise<GateRefusal | null> | null = null;
  const gate = () => (check ??= planGate(client, accountId, payload, writeActions));

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

  return new Proxy(client, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj) as unknown;
      if (prop !== 'from' && prop !== 'rpc') return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
      return (...args: unknown[]) => wrap((value as (...a: unknown[]) => object).apply(obj, args));
    },
  });
}
