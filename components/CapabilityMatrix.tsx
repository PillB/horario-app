// components/CapabilityMatrix.tsx
/**
 * CapabilityMatrix — displays a feature comparison table (Free vs Pro).
 *
 * - 3-column layout: Feature | Free | Pro
 * - Highlights rows listed in `highlightMissing` with amber background
 * - Shows an "Upgrade to Pro" CTA when any pro-only row is highlighted
 * - Fully accessible and i18n-ready
 */
import React from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { brand, Colors, ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tier = 'free' | 'pro';

type FeatureRow = {
  /** Stable key used for i18n lookup and highlighting */
  key: string;
  /** i18n key, e.g. "capability.autoAssign" */
  i18nKey: string;
  /** English fallback — for developer debugging only, never rendered directly */
  fallback: string;
  /** Which tier includes this feature */
  tier: Tier;
};

export type CapabilityMatrixProps = {
  /** Called when the user taps the "Upgrade to Pro" CTA */
  onUpgradePress?: () => void;
  /**
   * Feature keys (matching FeatureRow.key) that should be highlighted in amber,
   * typically because the current user is blocked from using them.
   */
  highlightMissing?: string[];
};

// ─── Feature definitions ─────────────────────────────────────────────────────

const FEATURE_ROWS: FeatureRow[] = [
  // Free features
  {
    key: 'unlimitedWorkers',
    i18nKey: 'capability.unlimitedWorkers',
    fallback: 'Unlimited workers',
    tier: 'free',
  },
  {
    key: 'shiftTemplates',
    i18nKey: 'capability.shiftTemplates',
    fallback: 'Shift templates',
    tier: 'free',
  },
  {
    key: 'availabilityTracking',
    i18nKey: 'capability.availabilityTracking',
    fallback: 'Availability tracking',
    tier: 'free',
  },
  {
    key: 'rosterAssignment',
    i18nKey: 'capability.rosterAssignment',
    fallback: 'Roster assignment',
    tier: 'free',
  },
  {
    key: 'demandTargets',
    i18nKey: 'capability.demandTargets',
    fallback: 'Demand targets',
    tier: 'free',
  },
  {
    key: 'posCsvImport',
    i18nKey: 'capability.posCsvImport',
    fallback: 'POS CSV import',
    tier: 'free',
  },
  // Pro-only features
  {
    key: 'autoAssign',
    i18nKey: 'capability.autoAssign',
    fallback: 'Auto-assign',
    tier: 'pro',
  },
  {
    key: 'advancedAnalytics',
    i18nKey: 'capability.advancedAnalytics',
    fallback: 'Advanced analytics',
    tier: 'pro',
  },
  {
    key: 'multiLocation',
    i18nKey: 'capability.multiLocation',
    fallback: 'Multi-location',
    tier: 'pro',
  },
  {
    key: 'messaging',
    i18nKey: 'capability.messaging',
    fallback: 'Messaging & comms',
    tier: 'pro',
  },
  {
    key: 'prioritySupport',
    i18nKey: 'capability.prioritySupport',
    fallback: 'Priority support',
    tier: 'pro',
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckIcon({ color, includedLabel }: { color: string; includedLabel: string }) {
  return (
    <ThemedText
      style={{ color, fontSize: 16, fontWeight: '700' }}
      accessibilityLabel={includedLabel}>
      {'✓'}
    </ThemedText>
  );
}

function LockIcon({ color, proOnlyLockedLabel }: { color: string; proOnlyLockedLabel: string }) {
  return (
    <ThemedText
      style={{ color, fontSize: 14 }}
      accessibilityLabel={proOnlyLockedLabel}>
      {'🔒'}
    </ThemedText>
  );
}

function DashIcon({ color, notIncludedLabel }: { color: string; notIncludedLabel: string }) {
  return (
    <ThemedText
      style={{ color, fontSize: 16, fontWeight: '300' }}
      accessibilityLabel={notIncludedLabel}>
      {'–'}
    </ThemedText>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CapabilityMatrix({
  onUpgradePress,
  highlightMissing = [],
}: CapabilityMatrixProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);
  const { t } = useT();

  const highlightSet = new Set(highlightMissing);
  const hasHighlightedPro = FEATURE_ROWS.some(
    (row) => row.tier === 'pro' && highlightSet.has(row.key),
  );

  // Icon accessibility labels resolved through t() once and reused
  const iconLabelIncluded = t('capability.icon.included');
  const iconLabelNotIncluded = t('capability.icon.notIncluded');
  const iconLabelProOnlyLocked = t('capability.icon.proOnlyLocked');

  return (
    <ThemedView style={styles.container}>
      {/* Table header */}
      <View
        style={styles.headerRow}
        accessibilityRole="header"
        accessible>
        <View style={[styles.cell, styles.featureCell]}>
          <ThemedText style={styles.headerText}>
            {t('capability.header.feature')}
          </ThemedText>
        </View>
        <View style={[styles.cell, styles.tierCell]}>
          <ThemedText style={styles.headerText}>
            {t('capability.header.free')}
          </ThemedText>
        </View>
        <View style={[styles.cell, styles.tierCell]}>
          <View style={styles.proHeaderContent}>
            <ThemedText style={[styles.headerText, styles.proHeaderText]}>
              {t('capability.header.pro')}
            </ThemedText>
            <View style={styles.proBadge}>
              <ThemedText style={styles.proBadgeText}>
                {'★'}
              </ThemedText>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.divider} accessibilityElementsHidden />

      {/* Table rows */}
      <ScrollView
        scrollEnabled={false}
        accessible={false}>
        {FEATURE_ROWS.map((row, index) => {
          const isHighlighted = highlightSet.has(row.key);
          const isPro = row.tier === 'pro';
          const isLastRow = index === FEATURE_ROWS.length - 1;
          const label = t(row.i18nKey as Parameters<typeof t>[0]);

          const rowA11yLabel = isPro
            ? `${label}, ${t('capability.a11y.proOnly')}, ${isHighlighted ? t('capability.a11y.currentlyLocked') : t('capability.a11y.availableWithPro')}`
            : `${label}, ${t('capability.a11y.includedInFreeAndPro')}`;

          return (
            <View key={row.key}>
              <View
                style={[
                  styles.row,
                  index % 2 === 0 ? styles.rowEven : styles.rowOdd,
                  isHighlighted && styles.rowHighlighted,
                  isLastRow && styles.rowLast,
                ]}
                accessible
                accessibilityLabel={rowA11yLabel}>
                {/* Feature label */}
                <View style={[styles.cell, styles.featureCell]}>
                  <View style={styles.featureLabelRow}>
                    {isHighlighted && (
                      <View
                        style={styles.highlightDot}
                        accessibilityElementsHidden
                      />
                    )}
                    <ThemedText
                      style={[
                        styles.featureText,
                        isHighlighted && styles.featureTextHighlighted,
                      ]}
                      numberOfLines={2}>
                      {label}
                    </ThemedText>
                  </View>
                </View>

                {/* Free column */}
                <View
                  style={[styles.cell, styles.tierCell, styles.centeredCell]}
                  accessibilityElementsHidden>
                  {isPro ? (
                    <DashIcon color={colors.textSecondary} notIncludedLabel={iconLabelNotIncluded} />
                  ) : (
                    <CheckIcon color={brand.primary} includedLabel={iconLabelIncluded} />
                  )}
                </View>

                {/* Pro column */}
                <View
                  style={[styles.cell, styles.tierCell, styles.centeredCell]}
                  accessibilityElementsHidden>
                  {isPro ? (
                    isHighlighted ? (
                      <LockIcon color={brand.accentDark} proOnlyLockedLabel={iconLabelProOnlyLocked} />
                    ) : (
                      <CheckIcon color={brand.pro} includedLabel={iconLabelIncluded} />
                    )
                  ) : (
                    <CheckIcon color={brand.pro} includedLabel={iconLabelIncluded} />
                  )}
                </View>
              </View>

              {!isLastRow && (
                <View style={styles.rowDivider} accessibilityElementsHidden />
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Upgrade CTA */}
      {hasHighlightedPro && onUpgradePress && (
        <>
          <View style={styles.divider} accessibilityElementsHidden />
          <View style={styles.ctaContainer}>
            <ThemedText style={styles.ctaHint}>
              {t('capability.upgrade.ctaHint')}
            </ThemedText>
            <Pressable
              onPress={onUpgradePress}
              style={({ pressed }) => [
                styles.ctaButton,
                pressed && styles.ctaButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('capability.upgrade.title')}
              accessibilityHint={t('capability.upgrade.body')}>
              <ThemedText style={styles.ctaButtonText}>
                {t('capability.upgrade.cta')}
              </ThemedText>
            </Pressable>
            <ThemedText style={styles.ctaPricingNote}>
              {t('capability.upgrade.price')}
            </ThemedText>
          </View>
        </>
      )}
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border ?? '#E2E8F0',
      overflow: 'hidden',
      marginHorizontal: 16,
      marginVertical: 8,
    },

    // ── Header ──
    headerRow: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceSecondary,
      paddingVertical: 10,
    },
    headerText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    proHeaderContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    proHeaderText: {
      color: brand.pro,
    },
    proBadge: {
      backgroundColor: brand.pro,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    proBadgeText: {
      color: '#FFFFFF',
      fontSize: 9,
      fontWeight: '800',
    },

    // ── Cells ──
    cell: {
      paddingVertical: 12,
      paddingHorizontal: 10,
    },
    featureCell: {
      flex: 1,
    },
    tierCell: {
      width: 64,
    },
    centeredCell: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Rows ──
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowEven: {
      backgroundColor: colors.background,
    },
    rowOdd: {
      backgroundColor: colors.surfaceSecondary,
    },
    rowHighlighted: {
      backgroundColor: brand.accentSurface,
    },
    rowLast: {
      // No bottom border radius rounding needed — container clips it
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border ?? '#E2E8F0',
      marginHorizontal: 10,
    },

    // ── Feature label ──
    featureLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    highlightDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: brand.accentDark,
      flexShrink: 0,
    },
    featureText: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
      flex: 1,
    },
    featureTextHighlighted: {
      color: brand.accentDark,
      fontWeight: '600',
    },

    // ── Divider ──
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border ?? '#E2E8F0',
    },

    // ── CTA ──
    ctaContainer: {
      padding: 16,
      alignItems: 'center',
      gap: 8,
      backgroundColor: brand.proSurface,
    },
    ctaHint: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    ctaButton: {
      backgroundColor: brand.pro,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 28,
      alignSelf: 'stretch',
      alignItems: 'center',
      shadowColor: brand.pro,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 4,
    },
    ctaButtonPressed: {
      opacity: 0.88,
      transform: [{ scale: 0.985 }],
      backgroundColor: brand.proDark,
    },
    ctaButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    ctaPricingNote: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });