/**
 * /pay — Paddle's "default payment link" page.
 *
 * The server creates a Paddle transaction (server/billing.ts) whose checkout
 * link is this page with `?_ptxn=txn_…`. Paddle.js, once initialized with the
 * public client-side token, sees `_ptxn` and opens its overlay checkout for
 * that transaction (developer.paddle.com, build/transactions/default-payment-link,
 * read 2026-11-21). Card details, tax and receipts stay inside Paddle.
 *
 * The page never changes the plan: when Paddle reports `checkout.completed`
 * it says the payment went through and that the plan updates in a moment
 * (Paddle's signed webhook does that on the server).
 *
 * Set this page's URL (https://<app domain>/pay) as the default payment link
 * in Paddle > Checkout > Checkout settings, sandbox and live.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { PageTitle } from '@/components/PageTitle';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { stageForEvent, type PayStage as Stage } from '@/utils/paddleCheckout';

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_PADDLE_CLIENT_TOKEN ?? '';
const PADDLE_ENV = process.env.EXPO_PUBLIC_PADDLE_ENV === 'production' ? 'production' : 'sandbox';

type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set: (env: string) => void };
  Initialize: (options: { token: string; eventCallback?: (event: PaddleEvent) => void }) => void;
};

function loadPaddle(onEvent: (event: PaddleEvent) => void): () => void {
  let cancelled = false;
  const start = () => {
    const paddle = (window as unknown as { Paddle?: PaddleGlobal }).Paddle;
    if (cancelled || !paddle) return;
    if (PADDLE_ENV === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({ token: CLIENT_TOKEN, eventCallback: onEvent });
  };
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${PADDLE_JS}"]`);
  if (existing && (window as unknown as { Paddle?: unknown }).Paddle) {
    start();
  } else {
    const script = existing ?? document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.addEventListener('load', start);
    script.addEventListener('error', () => !cancelled && onEvent({ name: 'checkout.error' }));
    if (!existing) document.head.appendChild(script);
  }
  return () => {
    cancelled = true;
  };
}

export default function PayRoute(): React.JSX.Element {
  const { t } = useT();
  const router = useRouter();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = makeStyles(colors);
  const [stage, setStage] = useState<Stage>('loading');

  useEffect(() => {
    if (Platform.OS !== 'web' || !CLIENT_TOKEN) {
      setStage('unavailable');
      return;
    }
    if (!new URLSearchParams(window.location.search).get('_ptxn')) {
      setStage('closed');
      return;
    }
    return loadPaddle((event) => setStage((current) => stageForEvent(event.name, current)));
  }, []);

  const message: Record<Stage, string> = {
    loading: t('billing.pay.loading'),
    open: t('billing.pay.open'),
    paid: t('billing.pay.paid'),
    closed: t('billing.pay.closed'),
    failed: t('billing.pay.failed'),
    unavailable: t('billing.pay.unavailable'),
  };

  return (
    <ThemedView style={styles.fill}>
      <PageTitle title={t('billing.pay.title')} />
      <View style={styles.card}>
        <ThemedText type="subtitle" accessibilityRole="header">
          {t('billing.pay.title')}
        </ThemedText>
        {stage === 'loading' ? <ActivityIndicator color={colors.tintText} /> : null}
        <ThemedText style={styles.body} accessibilityRole={stage === 'failed' ? 'alert' : undefined} aria-live="polite">
          {message[stage]}
        </ThemedText>
        {stage !== 'loading' && stage !== 'open' ? (
          <Pressable
            onPress={() => router.replace('/profile')}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('billing.pay.back')}
            accessibilityHint={t('billing.pay.backHint')}>
            <ThemedText style={styles.buttonText}>{t('billing.pay.back')}</ThemedText>
          </Pressable>
        ) : null}
      </View>
    </ThemedView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.background },
    card: {
      width: '100%',
      maxWidth: 480,
      gap: 12,
      padding: 20,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    body: { fontSize: 15, color: colors.text },
    button: {
      minHeight: 44,
      borderRadius: 10,
      backgroundColor: brand.primaryDark,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    buttonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
    pressed: { opacity: 0.85 },
  });
