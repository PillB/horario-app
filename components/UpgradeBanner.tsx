/**
 * UpgradeBanner — shows plan status and an upgrade CTA when on free plan.
 *
 * - Free plan: shows "Free plan · 1 auto-assign remaining" with a Pro CTA
 * - Trial:     shows trial days remaining with a green badge
 * - Pro:       renders nothing (hide to avoid clutter)
 */
import React from 'react';
import { View, Pressable, StyleSheet, Linking } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';
import { useSubscription } from '@/hooks/useSubscription';
import { trackEvent } from '@/services/analytics';

const CLERK_BILLING_URL = 'https://pleased-falcon-63.clerk.accounts.dev/user/billing';

type Props = {
  /** Number of free auto-assigns remaining (from useUsageLimit) */
  autoAssignUsesLeft: number;
};

export function UpgradeBanner({ autoAssignUsesLeft }: Props) {
  const { plan, isTrialing } = useSubscription();

  // Pro users don't see any banner
  if (plan === 'user_subscription' && !isTrialing) return null;

  const openBilling = () => {
    void trackEvent('upgrade_cta_tapped', { plan, source: 'banner' });
    Linking.openURL(CLERK_BILLING_URL).catch(() => {
      // Silently ignore if the URL can't be opened
    });
  };

  if (isTrialing) {
    return (
      <View style={[styles.banner, styles.trialBanner]}>
        <View style={styles.trialBadge}>
          <ThemedText style={styles.trialBadgeText}>TRIAL</ThemedText>
        </View>
        <View style={styles.trialContent}>
          <ThemedText style={styles.trialText}>
            Pro trial active — unlimited auto-assigns enabled.
          </ThemedText>
          <ThemedText style={styles.trialSub}>
            $12/mo flat after trial. No per-employee fees.
          </ThemedText>
        </View>
      </View>
    );
  }

  // Free plan — outcome-framed copy
  const limitReached = autoAssignUsesLeft <= 0;
  const outcomeHeadline = limitReached
    ? 'Stop building rosters by hand — you\'ve hit the free limit.'
    : `${autoAssignUsesLeft} free auto-assign${autoAssignUsesLeft === 1 ? '' : 's'} left`;
  const outcomeCta = limitReached
    ? 'Unlock unlimited auto-assigns — no per-employee fees →'
    : 'Auto-assign your whole team in one tap. Try Pro free 10 days →';

  return (
    <Pressable
      onPress={openBilling}
      style={({ pressed }) => [styles.banner, styles.freeBanner, pressed && styles.bannerPressed]}
      accessibilityRole="button"
      accessibilityLabel="Upgrade to Pro plan"
      accessibilityHint="Opens billing page to start your free Pro trial">
      <View style={styles.bannerContent}>
        <View style={styles.freeBadge}>
          <ThemedText style={styles.freeBadgeText}>FREE</ThemedText>
        </View>
        <View style={styles.bannerText}>
          <ThemedText style={styles.freePlanTitle}>{outcomeHeadline}</ThemedText>
          <ThemedText style={styles.freePlanCta}>{outcomeCta}</ThemedText>
          <ThemedText style={styles.pricingNote}>$12/mo flat · no per-employee fees · cancel anytime</ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  bannerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  // Trial banner
  trialBanner: {
    backgroundColor: brand.successSurface,
    borderWidth: 1,
    borderColor: brand.success,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trialBadge: {
    backgroundColor: brand.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  trialBadgeText: {
    color: '#FFFFFF',
    fontSize: 11, // raised from 10px — 10px is below the safe legibility floor
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  trialContent: {
    flex: 1,
    gap: 2,
  },
  trialText: {
    fontSize: 13,
    color: brand.primaryDeep,
    fontWeight: '600',
  },
  trialSub: {
    fontSize: 11,
    color: brand.primaryDark,
  },
  // Free plan banner
  freeBanner: {
    backgroundColor: brand.proSurface,
    borderWidth: 1,
    borderColor: brand.proLight,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  freeBadge: {
    backgroundColor: brand.pro,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  freeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11, // raised from 10px — 10px is below the safe legibility floor
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  bannerText: {
    flex: 1,
    gap: 2,
  },
  freePlanTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E1B4B',
  },
  freePlanCta: {
    fontSize: 12,
    color: brand.pro,
    fontWeight: '600',
  },
  pricingNote: {
    fontSize: 11, // raised from 10px
    color: '#6B7280', // Gray 500 — 4.48:1 on lavender proSurface ✓ AA
    marginTop: 2,
  },
});
