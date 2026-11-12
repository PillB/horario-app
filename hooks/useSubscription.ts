/**
 * useSubscription — the account's plan, as the server computed it.
 *
 * Source of truth: the proxy's `getSubscription` (server/plans.ts reads
 * `account_entitlements` and `subscriptions`). Until it answers, and when it
 * fails, the state is Gratis: the client never unlocks anything by itself,
 * and the server enforces the limits whatever is shown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { tierCanAccessFeature, tierMeetsRequirement, type SubscriptionTier } from '@/constants/pricing';
import { useIdentity } from '@/contexts/IdentityContext';
import {
  getAccountPlan,
  type AccountPlan,
  type PlanSource,
  type PlanUsage,
  type SubscriptionStatus,
} from '@/services/subscriptionService';

export type { SubscriptionTier, SubscriptionStatus };

export type SubscriptionState = {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** On a paid or granted plan that is not the trial. */
  isSubscribed: boolean;
  /** On the free Pro trial. */
  isTrialing: boolean;
  source: PlanSource;
  /** When the current plan or trial ends (ISO), null = no end date. */
  endsAt: string | null;
  /** Whole days left on the trial (at least 1 while it runs), null when not on it. */
  trialDaysLeft: number | null;
  limits: AccountPlan['limits'];
  usage: PlanUsage | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  isPlatformAdmin: boolean;
  loading: boolean;
  /** Set when the plan could not be loaded. */
  error: string | null;
  canAccess: (feature: string) => boolean;
  refresh: () => void;
};

const GRATIS_LIMITS: AccountPlan['limits'] = { maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 3 };

type Loaded = {
  plan: AccountPlan;
  usage: PlanUsage;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  isPlatformAdmin: boolean;
};

export const daysLeft = (endsAt: string | null, now: number): number | null => {
  if (!endsAt) return null;
  const ms = Date.parse(endsAt) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 86_400_000) : null;
};

export function useSubscription(): SubscriptionState {
  const { accountId } = useIdentity();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    const result = await getAccountPlan();
    if (requestId !== requestRef.current) return;
    if (result.success) {
      setLoaded({
        plan: result.plan,
        usage: result.usage,
        status: result.subscription.status,
        cancelAtPeriodEnd: result.subscription.cancelAtPeriodEnd,
        currentPeriodEnd: result.subscription.currentPeriodEnd,
        isPlatformAdmin: result.isPlatformAdmin === true,
      });
      setError(null);
    } else {
      setLoaded(null);
      setError(result.error);
    }
    setLoading(false);
    // accountId is not sent (the server takes the tenant from the session); a tenant switch reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(() => {
    const tier: SubscriptionTier = loaded?.plan.plan ?? 'gratis';
    const isTrialing = loaded?.plan.isTrial ?? false;
    return {
      tier,
      status: loaded?.status ?? 'active',
      isSubscribed: tier !== 'gratis' && !isTrialing,
      isTrialing,
      source: loaded?.plan.source ?? 'default',
      endsAt: loaded?.plan.endsAt ?? null,
      trialDaysLeft: isTrialing ? daysLeft(loaded?.plan.endsAt ?? null, Date.now()) : null,
      limits: loaded?.plan.limits ?? GRATIS_LIMITS,
      usage: loaded?.usage ?? null,
      cancelAtPeriodEnd: loaded?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: loaded?.currentPeriodEnd ?? null,
      isPlatformAdmin: loaded?.isPlatformAdmin ?? false,
      loading,
      error,
      canAccess: (feature: string) => tierCanAccessFeature(tier, feature),
      refresh: () => void load(),
    };
  }, [loaded, loading, error, load]);
}

export function useTierCheck(required: SubscriptionTier): { allowed: boolean; loading: boolean } {
  const { tier, loading } = useSubscription();
  return { allowed: tierMeetsRequirement(tier, required), loading };
}
