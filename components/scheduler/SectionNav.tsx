/**
 * SectionNav — the scheduler's step bar.
 *
 * The scheduler shows one step at a time (team, shift templates, demand,
 * roster) instead of one long page. A step that is set up shows a check mark,
 * so the bar doubles as the progress indicator.
 */
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';
import { SCHEDULER_SECTIONS, type SchedulerSection } from '@/hooks/useSchedulerHandlers';

type Props = {
  active: SchedulerSection | null;
  onSelect: (section: SchedulerSection) => void;
  /** Steps whose data exists (shown with a check mark). */
  done: Partial<Record<SchedulerSection, boolean>>;
  /** Optional counts shown next to the label, e.g. number of workers. */
  counts?: Partial<Record<SchedulerSection, number>>;
};

export function SectionNav({ active, onSelect, done, counts }: Props) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);
  // On a phone the four steps share the width, marker above label.
  const { width } = useWindowDimensions();
  const compact = width < 600;

  return (
    <View style={styles.bar}>
      <View
        style={styles.row}
        accessibilityRole="tablist"
        accessibilityLabel={t('scheduler.sections.navLabel')}
      >
        {SCHEDULER_SECTIONS.map((key, index) => {
          const selected = key === active;
          const label = t(`scheduler.sections.${key}`);
          const count = counts?.[key];
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              accessibilityRole="tab"
              aria-selected={selected}
              accessibilityLabel={
                done[key] ? t('scheduler.sections.doneA11y', { step: label }) : label
              }
              accessibilityHint={t('scheduler.sections.hint')}
              testID={`section-tab-${key}`}
              style={({ pressed }) => [
                styles.tab,
                compact && styles.tabCompact,
                selected && styles.tabSelected,
                pressed && styles.tabPressed,
              ]}
            >
              <View style={[styles.marker, done[key] && styles.markerDone, selected && !done[key] && styles.markerSelected]}>
                <ThemedText style={[styles.markerText, (done[key] || selected) && styles.markerTextOn]}>
                  {done[key] ? '✓' : String(index + 1)}
                </ThemedText>
              </View>
              <ThemedText style={[styles.label, compact && styles.labelCompact, selected && styles.labelSelected]} numberOfLines={1}>
                {label}
                {typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      borderBottomWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    row: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      gap: 4,
    },
    tabCompact: {
      flex: 1,
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 2,
      paddingHorizontal: 2,
      paddingVertical: 6,
    },
    labelCompact: {
      fontSize: 12,
      lineHeight: 16,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      minHeight: 48,
      borderBottomWidth: 3,
      borderColor: 'transparent',
    },
    tabSelected: {
      borderColor: brand.primary,
    },
    tabPressed: {
      opacity: 0.7,
    },
    marker: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.border,
    },
    markerSelected: {
      backgroundColor: brand.primaryDark,
    },
    markerDone: {
      backgroundColor: brand.primaryDark,
    },
    markerText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      color: colors.text,
    },
    markerTextOn: {
      color: '#FFFFFF',
    },
    label: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    labelSelected: {
      color: colors.tintText,
    },
  });
