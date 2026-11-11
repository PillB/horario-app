/**
 * PricingModal — the three plans side by side: Gratis, Esencial, Pro.
 *
 * Prices, limits and plan names come from constants/pricing.ts; the current
 * plan comes from the server (useSubscription). Prices are per location.
 *
 * Checkout is not built (docs/manual-setup/SETUP_PADDLE.md). Until
 * EXPO_PUBLIC_CHECKOUT_ENABLED is "1" the paid plans show no buy button, only
 * a note; with it, the button asks the proxy for a checkout page.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { brand, Colors, type ThemeColors } from '@/constants/Colors';
import {
  ANNUAL_MONTHS_FREE,
  TIERS,
  TIER_LIMITS,
  TIER_META,
  TRIAL_DAYS,
  formatPlanPrice,
  pricesForCountry,
  type SubscriptionTier,
} from '@/constants/pricing';
import { useT } from '@/contexts/LocaleContext';
import { useIdentity } from '@/contexts/IdentityContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLocations } from '@/hooks/useLocations';
import { useSubscription } from '@/hooks/useSubscription';
import { createCheckoutSession } from '@/services/subscriptionService';

const CHECKOUT_ENABLED = process.env.EXPO_PUBLIC_CHECKOUT_ENABLED === '1';

type Interval = 'month' | 'year';

type PricingModalProps = {
  visible: boolean;
  /** Plan to draw attention to (the one a locked feature needs). */
  highlightTier?: SubscriptionTier;
  onClose: () => void;
  /** Country for the price list (ISO 3166-1 alpha-2). Default: the country of the account's first location. */
  countryCode?: string | null;
};

