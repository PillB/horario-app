/**
 * PricingModal — the three plans side by side: Gratis, Esencial, Pro.
 *
 * Prices, limits and plan names come from constants/pricing.ts; the current
 * plan comes from the server (useSubscription). Prices are per location.
 *
 * Payments: Paddle (server/billing.ts, docs/manual-setup/SETUP_PADDLE.md).
 * Until EXPO_PUBLIC_CHECKOUT_ENABLED is "1" the paid plans show no buy button,
 * only a note. With it: a business on no paid plan gets a checkout (the
 * /pay page, Paddle's overlay); a business that already pays switches plan
 * in place (prorated) and has "Manage billing" (Paddle's portal: card,
 * invoices, cancel). The plan shown changes when Paddle's webhook arrives.
 * iOS shows no purchase button: App Store rule 3.1.1 asks for in-app purchase
 * for digital subscriptions bought inside the app; the plan bought on the web
 * still applies there.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { changeSubscription, createBillingPortalSession, createCheckoutSession } from '@/services/subscriptionService';

// Read at render (Expo inlines the value at build time either way).
const checkoutEnabled = () => process.env.EXPO_PUBLIC_CHECKOUT_ENABLED === '1';
const canBuyHere = () => checkoutEnabled() && Platform.OS !== 'ios';

/** The checkout page replaces the app on the web (it comes back through /pay); elsewhere it opens the browser. */
const openPaymentPage = async (url: string, sameTab: boolean): Promise<void> => {
  if (Platform.OS === 'web' && sameTab && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }
  await Linking.openURL(url);
};

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
  const { tier: currentTier, isTrialing, trialDaysLeft, hasPaidSubscription, hasBillingAccount, status, refresh } = useSubscription();
  const [notice, setNotice] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
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
      setNotice(null);
      if (hasPaidSubscription) {
        const changed = await changeSubscription({ tier, billingInterval: interval });
        setBusyTier(null);
        if (!changed.success) {
          setCheckoutError(changed.error);
          return;
        }
        setNotice(t('billing.changePending'));
        // Paddle confirms by webhook within seconds; read the plan again then.
        setTimeout(refresh, 4000);
        return;
      }
      const result = await createCheckoutSession({ tier, billingInterval: interval });
      setBusyTier(null);
      if (!result.success) {
        setCheckoutError(result.error);
        return;
      }
      openPaymentPage(result.checkoutUrl, true).catch(() => setCheckoutError(t('pricing.checkoutOpenFailed')));
    },
    [hasPaidSubscription, interval, refresh, t],
  );

  // Buy (or switch to) a paid plan: not the one already paid for; the trial's own plan can be bought.
  const offersButton = (isCurrent: boolean) => canBuyHere() && (!isCurrent || isTrialing || !hasPaidSubscription);

  const handleManageBilling = useCallback(async () => {
    setPortalBusy(true);
    setCheckoutError(null);
    const result = await createBillingPortalSession();
    setPortalBusy(false);
    if (!result.success) {
      setCheckoutError(result.error);
      return;
    }
    openPaymentPage(result.portalUrl, false).catch(() => setCheckoutError(t('pricing.checkoutOpenFailed')));
  }, [t]);

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
          {checkoutEnabled() && locations.length > 1 ? (
            <ThemedText style={styles.muted}>{t('billing.quantityNote', { n: String(locations.length) })}</ThemedText>
          ) : null}
          {status === 'past_due' ? (
            <ThemedText style={styles.notice} accessibilityRole="alert">
              {t('billing.pastDue')}
            </ThemedText>
          ) : null}
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

                {tier !== 'gratis' && offersButton(isCurrent) ? (
                  <ChooseButton
                    planLabel={meta.label}
                    switching={hasPaidSubscription}
                    busy={busyTier === tier}
                    disabled={busyTier !== null}
                    isPro={isPro}
                    onPress={() => handleChoose(tier)}
                    styles={styles}
                  />
                ) : null}
              </View>
            );
          })}

          {checkoutEnabled() ? (
            <BillingExtras
              showManage={hasBillingAccount}
              portalBusy={portalBusy}
              onManage={handleManageBilling}
              notice={notice}
              spinnerColor={colors.tintText}
              styles={styles}
            />
          ) : null}
          {checkoutError ? (
            <ThemedText style={styles.error} accessibilityRole="alert">
              {checkoutError}
            </ThemedText>
          ) : null}
          {!checkoutEnabled() ? <ThemedText style={styles.notice}>{t('pricing.checkoutSoon')}</ThemedText> : null}
          <ThemedText style={styles.muted}>{t('pricing.trialTerms', { n: String(TRIAL_DAYS) })}</ThemedText>
          <ThemedText style={styles.muted}>{t('pricing.planned')}</ThemedText>
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

type ModalStyles = ReturnType<typeof makeStyles>;

function ChooseButton({ planLabel, switching, busy, disabled, isPro, onPress, styles }: {
  planLabel: string;
  /** The business already pays: the button switches plan instead of opening a checkout. */
  switching: boolean;
  busy: boolean;
  disabled: boolean;
  isPro: boolean;
  onPress: () => void;
  styles: ModalStyles;
}) {
  const { t } = useT();
  const label = switching ? t('billing.switchTo', { plan: planLabel }) : t('pricing.choose', { plan: planLabel });
  const hint = switching ? t('billing.switchHint') : t('pricing.chooseHint');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.chooseBtn, isPro && styles.chooseBtnPro, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.chooseText}>{label}</ThemedText>}
    </Pressable>
  );
}

/** Manage billing, the change notice, the iOS note and who sells (shown once checkout is on). */
function BillingExtras({ showManage, portalBusy, onManage, notice, spinnerColor, styles }: {
  showManage: boolean;
  portalBusy: boolean;
  onManage: () => void;
  notice: string | null;
  spinnerColor: string;
  styles: ModalStyles;
}) {
  const { t } = useT();
  return (
    <>
      {showManage ? (
        <Pressable
          onPress={onManage}
          disabled={portalBusy}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('billing.manage')}
          accessibilityHint={t('billing.manageHint')}
          accessibilityState={{ disabled: portalBusy }}>
          {portalBusy ? <ActivityIndicator color={spinnerColor} /> : <ThemedText style={styles.secondaryText}>{t('billing.manage')}</ThemedText>}
        </Pressable>
      ) : null}
      {notice ? (
        <ThemedText style={styles.notice} accessibilityRole="alert">
          {notice}
        </ThemedText>
      ) : null}
      {Platform.OS === 'ios' ? <ThemedText style={styles.notice}>{t('billing.iosNote')}</ThemedText> : null}
      <ThemedText style={styles.muted}>{t('billing.merchantOfRecord')}</ThemedText>
    </>
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
    secondaryBtn: {
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: brand.primaryDark,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    secondaryText: { color: colors.tintText, fontWeight: '600', fontSize: 15 },
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
