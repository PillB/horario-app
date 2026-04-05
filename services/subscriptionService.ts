/**
 * subscriptionService.ts
 *
 * Client-side service for subscription tier reads and payment flows.
 * All writes are routed through the secure proxy (service-role key lives there).
 *
 * Pattern mirrors services/rosterService.ts.
 */

import { getSessionToken } from '@/services/authToken';
import type { SubscriptionTier } from '@/constants/pricing';

const SECURE_PROXY_URL = process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

// ─── Domain types ─────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid';

export type DbSubscription = {
  id: string;
  accountId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  culqiCustomerId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  paymentProvider: 'stripe' | 'culqi' | null;
  billingInterval: 'month' | 'year';
  countryCode: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCheckoutSessionResult =
  | { success: true; checkoutUrl: string; provider: 'stripe' | 'culqi' }
  | { success: false; error: string };

export type CreatePortalSessionResult =
  | { success: true; portalUrl: string }
  | { success: false; error: string };

// ─── Proxy helper ──────────────────────────────────────────────────────────────

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
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Proxy error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Subscription reads ────────────────────────────────────────────────────────

/**
 * Fetches the current subscription record for an account.
 * Returns a free-tier stub if no record exists yet.
 */
export async function getSubscription(
  accountId: string,
): Promise<{ success: true; subscription: DbSubscription } | { success: false; error: string }> {
  try {
    return await proxyPost({ action: 'getSubscription', accountId });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Gets the current tier for an account (simplified — just the tier string).
 * Falls back to 'free' on any error.
 */
export async function getAccountTier(accountId: string): Promise<SubscriptionTier> {
  const result = await getSubscription(accountId);
  if (!result.success) return 'free';
  return result.subscription.tier;
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * Creates a Stripe or Culqi checkout session for a paid tier upgrade.
 * Returns the redirect URL to send the user to.
 */
export async function createCheckoutSession(params: {
  accountId: string;
  tier: Exclude<SubscriptionTier, 'free'>;
  billingInterval: 'month' | 'year';
  countryCode: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CreateCheckoutSessionResult> {
  try {
    return await proxyPost({ action: 'createCheckoutSession', ...params });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Creates a Stripe customer portal session for managing billing.
 */
export async function createBillingPortalSession(params: {
  accountId: string;
  returnUrl: string;
}): Promise<CreatePortalSessionResult> {
  try {
    return await proxyPost({ action: 'createBillingPortalSession', ...params });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Cancels the subscription at period end (does not revoke access immediately).
 */
export async function cancelSubscription(
  accountId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    return await proxyPost({ action: 'cancelSubscription', accountId });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
