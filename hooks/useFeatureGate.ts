/**
 * useFeatureGate.ts
 *
 * Returns whether the current account's tier can access a named feature.
 * Use this in screen/component logic to conditionally render or block UI.
 *
 * For declarative gating in JSX, use <FeatureGate feature="..." /> instead.
 */

import { useSubscription } from '@/hooks/useSubscription';
import {
  type SubscriptionTier,
  nextTier,
  requiredTierForFeature,
  tierMeetsRequirement,
} from '@/constants/pricing';

export type FeatureGateResult = {
  /** Whether the current tier can access this feature */
  allowed: boolean;
  /** The current account tier */
  currentTier: SubscriptionTier;
  /** The minimum tier required for this feature */
  requiredTier: SubscriptionTier;
  /** The next tier above current (for upgrade prompts) */
  upgradeTo: SubscriptionTier | null;
  /** Whether subscription is still loading */
  loading: boolean;
};

/**
 * Check access for a single named feature.
 *
 * @example
 * const { allowed, upgradeTo } = useFeatureGate('notifications.whatsapp');
 * if (!allowed) return <UpgradePrompt tier={upgradeTo} />;
 */
export function useFeatureGate(feature: string): FeatureGateResult {
  const { tier, loading } = useSubscription();
  const requiredTier = requiredTierForFeature(feature);
  const allowed = tierMeetsRequirement(tier, requiredTier);
  const upgradeTo = allowed ? null : nextTier(tier);

  return { allowed, currentTier: tier, requiredTier, upgradeTo, loading };
}

/**
 * Check access for multiple features at once.
 * Returns true only if ALL features are accessible on the current tier.
 */
export function useFeatureGates(features: string[]): FeatureGateResult & { results: Record<string, boolean> } {
  const { tier, loading } = useSubscription();

  const results: Record<string, boolean> = {};
  let allAllowed = true;
  let mostRestrictiveTier: SubscriptionTier = 'free';

  for (const feature of features) {
    const required = requiredTierForFeature(feature);
    const can = tierMeetsRequirement(tier, required);
    results[feature] = can;
    if (!can) {
      allAllowed = false;
      // Track the highest required tier among blocked features
      const tiers: SubscriptionTier[] = ['free', 'starter', 'growth', 'pro'];
      if (tiers.indexOf(required) > tiers.indexOf(mostRestrictiveTier)) {
        mostRestrictiveTier = required;
      }
    }
  }

  return {
    allowed: allAllowed,
    currentTier: tier,
    requiredTier: mostRestrictiveTier,
    upgradeTo: allAllowed ? null : nextTier(tier),
    loading,
    results,
  };
}
