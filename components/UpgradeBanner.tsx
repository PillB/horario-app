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
        <ThemedText style={styles.trialText}>
          Your Pro trial is active — enjoy unlimited auto-assigns.
        </ThemedText>
      </View>
    );
  }

  // Free plan
  const usesLabel = autoAssignUsesLeft <= 0
    ? 'Auto-assign limit reached'
    : `${autoAssignUsesLeft} free auto-assign${autoAssignUsesLeft === 1 ? '' : 's'} left`;

  return (
    <Pressable
      onPress={openBilling}
      style={({ pressed }) => [styles.banner, styles.freeBanner, pressed && styles.bannerPressed]}
      accessibilityRole="button"
      accessibilityLabel="Upgrade to Pro plan"
      accessibilityHint="Opens billing page to start your free trial">
      <View style={styles.bannerContent}>
        <View style={styles.freeBadge}>
          <ThemedText style={styles.freeBadgeText}>FREE</ThemedText>
        </View>
        <View style={styles.bannerText}>
          <ThemedText style={styles.freePlanTitle}>{usesLabel}</ThemedText>
          <ThemedText style={styles.freePlanCta}>
            Try Pro free for 10 days · $12/mo after →
          </ThemedText>
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  trialText: {
    fontSize: 13,
    color: brand.primaryDeep,
    flex: 1,
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
    fontSize: 10,
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
    fontWeight: '500',
  },
});
