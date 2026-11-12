/**
 * Platform admin: give a business tester or complimentary access, and take it
 * back. Only users listed in the server's HORARIO_PLATFORM_ADMIN_USER_IDS get
 * past the proxy (403 otherwise); this screen is just the form.
 *
 * A grant is never edited: to extend, grant again; to end early, revoke.
 */
import React, { useCallback, useState } from 'react';
import { Redirect, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { PageTitle } from '@/components/PageTitle';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { PAID_TIERS, TIER_META, type SubscriptionTier } from '@/constants/pricing';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useSubscription } from '@/hooks/useSubscription';
import {
  adminGrantEntitlement,
  adminListEntitlements,
  adminRevokeEntitlement,
  type Entitlement,
} from '@/services/subscriptionService';

type PaidTier = Exclude<SubscriptionTier, 'gratis'>;
type GrantSource = 'tester' | 'comp';
const SOURCES: GrantSource[] = ['tester', 'comp'];
/** Research default for testers. */
const DEFAULT_DAYS = '90';

export default function AdminRoute(): React.JSX.Element {
  const { isPlatformAdmin, loading } = useSubscription();
  if (loading) return <ThemedView style={routeStyles.fill} />;
  if (!isPlatformAdmin) return <Redirect href="/" />;
  return <AdminScreen />;
}

