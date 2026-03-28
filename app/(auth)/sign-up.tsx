import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSignUp } from '@clerk/expo/legacy';
import { Link, useRouter } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const extractClerkError = (err: unknown): string => {
    const clerkError = err as { errors?: Array<{ longMessage?: string; message?: string }> };
    return (
      clerkError?.errors?.[0]?.longMessage ??
      clerkError?.errors?.[0]?.message ??
      (err instanceof Error ? err.message : 'An error occurred. Please try again.')
    );
  };

  const handleSignUp = async () => {
    if (!isLoaded || !signUp) return;
    setError(null);
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!isLoaded || !signUp) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
      } else {
        setError('Verification incomplete. Please try again.');
      }
    } catch (err: unknown) {
      setError(extractClerkError(err));
    } finally {
      setLoading(false);
    }
  };

  if (pendingVerification) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>Check your email</ThemedText>
        <ThemedText style={styles.subtitle}>
          We sent a verification code to {email}
        </ThemedText>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Verification code</ThemedText>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
              accessibilityLabel="Verification code"
            />
          </View>

          {error ? (
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          ) : null}

          <Pressable
            onPress={handleVerify}
            disabled={loading || !code}
            style={[styles.primaryButton, (loading || !code) && styles.disabledButton]}
            accessibilityRole="button"
            accessibilityLabel="Verify email"
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <ThemedText style={styles.primaryButtonText}>Verify email</ThemedText>}
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>Create account</ThemedText>
      <ThemedText style={styles.subtitle}>
        Get one free optimized schedule — no credit card required.
      </ThemedText>

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
            placeholder="Min 8 characters"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            style={styles.input}
            accessibilityLabel="Password"
          />
        </View>

        {error ? (
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        ) : null}

        <Pressable
          onPress={handleSignUp}
          disabled={loading || !email || !password}
          style={[styles.primaryButton, (loading || !email || !password) && styles.disabledButton]}
          accessibilityRole="button"
          accessibilityLabel="Create account"
        >
          {loading
            ? <ActivityIndicator color="#FFFFFF" />
            : <ThemedText style={styles.primaryButtonText}>Create account</ThemedText>}
        </Pressable>

        <View style={styles.footerRow}>
          <ThemedText style={styles.mutedText}>Already have an account? </ThemedText>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel="Sign in">
              <ThemedText style={styles.linkText}>Sign in</ThemedText>
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
