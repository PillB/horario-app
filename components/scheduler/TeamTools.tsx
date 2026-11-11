/**
 * TeamTools — the team step's extra tools.
 *
 *  - Import several workers at once from pasted CSV (name, role, skills), or
 *    copy the current team out as CSV (`useTeamSetup`). Imported workers are
 *    saved through the proxy like any other worker.
 *  - Days off: one-off dates a worker cannot work (`useTimeOff`), saved
 *    through the proxy. Auto-assign skips a worker on a day off.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { InputField } from '@/components/scheduler/InputField';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useT } from '@/contexts/LocaleContext';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTeamSetup } from '@/hooks/useTeamSetup';
import { useTimeOff } from '@/hooks/useTimeOff';

type WorkerRef = { id: string; name: string };

type Props = {
  accountId: string;
  workers: readonly WorkerRef[];
  /** Called after an import saved at least one worker, to reload the team list. */
  onImported: () => void;
};

export function TeamTools({ accountId, workers, onImported }: Props) {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const styles = makeStyles(colors);

  // ── CSV import / export ──────────────────────────────────────────────────
  const { bulkImportWorkers, exportWorkersCSV } = useTeamSetup(accountId);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const handleImport = async () => {
    if (!csv.trim() || importing) return;
    setImporting(true);
    setImportMessage(null);
    setImportErrors([]);
    try {
      const result = await bulkImportWorkers(csv);
      setImportMessage(t('teamTools.imported', { n: String(result.imported) }));
      setImportErrors(result.errors);
      if (result.imported > 0) {
        if (result.errors.length === 0) setCsv('');
        onImported();
      }
    } finally {
      setImporting(false);
    }
  };

  // ── Days off ─────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState('');
  const activeId = workers.some((w) => w.id === selectedId) ? selectedId : workers[0]?.id ?? '';
  const workerIds = useMemo(() => workers.map((w) => w.id), [workers]);
  const { timeOff, error: timeOffError, addTimeOff, removeTimeOff } = useTimeOff(accountId, workerIds);
  const exceptions = useMemo(() => timeOff.filter((item) => item.workerId === activeId), [activeId, timeOff]);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [dayOffError, setDayOffError] = useState<string | null>(null);

  const handleAddDayOff = async () => {
    const trimmed = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))
      || new Date(`${trimmed}T00:00:00Z`).toISOString().slice(0, 10) !== trimmed) {
      setDayOffError(t('teamTools.dayOffDateError'));
      return;
    }
    setDayOffError(null);
    const result = await addTimeOff(activeId, trimmed, reason);
    if (!result.success) {
      setDayOffError(t('scheduler.sync.saveFailed', { error: result.error }));
      return;
    }
    setDate('');
    setReason('');
  };

  return (
    <View style={styles.stack}>
      <ThemedView style={styles.card} testID="team-import">
        <ThemedText type="subtitle">{t('teamTools.importTitle')}</ThemedText>
        <ThemedText style={styles.muted}>{t('teamTools.importHelp')}</ThemedText>
        <TextInput
          value={csv}
          onChangeText={setCsv}
          multiline
          placeholder={t('teamTools.importPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('teamTools.importInputA11y')}
          accessibilityHint={t('teamTools.importHelp')}
          testID="team-import-input"
          style={styles.textArea}
        />
        <View style={styles.buttonRow}>
          <Pressable
            onPress={() => { void handleImport(); }}
            disabled={importing || !csv.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('teamTools.importButton')}
            accessibilityHint={t('teamTools.importButtonHint')}
            accessibilityState={{ disabled: importing || !csv.trim() }}
            testID="team-import-button"
            style={({ pressed }) => [styles.primaryButton, (importing || !csv.trim()) && styles.disabled, pressed && styles.pressed]}
          >
            <ThemedText style={styles.primaryButtonText}>
              {importing ? t('common.loading') : t('teamTools.importButton')}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => { setCsv(exportWorkersCSV()); setImportMessage(t('teamTools.exported')); setImportErrors([]); }}
            disabled={workers.length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('teamTools.exportButton')}
            accessibilityHint={t('teamTools.exportButtonHint')}
            accessibilityState={{ disabled: workers.length === 0 }}
            testID="team-export-button"
            style={({ pressed }) => [styles.secondaryButton, workers.length === 0 && styles.disabled, pressed && styles.pressed]}
          >
            <ThemedText style={styles.secondaryButtonText}>{t('teamTools.exportButton')}</ThemedText>
          </Pressable>
        </View>
        {importMessage ? (
          <ThemedText style={styles.muted} accessibilityLiveRegion="polite" testID="team-import-message">
            {importMessage}
          </ThemedText>
        ) : null}
        {importErrors.map((error) => (
          <ThemedText key={error} style={styles.error} accessibilityRole="alert">{error}</ThemedText>
        ))}
      </ThemedView>

      {workers.length > 0 ? (
        <ThemedView style={styles.card} testID="team-days-off">
          <ThemedText type="subtitle">{t('teamTools.daysOffTitle')}</ThemedText>
          <ThemedText style={styles.muted}>{t('teamTools.daysOffHelp')}</ThemedText>
          <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel={t('teamTools.daysOffWorker')}>
            {workers.map((worker) => {
              const selected = worker.id === activeId;
              return (
                <Pressable
                  key={worker.id}
                  onPress={() => setSelectedId(worker.id)}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityLabel={worker.name}
                  accessibilityHint={t('teamTools.daysOffWorkerHint')}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <ThemedText style={[styles.chipText, selected && styles.chipTextSelected]}>{worker.name}</ThemedText>
                </Pressable>
              );
            })}
          </View>
          <InputField
            label={t('teamTools.dayOffDate')}
            value={date}
            placeholder="2026-12-24"
            onChangeText={setDate}
            accessibilityLabel={t('teamTools.dayOffDate')}
            accessibilityHint={t('teamTools.dayOffDateHint')}
            testID="day-off-date"
          />
          <InputField
            label={t('teamTools.dayOffReason')}
            value={reason}
            placeholder={t('teamTools.dayOffReasonPlaceholder')}
            onChangeText={setReason}
            accessibilityLabel={t('teamTools.dayOffReason')}
            accessibilityHint={t('teamTools.dayOffReasonHint')}
            testID="day-off-reason"
          />
          {timeOffError ? (
            <ThemedText style={styles.error} accessibilityRole="alert" testID="days-off-load-error">
              {t('teamTools.daysOffLoadError', { error: timeOffError })}
            </ThemedText>
          ) : null}
          {dayOffError ? <ThemedText style={styles.error} accessibilityRole="alert">{dayOffError}</ThemedText> : null}
          <Pressable
            onPress={() => { void handleAddDayOff(); }}
            accessibilityRole="button"
            accessibilityLabel={t('teamTools.dayOffAdd')}
            accessibilityHint={t('teamTools.dayOffAddHint')}
            testID="day-off-add"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <ThemedText style={styles.primaryButtonText}>{t('teamTools.dayOffAdd')}</ThemedText>
          </Pressable>
          {exceptions.length === 0 ? (
            <ThemedText style={styles.muted}>{t('teamTools.daysOffEmpty')}</ThemedText>
          ) : (
            exceptions.map((exception) => (
              <View key={exception.id} style={styles.rowBetween} testID={`day-off-${exception.date}`}>
                <View style={styles.rowText}>
                  <ThemedText type="defaultSemiBold">{exception.date}</ThemedText>
                  {exception.reason ? <ThemedText style={styles.muted}>{exception.reason}</ThemedText> : null}
                </View>
                <Pressable
                  onPress={() => {
                    void removeTimeOff(exception.id).then((result) => {
                      setDayOffError(result.success ? null : t('scheduler.sync.saveFailed', { error: result.error }));
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('teamTools.dayOffRemove', { date: exception.date })}
                  accessibilityHint={t('teamTools.dayOffRemoveHint')}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                  <ThemedText style={styles.secondaryButtonText}>{t('common.dismiss')}</ThemedText>
                </Pressable>
              </View>
            ))
          )}
        </ThemedView>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    stack: { gap: 16, marginTop: 16 },
    card: { gap: 12, padding: 16, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    muted: { color: colors.textSecondary, fontSize: 14 },
    error: { color: colors.error, fontSize: 14 },
    textArea: {
      minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10,
      color: colors.text, backgroundColor: colors.background, textAlignVertical: 'top', fontSize: 14,
    },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    primaryButton: {
      minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      backgroundColor: brand.primaryDark, alignSelf: 'flex-start',
    },
    primaryButtonText: { color: '#FFFFFF', fontWeight: '600' },
    secondaryButton: {
      minHeight: 44, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start',
    },
    secondaryButtonText: { color: colors.tintText, fontWeight: '600' },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
    chipSelected: { backgroundColor: brand.primaryDark, borderColor: brand.primaryDark },
    chipText: { color: colors.text, fontSize: 14 },
    chipTextSelected: { color: '#FFFFFF', fontWeight: '600' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    rowText: { flex: 1, gap: 2 },
  });