export function PricingModal({ visible, highlightTier = 'esencial', onClose, countryCode }: PricingModalProps) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = makeStyles(colors);
  const { tier: currentTier, isTrialing, trialDaysLeft } = useSubscription();
  const [interval, setBillingInterval] = useState<Interval>('month');
  const [busyTier, setBusyTier] = useState<SubscriptionTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const { accountId } = useIdentity();
  const { locations } = useLocations(accountId);
  const country = countryCode ?? locations[0]?.countryCode ?? null;
  const prices = pricesForCountry(country);

  const handleChoose = useCallback(
    async (tier: Exclude<SubscriptionTier, 'gratis'>) => {
      setBusyTier(tier);
      setCheckoutError(null);
      const result = await createCheckoutSession({ tier, billingInterval: interval, countryCode: country ?? undefined });
      setBusyTier(null);
      if (!result.success) {
        setCheckoutError(result.error);
        return;
      }
      Linking.openURL(result.checkoutUrl).catch(() => setCheckoutError(t('pricing.checkoutOpenFailed')));
    },
    [country, interval, t],
  );

  const featureLines = (tier: SubscriptionTier): string[] => {
    const limits = TIER_LIMITS[tier];
    const people = Number.isFinite(limits.maxWorkers)
      ? t('pricing.feature.people', { n: String(limits.maxWorkers) })
      : t('pricing.feature.peopleUnlimited');
    const autoSchedule = Number.isFinite(limits.maxAutoSchedulesPerMonth)
      ? t('pricing.feature.autoScheduleLimited', { n: String(limits.maxAutoSchedulesPerMonth) })
      : t('pricing.feature.autoScheduleUnlimited');
    if (tier === 'gratis') {
      return [people, t('pricing.feature.oneLocation'), t('pricing.feature.core'), t('pricing.feature.laborWarnings'), autoSchedule];
    }
    if (tier === 'esencial') {
      return [t('pricing.feature.everythingIn', { plan: TIER_META.gratis.label }), people, autoSchedule];
    }
    return [
      t('pricing.feature.everythingIn', { plan: TIER_META.esencial.label }),
      people,
      t('pricing.feature.multiLocation'),
      t('pricing.feature.forecast'),
    ];
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.headerTitle}>
            {t('pricing.title')}
          </ThemedText>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel={t('pricing.close')}
            accessibilityHint={t('pricing.closeHint')}>
            <ThemedText style={styles.closeText}>✕</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
          <ThemedText style={styles.muted}>{t('pricing.perLocation')}</ThemedText>
          {isTrialing && trialDaysLeft !== null ? (
            <ThemedText style={styles.trialNote}>{t('pricing.trialRunning', { n: String(trialDaysLeft) })}</ThemedText>
          ) : null}

          <View style={styles.intervalRow} accessibilityRole="radiogroup" accessibilityLabel={t('pricing.intervalLabel')}>
            {(['month', 'year'] as Interval[]).map((option) => {
              const selected = interval === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setBillingInterval(option)}
                  style={[styles.intervalBtn, selected && styles.intervalBtnActive]}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option === 'month' ? t('pricing.monthly') : t('pricing.annual')}
                  accessibilityHint={t('pricing.intervalHint')}>
                  <ThemedText style={[styles.intervalText, selected && styles.intervalTextActive]}>
                    {option === 'month'
                      ? t('pricing.monthly')
                      : `${t('pricing.annual')} · ${t('pricing.monthsFree', { n: String(ANNUAL_MONTHS_FREE) })}`}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const price = prices[tier];
            const isCurrent = tier === currentTier;
            const isPro = tier === 'pro';
            const amount = interval === 'month' ? price.monthly : price.annual;
            return (
              <View
                key={tier}
                style={[styles.card, tier === highlightTier && !isCurrent && styles.cardHighlighted, isCurrent && styles.cardCurrent]}>
                <View style={styles.cardHeader}>
                  <ThemedText type="defaultSemiBold" style={[styles.planName, isPro && styles.planNamePro]}>
                    {meta.label}
                  </ThemedText>
                  {isCurrent ? (
                    <View style={styles.currentBadge}>
                      <ThemedText style={styles.currentText}>
                        {isTrialing ? t('pricing.currentTrial') : t('pricing.current')}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                <ThemedText style={styles.price}>
                  {tier === 'gratis'
                    ? t('pricing.free')
                    : `${formatPlanPrice(amount, prices)} ${interval === 'month' ? t('pricing.perMonth') : t('pricing.perYear')}`}
                </ThemedText>
                {tier !== 'gratis' && prices.taxIncluded ? (
                  <ThemedText style={styles.muted}>{t('pricing.taxIncluded')}</ThemedText>
                ) : null}

                <View style={styles.features}>
                  {featureLines(tier).map((line) => (
                    <ThemedText key={line} style={styles.featureLine}>
                      {`✓ ${line}`}
                    </ThemedText>
                  ))}
                </View>

                {CHECKOUT_ENABLED && tier !== 'gratis' && (!isCurrent || isTrialing) ? (
                  <Pressable
                    onPress={() => handleChoose(tier)}
                    disabled={busyTier !== null}
                    style={({ pressed }) => [styles.chooseBtn, isPro && styles.chooseBtnPro, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t('pricing.choose', { plan: meta.label })}
                    accessibilityHint={t('pricing.chooseHint')}
                    accessibilityState={{ disabled: busyTier !== null }}>
                    {busyTier === tier ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.chooseText}>{t('pricing.choose', { plan: meta.label })}</ThemedText>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {checkoutError ? (
            <ThemedText style={styles.error} accessibilityRole="alert">
              {checkoutError}
            </ThemedText>
          ) : null}
          {!CHECKOUT_ENABLED ? <ThemedText style={styles.notice}>{t('pricing.checkoutSoon')}</ThemedText> : null}
          <ThemedText style={styles.muted}>{t('pricing.trialTerms', { n: String(TRIAL_DAYS) })}</ThemedText>
          <ThemedText style={styles.muted}>{t('pricing.planned')}</ThemedText>
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { flex: 1 },
    closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontSize: 18, color: colors.text },
    scroll: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
    muted: { fontSize: 13, color: colors.textSecondary },
    trialNote: { fontSize: 14, color: colors.text },
    intervalRow: { flexDirection: 'row', gap: 8 },
    intervalBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      backgroundColor: colors.surface,
    },
    intervalBtnActive: { borderColor: brand.primaryDark, borderWidth: 2 },
    intervalText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
    intervalTextActive: { color: colors.tintText, fontWeight: '600' },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      gap: 6,
    },
    cardHighlighted: { borderColor: brand.pro, borderWidth: 2 },
    cardCurrent: { borderColor: brand.primaryDark, borderWidth: 2 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    planName: { fontSize: 18, color: colors.text },
    planNamePro: { color: colors.text },
    currentBadge: { backgroundColor: brand.primaryDark, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    currentText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    price: { fontSize: 22, fontWeight: '700', color: colors.text },
    features: { gap: 4, marginTop: 6 },
    featureLine: { fontSize: 14, color: colors.text },
    chooseBtn: {
      marginTop: 10,
      minHeight: 44,
      borderRadius: 10,
      backgroundColor: brand.primaryDark,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    chooseBtnPro: { backgroundColor: brand.proDark },
    chooseText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
    pressed: { opacity: 0.85 },
    notice: {
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 10,
      padding: 12,
    },
    error: { fontSize: 14, color: colors.error },
  });
