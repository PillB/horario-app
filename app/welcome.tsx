/**
 * Public landing page: what Horario does, for whom, the plans and what it does
 * not do yet. Signed-out visitors land here (app/(tabs)/_layout.tsx).
 *
 * Copy rules (evidence in /mnt/project-files/marketing/):
 * - Every claim is true of the product today; no testimonials, counters or
 *   "most chosen" badges until there are real customers to back them.
 * - Plain words, 16 px body text, large targets: many buyers are owners 50+.
 * - The plan list reads constants/pricing.ts, so prices never drift from the
 *   server's plans.
 */
import { Link } from 'expo-router';
import { getLocales } from 'expo-localization';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { PageTitle } from '@/components/PageTitle';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';
import {
  ANNUAL_MONTHS_FREE,
  TIER_LIMITS,
  TIER_META,
  TIERS,
  TRIAL_DAYS,
  formatPlanPrice,
  pricesForCountry,
  type SubscriptionTier,
} from '@/constants/pricing';
import { useT } from '@/contexts/LocaleContext';
import { useHasMounted } from '@/hooks/useHasMounted';

const CHECKOUT_ENABLED = process.env.EXPO_PUBLIC_CHECKOUT_ENABLED === '1';

const INK = '#0F172A';
const BODY = '#334155'; // 10.4:1 on white
const CARD = '#FFFFFF';

type Card = { title: string; body: string };

function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <View style={styles.grid}>
      {cards.map((card) => (
        <View key={card.title} style={styles.card}>
          <ThemedText style={styles.cardTitle}>{card.title}</ThemedText>
          <ThemedText style={styles.body}>{card.body}</ThemedText>
        </View>
      ))}
    </View>
  );
}

