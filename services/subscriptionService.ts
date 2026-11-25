/**
 * Client calls for the account's plan. The server decides the plan
 * (server/plans.ts); nothing here can change it.
 *
 * Payments go through Paddle (server/billing.ts). These calls ask the server
 * for a checkout or portal link, or for a change; the plan itself changes
 * only when Paddle's signed webhook reaches the server, a few seconds later.
 */
import { getSessionToken } from '@/services/authToken';
import { isSubscriptionTier, type SubscriptionTier } from '@/constants/pricing';

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'paused' | 'cancelled' | 'unpaid';
export type PlanSource = 'paddle' | 'comp' | 'tester' | 'trial' | 'subscription' | 'default';

export type DbSubscription = {
  id: string;
  accountId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingInterval: 'month' | 'year';
  countryCode: string | null;
  /** 'paddle' once the business has paid; null on a plan nobody paid for. */
  provider: string | null;
  /** Locations paid for. */
  quantity: number | null;
  pastDueSince: string | null;
  /** True once a Paddle customer exists (the billing portal can open). */
  hasBillingAccount: boolean;
  createdAt: string;
  updatedAt: string;
};

/** The plan in force, as the server computed it. A null limit means no limit. */
export type AccountPlan = {
  plan: SubscriptionTier;
  source: PlanSource;
  endsAt: string | null;
  isTrial: boolean;
  trialEndsAt: string | null;
  limits: { maxWorkers: number | null; maxLocations: number | null; maxAutoSchedulesPerMonth: number | null };
};

export type PlanUsage = { workers: number; locations: number; autoSchedulesThisMonth: number };

export type AccountPlanResponse = {
  subscription: DbSubscription;
  plan: AccountPlan;
  usage: PlanUsage;
  isPlatformAdmin: boolean;
};

export type Entitlement = {
  id: string;
  accountId: string;
  plan: SubscriptionTier;
  source: Exclude<PlanSource, 'subscription' | 'default'>;
  startsAt: string;
  endsAt: string | null;
  locationQuota: number | null;
  grantedBy: string;
  reason: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  active: boolean;
};

export type ServiceResult<T> = ({ success: true } & T) | { success: false; error: string };

export type CreateCheckoutSessionResult = ServiceResult<{ checkoutUrl: string; transactionId: string; quantity: number }>;
export type CreatePortalSessionResult = ServiceResult<{ portalUrl: string }>;

async function proxyPost<T>(body: Record<string, unknown>): Promise<T> {
  const token = await getSessionToken();
  const res = await fetch(SECURE_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const attempt = async <T>(run: () => Promise<T>): Promise<ServiceResult<T>> => {
  try {
    return { success: true, ...(await run()) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Request failed' };
  }
};

// ─── Plan ─────────────────────────────────────────────────────────────────────

/** The account's plan, limits and usage. */
export const getAccountPlan = (): Promise<ServiceResult<AccountPlanResponse>> =>
  attempt(async () => {
    const data = await proxyPost<Partial<AccountPlanResponse> | null>({ action: 'getSubscription' });
    // An answer without a known plan is an error, never a plan.
    if (!data?.subscription || !data.plan?.limits || !isSubscriptionTier(data.plan.plan) || !data.usage) {
      throw new Error('Unexpected plan response');
    }
    return data as AccountPlanResponse;
  });

// ─── Payments ─────────────────────────────────────────────────────────────────

export const createCheckoutSession = (params: {
  tier: Exclude<SubscriptionTier, 'gratis'>;
  billingInterval: 'month' | 'year';
}): Promise<CreateCheckoutSessionResult> =>
  attempt(() => proxyPost<{ checkoutUrl: string; transactionId: string; quantity: number }>({ action: 'createCheckoutSession', ...params }));

/** Another plan, period or number of locations for a business that already pays. Prorated now. */
export const changeSubscription = (params: {
  tier: Exclude<SubscriptionTier, 'gratis'>;
  billingInterval: 'month' | 'year';
  quantity?: number;
}): Promise<ServiceResult<{ pending: boolean; quantity: number }>> =>
  attempt(() => proxyPost<{ pending: boolean; quantity: number }>({ action: 'changeSubscription', ...params }));

export const createBillingPortalSession = (): Promise<CreatePortalSessionResult> =>
  attempt(() => proxyPost<{ portalUrl: string }>({ action: 'createBillingPortalSession' }));

export const cancelSubscription = (): Promise<ServiceResult<object>> =>
  attempt(() => proxyPost<object>({ action: 'cancelSubscription' }));

// ─── Platform admin ───────────────────────────────────────────────────────────

export const adminListEntitlements = (accountId: string) =>
  attempt(() => proxyPost<{ entitlements: Entitlement[]; plan: AccountPlan }>({ action: 'adminListEntitlements', accountId }));

export const adminGrantEntitlement = (grant: {
  accountId: string;
  plan: Exclude<SubscriptionTier, 'gratis'>;
  source: 'comp' | 'tester';
  days: number;
  reason: string;
  locationQuota?: number | null;
}) => attempt(() => proxyPost<{ entitlement: Entitlement }>({ action: 'adminGrantEntitlement', ...grant }));

export const adminRevokeEntitlement = (id: string) =>
  attempt(() => proxyPost<object>({ action: 'adminRevokeEntitlement', id }));
