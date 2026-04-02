/**
 * WorkerIdPicker — replaces a raw UUID text input for worker selection.
 *
 * Features:
 *  - Shows scrollable name chips; tap any chip to auto-fill the UUID.
 *  - Displays the resolved worker name beneath the input while the ID is valid.
 *  - Inline warning when the entered ID is non-empty but matches no worker
 *    (covers both "never existed" and "deleted worker" cases — we can only
 *    distinguish those if the caller tracks deleted IDs separately, but for
 *    now both surface the same "not found" warning).
 */

import React, { useMemo } from 'react';
import { View, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { type Worker } from '@/types/scheduler';
import { useT } from '@/contexts/LocaleContext';

type Props = {
  label: string;
  value: string;
  workers: Worker[];
  onChangeText: (text: string) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

const makeStyles = (colors: ThemeColors, colorScheme: 'light' | 'dark') =>
  StyleSheet.create({
    container: {
      marginBottom: 12,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 4,
      color: colors.text,
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },
    resolvedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      gap: 4,
    },
    resolvedName: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    resolvedDot: {
      fontSize: 12,
      color: brand.primary,
    },
    warningRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      gap: 4,
    },
    warningText: {
      fontSize: 12,
      color: colors.error,
    },
    chipsLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 8,
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    chipsScroll: {
      marginTop: 0,
    },
    chipsContent: {
      flexDirection: 'row',
      gap: 6,
      paddingBottom: 2,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 16,
      backgroundColor: brand.primarySurface,
      borderWidth: 1,
      borderColor: brand.primaryLight,
    },
    chipSelected: {
      backgroundColor: brand.primary,
      borderColor: brand.primaryDark,
    },
    chipText: {
      fontSize: 12,
      color: brand.primaryDeep,
      fontWeight: '500',
    },
    chipSelectedText: {
      color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.surface,
    },
    chipSubText: {
      fontSize: 10,
      color: brand.primaryDeep,
      opacity: 0.75,
    },
    chipSelectedSubText: {
      color: colorScheme === 'dark' ? Colors.dark.textSecondary : Colors.light.surface,
      opacity: 0.85,
    },
  });

export const WorkerIdPicker = ({
  label,
  value,
  workers,
  onChangeText,
  accessibilityLabel,
  accessibilityHint,
}: Props) => {
  const { t } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const styles = makeStyles(colors, colorScheme);

  const placeholderColor = colorScheme === 'dark' ? '#94A3B8' : colors.textTertiary;

  const resolvedWorker = useMemo(() => {
    const v = value.trim();
    if (!v) return undefined;
    // Match by displayId first (e.g. "W-1"), fall back to full UUID
    return workers.find((w) => w.displayId === v) ?? workers.find((w) => w.id === v);
  }, [value, workers]);

  const isUnknown = value.trim().length > 0 && !resolvedWorker;

  return (
    <View style={styles.container}>
      <ThemedText style={styles.label}>{label}</ThemedText>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={t('scheduler.workerPicker.placeholder')}
        placeholderTextColor={placeholderColor}
        style={[styles.input, isUnknown && { borderColor: colors.error }]}
        accessibilityRole="none"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint ?? t('scheduler.workerPicker.hint')}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {resolvedWorker ? (
        <View style={styles.resolvedRow} accessibilityLiveRegion="polite">
          <ThemedText style={styles.resolvedDot}>✓</ThemedText>
          <ThemedText style={styles.resolvedName}>
            {resolvedWorker.name}
            {resolvedWorker.role ? ` · ${resolvedWorker.role}` : ''}
          </ThemedText>
        </View>
      ) : isUnknown ? (
        <View style={styles.warningRow} accessibilityLiveRegion="polite">
          <ThemedText style={styles.warningText}>
            {t('scheduler.workerPicker.notFound')}
          </ThemedText>
        </View>
      ) : null}

      {workers.length > 0 && (
        <>
          <ThemedText style={styles.chipsLabel}>
            {t('scheduler.workerPicker.chipsLabel')}
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsContent}
          >
            {workers.map((worker) => {
              const selected = value === worker.displayId || value === worker.id;
              return (
                <Pressable
                  key={worker.id}
                  onPress={() => onChangeText(worker.displayId)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('scheduler.workerPicker.selectWorker')} ${worker.name}`}
                  accessibilityState={{ selected }}
                >
                  <ThemedText style={[styles.chipText, selected && styles.chipSelectedText]}>
                    {worker.name}
                  </ThemedText>
                  {worker.role ? (
                    <ThemedText style={[styles.chipSubText, selected && styles.chipSelectedSubText]}>
                      {worker.role}
                    </ThemedText>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
};
