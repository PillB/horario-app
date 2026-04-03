import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useT } from '@/contexts/LocaleContext';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SyncStatusBarProps = {
  status: SyncStatus;
  message?: string;
  errorMessage?: string;
  onRetry?: () => void;
  lastSyncedAt?: number | null;
};

function formatTime(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function SyncStatusBar({
  status,
  message,
  errorMessage,
  onRetry,
  lastSyncedAt,
}: SyncStatusBarProps): React.ReactElement | null {
  const t = useT();
  const colorScheme = useColorScheme();
  const colors: ThemeColors = Colors[colorScheme ?? 'light'];
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayStatus, setDisplayStatus] = useState<SyncStatus>(status);

  useEffect(() => {
    if (status === 'saved') {
      setDisplayStatus('saved');
      dismissTimerRef.current = setTimeout(() => {
        setDisplayStatus('idle');
      }, 3000);
    } else if (status === 'saving' || status === 'error') {
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      setDisplayStatus(status);
    } else {
      setDisplayStatus(status);
    }

    return () => {
      if (dismissTimerRef.current !== null) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [status]);

  const isIdle = displayStatus === 'idle';
  const hasLastSynced = lastSyncedAt != null;

  if (isIdle && !hasLastSynced) {
    return null;
  }

  const lastSavedLabel =
    hasLastSynced
      ? `${t('sync.lastSaved')} ${formatTime(lastSyncedAt as number)}`
      : null;

  let liveRegion: 'none' | 'polite' | 'assertive' = 'none';
  if (displayStatus === 'saving' || displayStatus === 'saved') {
    liveRegion = 'polite';
  } else if (displayStatus === 'error') {
    liveRegion = 'assertive';
  }

  let accessibilityLabel = '';
  if (displayStatus === 'saving') {
    accessibilityLabel = message ?? t('sync.saving');
  } else if (displayStatus === 'saved') {
    accessibilityLabel = message ?? t('sync.saved');
  } else if (displayStatus === 'error') {
    accessibilityLabel = errorMessage ?? t('sync.error');
  } else if (isIdle && lastSavedLabel !== null) {
    accessibilityLabel = lastSavedLabel;
  }

  if (hasLastSynced && lastSavedLabel !== null && displayStatus !== 'idle') {
    accessibilityLabel = `${accessibilityLabel}. ${lastSavedLabel}`;
  }

  const barStyle = [
    styles.bar,
    displayStatus === 'saving' && { backgroundColor: brand.primary },
    displayStatus === 'saved' && styles.barSaved,
    displayStatus === 'error' && styles.barError,
    isIdle && styles.barIdle,
  ];

  return (
    <View
      style={barStyle}
      accessibilityRole="status"
      accessibilityLiveRegion={liveRegion}
      accessibilityLabel={accessibilityLabel}
    >
      {displayStatus === 'saving' && (
        <>
          <ActivityIndicator size="small" color="#FFFFFF" style={styles.icon} />
          <ThemedText style={styles.textLight}>
            {message ?? t('sync.saving')}
          </ThemedText>
        </>
      )}

      {displayStatus === 'saved' && (
        <>
          <ThemedText style={[styles.textLight, styles.icon]}>{'✓'}</ThemedText>
          <ThemedText style={styles.textLight}>
            {message ?? t('sync.saved')}
          </ThemedText>
        </>
      )}

      {displayStatus === 'error' && (
        <>
          <ThemedText style={[styles.textLight, styles.icon]}>{'⚠'}</ThemedText>
          <ThemedText style={[styles.textLight, styles.errorMessage]} numberOfLines={1}>
            {errorMessage ?? t('sync.error')}
          </ThemedText>
          {onRetry !== undefined && (
            <Pressable
              onPress={onRetry}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.retryButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('sync.retry')}
              hitSlop={styles.retryHitSlop}
            >
              <ThemedText style={styles.retryText}>{t('sync.retry')}</ThemedText>
            </Pressable>
          )}
        </>
      )}

      {isIdle && lastSavedLabel !== null && (
        <ThemedText style={styles.textMuted}>{lastSavedLabel}</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 36,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  barIdle: {
    backgroundColor: '#E5E7EB',
  },
  barSaved: {
    backgroundColor: '#15803D',
  },
  barError: {
    backgroundColor: '#DC2626',
  },
  icon: {
    marginRight: 6,
  },
  textLight: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  textMuted: {
    color: '#6B7280',
    fontSize: 13,
  },
  errorMessage: {
    flex: 1,
    flexShrink: 1,
  },
  retryButton: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  retryButtonPressed: {
    opacity: 0.7,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  retryHitSlop: {
    top: 8,
    bottom: 8,
    left: 8,
    right: 8,
  },
});