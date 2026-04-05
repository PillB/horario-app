/**
 * useSubscription — reads the account's subscription tier.
 *
 * Source of truth: Clerk publicMetadata.horario_tier (written by the secure
 * proxy webhook handler after every successful Stripe / Culqi payment).
 *
 * Tier values: 'free' | 'starter' | 'growth' | 'pro'
 * Status values: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid'
 *
 * Falls back gracefully when auth is disabled (dev bypass) or Clerk hasn't
 * loaded yet. Never throws — always returns a valid state.
 */

import type { SubscriptionTier } from '@/constants/pricing';
import { tierMeetsRequirement } from '@/constants/pricing';

export type { SubscriptionTier };

const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid';

export type SubscriptionState = {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** true when on any paid tier (starter/growth/pro) and status is active or trialing */
  isSubscribed: boolean;
  /** true when in trial period */
  isTrialing: boolean;
  /** true when the subscription will cancel at end of current period */
  cancelAtPeriodEnd: boolean;
  /** ISO date string of when the current billing period ends */
  currentPeriodEnd: string | null;
  /** whether Clerk is still loading the user */
  loading: boolean;
  /** Shorthand tier checks */
  canAccess: (feature: string) => boolean;
};

const FREE_STATE: SubscriptionState = {
  tier: 'free',
  status: 'active',
  isSubscribed: false,
  isTrialing: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  loading: false,
  canAccess: () => false,
};

// ── Auth-enabled implementation ───────────────────────────────────────────────

function useSubscriptionAuth(): SubscriptionState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useUser } = require('@clerk/expo') as {
    useUser: () => { user: { publicMetadata?: Record<string, unknown> } | null; isLoaded: boolean };
  };
  const { user, isLoaded } = useUser();

  if (!isLoaded) return { ...FREE_STATE, loading: true };
  if (!user) return FREE_STATE;

  const meta = user.publicMetadata ?? {};

  // Written by secure-proxy webhook handler after payment confirmation
  const tier = (['free', 'starter', 'growth', 'pro'].includes(meta['horario_tier'] as string)
    ? (meta['horario_tier'] as SubscriptionTier)
    : 'free');
  const status = (['active', 'trialing', 'past_due', 'cancelled', 'unpaid'].includes(meta['horario_status'] as string)
    ? (meta['horario_status'] as SubscriptionStatus)
    : 'active');
  const cancelAtPeriodEnd = Boolean(meta['horario_cancel_at_period_end']);
  const currentPeriodEnd = (meta['horario_period_end'] as string | null) ?? null;

  const isSubscribed = tier !== 'free' && (status === 'active' || status === 'trialing');
  const isTrialing = tier !== 'free' && status === 'trialing';

  const canAccess = (feature: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tierCanAccessFeature } = require('@/constants/pricing') as typeof import('@/constants/pricing');
    return tierCanAccessFeature(tier, feature);
  };

  return { tier, status, isSubscribed, isTrialing, cancelAtPeriodEnd, currentPeriodEnd, loading: false, canAccess };
}

// ── Dev bypass — auth disabled ─────────────────────────────────────────────

function useSubscriptionBypass(): SubscriptionState {
  return {
    ...FREE_STATE,
    canAccess: (feature: string) => {
      // In dev bypass, use env var EXPO_PUBLIC_DEV_TIER to simulate a tier
      const devTier = (process.env.EXPO_PUBLIC_DEV_TIER ?? 'free') as SubscriptionTier;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tierCanAccessFeature } = require('@/constants/pricing') as typeof import('@/constants/pricing');
      return tierCanAccessFeature(devTier, feature);
    },
  };
}

// ── Export the right hook based on config ────────────────────────────────────

export const useSubscription: () => SubscriptionState = authEnabled
  ? useSubscriptionAuth
  : useSubscriptionBypass;

// ── Convenience: check if tier meets a minimum requirement ───────────────────

export function useTierCheck(required: SubscriptionTier): { allowed: boolean; loading: boolean } {
  const { tier, loading } = useSubscription();
  return { allowed: tierMeetsRequirement(tier, required), loading };
}
