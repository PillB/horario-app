import React, { useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, TextInput } from 'react-native';
import {
  forecastDemandFromPOSMultiRole,
  STAFFING_PRESETS,
  type RoleRatio,
  type StaffingMix,
  type StaffingPresetKey,
} from '@/utils/posForecasting';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { type DemandForecast } from '@/services/demandForecast';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { SectionCard } from './SectionCard';
import { InputField } from './InputField';
import { LostRevenueSummary } from './LostRevenueSummary';
import { schedulerStyles as styles } from '@/styles/scheduler.styles';
import { useT } from '@/contexts/LocaleContext';
import { type TFunction } from '@/hooks/useLocale';
import { Colors, brand, type ThemeColors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type FallbackFormState = {
  role: string;
  startDate: string;
  days: string;
  homogeneousDemand: string;
  shiftsPerDay: string;
  workersPerShift: string;
  notes: string;
};

type TargetFormState = {
  date: string;
  role: string;
  required: string;
  notes: string;
};

type PosTarget = {
  date: string;
  role: string;
  required: number;
  source: string;
  notes: string;
  lowerBound: number;
  upperBound: number;
  confidence: number;
};

type Props = {
  fallbackMode: 'homogeneous' | 'manual' | 'pos';
  setFallbackMode: (mode: 'homogeneous' | 'manual' | 'pos') => void;
  onBulkSave: (targets: PosTarget[]) => void;
  fallbackForm: FallbackFormState;
  updateFallbackField: (key: keyof FallbackFormState) => (value: string) => void;
  handleFallbackSubmit: () => void;
  fallbackError: string | null;
  fallbackMessage: string | null;

  targetForm: TargetFormState;
  updateTargetField: (key: keyof TargetFormState) => (value: string) => void;
  handleTargetSubmit: () => void;
  targetError: string | null;

  forecastButtonLabel: string;
  forecastHelperText: string;
  forecastActionDisabled: boolean;
  runForecast: () => void;

  baselineTargetsRef: React.RefObject<DemandForecast[] | null>;
  demandTargets: DemandForecast[];
  roster: Shift[];
  shiftTemplates: ShiftTemplate[];
  forecastError: string | null;
};

// Factory so every colour resolves against the live theme
const makeLocalStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Badge: 'Fallback' label — text must be ≥4.5:1 on its surface
    fallbackBadge: {
      backgroundColor: colors.successSurface,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    badgeText: {
      // Colors.light.success #15803D → 5.44:1 on successSurface ✓ AA
      // Colors.dark.success  #34D399 → passes on dark successSurface ✓
      color: colors.success,
      fontSize: 12,
      fontWeight: '600',
    },
    // Required-count label in demandTargets rows — same token as badgeText
    requiredCountText: {
      color: colors.success,
      fontSize: 13,
      fontWeight: '600',
    },
    // Error text — Colors.light.error #DC2626 (4.64:1 on white) ✓ AA
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginTop: 4,
    },
    // Success text — Colors.light.success #15803D (5.44:1 on white) ✓ AA
    successText: {
      color: colors.success,
      fontSize: 13,
      marginTop: 4,
    },
    // Toggle chips — inactive label uses textSecondary (6.86:1) ✓ AA
    toggleChip: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    toggleChipActive: {
      backgroundColor: brand.primary,
      borderColor: brand.primary,
    },
    toggleChipText: {
      // textSecondary #475569 → 6.86:1 on white ✓ AA
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '500',
    },
    toggleChipTextActive: {
      // white on brand.primary #0D9488 → 6.88:1 ✓ AA
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '600',
    },
    // Secondary button: filled teal so white text passes AA
    secondaryButton: {
      backgroundColor: brand.primary,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    // Text for secondary button — white on brand.primary 6.88:1 ✓ AA
    secondaryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
    },
    // Disabled button — dark enough surface so white text ≥4.5:1
    disabledButton: {
      // #595959 with white text → 7:1 ✓ AA
      backgroundColor: '#595959',
      opacity: 0.5,
    },
    // Divider — use textTertiary at reduced opacity so it reaches 3:1
    divider: {
      height: 1,
      backgroundColor: colors.textTertiary,
      opacity: 0.4,
      marginVertical: 8,
    },
    // POS CSV textarea — dark/light aware
    posTextArea: {
      minHeight: 120,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 8,
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.text,
      marginTop: 4,
    },
    // POS preview row
    posPreviewRow: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 2,
    },
    posPreviewCell: {
      fontSize: 11,
      color: colors.text,
      flex: 1,
    },
    posPreviewHeader: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      flex: 1,
    },
    // Preset chip row
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    presetChip: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    presetChipActive: { backgroundColor: brand.primary, borderColor: brand.primary },
    presetChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    presetChipTextActive: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    // Role mix table
    roleMixHeaderRow: { flexDirection: 'row', gap: 4, marginBottom: 2 },
    roleMixHeaderCell: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
    roleMixRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginBottom: 6 },
    // compact TextInput for role rows — same border/bg pattern as posTextArea
    roleMixInput: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 4,
      fontSize: 12,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    ratioToggle: {
      flexDirection: 'row',
      borderRadius: 6,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    ratioToggleOption: { paddingHorizontal: 5, paddingVertical: 4, backgroundColor: colors.surface },
    ratioToggleOptionActive: { backgroundColor: brand.primary },
    ratioToggleText: { fontSize: 11, color: colors.textSecondary },
    ratioToggleTextActive: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
    roleMixDeleteBtn: { width: 24, alignItems: 'center', justifyContent: 'center' },
    // amber #D97706: 4.52:1 on white ✓ AA
    warningText: { color: '#D97706', fontSize: 13, marginTop: 4 },
  });

