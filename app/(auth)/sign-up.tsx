import React, { useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSignUp } from '@clerk/expo/legacy';
import { Link, useRouter } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';
import { trackEvent } from '@/services/analytics';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const hasTrackedStart = useRef(false);

  const extractClerkError = (err: unknown): string => {
    const clerkError = err as { errors?: { longMessage?: string; message?: string }[] };
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
        void trackEvent('sign_up_completed');
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

  // ── Verification step ──────────────────────────────────────────────────────
  if (pendingVerification) {
    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          <View style={styles.brandSection}>
            <View style={styles.logoMark}>
              <ThemedText style={styles.logoIcon}>H</ThemedText>
            </View>
            <ThemedText style={styles.wordmark}>Horario</ThemedText>
          </View>

          <View style={styles.card}>
            <View style={styles.verifyIcon}>
              <ThemedText style={styles.verifyEmoji}>📬</ThemedText>
            </View>
            <ThemedText style={styles.heading}>Check your email</ThemedText>
            <ThemedText style={styles.subheading}>
              We sent a 6-digit code to{'\n'}
              <ThemedText style={styles.emailHighlight}>{email}</ThemedText>
            </ThemedText>

            <View style={styles.fields}>
              <View style={styles.field}>
                <ThemedText style={styles.label}>Verification code</ThemedText>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  placeholder="123456"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={code ? handleVerify : undefined}
                  style={[styles.input, styles.codeInput, codeFocused && styles.inputFocused]}
                  accessibilityLabel="Verification code"
                  maxLength={6}
                />
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>{error}</ThemedText>
                </View>
              ) : null}

              <Pressable
                onPress={handleVerify}
                disabled={loading || !code}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (!code || loading) && styles.primaryBtnDisabled,
                  pressed && code && !loading && styles.primaryBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Verify email"
                accessibilityState={{ disabled: !code || loading }}>
                {loading
                  ? <ActivityIndicator color="#FFFFFF" size="small" />
                  : <ThemedText style={styles.primaryBtnText}>Verify email</ThemedText>}
              </Pressable>
            </View>

            <Pressable
              onPress={() => setPendingVerification(false)}
              style={styles.backLink}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <ThemedText style={styles.footerLink}>← Back to sign up</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Registration step ──────────────────────────────────────────────────────
  const canSubmit = Boolean(email && password) && !loading;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>

        {/* Brand header */}
        <View style={styles.brandSection}>
          <View style={styles.logoMark}>
            <ThemedText style={styles.logoIcon}>H</ThemedText>
          </View>
          <ThemedText style={styles.wordmark}>Horario</ThemedText>
          <ThemedText style={styles.tagline}>Smart scheduling, simplified.</ThemedText>
        </View>

        {/* Freemium hook */}
        <View style={styles.promoCard}>
          <ThemedText style={styles.promoText}>
            ✦ Your first optimized schedule is free — no card required
          </ThemedText>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <ThemedText style={styles.heading}>Create your account</ThemedText>
          <ThemedText style={styles.subheading}>Join 1,200+ team managers. Cut no-shows by 40%.</ThemedText>

          <View style={styles.fields}>
            <View style={styles.field}>
              <ThemedText style={styles.label}>Work email</ThemedText>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (!hasTrackedStart.current && v.length > 0) {
                    hasTrackedStart.current = true;
                    void trackEvent('sign_up_started');
                  }
                }}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="you@company.com"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                style={[styles.input, emailFocused && styles.inputFocused]}
                accessibilityLabel="Email address"
              />
            </View>

            <View style={styles.field}>
              <ThemedText style={styles.label}>Password</ThemedText>
              <TextInput
                value={password}
                onChangeText={setPassword}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="Min 8 characters"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={canSubmit ? handleSignUp : undefined}
                style={[styles.input, passwordFocused && styles.inputFocused]}
                accessibilityLabel="Password"
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : null}

            <Pressable
              onPress={handleSignUp}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                !canSubmit && styles.primaryBtnDisabled,
                pressed && canSubmit && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create account"
              accessibilityState={{ disabled: !canSubmit }}>
              {loading
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <ThemedText style={styles.primaryBtnText}>Create free account →</ThemedText>}
            </Pressable>

            <ThemedText style={styles.legalText}>
              By signing up you agree to our Terms of Service and Privacy Policy.
            </ThemedText>
            <ThemedText style={styles.pricingNote}>
              Free forever for 1 team · Pro from $12/mo flat — no per-employee fees
            </ThemedText>
          </View>

          <View style={styles.footer}>
            <ThemedText style={styles.footerText}>Already have an account?</ThemedText>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="Sign in">
                <ThemedText style={styles.footerLink}> Sign in</ThemedText>
              </Pressable>
            </Link>
          </View>
        </View>

        {/* Trust signals */}
        <View style={styles.trust}>
          <ThemedText style={styles.trustText}>Free to start · No credit card · Cancel anytime</ThemedText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: brand.primarySurface,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
  },
  // Brand header
  brandSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  logoIcon: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  wordmark: {
    fontSize: 26,
    fontWeight: '800',
    color: brand.primaryDeep,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    color: brand.primaryDark,
    opacity: 0.8,
  },
  // Promo
  promoCard: {
    backgroundColor: brand.proSurface,
    borderWidth: 1,
    borderColor: brand.proLight,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  promoText: {
    fontSize: 13,
    color: brand.pro,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Form card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 24,
  },
  emailHighlight: {
    color: brand.primary,
    fontWeight: '600',
  },
  // Fields
  fields: {
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    letterSpacing: 0.2,
  },
  input: {
    height: 48,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 16,
  },
  codeInput: {
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    height: 60,
  },
  inputFocused: {
    borderColor: brand.primary,
    backgroundColor: '#FFFFFF',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    lineHeight: 18,
  },
  primaryBtn: {
    height: 50,
    backgroundColor: brand.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: brand.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryBtnDisabled: {
    backgroundColor: '#A5F3FC',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryBtnPressed: {
    backgroundColor: brand.primaryDark,
    transform: [{ scale: 0.985 }],
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  legalText: {
    fontSize: 12, // raised from 11px (below safe minimum)
    color: '#64748B', // Slate 500 — 4.35:1 for small legal text (was #9CA3AF 2.54:1 FAIL)
    textAlign: 'center',
    lineHeight: 16,
  },
  pricingNote: {
    fontSize: 11,
    color: '#0D9488',
    textAlign: 'center',
    fontWeight: '500',
    marginTop: 2,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#64748B',
  },
  footerLink: {
    fontSize: 14,
    color: brand.primary,
    fontWeight: '600',
  },
  backLink: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  // Verification
  verifyIcon: {
    alignItems: 'center',
    marginBottom: 12,
  },
  verifyEmoji: {
    fontSize: 40,
  },
  // Trust signals
  trust: {
    alignItems: 'center',
    marginTop: 24,
  },
  trustText: {
    fontSize: 12,
    color: brand.primaryDark,
    opacity: 0.7,
  },
});
