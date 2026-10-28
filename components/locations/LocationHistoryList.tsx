/**
 * LocationHistoryList — read-only change history of the business's locations
 * (who changed the rules, time zone, industry, headcount or overrides, and
 * when). Rows are written by a database trigger (CHG-089); nothing here edits
 * them. It loads when mounted and again when `version` changes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { Colors, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { getJurisdiction } from '@/services/labor/jurisdictions';
import { parseStoredOverrides } from '@/services/labor/overrides';
import { listLocationHistory, type LocationHistoryEntry } from '@/services/locationService';
import type { LocationHistoryValues } from '@/utils/locationValidation';

type T = (key: string, params?: Record<string, string>) => string;

const FIELDS = ['jurisdictionCode', 'timeZone', 'industry', 'employerHeadcount', 'overrides'] as const;
type Field = (typeof FIELDS)[number];

const FIELD_LABEL: Record<Field, string> = {
  jurisdictionCode: 'locations.history.jurisdiction',
  timeZone: 'locations.history.timeZone',
  industry: 'locations.history.industry',
  employerHeadcount: 'locations.history.headcount',
  overrides: 'locations.history.overrides',
};

const formatOverrides = (raw: unknown[] | null, t: T): string => {
  const list = parseStoredOverrides(raw);
  if (!list.length) return t('locations.history.none');
  return list
    .map((o) => {
      const value = String(o.value);
      switch (o.rule) {
        case 'rest.minHours': return t('locations.history.ruleRest', { value });
        case 'daily.maxHours': return t('locations.history.ruleDaily', { value });
        case 'weekly.maxHours': return t('locations.history.ruleWeekly', { value });
        case 'breaks.minMinutes': return t('locations.history.ruleBreak', { value, after: String(o.afterHours) });
      }
      return '';
    })
    .join(', ');
};

/** Display text of one field (exported for tests). */
export const formatHistoryValue = (field: Field, values: LocationHistoryValues, t: T): string => {
  switch (field) {
    case 'jurisdictionCode':
      return values.jurisdictionCode ? getJurisdiction(values.jurisdictionCode)?.name ?? values.jurisdictionCode : t('locations.history.none');
    case 'timeZone':
      return values.timeZone ?? t('locations.history.none');
    case 'industry':
      return values.industry ? t(`locations.industries.${values.industry}`) || values.industry : t('locations.history.none');
    case 'employerHeadcount':
      return values.employerHeadcount === null ? t('locations.history.none') : String(values.employerHeadcount);
    case 'overrides':
      return formatOverrides(values.overrides, t);
  }
};

/** One line per field: "old → new" for changes, the value for an add or delete (exported for tests). */
export const describeHistoryEntry = (entry: LocationHistoryEntry, t: T): string[] => {
  const before = entry.old;
  const after = entry.new;
  if (before && after) {
    const lines = FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map(
      (f) => `${t(FIELD_LABEL[f])}: ${formatHistoryValue(f, before, t)} → ${formatHistoryValue(f, after, t)}`,
    );
    return lines.length ? lines : [t('locations.history.noRuleChange')];
  }
  const side = after ?? before;
  if (!side) return [];
  return FIELDS.filter((f) => f !== 'overrides' || parseStoredOverrides(side.overrides).length > 0).map(
    (f) => `${t(FIELD_LABEL[f])}: ${formatHistoryValue(f, side, t)}`,
  );
};

const ACTION_KEY: Record<LocationHistoryEntry['action'], string> = {
  insert: 'locations.history.added',
  update: 'locations.history.changed',
  delete: 'locations.history.deleted',
};

const formatWhen = (iso: string, langCode: string): string => {
  try {
    return new Intl.DateTimeFormat(langCode, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

export function LocationHistoryList({ version = 0 }: { version?: number }) {
  const { t, langCode } = useT();
  const colorScheme = useColorScheme() ?? 'light';
  const styles = makeStyles(Colors[colorScheme]);
  const [entries, setEntries] = useState<LocationHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Only the latest request may update state (see useDemandForecast).
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setStatus('loading');
    const result = await listLocationHistory();
    if (requestIdRef.current !== requestId) return;
    if (result.ok) {
      setEntries(result.data);
      setStatus('ready');
    } else {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  return (
    <View style={styles.container} testID="location-history">
      <ThemedText type="defaultSemiBold">{t('locations.history.title')}</ThemedText>
      {status === 'loading' && entries.length === 0 ? <ThemedText style={styles.muted}>{t('common.loading')}</ThemedText> : null}
      {status === 'error' ? (
        <View style={styles.row}>
          <ThemedText style={styles.errorText}>{t('locations.history.loadFailed')}</ThemedText>
          <Pressable
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            accessibilityHint={t('locations.history.retryHint')}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.smallButtonText}>{t('common.retry')}</ThemedText>
          </Pressable>
        </View>
      ) : null}
      {status === 'ready' && entries.length === 0 ? <ThemedText style={styles.muted}>{t('locations.history.empty')}</ThemedText> : null}
      {entries.length > 0 ? (
        <View role="list">
          {entries.map((entry) => (
            <View key={entry.id} role="listitem" style={styles.entry} testID={`location-history-${entry.id}`}>
              <ThemedText style={styles.entryTitle}>
                {formatWhen(entry.changedAt, langCode)} · {entry.locationName}
              </ThemedText>
              <ThemedText style={styles.muted}>
                {t(ACTION_KEY[entry.action], { who: entry.changedBy ?? t('locations.history.outsideApp') })}
              </ThemedText>
              {describeHistoryEntry(entry, t).map((line) => (
                <ThemedText key={line} style={styles.change}>{line}</ThemedText>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { gap: 6, paddingTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    muted: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    errorText: { fontSize: 13, color: colors.error, flexShrink: 1 },
    entry: {
      gap: 2,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    entryTitle: { fontSize: 13, fontWeight: '600' },
    change: { fontSize: 13, lineHeight: 19 },
    smallButton: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      minHeight: 36,
      justifyContent: 'center',
    },
    smallButtonText: { fontSize: 13, fontWeight: '600', color: colors.text },
    pressed: { opacity: 0.75 },
  });
