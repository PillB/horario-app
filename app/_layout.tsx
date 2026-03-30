import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { IdentityProvider } from '@/contexts/IdentityContext';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
// Auth is only active when a Clerk publishable key is configured.
// Without it the app runs in "dev bypass" mode (no auth wall).
const authEnabled = publishableKey.startsWith('pk_');

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
    return null;
  }

  const inner = (
    <LocaleProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* ErrorBoundary is inside ThemeProvider so ThemedText/ThemedView in the
            fallback UI have access to the theme context. */}
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </ThemeProvider>
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
