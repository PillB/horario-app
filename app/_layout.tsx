import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ClerkProvider } from '@clerk/expo';
import { Platform, ActivityIndicator, View } from 'react-native';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { IdentityProvider } from '@/contexts/IdentityContext';
import { WelcomeTourProvider } from '@/contexts/WelcomeTourContext';
import { TourSpotlight } from '@/components/TourSpotlight';
import { Colors, brand } from '@/constants/Colors';

// expo-secure-store (used by @clerk/expo/token-cache) is a native-only module
// and will crash during Vercel's Node.js / web bundle step. We therefore only
// import it on native platforms and pass `undefined` on web — Clerk handles web
// auth automatically via cookies when no tokenCache is provided.
import type { TokenCache } from '@clerk/expo';

const tokenCache: TokenCache | undefined =
  Platform.OS !== 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@clerk/expo/token-cache').tokenCache as TokenCache)
    : undefined;

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
// Auth is only active when a Clerk publishable key is configured.
// Without it the app runs in "dev bypass" mode (no auth wall).
const authEnabled = publishableKey.startsWith('pk_');

// Extend React Navigation themes with Horario design tokens so that all
// navigator-owned UI (headers, bottom sheets, modals) uses audited colours.
const HorarioLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Colors.light.background,
    card: Colors.light.surface,
    text: Colors.light.text,
    border: Colors.light.border,
    primary: brand.primary,
  },
};

const HorarioDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.background,
    card: Colors.dark.surface,
    text: Colors.dark.text,
    border: Colors.dark.border,
    primary: brand.primary,
  },
};

function AppNavigator() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  if (!loaded) {
    // Render a themed loading screen instead of null so users always receive
    // visible feedback and the abrupt content flash is minimised.
    const loadingColors = Colors[colorScheme ?? 'light'];
    return (
      <View
        style={{ flex: 1, backgroundColor: loadingColors.background, alignItems: 'center', justifyContent: 'center' }}
        accessible
        accessibilityLabel="Loading"
      >
        <ActivityIndicator size="large" color={loadingColors.tint} />
      </View>
    );
  }

  const inner = (
    <LocaleProvider>
      <WelcomeTourProvider>
        <ThemeProvider value={colorScheme === 'dark' ? HorarioDarkTheme : HorarioLightTheme}>
          {/* ErrorBoundary is inside ThemeProvider so ThemedText/ThemedView in the
              fallback UI have access to the theme context. */}
          <ErrorBoundary>
            <AppNavigator />
          </ErrorBoundary>
          <TourSpotlight />
          {/* Explicit style ensures status-bar icons are always the inverse of
              the app background, guaranteeing sufficient contrast in both modes. */}
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        </ThemeProvider>
      </WelcomeTourProvider>
    </LocaleProvider>
  );

  if (!authEnabled) {
    return <IdentityProvider>{inner}</IdentityProvider>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <IdentityProvider>{inner}</IdentityProvider>
    </ClerkProvider>
  );
}
