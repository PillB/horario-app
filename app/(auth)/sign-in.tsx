import React, { useState, useEffect, useCallback } from 'react';
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
import { useSignIn } from '@clerk/expo/legacy';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/components/ThemedText';
import { brand } from '@/constants/Colors';

// ─── Clerk error-code → user-friendly message map ──────────────────────────
const CLERK_ERROR_MESSAGES: Record<string, string> = {
  form_identifier_not_found:
    'No account found for that email address. Please check your email or create an account.',
  form_password_incorrect:
    'Incorrect password. Please try again or reset your password.',
  form_identifier_exists:
    'An account with this email already exists. Try signing in instead.',
  too_many_requests:
    'Too many attempts. Please wait a moment and try again.',
  session_exists:
    'You are already signed in.',
  ticket_expired:
    'This sign-in link has expired. Please request a new one.',
  ticket_invalid:
    'This sign-in link is invalid. Please request a new one.',
};

function resolveClerkError(err: unknown): string {
  const clerkErr = err as {
    errors?: { code?: string; longMessage?: string; message?: string }[];
  };
  const first = clerkErr?.errors?.[0];
  if (first?.code && CLERK_ERROR_MESSAGES[first.code]) {
    return CLERK_ERROR_MESSAGES[first.code];
  }
  return (
    first?.longMessage ??
    first?.message ??
    (err instanceof Error ? err.message : 'Sign-in failed. Please check your credentials.')
  );
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  // Collect both __clerk_ticket (magic-link / org invitation) and
  // afterSignInUrl (deep-link redirect from referring screen).
  const {
    __clerk_ticket: clerkTicket,
    afterSignInUrl,
  } = useLocalSearchParams<{
    __clerk_ticket?: string;
    afterSignInUrl?: string;
  }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Resolve the post-auth destination once so it is consistent across both
  // ticket and password flows.
  const postAuthDestination: string = afterSignInUrl ?? '/';

  // ── Ticket / magic-link flow ──────────────────────────────────────────────
  // After consuming the ticket we replace the current URL with the clean
  // destination so the one-time token cannot be replayed on back-navigation or
  // a future app resume. setActive is always awaited before router.replace to
  // prevent a flash of unauthenticated state.
  useEffect(() => {
    if (!isLoaded || !signIn || !clerkTicket) return;

    let cancelled = false;

    async function consumeTicket() {
      setLoading(true);
      setError(null);
      try {
        const result = await signIn!.create({
          strategy: 'ticket',
          ticket: clerkTicket as string,
        });
        if (cancelled) return;

        if (result.status === 'complete') {
          // Await setActive so the session is fully established before we
          // navigate; this prevents the momentary unauthenticated flash.
          await setActive!({ session: result.createdSessionId });
          // Replace rather than push — removes the ticket-bearing URL from
          // the history stack so the token cannot be reused on back-nav.
          router.replace(postAuthDestination as never);
        } else {
          setError('Sign-in could not be completed. Please try again.');
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(resolveClerkError(err));
          setLoading(false);
        }
      }
    }

    void consumeTicket();

    return () => {
      cancelled = true;
    };
    // postAuthDestination intentionally excluded: it is derived from
    // search params and therefore stable for the lifetime of this render.
    // clerkTicket and isLoaded are the meaningful triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, clerkTicket]);

  // ── Password flow ─────────────────────────────────────────────────────────
  const handleSignIn = useCallback(async () => {
    if (!isLoaded || !signIn) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });
      if (result.status === 'complete') {
        // Always await setActive before navigating so the session token is
        // available to any protected route the user lands on.
        await setActive({ session: result.createdSessionId });
        router.replace(postAuthDestination as never);
      } else {
        setError('Sign-in could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      setError(resolveClerkError(err));
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, setActive, email, password, postAuthDestination, router]);

  const canSubmit = Boolean(email.trim() && password) && !loading;

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

        {/* Form card */}
        <View style={styles.card}>
          <ThemedText style={styles.heading}>Welcome back</ThemedText>
          <ThemedText style={styles.subheading}>Sign in to continue</ThemedText>

          <View style={styles.fields}>
            <View style={styles.field}>
              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="you@example.com"
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
                placeholder="••••••••"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                autoComplete="password"
                returnKeyType="done"
                onSubmitEditing={canSubmit ? handleSignIn : undefined}
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
              onPress={handleSignIn}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                !canSubmit && styles.primaryBtnDisabled,
                pressed && canSubmit && styles.primaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: !canSubmit }}>
              {loading
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <ThemedText style={styles.primaryBtnText}>Sign in</ThemedText>}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <ThemedText style={styles.footerText}>Don&apos;t have an account?</ThemedText>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable accessibilityRole="link" accessibilityLabel="Create account">
                <ThemedText style={styles.footerLink}> Create one free</ThemedText>
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
  brandSection: {
    alignItems: 'center',
    marginBottom: 32,
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