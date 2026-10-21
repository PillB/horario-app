/**
 * Load state of the scheduler's stored data (workers, availability,
 * templates, roster, demand overrides): a loading line, or an error with a
 * retry button. Without it a failed load looked like an empty account
 * (CHG-088).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';

type Props = {
  /** A first load is still running (nothing stored is shown yet). */
  loading: boolean;
  /** Load errors, one per list that failed. */
  errors: string[];
  /** A list had more rows than the client reads. */
  truncated: boolean;
  onRetry: () => void;
};

export const SyncNotice = ({ loading, errors, truncated, onRetry }: Props) => {
  const { t } = useT();
  const colors = Colors[useColorScheme() ?? 'light'];

  if (errors.length > 0) {
    return (
      <ThemedView
        style={[styles.box, { backgroundColor: colors.errorSurface, borderColor: colors.error }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        testID="sync-notice-error"
      >
        <ThemedText style={[styles.title, { color: colors.error }]}>{t('scheduler.sync.loadFailed')}</ThemedText>
        <ThemedText style={[styles.detail, { color: colors.text }]}>{t('scheduler.sync.errorDetail', { error: errors[0] })}</ThemedText>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('scheduler.sync.retry')}
          accessibilityHint={t('scheduler.sync.retryHint')}
          style={({ pressed }) => [styles.retry, { borderColor: colors.error }, pressed && styles.pressed]}
          testID="sync-notice-retry"
        >
          <ThemedText style={[styles.retryText, { color: colors.text }]}>{t('scheduler.sync.retry')}</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={t('scheduler.sync.loading')} testID="sync-notice-loading">
        <ThemedText style={[styles.detail, { color: colors.textSecondary }]}>{t('scheduler.sync.loading')}</ThemedText>
      </View>
    );
  }

  if (truncated) {
    return (
      <ThemedText style={[styles.detail, { color: colors.warning }]} accessibilityLiveRegion="polite" testID="sync-notice-truncated">
        {t('scheduler.sync.truncated')}
      </ThemedText>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
    marginBottom: 12,
  },
  title: {
    fontWeight: '700',
  },
  detail: {
    fontSize: 13,
  },
  retry: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 36,
    justifyContent: 'center',
  },
  retryText: {
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
