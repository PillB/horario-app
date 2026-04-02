/**
 * DiagnosticsPanel — surfaced in the Support Diagnostics screen.
 *
 * Renders a scrollable list of structured log entries from the in-memory ring
 * buffer, with controls to refresh, copy, and clear the buffer.
 *
 * Privacy: all entries have already been sanitised by services/logger — no PII
 * or secrets will appear here.
 */

import React, { useCallback } from 'react';
import {
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuditLog } from '@/hooks/useAuditLog';
import { type LogEntry, type LogLevel } from '@/services/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const LIST_MAX_HEIGHT = 400;

/** Map each level to a background / foreground pair for the badge. */
const LEVEL_COLORS: Record<LogLevel, { bg: string; fg: string }> = {
  DEBUG: { bg: '#E2E8F0', fg: '#475569' }, // slate
  INFO:  { bg: '#DBEAFE', fg: '#1D4ED8' }, // blue
  WARN:  { bg: '#FFFBEB', fg: '#D97706' }, // amber
  ERROR: { bg: '#FEF2F2', fg: '#DC2626' }, // red
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract HH:MM:SS from an ISO-8601 timestamp string.
 * Falls back to the raw string if parsing fails.
 */
function formatTimeOnly(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface LevelBadgeProps {
  level: LogLevel;
}

function LevelBadge({ level }: LevelBadgeProps): React.JSX.Element {
  const { bg, fg } = LEVEL_COLORS[level];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <ThemedText style={[styles.badgeText, { color: fg }]}>
        {level}
      </ThemedText>
    </View>
  );
}

interface EntryRowProps {
  entry: LogEntry;
  colors: ThemeColors;
}

function EntryRow({ entry, colors }: EntryRowProps): React.JSX.Element {
  return (
    <View
      style={[styles.row, { borderBottomColor: colors.border ?? '#E2E8F0' }]}
      accessibilityRole="text"
      accessibilityLabel={`${entry.level} ${entry.category} ${entry.message} at ${formatTimeOnly(entry.timestamp)}`}
    >
      {/* Left: badge + meta */}
      <View style={styles.rowLeft}>
        <LevelBadge level={entry.level} />
        <ThemedText style={[styles.categoryText, { color: colors.textTertiary }]}>
          {entry.category}
        </ThemedText>
        <ThemedText style={[styles.timeText, { color: colors.textTertiary }]}>
          {formatTimeOnly(entry.timestamp)}
        </ThemedText>
      </View>
      {/* Right: message */}
      <ThemedText
        style={[styles.messageText, { color: colors.text }]}
        numberOfLines={2}
      >
        {entry.message}
      </ThemedText>
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  variant?: 'default' | 'danger' | 'primary';
}

function ActionButton({
  label,
  accessibilityLabel,
  onPress,
  variant = 'default',
}: ActionButtonProps): React.JSX.Element {
  const bgColor =
    variant === 'primary'
      ? brand.primary
      : variant === 'danger'
      ? brand.error
      : brand.primarySurface;

  const fgColor =
    variant === 'primary' || variant === 'danger' ? '#FFFFFF' : brand.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: bgColor, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <ThemedText style={[styles.actionButtonText, { color: fgColor }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DiagnosticsPanel(): React.JSX.Element {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const { entries, copyToClipboard, clear, refresh, lastRefreshedAt } =
    useAuditLog();

  // Reverse order so newest entry appears at the top.
  // We derive a stable reversed copy; entries is already a snapshot so this is
  // safe to do in render without extra memo overhead at this list size (≤ 100).
  const reversedEntries: LogEntry[] = [...entries].reverse();

  const handleCopy = useCallback(async () => {
    await copyToClipboard();
  }, [copyToClipboard]);

  const keyExtractor = useCallback(
    (item: LogEntry, index: number) => `${item.timestamp}-${index}`,
    [],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LogEntry>) => (
      <EntryRow entry={item} colors={colors} />
    ),
    [colors],
  );

  const ListEmpty = (
    <View style={styles.emptyContainer}>
      <ThemedText style={[styles.emptyText, { color: colors.textSecondary }]}>
        No log entries yet. Use the app to generate activity.
      </ThemedText>
    </View>
  );

  const updatedLabel =
    lastRefreshedAt != null
      ? `Updated ${formatTimeOnly(lastRefreshedAt)}`
      : 'Not yet refreshed';

  return (
    <ThemedView style={[styles.panel, { borderColor: colors.border ?? '#E2E8F0' }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedText type="defaultSemiBold" style={{ color: colors.text }}>
            Log entries
          </ThemedText>
          {/* Count badge */}
          <View
            style={[styles.countBadge, { backgroundColor: brand.primaryLight }]}
            accessibilityRole="text"
            accessibilityLabel={`${entries.length} log entries`}
          >
            <ThemedText style={styles.countBadgeText}>
              {entries.length}
            </ThemedText>
          </View>
        </View>

        {/* Action row */}
        <View style={styles.headerActions}>
          <ActionButton
            label="Refresh"
            accessibilityLabel="Refresh log entries"
            onPress={refresh}
          />
          <ActionButton
            label="Copy logs"
            accessibilityLabel="Copy all log entries to clipboard"
            onPress={handleCopy}
            variant="primary"
          />
          <ActionButton
            label="Clear"
            accessibilityLabel="Clear all log entries"
            onPress={clear}
            variant="danger"
          />
        </View>
      </View>

      {/* ── Last-refreshed stamp ── */}
      <ThemedText
        style={[styles.updatedText, { color: colors.textTertiary }]}
        accessibilityRole="text"
        accessibilityLabel={updatedLabel}
      >
        {updatedLabel}
      </ThemedText>

      {/* ── Entry list ── */}
      <View
        style={[
          styles.listWrapper,
          { borderColor: colors.border ?? '#E2E8F0' },
        ]}
      >
        <FlatList<LogEntry>
          data={reversedEntries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={ListEmpty}
          style={styles.list}
          contentContainerStyle={
            reversedEntries.length === 0 ? styles.listContentEmpty : undefined
          }
          scrollEnabled
          showsVerticalScrollIndicator
          accessibilityRole="list"
          accessibilityLabel="Log entries list"
          // Perf: items are small and ring buffer ≤ 100 — no windowing needed
          removeClippedSubviews={false}
        />
      </View>

      {/* ── Privacy notice ── */}
      <View
        style={[
          styles.privacyRow,
          { borderTopColor: colors.border ?? '#E2E8F0' },
        ]}
      >
        <ThemedText
          style={[styles.privacyText, { color: colors.textTertiary }]}
          accessibilityRole="text"
          accessibilityLabel="Privacy notice: all logs are sanitised — no passwords or personal data are stored."
        >
          🔒 All logs are sanitised — no passwords or personal data are stored.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },

  // ── Count badge ──
  countBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: brand.primaryDeep,
  },

  // ── Updated stamp ──
  updatedText: {
    fontSize: 11,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  // ── Action buttons ──
  actionButton: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // ── List ──
  listWrapper: {
    maxHeight: LIST_MAX_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  // ── Empty state ──
  emptyContainer: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Entry row ──
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },

  // ── Level badge ──
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // ── Row text ──
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  messageText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // ── Privacy notice ──
  privacyRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  privacyText: {
    fontSize: 11,
    lineHeight: 16,
  },
});