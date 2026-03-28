import { Tabs, Redirect } from 'expo-router';
import React from 'react';
import { Platform, Pressable } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

// Auth gate only active when a valid Clerk publishable key is provided.
const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

function TabNavigator({ headerRight }: { headerRight?: React.ReactNode }) {
  const colorScheme = useColorScheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: Boolean(headerRight),
        headerRight: headerRight ? () => headerRight : undefined,
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
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="scheduler"
        options={{
          title: 'Scheduler',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Analytics',
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
  return <TabNavigator headerRight={<SignOutButton />} />;
}

export default function TabLayout() {
  if (!authEnabled) {
    return <TabNavigator />;
  }
  return <AuthGuardedTabLayout />;
}
