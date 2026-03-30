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

// Auth gate only active when a valid Clerk publishable key is provided.
const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

function TourTriggerButton() {
  const { startTour } = useWelcomeTour();
  const colorScheme = useColorScheme();
  return (
    <Pressable
      onPress={startTour}
      accessibilityRole="button"
      accessibilityLabel="Start app tour"
      accessibilityHint="Opens the welcome tour that explains each section of the app"
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed
          ? brand.primary + '22'
          : Colors[colorScheme ?? 'light'].surface + '00',
      })}
    >
      <ThemedText style={{ fontSize: 16, color: brand.primary, lineHeight: 20 }}>?</ThemedText>
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
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
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
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
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
  return (
    <Pressable
      onPress={() => signOut()}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      style={{ paddingHorizontal: 14, paddingVertical: 8 }}
    >
      <IconSymbol
        size={22}
        name="rectangle.portrait.and.arrow.right"
        color={Colors[colorScheme ?? 'light'].tint}
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