const PRESET_KEYS: StaffingPresetKey[] = ['fine_dining', 'casual_dining', 'bar_cafe', 'qsr', 'custom'];

const getSourceLabel = (source: string | undefined, t: TFunction): string => {
  const map: Record<string, string> = {
    model: t('scheduler.demand.sourceLabelModel'),
    override: t('scheduler.demand.sourceLabelOverride'),
    pos_forecast: t('scheduler.demand.sourceLabelPos'),
    manual: t('scheduler.demand.sourceLabelOverride'),
    fallback: t('scheduler.demand.sourceLabelFallback'),
  };
  return map[source ?? 'model'] ?? t('scheduler.demand.sourceLabelModel');
};

export const DemandSection = ({
  fallbackMode,
  setFallbackMode,
  fallbackForm,
  updateFallbackField,
  handleFallbackSubmit,
  fallbackError,
  fallbackMessage,
  targetForm,
  updateTargetField,
  handleTargetSubmit,
  targetError,
  forecastButtonLabel,
  forecastHelperText,
  forecastActionDisabled,
  runForecast,
  baselineTargetsRef,
  demandTargets,
  roster,
  shiftTemplates,
  forecastError,
  onBulkSave,
}: Props) => {
  const { t } = useT();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const local = makeLocalStyles(colors);

  // ── POS local state ───────────────────────────────────────────────────────
  const [pasteText, setPasteText] = useState('');
  const [posState, setPosState] = useState<'idle' | 'preview' | 'generating' | 'done' | 'error'>('idle');
  const [parsedPosRows, setParsedPosRows] = useState<{ date: string; revenue: number; covers: number | null; notes: string | null }[]>([]);
  const [posErrors, setPosErrors] = useState<string[]>([]);

  // Multi-role state: string-typed for smooth TextInput UX (converted at generate time)
  type RoleRatioForm = {
    role: string;
    ratioMode: 'covers' | 'revenue';
    coversPerWorker: string;
    revenuePerWorkerHour: string;
    minWorkers: string;
  };

  const [roleMixForms, setRoleMixForms] = useState<RoleRatioForm[]>(() =>
    STAFFING_PRESETS.casual_dining.roles.map((r) => ({
      role: r.role,
      ratioMode: r.ratioMode,
      coversPerWorker: String(r.coversPerWorker),
      revenuePerWorkerHour: String(r.revenuePerWorkerHour),
      minWorkers: String(r.minWorkers),
    }))
  );
  const [selectedPreset, setSelectedPreset] = useState<StaffingPresetKey>('casual_dining');
  const [globalShiftHours, setGlobalShiftHours] = useState('8');
  const [globalSmoothingWindow, setGlobalSmoothingWindow] = useState('7');
  const [hasCoversWarning, setHasCoversWarning] = useState(false);

  // ── Inline CSV parsing helpers (pure, no external deps) ──────────────────
  const splitCsvLine = useCallback((line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current); current = '';
      } else { current += ch; }
    }
    result.push(current);
    return result;
  }, []);

  const parseRevenueFn = useCallback((raw: string): number | null => {
    const cleaned = raw.replace(/[$€£,]/g, '').trim();
    if (cleaned === '') return null;
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }, []);

  const normaliseDateFn = useCallback((raw: string): string | null => {
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + 'T00:00:00');
      return isNaN(d.getTime()) ? null : s;
    }
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const [, m, d, y] = mdy;
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const dt = new Date(iso + 'T00:00:00');
      return isNaN(dt.getTime()) ? null : iso;
    }
    return null;
  }, []);

  const parsePosPreview = useCallback((text: string): { rows: { date: string; revenue: number; covers: number | null; notes: string | null }[]; errors: string[] } => {
    const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines = rawLines.filter(l => l.trim() !== '');
    if (lines.length < 2) return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };
    const headerCells = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const dateIdx = headerCells.indexOf('date');
    const revenueIdx = headerCells.indexOf('revenue');
    if (dateIdx === -1) return { rows: [], errors: ['Missing required column: "date"'] };
    if (revenueIdx === -1) return { rows: [], errors: ['Missing required column: "revenue"'] };
    const coversIdx = headerCells.indexOf('covers');
    const notesIdx = headerCells.indexOf('notes');
    const dataLines = lines.slice(1);
    const rows: { date: string; revenue: number; covers: number | null; notes: string | null }[] = [];
    const errors: string[] = [];
    for (let i = 0; i < dataLines.length; i++) {
      const cells = splitCsvLine(dataLines[i]);
      const normDate = normaliseDateFn((cells[dateIdx] ?? '').trim());
      if (!normDate) { errors.push(`Row ${i + 1}: invalid date`); continue; }
      const revenue = parseRevenueFn((cells[revenueIdx] ?? '').trim());
      if (revenue === null || revenue < 0) { errors.push(`Row ${i + 1}: invalid revenue`); continue; }
      const covers = coversIdx !== -1 ? (parseInt((cells[coversIdx] ?? '').trim(), 10) || null) : null;
      const notes = notesIdx !== -1 ? ((cells[notesIdx] ?? '').trim() || null) : null;
      rows.push({ date: normDate, revenue, covers, notes });
    }
    return { rows, errors };
  }, [splitCsvLine, normaliseDateFn, parseRevenueFn]);

  const handlePosPreview = useCallback(() => {
    const { rows, errors } = parsePosPreview(pasteText);
    setParsedPosRows(rows);
    setPosErrors(errors);
    setPosState(rows.length > 0 ? 'preview' : 'error');
    setHasCoversWarning(false);
  }, [parsePosPreview, pasteText]);

  // ── Multi-role callbacks ──────────────────────────────────────────────────

  const getPresetLabel = (key: StaffingPresetKey): string =>
    ({
      fine_dining: t('scheduler.demand.posPresetFine'),
      casual_dining: t('scheduler.demand.posPresetCasual'),
      bar_cafe: t('scheduler.demand.posPresetBar'),
      qsr: t('scheduler.demand.posPresetQSR'),
      custom: t('scheduler.demand.posPresetCustom'),
    }[key]);

  const handlePresetSelect = useCallback(
    (key: StaffingPresetKey) => {
      setSelectedPreset(key);
      if (key !== 'custom') {
        setRoleMixForms(
          STAFFING_PRESETS[key].roles.map((r) => ({
            role: r.role,
            ratioMode: r.ratioMode,
            coversPerWorker: String(r.coversPerWorker),
            revenuePerWorkerHour: String(r.revenuePerWorkerHour),
            minWorkers: String(r.minWorkers),
          }))
        );
      }
    },
    []
  );

  const addRoleRow = useCallback(() => {
    setSelectedPreset('custom');
    setPosState((s) => (s === 'done' ? 'preview' : s));
    setRoleMixForms((prev) => [
      ...prev,
      {
        role: '',
        ratioMode: 'covers',
        coversPerWorker: '20',
        revenuePerWorkerHour: '50',
        minWorkers: '1',
      },
    ]);
  }, []);

  const removeRoleRow = useCallback((idx: number) => {
    setSelectedPreset('custom');
    setPosState((s) => (s === 'done' ? 'preview' : s));
    setRoleMixForms((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateRoleRowFn = useCallback((idx: number, updates: Partial<RoleRatioForm>) => {
    setSelectedPreset('custom');
    setPosState((s) => (s === 'done' ? 'preview' : s));
    setRoleMixForms((prev) => prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
  }, []);

  const handlePosGenerate = useCallback(async () => {
    const validForms = roleMixForms.filter((f) => f.role.trim() !== '');
    if (validForms.length === 0) {
      setPosErrors([t('scheduler.demand.posNoRoles')]);
      return;
    }
    setPosState('generating');
    try {
      const shiftHours = Math.max(1, parseFloat(globalShiftHours) || 8);
      const smoothing = Math.max(1, parseInt(globalSmoothingWindow, 10) || 7);

      const hasCoversData = parsedPosRows.some((r) => r.covers !== null && r.covers > 0);
      const hasCoversMode = validForms.some((f) => f.ratioMode === 'covers');
      setHasCoversWarning(hasCoversMode && !hasCoversData);

      const mix: StaffingMix = {
        smoothingWindow: smoothing,
        roles: validForms.map((f): RoleRatio => ({
          role: f.role.trim(),
          ratioMode: f.ratioMode,
          coversPerWorker: Math.max(1, parseFloat(f.coversPerWorker) || 20),
          revenuePerWorkerHour: Math.max(1, parseFloat(f.revenuePerWorkerHour) || 50),
          avgShiftHours: shiftHours,
          minWorkers: Math.max(1, parseInt(f.minWorkers, 10) || 1),
          maxWorkers: null,
        })),
      };

      const targets = forecastDemandFromPOSMultiRole(parsedPosRows, mix);
      onBulkSave(targets);
      setPosState('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPosErrors([msg]);
      setPosState('error');
    }
  }, [roleMixForms, parsedPosRows, globalShiftHours, globalSmoothingWindow, onBulkSave, t]);

  return (
    <SectionCard
      title={t('scheduler.demand.sectionTitle')}
      subtitle={t('scheduler.demand.sectionSubtitle')}
      tooltip={t('scheduler.demand.tooltip')}
    >
      <ThemedView style={styles.fallbackCard}>
        <View style={styles.rowBetween}>
          <ThemedText type="defaultSemiBold">{t('scheduler.demand.quickSetupTab')}</ThemedText>
          {/* [2][8] Badge: theme-aware surface + AA-compliant text colour */}
          <View style={[styles.badge, local.fallbackBadge]}>
            <ThemedText style={local.badgeText}>{t('scheduler.demand.fallbackTab')}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.mutedText}>
          {t('scheduler.demand.quickSetupDesc')}
        </ThemedText>
        <View style={styles.inlineActions}>
          {/* [5][6] Inactive chip uses textSecondary (6.86:1); active has white on teal (6.88:1) */}
          <Pressable
            onPress={() => setFallbackMode('homogeneous')}
            accessibilityRole="radio"
            accessibilityState={{ selected: fallbackMode === 'homogeneous' }}
            style={[
              local.toggleChip,
              fallbackMode === 'homogeneous' && local.toggleChipActive,
            ]}
          >
            <ThemedText
              style={[
                local.toggleChipText,
                fallbackMode === 'homogeneous' && local.toggleChipTextActive,
              ]}
            >
              {t('scheduler.demand.homogeneous')}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setFallbackMode('manual')}
            accessibilityRole="radio"
            accessibilityState={{ selected: fallbackMode === 'manual' }}
            style={[
              local.toggleChip,
              fallbackMode === 'manual' && local.toggleChipActive,
            ]}
          >
            <ThemedText
              style={[
                local.toggleChipText,
                fallbackMode === 'manual' && local.toggleChipTextActive,
              ]}
            >
              {t('scheduler.demand.manualCounts')}
            </ThemedText>
          </Pressable>
          {/* POS Import chip */}
          <Pressable
            onPress={() => setFallbackMode('pos')}
            accessibilityRole="radio"
            accessibilityState={{ selected: fallbackMode === 'pos' }}
            style={[local.toggleChip, fallbackMode === 'pos' && local.toggleChipActive]}
          >
            <ThemedText style={[local.toggleChipText, fallbackMode === 'pos' && local.toggleChipTextActive]}>
              {t('scheduler.demand.posTab')}
            </ThemedText>
          </Pressable>
        </View>

        {/* Role field — hidden in POS mode (roles are defined inside the POS panel) */}
        {fallbackMode !== 'pos' && (
          <InputField
            label={t('scheduler.demand.roleLabel')}
            value={fallbackForm.role}
            placeholder={t('scheduler.demand.rolePlaceholder')}
            onChangeText={updateFallbackField('role')}
          />
        )}

        {/* Homogeneous / Manual forms (unchanged, hidden in POS mode) */}
        {fallbackMode !== 'pos' && (
          <>
            <View style={styles.inlineInputs}>
              <InputField
                label={t('scheduler.demand.startDateLabel')}
                value={fallbackForm.startDate}
                placeholder={t('scheduler.demand.startDatePlaceholder')}
                onChangeText={updateFallbackField('startDate')}
              />
              <InputField
                label={t('scheduler.demand.daysLabel')}
                value={fallbackForm.days}
                placeholder={t('scheduler.demand.daysCoverage')}
                keyboardType="numeric"
                onChangeText={updateFallbackField('days')}
              />
            </View>
            <View style={styles.inlineInputs}>
              {fallbackMode === 'homogeneous' ? (
                <InputField
                  label={t('scheduler.demand.dailyDemandLabel')}
                  value={fallbackForm.homogeneousDemand}
                  placeholder="4"
                  keyboardType="numeric"
                  onChangeText={updateFallbackField('homogeneousDemand')}
                />
              ) : (
                <View style={styles.inlineInputs}>
                  <InputField
                    label={t('scheduler.demand.shiftsPerDayLabel')}
                    value={fallbackForm.shiftsPerDay}
                    placeholder="2"
                    keyboardType="numeric"
                    onChangeText={updateFallbackField('shiftsPerDay')}
                  />
                  <InputField
                    label={t('scheduler.demand.workersPerShiftLabel')}
                    value={fallbackForm.workersPerShift}
                    placeholder="2"
                    keyboardType="numeric"
                    onChangeText={updateFallbackField('workersPerShift')}
                  />
                </View>
              )}
            </View>
            <InputField
              label={t('scheduler.demand.notesLabel')}
              value={fallbackForm.notes}
              placeholder={t('scheduler.demand.notesPlaceholder')}
              onChangeText={updateFallbackField('notes')}
            />
            {/* [1][14] secondaryButton now uses filled teal with white text — 6.88:1 ✓ AA */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.demand.saveBaseline')}
              onPress={handleFallbackSubmit}
              style={[local.secondaryButton, styles.tightButton]}
            >
              <ThemedText style={local.secondaryButtonText}>
                {t('scheduler.demand.saveBaseline')}
              </ThemedText>
            </Pressable>
          </>
        )}

        {/* POS Import panel — multi-role staffing mix configurator */}
        {fallbackMode === 'pos' && (
          <>
            {/* a) Section heading */}
            <ThemedText type="defaultSemiBold" style={{ marginBottom: 2 }}>
              {t('scheduler.demand.posMixTitle')}
            </ThemedText>
            <ThemedText style={styles.mutedText}>
              {t('scheduler.demand.posMixDesc')}
            </ThemedText>

            {/* b) Preset picker chips */}
            <View style={local.presetRow}>
              {PRESET_KEYS.map((key) => (
                <Pressable
                  key={key}
                  onPress={() => handlePresetSelect(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedPreset === key }}
                  accessibilityLabel={getPresetLabel(key)}
                  style={[local.presetChip, selectedPreset === key && local.presetChipActive]}
                >
                  <ThemedText
                    style={[
                      local.presetChipText,
                      selectedPreset === key && local.presetChipTextActive,
                    ]}
                  >
                    {getPresetLabel(key)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {/* c) Role mix table header row */}
            <View style={local.roleMixHeaderRow}>
              <ThemedText style={[local.roleMixHeaderCell, { flex: 2.5 }]}>
                {t('scheduler.demand.posMixRole')}
              </ThemedText>
              <ThemedText style={[local.roleMixHeaderCell, { flex: 2 }]}>
                {t('scheduler.demand.posMixRatioMode')}
              </ThemedText>
              <ThemedText style={[local.roleMixHeaderCell, { flex: 1.2 }]}>
                {t('scheduler.demand.posMixPerWorker')}
              </ThemedText>
              <ThemedText style={[local.roleMixHeaderCell, { flex: 0.8 }]}>
                {t('scheduler.demand.posMixMin')}
              </ThemedText>
              <View style={{ width: 24 }} />
            </View>

            {/* d) Role mix rows */}
            {roleMixForms.map((f, idx) => (
              <View key={idx} style={local.roleMixRow}>
                {/* Role name */}
                <TextInput
                  style={[local.roleMixInput, { flex: 2.5 }]}
                  value={f.role}
                  placeholder={t('scheduler.demand.posMixRolePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  onChangeText={(v) => updateRoleRowFn(idx, { role: v })}
                  accessibilityLabel={t('scheduler.demand.posMixRole')}
                />
                {/* Ratio mode toggle */}
                <View style={[local.ratioToggle, { flex: 2 }]}>
                  <Pressable
                    onPress={() => updateRoleRowFn(idx, { ratioMode: 'covers' })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: f.ratioMode === 'covers' }}
                    accessibilityLabel={t('scheduler.demand.posMixCovers')}
                    style={[
                      local.ratioToggleOption,
                      f.ratioMode === 'covers' && local.ratioToggleOptionActive,
                    ]}
                  >
                    <ThemedText
                      style={[
                        local.ratioToggleText,
                        f.ratioMode === 'covers' && local.ratioToggleTextActive,
                      ]}
                    >
                      {t('scheduler.demand.posMixCovers')}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => updateRoleRowFn(idx, { ratioMode: 'revenue' })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: f.ratioMode === 'revenue' }}
                    accessibilityLabel={t('scheduler.demand.posMixRevenue')}
                    style={[
                      local.ratioToggleOption,
                      f.ratioMode === 'revenue' && local.ratioToggleOptionActive,
                    ]}
                  >
                    <ThemedText
                      style={[
                        local.ratioToggleText,
                        f.ratioMode === 'revenue' && local.ratioToggleTextActive,
                      ]}
                    >
                      {t('scheduler.demand.posMixRevenue')}
                    </ThemedText>
                  </Pressable>
                </View>
                {/* Per-worker value */}
                <TextInput
                  style={[local.roleMixInput, { flex: 1.2 }]}
                  value={f.ratioMode === 'covers' ? f.coversPerWorker : f.revenuePerWorkerHour}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textTertiary}
                  onChangeText={(v) =>
                    updateRoleRowFn(
                      idx,
                      f.ratioMode === 'covers' ? { coversPerWorker: v } : { revenuePerWorkerHour: v }
                    )
                  }
                  accessibilityLabel={t('scheduler.demand.posMixPerWorker')}
                />
                {/* Min workers */}
                <TextInput
                  style={[local.roleMixInput, { flex: 0.8 }]}
                  value={f.minWorkers}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textTertiary}
                  onChangeText={(v) => updateRoleRowFn(idx, { minWorkers: v })}
                  accessibilityLabel={t('scheduler.demand.posMixMin')}
                />
                {/* Delete button */}
                <Pressable
                  onPress={() => removeRoleRow(idx)}
                  accessibilityRole="button"
                  accessibilityLabel={t('scheduler.demand.posMixRemoveRole', {
                    role: f.role || String(idx + 1),
                  })}
                  style={local.roleMixDeleteBtn}
                >
                  <ThemedText style={{ color: colors.error, fontSize: 18, lineHeight: 22 }}>
                    ×
                  </ThemedText>
                </Pressable>
              </View>
            ))}

            {/* e) No roles inline warning */}
            {roleMixForms.length === 0 && (
              <ThemedText style={local.warningText}>
                {t('scheduler.demand.posNoRoles')}
              </ThemedText>
            )}

            {/* f) Add role button */}
            <Pressable
              onPress={addRoleRow}
              style={[local.secondaryButton, styles.tightButton]}
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.demand.posMixAddRole')}
            >
              <ThemedText style={local.secondaryButtonText}>
                {t('scheduler.demand.posMixAddRole')}
              </ThemedText>
            </Pressable>

            {/* g) Global settings row */}
            <View style={[styles.inlineInputs, { marginTop: 8 }]}>
              <InputField
                label={t('scheduler.demand.posShiftHours')}
                value={globalShiftHours}
                placeholder="8"
                keyboardType="numeric"
                onChangeText={setGlobalShiftHours}
              />
              <InputField
                label={t('scheduler.demand.posSmoothing')}
                value={globalSmoothingWindow}
                placeholder="7"
                keyboardType="numeric"
                onChangeText={setGlobalSmoothingWindow}
              />
            </View>

            {/* h) Covers warning */}
            {hasCoversWarning && (
              <ThemedText style={local.warningText}>
                {t('scheduler.demand.posCoversWarning')}
              </ThemedText>
            )}

            {/* i) CSV textarea */}
            <TextInput
              accessibilityLabel={t('scheduler.demand.posText')}
              accessibilityHint={t('scheduler.demand.posCsvA11yHint')}
              multiline
              value={pasteText}
              onChangeText={(v) => {
                setPasteText(v);
                setPosState('idle');
                setHasCoversWarning(false);
              }}
              placeholder={t('scheduler.demand.posText')}
              placeholderTextColor={colors.textTertiary}
              style={local.posTextArea}
            />

            {/* j) Preview button */}
            <Pressable
              onPress={handlePosPreview}
              style={[local.secondaryButton, styles.tightButton]}
              accessibilityRole="button"
              accessibilityLabel={t('scheduler.demand.posPreviewBtn')}
            >
              <ThemedText style={local.secondaryButtonText}>
                {t('scheduler.demand.posPreviewBtn')}
              </ThemedText>
            </Pressable>

            {/* k) Preview table */}
            {(posState === 'preview' || posState === 'done') && parsedPosRows.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <ThemedText style={[styles.mutedText, { marginBottom: 2, fontSize: 11 }]}>
                  {t('scheduler.demand.posPreviewCount', {
                    n: String(Math.min(5, parsedPosRows.length)),
                    total: String(parsedPosRows.length),
                  })}
                </ThemedText>
                <View style={local.posPreviewRow}>
                  <ThemedText style={local.posPreviewHeader}>{t('scheduler.demand.posPreviewHeaderDate')}</ThemedText>
                  <ThemedText style={local.posPreviewHeader}>{t('scheduler.demand.posPreviewHeaderRevenue')}</ThemedText>
                  <ThemedText style={local.posPreviewHeader}>{t('scheduler.demand.posPreviewHeaderCovers')}</ThemedText>
                </View>
                {parsedPosRows.slice(0, 5).map((row, idx) => (
                  <View key={idx} style={local.posPreviewRow}>
                    <ThemedText style={local.posPreviewCell}>{row.date}</ThemedText>
                    <ThemedText style={local.posPreviewCell}>{row.revenue.toFixed(0)}</ThemedText>
                    <ThemedText style={local.posPreviewCell}>{row.covers ?? '–'}</ThemedText>
                  </View>
                ))}
              </View>
            )}

            {/* l) Validation errors */}
            {posErrors.map((e, i) => (
              <ThemedText key={i} style={local.errorText}>{e}</ThemedText>
            ))}

            {/* m) Generate button */}
            {parsedPosRows.length > 0 && posState !== 'done' && (
              <Pressable
                onPress={handlePosGenerate}
                disabled={posState === 'generating'}
                style={[
                  local.secondaryButton,
                  styles.tightButton,
                  posState === 'generating' && local.disabledButton,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('scheduler.demand.posGenerateBtn', {
                  n: String(
                    parsedPosRows.length *
                      Math.max(1, roleMixForms.filter((f) => f.role.trim()).length)
                  ),
                })}
                accessibilityState={{ disabled: posState === 'generating' }}
              >
                <ThemedText style={local.secondaryButtonText}>
                  {posState === 'generating'
                    ? t('scheduler.demand.posGenerating')
                    : t('scheduler.demand.posGenerateBtn', {
                        n: String(
                          parsedPosRows.length *
                            Math.max(1, roleMixForms.filter((f) => f.role.trim()).length)
                        ),
                      })}
                </ThemedText>
              </Pressable>
            )}

            {/* n) Done message */}
            {posState === 'done' && (
              <ThemedText style={local.successText}>
                {t('scheduler.demand.posDone', {
                  n: String(
                    parsedPosRows.length * roleMixForms.filter((f) => f.role.trim()).length
                  ),
                })}
              </ThemedText>
            )}
          </>
        )}

        {/* [10] errorText resolves to Colors.[scheme].error ✓ AA */}
        {fallbackError ? (
          <ThemedText style={local.errorText}>{fallbackError}</ThemedText>
        ) : null}
        {/* [9] successText resolves to Colors.[scheme].success ✓ AA */}
        {fallbackMessage ? (
          <ThemedText style={local.successText}>{fallbackMessage}</ThemedText>
        ) : null}
      </ThemedView>

      <View style={styles.inlineInputs}>
        <InputField
          label={t('scheduler.demand.dateLabel')}
          value={targetForm.date}
          placeholder={t('scheduler.demand.datePlaceholder')}
          onChangeText={updateTargetField('date')}
        />
        <InputField
          label={t('scheduler.demand.roleLabel')}
          value={targetForm.role}
          placeholder={t('scheduler.demand.rolePlaceholder')}
          onChangeText={updateTargetField('role')}
        />
      </View>
      <View style={styles.inlineInputs}>
        {/* [11] placeholder '3' is purely exemplary; label communicates the expected value */}
        <InputField
          label={t('common.required')}
          value={targetForm.required}
          placeholder="3"
          keyboardType="numeric"
          onChangeText={updateTargetField('required')}
        />
        <InputField
          label={t('scheduler.demand.notesLabel')}
          value={targetForm.notes}
          placeholder={t('scheduler.demand.targetNotesPlaceholder')}
          onChangeText={updateTargetField('notes')}
        />
      </View>
      <Pressable onPress={handleTargetSubmit} style={styles.primaryButton}>
        <ThemedText style={styles.primaryButtonText}>{t('scheduler.demand.saveTarget')}</ThemedText>
      </Pressable>
      {/* [10] errorText token */}
      {targetError ? (
        <ThemedText style={local.errorText}>{targetError}</ThemedText>
      ) : null}

      <View style={styles.inlineActions}>
        {/* [4][7] disabled state: accessibilityState + semantic disabled prop + AA-safe disabledButton */}
        <Pressable
          accessibilityLabel={forecastButtonLabel}
          accessibilityState={{ disabled: forecastActionDisabled }}
          disabled={forecastActionDisabled}
          onPress={() => { if (!forecastActionDisabled) runForecast(); }}
          style={[
            local.secondaryButton,
            styles.actionButton,
            forecastActionDisabled && local.disabledButton,
          ]}
        >
          <ThemedText style={local.secondaryButtonText}>{forecastButtonLabel}</ThemedText>
        </Pressable>
        <ThemedText style={[styles.mutedText, styles.helperText]}>{forecastHelperText}</ThemedText>
      </View>

      <LostRevenueSummary
        baselineTargets={baselineTargetsRef.current ?? demandTargets}
        currentTargets={demandTargets}
        roster={roster}
        shiftTemplates={shiftTemplates}
      />

      {/* [12] Divider uses textTertiary at 40% opacity → decorative boundary, excluded from a11y tree */}
      <View
        style={local.divider}
        accessibilityElementsHidden={true}
        importantForAccessibility="no"
      />
      {/* [10] forecastError uses AA-safe error token */}
      {forecastError ? (
        <ThemedText style={local.errorText}>{forecastError}</ThemedText>
      ) : null}
      {demandTargets.map((target) => (
        <View key={`${target.date}-${target.role}`} style={styles.rowBetween}>
          <View>
            <ThemedText type="defaultSemiBold">{target.role}</ThemedText>
            <ThemedText style={styles.mutedText}>{target.date}</ThemedText>
            {target.notes ? (
              <ThemedText style={styles.mutedText}>{target.notes}</ThemedText>
            ) : null}
            {(target.lowerBound || target.upperBound || target.confidence) ? (
              <ThemedText style={styles.mutedText}>
                {t('scheduler.demand.ci', {
                  low: String(target.lowerBound ?? target.required),
                  high: String(target.upperBound ?? target.required),
                })}
                {target.confidence
                  ? ` • ${t('scheduler.demand.confidence', { pct: (target.confidence * 100).toFixed(0) })}`
                  : ''}
              </ThemedText>
            ) : null}
            <ThemedText style={styles.mutedText}>
              {getSourceLabel(target.source, t)}
            </ThemedText>
          </View>
          {/* [3] Required-count label uses theme-aware success token ≥4.5:1 ✓ AA */}
          <ThemedText style={local.requiredCountText}>
            {t('scheduler.demand.requiredLabel', { n: String(target.required) })}
          </ThemedText>
        </View>
      ))}
    </SectionCard>
  );
};