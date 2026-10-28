import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');

function AuthStack() {
  return (
    <Stack>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account', headerShown: false }} />
    </Stack>
  );
}

function AuthGuardedLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  return <AuthStack />;
}

/**
 * Auth route group layout.
 * If the user is already signed in, redirect them to the app.
 * When authEnabled is false (dev-bypass mode) ClerkProvider is not mounted,
 * so we must not call useAuth() at all, and the sign-in / sign-up screens
 * (which call Clerk hooks) would crash: send the visitor to the app instead.
 */
export default function AuthLayout() {
  if (!authEnabled) {
    return <Redirect href="/" />;
  }

  return <AuthGuardedLayout />;
}
