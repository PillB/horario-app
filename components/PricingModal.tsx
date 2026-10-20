/**
 * PricingModal.tsx
 *
 * Full-screen upgrade modal shown when a user hits a feature gate.
 * Displays the pricing tiers with the required tier highlighted.
 * Handles Stripe checkout redirect and Culqi (Peru) payment.
 *
 * Usage:
 *   const [pricingVisible, setPricingVisible] = useState(false);
 *   const [targetTier, setTargetTier] = useState<SubscriptionTier>('starter');
 *
 *   <PricingModal
 *     visible={pricingVisible}
 *     highlightTier={targetTier}
 *     onClose={() => setPricingVisible(false)}
 *   />
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, Colors } from '@/constants/Colors';
import {
  ANNUAL_DISCOUNT_PCT,
  TIER_LIMITS,
  TIER_META,
  TIER_PRICES_LOCAL,
  TIER_PRICES_USD,
  type SubscriptionTier,
} from '@/constants/pricing';
import { useSubscription } from '@/hooks/useSubscription';
import { createCheckoutSession } from '@/services/subscriptionService';

const PAID_TIERS: Exclude<SubscriptionTier, 'free'>[] = ['starter', 'growth', 'pro'];

type PricingModalProps = {
  visible: boolean;
  /** Tier to pre-select / highlight */
  highlightTier?: SubscriptionTier;
  onClose: () => void;
  /** Country code for localized pricing (ISO 2-char) */
  countryCode?: string;
};

