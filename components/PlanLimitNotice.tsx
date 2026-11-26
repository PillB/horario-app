/**
 * PlanLimitNotice — says up front that the schedule is read-only because the
 * team is over the plan's people limit (F-10, CHG-109).
 *
 * The server refuses every scheduling write except deletes while the team has
 * more people than the plan covers (server/plans.ts, workerRefusal). Before,
 * nothing on the Scheduler said so until a write was refused. The numbers are
 * the server's (`useSubscription`: plan limits and usage from getSubscription);
 * the client decides nothing, it only shows what the server will do.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PricingModal } from '@/components/PricingModal';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { TIER_META } from '@/constants/pricing';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useReloadOnSignal } from '@/hooks/useRefreshOnFocus';
import { useSubscription } from '@/hooks/useSubscription';

/** The people count over the limit, or null when the team fits (or the plan is not known yet). */
export const peopleOverLimit = (
  usage: { workers: number } | null,
  limits: { maxWorkers: number | null },
): { count: number; max: number } | null =>
  usage && limits.maxWorkers !== null && usage.workers > limits.maxWorkers
    ? { count: usage.workers, max: limits.maxWorkers }
    : null;

type Props = {
  /** Bumped by the screen when it regains focus: the plan reloads. */
  reloadSignal?: number;
};

export function PlanLimitNotice({ reloadSignal }: Props) {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];
  const { tier, usage, limits, refresh } = useSubscription();
  useReloadOnSignal(reloadSignal, refresh);
  const [pricingVisible, setPricingVisible] = useState(false);
  const over = peopleOverLimit(usage, limits);
  if (!over) return null;
  const params = { count: String(over.count), max: String(over.max), plan: TIER_META[tier].label, extra: String(over.count - over.max) };
  return (
    <View
      style={[styles.box, { backgroundColor: colors.warningSurface, borderColor: colors.warning }]}
      accessibilityRole="alert"
      testID="plan-people-limit-notice"
    >
      {pricingVisible ? <PricingModal visible onClose={() => setPricingVisible(false)} /> : null}
      <ThemedText style={[styles.title, { color: colors.text }]}>{t('upgrade.peopleOver.title', params)}</ThemedText>
      <ThemedText style={[styles.body, { color: colors.text }]}>{t('upgrade.peopleOver.body', params)}</ThemedText>
      <Pressable
        onPress={() => setPricingVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={t('upgrade.buttonA11y')}
        accessibilityHint={t('upgrade.buttonHint')}
        style={({ pressed }) => [styles.button, { borderColor: colors.text }, pressed && styles.pressed]}
        testID="plan-people-limit-plans"
      >
        <ThemedText style={[styles.buttonText, { color: colors.text }]}>{t('upgrade.buttonA11y')}</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, marginHorizontal: 16, marginVertical: 8, padding: 12, gap: 6 },
  title: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 19 },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
