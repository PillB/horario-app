/**
 * ProfileScreen — account identity, subscription status, settings, and sign-out.
 *
 * When Clerk auth is enabled the screen shows real user data (email, plan) and
 * a functional sign-out button.  When running in dev-bypass mode it shows a
 * clear "Development mode" notice so the absence of real auth is obvious.
 *
 * Follows the same dynamic-require pattern used throughout the app so that
 * Clerk hooks are only called when ClerkProvider is mounted in the tree.
 */

import React, { useCallback } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { InfoTooltip } from '@/components/InfoTooltip';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useIdentity } from '@/contexts/IdentityContext';
import { useT } from '@/contexts/LocaleContext';
import { useWelcomeTour, type TourMode } from '@/contexts/WelcomeTourContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSubscription } from '@/hooks/useSubscription';

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUTH_ENABLED = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');
const BILLING_URL = 'https://pleased-falcon-63.clerk.accounts.dev/user/billing';
const APP_VERSION = '1.0.0';

// ─── Clerk user info — two-implementation pattern (same as useSubscription) ────

type UserInfo = {
  email: string;
  displayName: string;
  initials: string;
  isLoaded: boolean;
};

function useUserInfoAuth(): UserInfo {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useUser } = require('@clerk/expo') as typeof import('@clerk/expo');
  const { user, isLoaded } = useUser();

  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const fullName = user?.fullName ?? user?.username ?? '';
  const nameParts = fullName.trim().split(/\s+/);
  const initials =
    nameParts.length >= 2
      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
      : (nameParts[0]?.[0] ?? '?').toUpperCase();

  return { email, displayName: fullName, initials, isLoaded };
}

function useUserInfoBypass(): UserInfo {
  return {
    email: process.env.EXPO_PUBLIC_USER_ID ?? 'dev@horario.app',
    displayName: '',
    initials: 'DV',
    isLoaded: true,
  };
}

const useUserInfo: () => UserInfo = AUTH_ENABLED ? useUserInfoAuth : useUserInfoBypass;

// ─── Sign-out — two-implementation pattern (same as useSubscription) ──────────

function useSignOutAuth(): (() => Promise<void>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuth } = require('@clerk/expo') as typeof import('@clerk/expo');
  const { signOut } = useAuth();
  return signOut;
}

function useSignOutBypass(): null {
  return null;
}

const useSignOut: () => (() => Promise<void>) | null = AUTH_ENABLED
  ? useSignOutAuth
  : useSignOutBypass;

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  tooltip,
  styles,
}: {
  title: string;
  subtitle?: string;
  tooltip?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>
          {title}
        </ThemedText>
        {tooltip ? <InfoTooltip content={tooltip} label={title} /> : null}
      </View>
      {subtitle ? (
        <ThemedText style={styles.sectionSubtitle}>{subtitle}</ThemedText>
      ) : null}
    </View>
  );
}