function AdminScreen(): React.JSX.Element {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = makeStyles(colors);

  const [accountId, setAccountId] = useState('');
  const [plan, setPlan] = useState<PaidTier>('pro');
  const [source, setSource] = useState<GrantSource>('tester');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [reason, setReason] = useState('');
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SubscriptionTier | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const id = accountId.trim();

  const load = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    const result = await adminListEntitlements(id);
    setBusy(false);
    if (result.success) {
      setEntitlements(result.entitlements);
      setCurrentPlan(result.plan.plan);
      setMessage(null);
    } else {
      setEntitlements(null);
      setCurrentPlan(null);
      setMessage(result.error);
    }
  }, [id]);

  const grant = useCallback(async () => {
    setBusy(true);
    const result = await adminGrantEntitlement({ accountId: id, plan, source, days: Number(days), reason: reason.trim() });
    setBusy(false);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    setReason('');
    setMessage(t('admin.granted'));
    await load();
  }, [days, id, load, plan, reason, source, t]);

  const revoke = useCallback(
    async (entitlementId: string) => {
      setBusy(true);
      const result = await adminRevokeEntitlement(entitlementId);
      setBusy(false);
      setMessage(result.success ? t('admin.revoked') : result.error);
      if (result.success) await load();
    },
    [load, t],
  );

  const chip = <T extends string>(value: T, selected: boolean, label: string, onPress: (v: T) => void) => (
    <Pressable
      key={value}
      onPress={() => onPress(value)}
      style={[styles.chip, selected && styles.chipActive]}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      accessibilityHint={t('admin.chipHint')}>
      <ThemedText style={[styles.chipText, selected && styles.chipTextActive]}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: t('admin.title') }} />
      <PageTitle title={t('admin.title')} />
      <ThemedText type="title" accessibilityRole="header">
        {t('admin.title')}
      </ThemedText>
      <ThemedText style={styles.muted}>{t('admin.subtitle')}</ThemedText>

      <ThemedView style={styles.card}>
        <ThemedText type="defaultSemiBold">{t('admin.accountLabel')}</ThemedText>
        <TextInput
          value={accountId}
          onChangeText={setAccountId}
          placeholder="org_… / user_…"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={t('admin.accountLabel')}
          accessibilityHint={t('admin.accountHint')}
        />
        <ThemedText style={styles.muted}>{t('admin.accountHint')}</ThemedText>
        <Pressable
          onPress={load}
          disabled={!id || busy}
          style={[styles.button, (!id || busy) && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('admin.load')}
          accessibilityHint={t('admin.loadHint')}
          accessibilityState={{ disabled: !id || busy }}>
          <ThemedText style={styles.buttonText}>{t('admin.load')}</ThemedText>
        </Pressable>
      </ThemedView>

      {message ? (
        <ThemedText style={styles.message} accessibilityRole="alert">
          {message}
        </ThemedText>
      ) : null}

      {entitlements ? (
        <>
          <ThemedView style={styles.card}>
            <ThemedText type="defaultSemiBold">
              {t('admin.currentPlan', { plan: currentPlan ? TIER_META[currentPlan].label : '—' })}
            </ThemedText>
            {entitlements.length === 0 ? <ThemedText style={styles.muted}>{t('admin.none')}</ThemedText> : null}
            {entitlements.map((row) => (
              <View key={row.id} style={styles.row}>
                <View style={styles.rowText}>
                  <ThemedText>
                    {`${TIER_META[row.plan]?.label ?? row.plan} · ${row.source} · ${row.startsAt.slice(0, 10)} → ${row.endsAt ? row.endsAt.slice(0, 10) : '∞'}`}
                  </ThemedText>
                  <ThemedText style={styles.muted}>
                    {`${row.active ? t('admin.active') : row.revokedAt ? t('admin.revokedState') : t('admin.ended')} · ${row.grantedBy}${row.reason ? ` · ${row.reason}` : ''}`}
                  </ThemedText>
                </View>
                {row.active ? (
                  <Pressable
                    onPress={() => revoke(row.id)}
                    disabled={busy}
                    style={styles.revoke}
                    accessibilityRole="button"
                    accessibilityLabel={t('admin.revoke')}
                    accessibilityHint={t('admin.revokeHint')}>
                    <ThemedText style={styles.revokeText}>{t('admin.revoke')}</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ThemedView>

          <ThemedView style={styles.card}>
            <ThemedText type="defaultSemiBold">{t('admin.grantTitle')}</ThemedText>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('admin.planLabel')}>
              {PAID_TIERS.map((tier) => chip(tier, plan === tier, TIER_META[tier].label, setPlan))}
            </View>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('admin.sourceLabel')}>
              {SOURCES.map((s) => chip(s, source === s, s === 'tester' ? t('admin.sourceTester') : t('admin.sourceComp'), setSource))}
            </View>
            <ThemedText>{t('admin.daysLabel')}</ThemedText>
            <TextInput
              value={days}
              onChangeText={setDays}
              keyboardType="number-pad"
              style={styles.input}
              accessibilityLabel={t('admin.daysLabel')}
              accessibilityHint={t('admin.daysHint')}
            />
            <ThemedText>{t('admin.reasonLabel')}</ThemedText>
            <TextInput
              value={reason}
              onChangeText={setReason}
              maxLength={500}
              style={styles.input}
              accessibilityLabel={t('admin.reasonLabel')}
              accessibilityHint={t('admin.reasonHint')}
            />
            <Pressable
              onPress={grant}
              disabled={busy}
              style={[styles.button, busy && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('admin.grant')}
              accessibilityHint={t('admin.grantHint')}
              accessibilityState={{ disabled: busy }}>
              <ThemedText style={styles.buttonText}>{t('admin.grant')}</ThemedText>
            </Pressable>
          </ThemedView>
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
    card: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8, backgroundColor: colors.surface },
    muted: { fontSize: 13, color: colors.textSecondary },
    message: { fontSize: 14, color: colors.text, backgroundColor: colors.surfaceSecondary, borderRadius: 10, padding: 12 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      minHeight: 44,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    button: {
      minHeight: 44,
      borderRadius: 10,
      backgroundColor: brand.primaryDark,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    buttonDisabled: { backgroundColor: colors.textSecondary },
    buttonText: { color: '#FFFFFF', fontWeight: '600' },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, justifyContent: 'center' },
    chipActive: { borderColor: brand.primaryDark, borderWidth: 2 },
    chipText: { color: colors.textSecondary },
    chipTextActive: { color: colors.tintText, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
    rowText: { flex: 1, gap: 2 },
    revoke: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
    revokeText: { color: colors.error, fontWeight: '600' },
  });

const routeStyles = StyleSheet.create({ fill: { flex: 1 } });
