import { Tabs, Redirect } from 'expo-router';
import React from 'react';
import { Platform, Pressable, View } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { LanguageSelector } from '@/components/LanguageSelector';
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';
import { ThemedText } from '@/components/ThemedText';
import { useWelcomeTour } from '@/contexts/WelcomeTourContext';
import { TourStep } from '@/components/TourStep';
import { isDiagnosticsEnabled } from '@/utils/appEnv';

// Auth gate only active when a valid Clerk publishable key is provided.
const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

function TourTriggerButton() {
  const { startTour } = useWelcomeTour();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  return (
    <Pressable
      onPress={startTour}
      accessibilityRole="button"
      accessibilityLabel="Start app tour"
      accessibilityHint="Opens the welcome tour that explains each section of the app"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed
          ? brand.primary + '55'
          : colors.border,
      })}
    >
      <ThemedText style={{ fontSize: 16, color: colors.text, lineHeight: 24 }}>?</ThemedText>
    </Pressable>
  );
}

function TabNavigator({ extraHeaderRight }: { extraHeaderRight?: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const { t, langCode, setLanguage, locale } = useT();
  const headerRightContent = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 }}>
      <TourTriggerButton />
      <LanguageSelector currentLang={langCode} onSelect={setLanguage} locale={locale} />
      {extraHeaderRight}
    </View>
  );
  return (
    <Tabs
      screenOptions={{
        // Text-safe tint: the active tab label is 10–12px text on a light bar.
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tintText,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].textSecondary,
        headerShown: true,
        headerRight: () => headerRightContent,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: { position: 'absolute' },
          default: {},
        }),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="scheduler"
        options={{
          title: t('nav.scheduler'),
          tabBarIcon: ({ color }) => (
            <TourStep target="scheduler-tab">
              <IconSymbol size={28} name="calendar" color={color} />
            </TourStep>
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('nav.analytics'),
          tabBarIcon: ({ color }) => (
            <TourStep target="analytics-tab">
              <IconSymbol size={28} name="chart.bar.fill" color={color} />
            </TourStep>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="person.crop.circle.fill" color={color} />
          ),
        }}
      />
      {/* Support diagnostics: hidden from the tab bar in production builds. */}
      <Tabs.Screen
        name="diagnostics"
        options={{
          href: isDiagnosticsEnabled() ? undefined : null,
          title: t('nav.diagnostics'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="wrench.and.screwdriver.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

function SignOutButton() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuth } = require('@clerk/expo');
  const { signOut } = useAuth();
  const colorScheme = useColorScheme();
  const { t } = useT();
  return (
    <Pressable
      onPress={() => signOut()}
      accessibilityRole="button"
      accessibilityLabel={t('nav.signOut')}
      accessibilityHint={t('nav.signOutA11y')}
      style={{ paddingHorizontal: 14, paddingVertical: 11, minHeight: 44 }}
    >
      <IconSymbol
        size={22}
        name="rectangle.portrait.and.arrow.right"
        color={colorScheme === 'dark' ? Colors.dark.tint : brand.primaryDark}
      />
    </Pressable>
  );
}

function AuthGuardedTabLayout() {
  // Dynamic import avoids calling useAuth() when ClerkProvider is not mounted
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuth } = require('@clerk/expo');
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return <TabNavigator extraHeaderRight={<SignOutButton />} />;
}

export default function TabLayout() {
  if (!authEnabled) {
    return <TabNavigator />;
  }
  return <AuthGuardedTabLayout />;
}