function PlanBadge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <ThemedText style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color }}>
        {label}
      </ThemedText>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { t, langCode, setLanguage, locale } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = makeStyles(colors, colorScheme);
  const router = useRouter();

  const { accountId } = useIdentity();
  const { email, displayName, initials, isLoaded } = useUserInfo();
  const subscription = useSubscription();
  const signOut = useSignOut();
  const { startTourMode } = useWelcomeTour();

  const handleBillingPress = useCallback(() => {
    Linking.openURL(BILLING_URL);
  }, []);

  const handleSignOut = useCallback(async () => {
    if (signOut) {
      await signOut();
    }
  }, [signOut]);

  const handleSignIn = useCallback(() => {
    router.push('/(auth)/sign-in');
  }, [router]);

  const handleDiagnostics = useCallback(() => {
    router.push('/diagnostics');
  }, [router]);

  // Plan display config
  const planConfig = (() => {
    if (subscription.loading) return null;
    if (subscription.isTrialing) {
      return {
        badge: t('profile.subscription.trialBadge'),
        badgeColor: brand.accentDark,
        badgeBg: brand.accentSurface,
        title: t('profile.subscription.trialTitle'),
        desc: t('profile.subscription.trialDesc'),
      };
    }
    if (subscription.isSubscribed) {
      return {
        badge: t('profile.subscription.proBadge'),
        badgeColor: brand.proDark,
        badgeBg: brand.proSurface,
        title: t('profile.subscription.proTitle'),
        desc: t('profile.subscription.proDesc'),
      };
    }
    return {
      badge: t('profile.subscription.freeBadge'),
      badgeColor: colors.textSecondary,
      badgeBg: colors.border,
      title: t('profile.subscription.freeTitle'),
      desc: t('profile.subscription.freeDesc'),
    };
  })();

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      accessibilityLabel={t('nav.profile')}
    >
      {/* ── Hero identity header ───────────────────────────────────────── */}
      <ThemedView style={styles.heroCard}>
        <View style={styles.heroRow}>
          {/* Avatar circle */}
          <View style={styles.avatarCircle}>
            <ThemedText style={styles.avatarInitials}>
              {isLoaded ? initials : '…'}
            </ThemedText>
          </View>

          {/* Name + email + plan badge */}
          <View style={styles.heroInfo}>
            {displayName ? (
              <ThemedText type="defaultSemiBold" style={styles.heroName}>
                {displayName}
              </ThemedText>
            ) : AUTH_ENABLED ? (
              <ThemedText style={styles.heroName}>
                {isLoaded ? t('profile.identity.guestLabel') : t('common.loading')}
              </ThemedText>
            ) : null}

            {AUTH_ENABLED ? (
              email ? (
                <ThemedText style={styles.heroEmail}>{email}</ThemedText>
              ) : null
            ) : (
              <ThemedText style={styles.devBadge}>
                {t('profile.identity.devModeTitle')}
              </ThemedText>
            )}

            {/* Plan badge in hero */}
            {planConfig && !subscription.loading ? (
              <View style={{ marginTop: 6 }}>
                <PlanBadge
                  label={planConfig.badge}
                  color={planConfig.badgeColor}
                  bg={planConfig.badgeBg}
                />
              </View>
            ) : null}
          </View>

          {/* Identity tooltip */}
          <InfoTooltip
            content={t('profile.identity.tooltip')}
            label={t('profile.identity.sectionTitle')}
          />
        </View>

        {/* Dev-mode notice */}
        {!AUTH_ENABLED && (
          <ThemedView style={styles.devNotice}>
            <ThemedText style={styles.devNoticeText}>
              {t('profile.identity.devModeDesc')}
            </ThemedText>
            <ThemedText style={styles.devAccountId}>
              {t('profile.identity.accountIdLabel')}: {accountId}
            </ThemedText>
          </ThemedView>
        )}
      </ThemedView>

      {/* ── Subscription ──────────────────────────────────────────────── */}
      <ThemedView style={styles.card}>
        <SectionHeader
          title={t('profile.subscription.sectionTitle')}
          subtitle={t('profile.subscription.sectionSubtitle')}
          tooltip={t('profile.subscription.tooltip')}
          styles={styles}
        />

        {subscription.loading ? (
          <ThemedText style={styles.mutedText}>
            {t('profile.subscription.loadingPlan')}
          </ThemedText>
        ) : planConfig ? (
          <View style={styles.planBlock}>
            <View style={styles.planRow}>
              <PlanBadge
                label={planConfig.badge}
                color={planConfig.badgeColor}
                bg={planConfig.badgeBg}
              />
              <ThemedText type="defaultSemiBold" style={styles.planTitle}>
                {planConfig.title}
              </ThemedText>
            </View>
            <ThemedText style={styles.mutedText}>{planConfig.desc}</ThemedText>

            {/* CTA */}
            {subscription.isSubscribed || subscription.isTrialing ? (
              <Pressable
                onPress={handleBillingPress}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('profile.subscription.manageButtonA11y')}
                accessibilityHint={t('profile.subscription.manageButtonHint')}
              >
                <ThemedText style={styles.secondaryButtonText}>
                  {t('profile.subscription.manageButton')}
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={handleBillingPress}
                  style={({ pressed }) => [
                    styles.upgradeButton,
                    pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.subscription.upgradeButtonA11y')}
                  accessibilityHint={t('profile.subscription.upgradeButtonHint')}
                >
                  <ThemedText style={styles.upgradeButtonText}>
                    {t('profile.subscription.upgradeButton')}
                  </ThemedText>
                </Pressable>
                <ThemedText style={styles.pricingNote}>
                  {t('profile.subscription.pricingNote')}
                </ThemedText>
              </>
            )}
          </View>
        ) : null}
      </ThemedView>

      {/* ── Settings ──────────────────────────────────────────────────── */}
      <ThemedView style={styles.card}>
        <SectionHeader
          title={t('profile.settings.sectionTitle')}
          subtitle={t('profile.settings.sectionSubtitle')}
          tooltip={t('profile.settings.tooltip')}
          styles={styles}
        />

        <View style={styles.settingsRow}>
          <ThemedText style={styles.settingsLabel}>
            {t('profile.settings.languageLabel')}
          </ThemedText>
          <LanguageSelector
            currentLang={langCode}
            onSelect={setLanguage}
            locale={locale}
          />
        </View>
      </ThemedView>

      {/* ── Account actions ───────────────────────────────────────────── */}
      <ThemedView style={styles.card}>
        <SectionHeader
          title={t('profile.actions.sectionTitle')}
          subtitle={t('profile.actions.sectionSubtitle')}
          tooltip={t('profile.actions.tooltip')}
          styles={styles}
        />

        {AUTH_ENABLED ? (
          <Pressable
            onPress={handleSignOut}
            style={({ pressed }) => [
              styles.destructiveButton,
              pressed && { opacity: 0.75 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('profile.actions.signOutA11y')}
            accessibilityHint={t('profile.actions.signOutHint')}
          >
            <ThemedText style={styles.destructiveButtonText}>
              {t('profile.actions.signOutButton')}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSignIn}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && { opacity: 0.75 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('profile.actions.signInA11y')}
            accessibilityHint={t('profile.actions.signInHint')}
          >
            <ThemedText style={styles.secondaryButtonText}>
              {t('profile.actions.signInButton')}
            </ThemedText>
          </Pressable>
        )}
      </ThemedView>

      {/* ── Guides & Tour ─────────────────────────────────────────────── */}
      <ThemedView style={styles.card}>
        <SectionHeader
          title={t('profile.guides.sectionTitle')}
          subtitle={t('profile.guides.sectionSubtitle')}
          tooltip={t('profile.guides.tooltip')}
          styles={styles}
        />
        {(
          [
            { mode: 'overview' as TourMode, label: t('profile.guides.overview') },
            { mode: 'home' as TourMode, label: t('profile.guides.home') },
            { mode: 'scheduler' as TourMode, label: t('profile.guides.scheduler') },
            { mode: 'analytics' as TourMode, label: t('profile.guides.analytics') },
          ] as const
        ).map(({ mode, label }) => (
          <Pressable
            key={mode}
            onPress={() => startTourMode(mode)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.guideButton, pressed && { opacity: 0.75 }]}
          >
            <ThemedText style={styles.guideButtonText}>{label}</ThemedText>
          </Pressable>
        ))}
      </ThemedView>

      {/* ── About ─────────────────────────────────────────────────────── */}
      <ThemedView style={styles.card}>
        <SectionHeader
          title={t('profile.about.sectionTitle')}
          subtitle={t('profile.about.sectionSubtitle')}
          tooltip={t('profile.about.tooltip')}
          styles={styles}
        />

        <View style={styles.aboutRow}>
          <ThemedText style={styles.settingsLabel}>
            {t('profile.about.versionLabel')}
          </ThemedText>
          <ThemedText style={styles.mutedText}>{APP_VERSION}</ThemedText>
        </View>

        <Pressable
          onPress={handleDiagnostics}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && { opacity: 0.75 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('profile.about.diagnosticsA11y')}
          accessibilityHint={t('profile.about.diagnosticsHint')}
        >
          <ThemedText style={styles.secondaryButtonText}>
            {t('profile.about.diagnosticsButton')}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors, colorScheme: 'light' | 'dark') =>
  StyleSheet.create({
    container: {
      padding: 16,
      gap: 12,
      paddingBottom: 48,
    },

    // Hero card
    heroCard: {
      borderRadius: 16,
      padding: 20,
      backgroundColor: colors.surface,
      gap: 14,
      // Elevated shadow
      shadowColor: '#000',
      shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.07,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    avatarCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: brand.primary,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarInitials: {
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
      lineHeight: 28,
    },
    heroInfo: {
      flex: 1,
      gap: 2,
    },
    heroName: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    heroEmail: {
      fontSize: 14,
      color: colors.textSecondary, // #475569 · 6.86:1 AA
    },
    devBadge: {
      fontSize: 12,
      fontWeight: '700',
      color: brand.accentDark, // #D97706 · AA on white
      letterSpacing: 0.4,
    },

    // Dev notice banner
    devNotice: {
      backgroundColor: brand.accentSurface,
      borderRadius: 10,
      padding: 12,
      borderLeftWidth: 3,
      borderLeftColor: brand.accent,
      gap: 4,
    },
    devNoticeText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    devAccountId: {
      fontSize: 12,
      color: colors.textTertiary,
      fontFamily: 'monospace',
    },

    // Generic card
    card: {
      borderRadius: 14,
      padding: 18,
      backgroundColor: colors.surface,
      gap: 14,
      shadowColor: '#000',
      shadowOpacity: colorScheme === 'dark' ? 0.2 : 0.05,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },

    // Section header inside card
    sectionHeader: {
      gap: 3,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: 13,
      color: colors.textSecondary, // 6.86:1 AA
    },

    // Plan block
    planBlock: {
      gap: 10,
    },
    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    planTitle: {
      fontSize: 15,
      color: colors.text,
    },
    mutedText: {
      fontSize: 13,
      color: colors.textSecondary, // 6.86:1 AA
      lineHeight: 20,
    },
    pricingNote: {
      fontSize: 12,
      color: colors.textTertiary, // 4.35:1 — hint text
      textAlign: 'center',
    },

    // Upgrade button (violet gradient feel via solid color)
    upgradeButton: {
      backgroundColor: brand.pro, // #7C3AED · white text 6.67:1 AAA
      borderRadius: 10,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      minHeight: 48,
      justifyContent: 'center',
    },
    upgradeButtonText: {
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 15,
    },

    // Secondary (outlined) button
    secondaryButton: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
    },
    secondaryButtonText: {
      color: colorScheme === 'dark' ? colors.tint : brand.primaryDeep, // #115E59 · 5.87:1 AA
      fontWeight: '600',
      fontSize: 15,
    },

    // Destructive (sign out)
    destructiveButton: {
      borderWidth: 1.5,
      borderColor: brand.error + '55',
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: 'center',
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: brand.errorSurface,
    },
    destructiveButtonText: {
      color: colors.error, // light: #DC2626 4.64:1 · dark: #F87171 AA ✓
      fontWeight: '600',
      fontSize: 15,
    },

    // Settings row (label + control on same line)
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingsLabel: {
      fontSize: 14,
      color: colors.text,
      fontWeight: '500',
    },

    // Guide buttons
    guideButton: {
      borderWidth: 1.5,
      borderColor: brand.primary,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 8,
      alignItems: 'center',
    },
    guideButtonText: {
      color: brand.primary,
      fontWeight: '600',
      fontSize: 14,
    },

    // About rows
    aboutRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  });