export function PricingModal({
  visible,
  highlightTier = 'starter',
  onClose,
  countryCode = 'PE',
}: PricingModalProps) {
  const insets = useSafeAreaInsets();
  const { tier: currentTier } = useSubscription();
  const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);

  const localPrices = TIER_PRICES_LOCAL[countryCode] ?? TIER_PRICES_LOCAL['PE'];

  const handleUpgrade = useCallback(
    async (tier: Exclude<SubscriptionTier, 'free'>) => {
      setLoadingTier(tier);
      try {
        const result = await createCheckoutSession({
          accountId: process.env.EXPO_PUBLIC_ACCOUNT_ID ?? '',
          tier,
          billingInterval,
          countryCode,
          successUrl: `${process.env.EXPO_PUBLIC_APP_ORIGIN ?? ''}/billing/success`,
          cancelUrl: `${process.env.EXPO_PUBLIC_APP_ORIGIN ?? ''}/billing/cancel`,
        });
        if (result.success) {
          // Open checkout URL in browser
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { openBrowserAsync } = require('expo-web-browser') as typeof import('expo-web-browser');
          await openBrowserAsync(result.checkoutUrl);
          onClose();
        }
      } finally {
        setLoadingTier(null);
      }
    },
    [billingInterval, countryCode, onClose],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Actualiza tu plan</Text>
          <View style={styles.closeBtn} />
        </View>

        {/* Billing interval toggle */}
        <View style={styles.intervalRow}>
          <TouchableOpacity
            style={[styles.intervalBtn, billingInterval === 'month' && styles.intervalBtnActive]}
            onPress={() => setBillingInterval('month')}
            accessibilityRole="button"
            accessibilityLabel="Facturación mensual"
          >
            <Text style={[styles.intervalLabel, billingInterval === 'month' && styles.intervalLabelActive]}>
              Mensual
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.intervalBtn, billingInterval === 'year' && styles.intervalBtnActive]}
            onPress={() => setBillingInterval('year')}
            accessibilityRole="button"
            accessibilityLabel={`Facturación anual — ${ANNUAL_DISCOUNT_PCT}% descuento`}
          >
            <Text style={[styles.intervalLabel, billingInterval === 'year' && styles.intervalLabelActive]}>
              Anual
            </Text>
            <View style={styles.discountBadge}>
              <Text style={styles.discountLabel}>-{ANNUAL_DISCOUNT_PCT}%</Text>
            </View>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {PAID_TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const usdPrice = TIER_PRICES_USD[tier];
            const localPrice = localPrices[tier];
            const limits = TIER_LIMITS[tier];
            const isHighlighted = tier === highlightTier;
            const isCurrent = tier === currentTier;
            const isLoading = loadingTier === tier;
            const isPro = tier === 'pro';

            const displayPrice = billingInterval === 'month'
              ? localPrice.monthly
              : Math.round(localPrice.monthly * (1 - ANNUAL_DISCOUNT_PCT / 100));
            const usdDisplay = billingInterval === 'month'
              ? usdPrice.monthly
              : usdPrice.annualMonthly;

            return (
              <View
                key={tier}
                style={[
                  styles.card,
                  isHighlighted && styles.cardHighlighted,
                  isPro && styles.cardPro,
                  isCurrent && styles.cardCurrent,
                ]}
              >
                {meta.isPopular && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularLabel}>⭐ Más popular</Text>
                  </View>
                )}

                <View style={styles.cardHeader}>
                  <Text style={[styles.tierName, isPro && styles.tierNamePro]}>
                    {meta.label}
                  </Text>
                  <Text style={styles.tagline}>{meta.tagline}</Text>
                </View>

                <View style={styles.priceRow}>
                  <Text style={[styles.price, isPro && styles.pricePro]}>
                    {localPrice.currency === 'PEN' ? 'S/' : localPrice.symbol}
                    {displayPrice}
                  </Text>
                  <Text style={styles.priceSub}> / mes</Text>
                </View>
                <Text style={styles.usdEquiv}>(~${usdDisplay.toFixed(0)} USD/mes)</Text>

                <View style={styles.limitsList}>
                  <LimitRow
                    label="Trabajadores"
                    value={limits.maxWorkers === Infinity ? 'Ilimitados' : `Hasta ${limits.maxWorkers}`}
                  />
                  <LimitRow
                    label="Locales"
                    value={limits.maxLocations === Infinity ? 'Ilimitados' : `Hasta ${limits.maxLocations}`}
                  />
                  <LimitRow
                    label="Horarios IA"
                    value={limits.maxAiSchedulesPerMonth === Infinity ? 'Ilimitados' : `${limits.maxAiSchedulesPerMonth}/mes`}
                  />
                  {tier === 'starter' && <LimitRow label="Notif. WhatsApp" value="✅" />}
                  {(tier === 'growth' || tier === 'pro') && <LimitRow label="Multisede" value="✅" />}
                  {tier === 'pro' && <LimitRow label="Motor laboral completo" value="✅" />}
                </View>

                {isCurrent ? (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentLabel}>✓ Plan actual</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.upgradeBtn, isPro && styles.upgradeBtnPro, isHighlighted && styles.upgradeBtnHighlighted]}
                    onPress={() => handleUpgrade(tier)}
                    disabled={isLoading}
                    accessibilityRole="button"
                    accessibilityLabel={`Actualizar a ${meta.label}`}
                    accessibilityHint={`Activa el plan ${meta.label} por ${localPrice.symbol}${displayPrice}/mes`}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.upgradeBtnText}>
                        Activar {meta.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          <Text style={styles.footer}>
            Cancela cuando quieras · Sin permanencia · Precios en {
              countryCode === 'PE' ? 'Soles (PEN)' :
              countryCode === 'MX' ? 'Pesos MXN' :
              countryCode === 'CO' ? 'Pesos COP' :
              countryCode === 'BR' ? 'Reais (BRL)' :
              countryCode === 'CL' ? 'Pesos CLP' : 'USD'
            }
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── LimitRow ─────────────────────────────────────────────────────────────────

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{label}</Text>
      <Text style={styles.limitValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.light.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: Colors.light.textSecondary,
  },
  intervalRow: {
    flexDirection: 'row',
    margin: 16,
    backgroundColor: Colors.light.surfaceSecondary,
    borderRadius: 10,
    padding: 3,
  },
  intervalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  intervalBtnActive: {
    backgroundColor: Colors.light.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  intervalLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  intervalLabelActive: {
    color: Colors.light.text,
    fontWeight: '600',
  },
  discountBadge: {
    backgroundColor: brand.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: Colors.light.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    gap: 8,
    marginBottom: 12,
  },
  cardHighlighted: {
    borderColor: brand.primary,
    shadowColor: brand.primary,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardPro: {
    borderColor: brand.proLight,
    backgroundColor: brand.proSurface,
  },
  cardCurrent: {
    opacity: 0.7,
  },
  popularBadge: {
    alignSelf: 'flex-start',
    backgroundColor: brand.primarySurface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  popularLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: brand.primaryDark,
  },
  cardHeader: {
    gap: 2,
  },
  tierName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
  },
  tierNamePro: {
    color: brand.pro,
  },
  tagline: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  price: {
    fontSize: 28,
    fontWeight: '800',
    color: brand.primaryDark,
  },
  pricePro: {
    color: brand.pro,
  },
  priceSub: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    paddingBottom: 4,
  },
  usdEquiv: {
    fontSize: 11,
    color: Colors.light.textTertiary,
    marginTop: -4,
  },
  limitsList: {
    gap: 6,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  limitLabel: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  limitValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  upgradeBtn: {
    backgroundColor: brand.primary,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  upgradeBtnPro: {
    backgroundColor: brand.pro,
  },
  upgradeBtnHighlighted: {
    shadowColor: brand.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  upgradeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  currentBadge: {
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.light.surfaceSecondary,
    borderRadius: 10,
    marginTop: 8,
  },
  currentLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.textSecondary,
  },
  footer: {
    fontSize: 12,
    color: Colors.light.textTertiary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
});
