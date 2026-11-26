/**
 * WorkerRemovalConfirm — asks before a person with shifts is removed (F-11, CHG-109).
 *
 * Before, removing a person with shifts was refused with "Record is still
 * referenced", and on Gratis over the people limit (every other write refused)
 * the owner had to remove each shift by hand first. Now the row asks once,
 * says how many shifts go with the person (from today on and earlier), and that
 * earlier shifts are the record of who worked. Confirming removes the person and
 * their shifts in one transaction (delete_worker_with_shifts).
 *
 * Renders nothing unless the pending removal is for `workerId`.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { WorkerRemoval } from '@/hooks/useSchedulerHandlers';

type Props = {
  pending: WorkerRemoval | null | undefined;
  workerId: string;
  onConfirm: (() => void) | undefined;
  onCancel: (() => void) | undefined;
};

export function WorkerRemovalConfirm({ pending, workerId, onConfirm, onCancel }: Props) {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!pending || pending.workerId !== workerId || !onConfirm || !onCancel) return null;
  const n = String(pending.upcoming + pending.past);
  const params = { name: pending.name, upcoming: String(pending.upcoming), past: String(pending.past), n };
  return (
    <View
      style={[styles.box, { borderColor: colors.error, backgroundColor: colors.errorSurface }]}
      accessibilityRole="alert"
      testID={`remove-worker-with-shifts-${workerId}`}
    >
      <ThemedText style={[styles.title, { color: colors.text }]}>{t('scheduler.remove.withShifts.title', params)}</ThemedText>
      <ThemedText style={[styles.body, { color: colors.text }]}>{t('scheduler.remove.withShifts.body', params)}</ThemedText>
      {pending.past > 0 ? (
        <ThemedText style={[styles.body, { color: colors.text }]}>{t('scheduler.remove.withShifts.pastNote', params)}</ThemedText>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.remove.withShifts.confirm', params)}
          accessibilityHint={t('scheduler.remove.withShifts.confirmHint')}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.error }, pressed && styles.pressed]}
          testID={`confirm-remove-worker-${workerId}`}
        >
          <ThemedText style={styles.buttonText}>{t('scheduler.remove.withShifts.confirm', params)}</ThemedText>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.remove.withShifts.cancel', params)}
          accessibilityHint={t('scheduler.remove.withShifts.cancelHint')}
          style={({ pressed }) => [styles.button, styles.secondary, { borderColor: colors.border }, pressed && styles.pressed]}
          testID={`cancel-remove-worker-${workerId}`}
        >
          <ThemedText style={[styles.secondaryText, { color: colors.text }]}>{t('scheduler.remove.withShifts.cancel', params)}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginTop: 6, marginBottom: 8 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  secondary: { backgroundColor: 'transparent', borderWidth: 1 },
  secondaryText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
