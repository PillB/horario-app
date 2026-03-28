import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

/**
 * Auth route group layout.
 * If the user is already signed in, redirect them to the app.
 */
export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  return (
    <Stack>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account', headerShown: false }} />
    </Stack>
  );
}
