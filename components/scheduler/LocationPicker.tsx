/**
 * Which business location new shifts and auto-assign are for. Shown only when
 * the account has more than one location: with one, that location applies.
 * The location decides the labor rules and the time zone (CHG-098; before,
 * an account with several locations got no legal limits in auto-assign).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';

type LocationRef = { id: string; name: string; timeZone: string };

type Props = {
  locations: readonly LocationRef[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export const LocationPicker = ({ locations, selectedId, onSelect }: Props) => {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];
  const styles = makeStyles(colors);
  if (locations.length < 2) return null;
  return (
    <ThemedView style={styles.card} testID="location-picker">
      <ThemedText type="defaultSemiBold">{t('scheduler.locationPicker.title')}</ThemedText>
      <ThemedText style={styles.muted}>
        {selectedId ? t('scheduler.locationPicker.help') : t('scheduler.locationPicker.none')}
      </ThemedText>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('scheduler.locationPicker.title')}>
        {locations.map((location) => {
          const selected = location.id === selectedId;
          return (
            <Pressable
              key={location.id}
              onPress={() => onSelect(location.id)}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={location.name}
              accessibilityHint={t('scheduler.locationPicker.hint', { zone: location.timeZone })}
              testID={`location-option-${location.id}`}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{location.name}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </ThemedView>
  );
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      gap: 8,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    muted: { color: colors.textSecondary, fontSize: 14 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 44,
      paddingHorizontal: 14,
      justifyContent: 'center',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipSelected: { backgroundColor: brand.primaryDark, borderColor: brand.primaryDark },
    chipText: { fontSize: 14, color: colors.text },
    chipTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  });
