/**
 * FeatureGate.tsx
 *
 * Declarative wrapper that conditionally renders children based on subscription tier.
 * Shows an upgrade prompt (or nothing) when the feature is not accessible.
 *
 * Usage:
 *   <FeatureGate feature="notifications.whatsapp">
 *     <WhatsAppNotificationSettings />
 *   </FeatureGate>
 *
 *   <FeatureGate feature="multi_location" fallback={<LockedBadge />}>
 *     <MultiLocationDashboard />
 *   </FeatureGate>
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { brand, Colors } from '@/constants/Colors';
import { TIER_META, type SubscriptionTier } from '@/constants/pricing';
import { useT } from '@/contexts/LocaleContext';
import { useFeatureGate } from '@/hooks/useFeatureGate';

type FeatureGateProps = {
  feature: string;
  children: React.ReactNode;
  /**
   * What to render when the feature is locked.
   * Defaults to a compact locked badge with upgrade CTA.
   * Pass null to render nothing.
   */
  fallback?: React.ReactNode | null;
  /** Called when the user taps the upgrade CTA */
  onUpgradePress?: (requiredTier: SubscriptionTier) => void;
};

export function FeatureGate({
  feature,
  children,
  fallback,
  onUpgradePress,
}: FeatureGateProps) {
  const { allowed, requiredTier, loading } = useFeatureGate(feature);

  if (loading) return null;
  if (allowed) return <>{children}</>;

  // If fallback is explicitly null, render nothing
  if (fallback === null) return null;

  // If fallback is provided, render it
  if (fallback !== undefined) return <>{fallback}</>;

  // Default: locked badge
  return (
    <LockedBadge
      requiredTier={requiredTier}
      onUpgradePress={onUpgradePress}
    />
  );
}

// ─── LockedBadge ──────────────────────────────────────────────────────────────

type LockedBadgeProps = {
  requiredTier: SubscriptionTier;
  onUpgradePress?: (tier: SubscriptionTier) => void;
};

function LockedBadge({ requiredTier, onUpgradePress }: LockedBadgeProps) {
  const { t } = useT();
  const meta = TIER_META[requiredTier];
  const isPro = requiredTier === 'pro';

  return (
    <TouchableOpacity
      style={[styles.badge, isPro && styles.badgePro]}
      onPress={() => onUpgradePress?.(requiredTier)}
      accessibilityRole="button"
      accessibilityLabel={t('pricing.gate.requires', { plan: meta.label })}
      accessibilityHint={t('pricing.gate.hint')}
    >
      <Text style={styles.lock}>🔒</Text>
      <View style={styles.badgeText}>
        <Text style={[styles.badgeTitle, isPro && styles.badgeTitlePro]}>
          {t('pricing.gate.requires', { plan: meta.label })}
        </Text>
        <Text style={styles.badgeSub}>{t('pricing.gate.seePlans')}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── FeatureGateOverlay ───────────────────────────────────────────────────────
// Use this variant when you want to blur/overlay the locked content instead of hiding it.

type FeatureGateOverlayProps = Omit<FeatureGateProps, 'fallback'> & {
  /** If true, renders children with a locked overlay instead of hiding them */
  showPreview?: boolean;
};

export function FeatureGateOverlay({
  feature,
  children,
  showPreview = true,
  onUpgradePress,
}: FeatureGateOverlayProps) {
  const { allowed, requiredTier, loading } = useFeatureGate(feature);
  const { t } = useT();

  if (loading || allowed) return <>{children}</>;

  if (!showPreview) {
    return (
      <LockedBadge requiredTier={requiredTier} onUpgradePress={onUpgradePress} />
    );
  }

  const meta = TIER_META[requiredTier];

  return (
    <View style={styles.overlayContainer}>
      <View style={styles.overlayContent} pointerEvents="none">
        {children}
      </View>
      <TouchableOpacity
        style={styles.overlay}
        onPress={() => onUpgradePress?.(requiredTier)}
        accessibilityRole="button"
        accessibilityLabel={t('pricing.gate.requires', { plan: meta.label })}
        accessibilityHint={t('pricing.gate.hint')}
      >
        <View style={styles.overlayBadge}>
          <Text style={styles.overlayLock}>🔒</Text>
          <Text style={styles.overlayTitle}>{t('pricing.gate.requires', { plan: meta.label })}</Text>
          <Text style={styles.overlaySub}>{t('pricing.gate.seePlans')}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: Colors.light.surfaceSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  badgePro: {
    backgroundColor: brand.proSurface,
    borderColor: brand.proLight,
  },
  lock: {
    fontSize: 18,
  },
  badgeText: {
    flex: 1,
  },
  badgeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.text,
  },
  badgeTitlePro: {
    color: brand.pro,
  },
  badgeSub: {
    fontSize: 11,
    color: Colors.light.textSecondary,
    marginTop: 1,
  },
  // Overlay variant
  overlayContainer: {
    position: 'relative',
  },
  overlayContent: {
    opacity: 0.35,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 10,
  },
  overlayBadge: {
    alignItems: 'center',
    backgroundColor: Colors.light.surface,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  overlayLock: {
    fontSize: 24,
    marginBottom: 4,
  },
  overlayTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
  },
  overlaySub: {
    fontSize: 12,
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
});