export default function WelcomeScreen() {
  const { t } = useT();
  const hasMounted = useHasMounted();
  // The device region picks the price list (S/ in Peru). It is only known on
  // the client, so the static HTML shows US$ and the local list follows.
  const prices = useMemo(
    () => pricesForCountry(hasMounted ? getLocales()[0]?.regionCode ?? null : null),
    [hasMounted],
  );

  const planPeople = (tier: SubscriptionTier) => {
    const n = TIER_LIMITS[tier].maxWorkers;
    return Number.isFinite(n) ? t('landing.plans.people', { n: String(n) }) : t('landing.plans.peopleUnlimited');
  };
  const planAuto = (tier: SubscriptionTier) => {
    const n = TIER_LIMITS[tier].maxAutoSchedulesPerMonth;
    return Number.isFinite(n) ? t('landing.plans.autoLimited', { n: String(n) }) : t('landing.plans.autoUnlimited');
  };

  // Link asChild passes style straight to the DOM on web: one flat object, no
  // array and no style function.
  const startButton = (style: ViewStyle) => (
    <Link href="/(auth)/sign-up" asChild>
      <Pressable
        style={StyleSheet.flatten([styles.primaryBtn, style])}
        accessibilityRole="link"
        accessibilityLabel={t('landing.start')}
        accessibilityHint={t('landing.startHint')}>
        <ThemedText style={styles.primaryBtnText}>{t('landing.start')}</ThemedText>
      </Pressable>
    </Link>
  );

  const faq = (['1', '2', '3', '4', '5'] as const).map((n) => ({
    q: t(`landing.faq.q${n}`),
    a: t(`landing.faq.a${n}`),
  }));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <PageTitle title={t('landing.pageTitle')} />
      <View style={styles.page}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <ThemedText style={styles.logoIcon}>H</ThemedText>
            </View>
            <ThemedText style={styles.wordmark}>{t('auth.appName')}</ThemedText>
          </View>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable
              style={styles.secondaryBtn}
              accessibilityRole="link"
              accessibilityLabel={t('landing.signIn')}
              accessibilityHint={t('landing.signInHint')}>
              <ThemedText style={styles.secondaryBtnText}>{t('landing.signIn')}</ThemedText>
            </Pressable>
          </Link>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <ThemedText style={styles.eyebrow}>{t('landing.hero.eyebrow')}</ThemedText>
          <ThemedText style={styles.heroTitle} accessibilityRole="header">
            {t('landing.hero.title')}
          </ThemedText>
          <ThemedText style={styles.heroBody}>{t('landing.hero.body')}</ThemedText>
          <View style={styles.ctaRow}>
            {startButton(styles.heroBtn)}
            <Link href="/(auth)/sign-in" asChild>
              <Pressable
                style={styles.textBtn}
                accessibilityRole="link"
                accessibilityLabel={t('landing.hero.haveAccount')}
                accessibilityHint={t('landing.signInHint')}>
                <ThemedText style={styles.textBtnText}>{t('landing.hero.haveAccount')}</ThemedText>
              </Pressable>
            </Link>
          </View>
          <ThemedText style={styles.note}>{t('landing.hero.note')}</ThemedText>
        </View>

        <ThemedText style={styles.h2} accessibilityRole="header">{t('landing.how.title')}</ThemedText>
        <CardGrid
          cards={[
            { title: t('landing.how.step1Title'), body: t('landing.how.step1Body') },
            { title: t('landing.how.step2Title'), body: t('landing.how.step2Body') },
            { title: t('landing.how.step3Title'), body: t('landing.how.step3Body') },
          ]}
        />

        <ThemedText style={styles.h2} accessibilityRole="header">{t('landing.why.title')}</ThemedText>
        <CardGrid
          cards={[
            { title: t('landing.why.lawTitle'), body: t('landing.why.lawBody') },
            { title: t('landing.why.fairTitle'), body: t('landing.why.fairBody') },
            { title: t('landing.why.easyTitle'), body: t('landing.why.easyBody') },
            { title: t('landing.why.priceTitle'), body: t('landing.why.priceBody') },
          ]}
        />

        <ThemedText style={styles.h2} accessibilityRole="header">{t('landing.who.title')}</ThemedText>
        <CardGrid
          cards={[
            { title: t('landing.who.ownerTitle'), body: t('landing.who.ownerBody') },
            { title: t('landing.who.leadTitle'), body: t('landing.who.leadBody') },
            { title: t('landing.who.helperTitle'), body: t('landing.who.helperBody') },
          ]}
        />

        {/* Plans */}
        <ThemedText style={styles.h2} accessibilityRole="header">{t('landing.plans.title')}</ThemedText>
        <View style={styles.grid}>
          {TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const monthly = prices[tier].monthly;
            return (
              <View key={tier} style={[styles.card, meta.isPopular && styles.cardRecommended]}>
                {meta.isPopular ? (
                  <ThemedText style={styles.badge}>{t('landing.plans.recommended')}</ThemedText>
                ) : null}
                <ThemedText style={styles.cardTitle}>{meta.label}</ThemedText>
                <ThemedText style={styles.price}>
                  {monthly === 0
                    ? t('pricing.free')
                    : t('landing.plans.monthly', { price: formatPlanPrice(monthly, prices) })}
                </ThemedText>
                <ThemedText style={styles.body}>{planPeople(tier)}</ThemedText>
                <ThemedText style={styles.body}>{planAuto(tier)}</ThemedText>
              </View>
            );
          })}
        </View>
        <ThemedText style={styles.body}>{t('pricing.trialTerms', { n: String(TRIAL_DAYS) })}</ThemedText>
        <ThemedText style={styles.body}>{t('landing.plans.annual', { n: String(ANNUAL_MONTHS_FREE) })}</ThemedText>
        {CHECKOUT_ENABLED ? null : <ThemedText style={styles.body}>{t('landing.plans.soon')}</ThemedText>}

        {/* Honest limits */}
        <View style={[styles.card, styles.notYet]}>
          <ThemedText style={styles.cardTitle} accessibilityRole="header">{t('landing.notYet.title')}</ThemedText>
          <ThemedText style={styles.body}>{t('landing.notYet.body')}</ThemedText>
        </View>

        <ThemedText style={styles.h2} accessibilityRole="header">{t('landing.faq.title')}</ThemedText>
        <View style={styles.faq}>
          {faq.map((item) => (
            <View key={item.q} style={styles.faqItem}>
              <ThemedText style={styles.faqQ}>{item.q}</ThemedText>
              <ThemedText style={styles.body}>{item.a}</ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.final}>
          <ThemedText style={styles.finalTitle} accessibilityRole="header">{t('landing.final.title')}</ThemedText>
          {startButton(styles.heroBtn)}
          <ThemedText style={styles.note}>{t('landing.hero.note')}</ThemedText>
        </View>

        <ThemedText style={styles.footer}>{t('landing.footer')}</ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.primarySurface },
  scroll: { paddingHorizontal: 16, paddingVertical: 24 },
  page: { width: '100%', maxWidth: 1040, alignSelf: 'center', gap: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', lineHeight: 26 },
  wordmark: { fontSize: 22, fontWeight: '800', color: brand.primaryDeep, lineHeight: 28 },
  hero: { paddingVertical: 24, gap: 14, maxWidth: 760 },
  eyebrow: { fontSize: 16, fontWeight: '700', color: brand.primaryDark, lineHeight: 22 },
  heroTitle: { fontSize: 34, fontWeight: '800', color: INK, lineHeight: 42 },
  heroBody: { fontSize: 19, color: BODY, lineHeight: 28 },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 4 },
  heroBtn: { minWidth: 200 },
  primaryBtn: {
    minHeight: 52,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: brand.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', lineHeight: 24 },
  secondaryBtn: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: brand.primaryDark,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: brand.primaryDark, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  textBtn: { minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' },
  textBtnText: { color: brand.primaryDark, fontSize: 17, fontWeight: '600', textDecorationLine: 'underline' },
  note: { fontSize: 16, color: BODY, lineHeight: 22 },
  h2: { fontSize: 26, fontWeight: '800', color: INK, marginTop: 24, lineHeight: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: {
    flexGrow: 1,
    flexBasis: 260,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    gap: 8,
  },
  cardRecommended: { borderColor: brand.primary, borderWidth: 2 },
  cardTitle: { fontSize: 19, fontWeight: '700', color: INK, lineHeight: 26 },
  body: { fontSize: 16, color: BODY, lineHeight: 24 },
  price: { fontSize: 22, fontWeight: '800', color: INK, lineHeight: 28 },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '700',
    color: brand.primaryDeep,
    backgroundColor: brand.primarySurface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  notYet: { marginTop: 16, borderColor: '#FCD34D', backgroundColor: '#FFFBEB', flexBasis: 'auto' },
  faq: { gap: 12 },
  faqItem: { backgroundColor: CARD, borderRadius: 12, padding: 18, gap: 6 },
  faqQ: { fontSize: 18, fontWeight: '700', color: INK, lineHeight: 24 },
  final: { alignItems: 'flex-start', gap: 12, marginTop: 24, paddingVertical: 16 },
  finalTitle: { fontSize: 26, fontWeight: '800', color: INK, lineHeight: 32 },
  footer: { fontSize: 15, color: BODY, marginTop: 8, marginBottom: 24 },
});
