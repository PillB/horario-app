/**
 * Labor attributes in the Add worker form: birth date (minors' rules) and the
 * three contract flags the labor engine reads.
 */
import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors, brand } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { WorkerFormState } from '@/hooks/useSchedulerHandlers';
import { InputField } from './InputField';

type FlagKey = 'nightWorker' | 'weeklyLimitOptOut' | 'noFixedHours';

const FLAGS: FlagKey[] = ['nightWorker', 'weeklyLimitOptOut', 'noFixedHours'];

type Props = {
  workerForm: WorkerFormState;
  updateWorkerField: <K extends keyof WorkerFormState>(key: K) => (value: WorkerFormState[K]) => void;
};

const styles = StyleSheet.create({
  group: { gap: 8, marginBottom: 8 },
  heading: { fontWeight: '600' },
  flagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  flagText: { flex: 1, gap: 2 },
  flagHint: { fontSize: 13 },
});

export const WorkerLaborFields = ({ workerForm, updateWorkerField }: Props) => {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <View style={styles.group} testID="worker-labor-fields">
      <ThemedText style={styles.heading}>{t('workerLabor.heading')}</ThemedText>
      <InputField
        label={t('workerLabor.birthDateLabel')}
        value={workerForm.birthDate}
        placeholder={t('workerLabor.birthDatePlaceholder')}
        onChangeText={updateWorkerField('birthDate')}
        accessibilityLabel={t('workerLabor.birthDateA11y')}
        accessibilityHint={t('workerLabor.birthDateHint')}
        testID="worker-birth-date-input"
      />
      {FLAGS.map((key) => (
        <View key={key} style={styles.flagRow}>
          <View style={styles.flagText}>
            <ThemedText>{t(`workerLabor.${key}.label`)}</ThemedText>
            <ThemedText style={[styles.flagHint, { color: colors.textSecondary }]}>
              {t(`workerLabor.${key}.hint`)}
            </ThemedText>
          </View>
          <Switch
            value={workerForm[key]}
            onValueChange={updateWorkerField(key)}
            trackColor={{ false: colors.border, true: brand.primaryLight }}
            thumbColor={workerForm[key] ? brand.primary : colors.textSecondary}
            accessibilityRole="switch"
            accessibilityLabel={t(`workerLabor.${key}.label`)}
            accessibilityHint={t(`workerLabor.${key}.hint`)}
            accessibilityState={{ checked: workerForm[key] }}
            testID={`worker-${key}-switch`}
          />
        </View>
      ))}
    </View>
  );
};
