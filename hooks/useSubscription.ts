/**
 * useSubscription — reads the user's Clerk billing plan.
 *
 * Clerk Billing stores the active plan slug in user.publicMetadata
 * when a user subscribes or starts a trial via the Clerk dashboard plan
 * (plan slug: "user_subscription", free slug: "free_user").
 *
 * Falls back gracefully when auth is disabled (dev bypass) or Clerk
 * hasn't loaded yet.
 */

const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

export type PlanSlug = 'free_user' | 'user_subscription';

export type SubscriptionState = {
  plan: PlanSlug;
  /** true when the user has an active paid subscription */
  isSubscribed: boolean;
  /** true when the user is in the 10-day free trial period */
  isTrialing: boolean;
  /** whether Clerk is still loading the user */
  loading: boolean;
};

const FREE_STATE: SubscriptionState = {
  plan: 'free_user',
  isSubscribed: false,
  isTrialing: false,
  loading: false,
};

// ── Auth-enabled implementation ───────────────────────────────────────────────

function useSubscriptionAuth(): SubscriptionState {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useUser } = require('@clerk/expo') as { useUser: () => { user: { publicMetadata?: Record<string, unknown> } | null; isLoaded: boolean } };
  const { user, isLoaded } = useUser();

  if (!isLoaded) return { ...FREE_STATE, loading: true };
  if (!user) return FREE_STATE;

  const meta = user.publicMetadata ?? {};

  // Clerk Billing stores the active plan slug in publicMetadata.plan
  // The status field indicates 'active', 'trialing', or 'canceled'
  const planSlug = (meta['plan'] ?? 'free_user') as string;
  const status = (meta['subscriptionStatus'] ?? '') as string;

  const isSubscribed = planSlug === 'user_subscription' && status === 'active';
  const isTrialing = planSlug === 'user_subscription' && status === 'trialing';

  return {
    plan: (isSubscribed || isTrialing) ? 'user_subscription' : 'free_user',
    isSubscribed,
    isTrialing,
    loading: false,
  };
}

// ── Dev bypass — auth disabled ─────────────────────────────────────────────

function useSubscriptionBypass(): SubscriptionState {
  return FREE_STATE;
}

// ── Export the right hook based on config ────────────────────────────────────

export const useSubscription: () => SubscriptionState = authEnabled
  ? useSubscriptionAuth
  : useSubscriptionBypass;
