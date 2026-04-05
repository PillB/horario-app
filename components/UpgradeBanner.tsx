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
import { brand, Colors, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSubscription } from '@/hooks/useSubscription';
import { trackEvent } from '@/services/analytics';
import { useT } from '@/contexts/LocaleContext';

// Derived from EXPO_PUBLIC_CLERK_FRONTEND_API so it works across all environments
// (dev, staging, production) without hardcoding instance-specific hostnames.
const CLERK_BILLING_URL =
  `${process.env.EXPO_PUBLIC_CLERK_FRONTEND_API ?? 'https://clerk.horario.app'}/user/billing`;

type Props = {
  /** Number of free auto-assigns remaining (from useUsageLimit) */
  autoAssignUsesLeft: number;
};

export function UpgradeBanner({ autoAssignUsesLeft }: Props) {
  const { tier, isTrialing, isSubscribed } = useSubscription();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);
  const { t } = useT();

  // Paid users on active plans don't see the banner
  if (isSubscribed && !isTrialing) return null;

  const openBilling = () => {
    void trackEvent('upgrade_cta_tapped', { tier, source: 'banner' });
    Linking.openURL(CLERK_BILLING_URL).catch(() => {
      // Silently ignore if the URL can't be opened
    });
  };

  if (isTrialing) {
    return (
      <View style={[styles.banner, styles.trialBanner]}>
        <View style={styles.trialBadge}>
          <ThemedText style={styles.trialBadgeText}>{t('upgrade.trial.badge')}</ThemedText>
        </View>
        <View style={styles.trialContent}>
          <ThemedText style={styles.trialText}>
            {t('upgrade.trial.title')}
          </ThemedText>
          <ThemedText style={styles.trialSub}>
            {t('upgrade.trial.subtitle')}
          </ThemedText>
        </View>
      </View>
    );
  }

  // Free plan — outcome-framed copy
  const limitReached = autoAssignUsesLeft <= 0;
  const plural = autoAssignUsesLeft === 1 ? '' : 's';
  const outcomeHeadline = limitReached
    ? t('upgrade.free.limitReached')
    : t('upgrade.free.autoAssignsLeft', { n: String(autoAssignUsesLeft), plural });
  const outcomeCta = limitReached
    ? t('upgrade.free.ctaUnlimited')
    : t('upgrade.free.cta');

  return (
    <Pressable
      onPress={openBilling}
      style={({ pressed }) => [styles.banner, styles.freeBanner, pressed && styles.bannerPressed]}
      accessibilityRole="button"
      accessibilityLabel={t('upgrade.buttonA11y')}
      accessibilityHint={t('upgrade.buttonHint')}>
      <View style={styles.bannerContent}>
        <View style={styles.freeBadge}>
          <ThemedText style={styles.freeBadgeText}>{t('upgrade.free.badge')}</ThemedText>
        </View>
        <View style={styles.bannerText}>
          <ThemedText style={styles.freePlanTitle}>{outcomeHeadline}</ThemedText>
          <ThemedText style={styles.freePlanCta}>{outcomeCta}</ThemedText>
          <ThemedText style={styles.pricingNote}>{t('upgrade.free.pricing')}</ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
    // Visible background shift for clear pressed feedback independent of opacity
    backgroundColor: '#EDE9FE', // Violet 100 — perceptible darkening of proSurface
  },
  // Trial banner
  trialBanner: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trialBadge: {
    // Use Colors.light.success (#15803D) — 5.44:1 vs white, passing WCAG AA
    backgroundColor: Colors.light.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  trialBadgeText: {
    color: '#FFFFFF',
    fontSize: 12, // raised from 11px — improves legibility; 11px below 12px mobile floor
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  trialContent: {
    flex: 1,
    gap: 2,
  },
  trialText: {
    fontSize: 13,
    color: brand.primaryDeep, // #115E59 — 5.87:1 on successSurface ✓ AA
    fontWeight: '600',
    lineHeight: 20, // ≈1.54× of 13px — meets WCAG 1.4.8 best-practice 1.5× recommendation
  },
  trialSub: {
    fontSize: 12, // raised from 11px — below 12px mobile legibility floor
    color: brand.primaryDeep, // #115E59 — 5.87:1 on successSurface ✓ AA (was primaryDark 4.01:1 ✗)
    lineHeight: 18, // ≈1.5× of 12px — meets WCAG 1.4.8 best-practice recommendation
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
    backgroundColor: brand.pro, // #7C3AED — 5.17:1 vs white ✓ AA
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  freeBadgeText: {
    color: '#FFFFFF',
    fontSize: 12, // raised from 11px — below 12px mobile legibility floor
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
    color: colors.text, // tokens adapt to dark mode; #0F172A gives 17.85:1 on proSurface ✓ AAA
    lineHeight: 20, // ≈1.54× of 13px — meets WCAG 1.4.8 best-practice recommendation
  },
  freePlanCta: {
    fontSize: 13, // raised from 12px — improves safety margin; at 12px brand.proDark is borderline
    color: brand.proDark, // #6D28D9 — ~6.3:1 on proSurface ✓ AA (was brand.pro 5.05:1 at 12px)
    fontWeight: '600',
    lineHeight: 19, // ≈1.46× of 13px — approaches WCAG 1.4.8 best-practice 1.5× recommendation
  },
  pricingNote: {
    fontSize: 12, // raised from 11px — below 12px mobile legibility floor
    color: colors.textSecondary, // #475569 — 6.86:1 on white/proSurface ✓ AA (was #6B7280 ~4.40:1 ✗)
    marginTop: 2,
    lineHeight: 18, // ≈1.5× of 12px — meets WCAG 1.4.8 best-practice recommendation
  },
});