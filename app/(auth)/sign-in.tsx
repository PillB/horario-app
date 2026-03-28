import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSignIn } from '@clerk/expo/legacy';
import { Link, useRouter } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!isLoaded || !signIn) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
      } else {
        setError('Sign-in could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      const clerkError = err as { errors?: { longMessage?: string; message?: string }[] };
      const msg =
        clerkError?.errors?.[0]?.longMessage ??
        clerkError?.errors?.[0]?.message ??
        (err instanceof Error ? err.message : 'Sign-in failed. Check your credentials.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>Welcome back</ThemedText>
      <ThemedText style={styles.subtitle}>Sign in to your Horario account</ThemedText>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>Email</ThemedText>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            style={styles.input}
            accessibilityLabel="Email address"
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>Password</ThemedText>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            autoComplete="password"
            style={styles.input}
            accessibilityLabel="Password"
          />
        </View>

        {error ? (
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        ) : null}

        <Pressable
          onPress={handleSignIn}
          disabled={loading || !email || !password}
          style={[styles.primaryButton, (loading || !email || !password) && styles.disabledButton]}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <ThemedText style={styles.primaryButtonText}>Sign in</ThemedText>}
        </Pressable>

        <View style={styles.footerRow}>
          <ThemedText style={styles.mutedText}>Don&apos;t have an account? </ThemedText>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Create account">
              <ThemedText style={styles.linkText}>Create one</ThemedText>
            </Pressable>
          </Link>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { marginBottom: 4 },
  subtitle: { color: '#9CA3AF', marginBottom: 32 },
  form: { gap: 16 },
  inputGroup: { gap: 6 },
  label: { fontWeight: '600', fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontSize: 16,
  },
  errorText: { color: '#DC2626', fontSize: 14 },
  primaryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledButton: { opacity: 0.5 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  footerRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  mutedText: { color: '#9CA3AF' },
  linkText: { color: '#2563EB', fontWeight: '600' },
});
