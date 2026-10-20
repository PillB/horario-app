/**
 * DiagnosticsScreen — Support Diagnostics
 *
 * Accessible to support staff and admins via a Settings / Profile deep-link.
 * Only available in non-production builds: when EXPO_PUBLIC_APP_ENV is
 * `production` the tab is hidden (see `(tabs)/_layout.tsx`) and this route
 * redirects to the home screen.
 *
 * Layout:
 *   - Screen title + subtitle
 *   - Prominent "Copy all logs" CTA
 *   - DiagnosticsPanel (full list + controls)
 *   - Informational footer
 */

import React, { useCallback, useState } from 'react';
import { Redirect } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuditLog } from '@/hooks/useAuditLog';
import { todayKey } from '@/utils/dateKeys';
import { isDiagnosticsEnabled } from '@/utils/appEnv';

// ─── Route ────────────────────────────────────────────────────────────────────

export default function DiagnosticsRoute(): React.JSX.Element {
  if (!isDiagnosticsEnabled()) return <Redirect href="/" />;
  return <DiagnosticsScreen />;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function DiagnosticsScreen(): React.JSX.Element {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  // The panel owns its own hook instance for the list + inline controls.
  // This top-level instance drives the prominent CTA so the user gets
  // immediate feedback on the same buffer without prop-drilling.
  const { copyToClipboard } = useAuditLog();

  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');

  const handleCopyAll = useCallback(async () => {
    const ok = await copyToClipboard();
    setCopyState(ok ? 'success' : 'error');
    // Reset label after 2.5 s
    const timer = setTimeout(() => setCopyState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyToClipboard]);

  const ctaLabel =
    copyState === 'success'
      ? '✓ Copied!'
      : copyState === 'error'
      ? '✗ Copy failed'
      : 'Copy all logs to clipboard';

  const ctaBg =
    copyState === 'success'
      ? brand.success
      : copyState === 'error'
      ? brand.error
      : brand.primary;

  return (
    <ThemedView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityLabel="Support Diagnostics screen"
      >
        {/* ── Hero header ── */}
        <View style={styles.heroSection}>
          <ThemedText
            type="title"
            style={[styles.title, { color: colors.text }]}
            accessibilityRole="header"
          >
            Support Diagnostics
          </ThemedText>
          <ThemedText
            style={[styles.subtitle, { color: colors.textSecondary }]}
            accessibilityRole="text"
          >
            Share these logs with support to diagnose issues.
          </ThemedText>
        </View>

        {/* ── Prominent export CTA ── */}
        <View
          style={[
            styles.exportCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border ?? '#E2E8F0',
            },
          ]}
        >
          <ThemedText
            type="defaultSemiBold"
            style={[styles.exportCardTitle, { color: colors.text }]}
          >
            Export logs
          </ThemedText>
          <ThemedText
            style={[styles.exportCardBody, { color: colors.textSecondary }]}
          >
            Copy the full structured log payload to your clipboard, then paste
            it into a support ticket or share via your preferred app.
          </ThemedText>

          <Pressable
            onPress={handleCopyAll}
            accessibilityRole="button"
            accessibilityLabel="Copy all log entries to clipboard"
            accessibilityState={{ busy: false }}
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: ctaBg, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <ThemedText style={styles.ctaButtonText}>{ctaLabel}</ThemedText>
          </Pressable>
        </View>

        {/* ── Divider ── */}
        <View
          style={[styles.divider, { backgroundColor: colors.border ?? '#E2E8F0' }]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />

        {/* ── Log panel ── */}
        <View style={styles.panelSection}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.sectionLabel, { color: colors.textSecondary }]}
            accessibilityRole="header"
          >
            Recent activity
          </ThemedText>
          <DiagnosticsPanel />
        </View>

        {/* ── Footer info ── */}
        <View style={styles.footer}>
          <ThemedText
            style={[styles.footerText, { color: colors.textTertiary }]}
            accessibilityRole="text"
          >
            Logs are stored in-memory only and cleared when the app is
            restarted. A maximum of 100 entries are retained at any time.
          </ThemedText>
          <ThemedText
            style={[styles.footerText, { color: colors.textTertiary }]}
            accessibilityRole="text"
          >
            Build: {process.env.EXPO_PUBLIC_APP_VERSION ?? 'development'} ·{' '}
            {todayKey()}
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 48,
    gap: 20,
  },

  // ── Hero ──
  heroSection: {
    gap: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },

  // ── Export card ──
  exportCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  exportCardTitle: {
    fontSize: 16,
  },
  exportCardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  ctaButton: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // ── Divider ──
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },

  // ── Panel section ──
  panelSection: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // ── Footer ──
  footer: {
    gap: 4,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});