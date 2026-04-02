/**
 * role-mix-batch.mjs
 *
 * Batch API implementation of the multi-role staffing mix feature.
 * Model: claude-sonnet-4-6 (Batch API — 50% off standard pricing)
 *
 * Research Summary:
 *   - No scheduling app (7shifts, Deputy, Homebase, Sling) currently lets users define
 *     per-role covers/revenue ratios in a UI — managers must calculate offline.
 *   - Key pain point: "We need 1 server per 6 covers, 1 cook per 15 covers — why can't the
 *     app do that math?" (common Reddit/App Store theme).
 *   - Industry-standard ratios: Fine dining 1:4 covers/server; Casual 1:6; Bar/Café barista 1:15.
 *   - Users want: covers-per-role config, minimum floors (always ≥1 manager), presets
 *     (Fine Dining / Casual / Bar / QSR), and revenue fallback when no covers data.
 *   - Big opportunity: be the first app to auto-translate POS covers → multi-role headcount.
 *
 * Changes:
 *   A. utils/posForecasting.ts — Add RoleRatio, StaffingMix, StaffingPresetKey,
 *      STAFFING_PRESETS, forecastDemandFromPOSMultiRole (pure additions, no breaking changes)
 *   B. utils/__tests__/posForecasting.test.ts — Add multi-role test suite
 *   C. components/scheduler/DemandSection.tsx — Role mix configurator UI in POS tab
 *      (preset picker + editable role rows + global shift hours / smoothing)
 *   D. hooks/useSchedulerHandlers.ts — Update posTargetsGenerated banner for multi-role,
 *      add 't' to dep array, add try/catch around overrideTarget
 *   E. locales/en.ts — New mix UI keys + fix posTargetsSaved plural bug
 *   F. locales/es.ts — Spanish translations for new keys
 *
 * Usage:
 *   node --env-file=.env.local scripts/role-mix-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Read current file contents ──────────────────────────────────────────────

const POS_FORECAST_TS      = read('utils/posForecasting.ts');
const POS_FORECAST_TEST_TS = read('utils/__tests__/posForecasting.test.ts');
const DEMAND_SECTION_TSX   = read('components/scheduler/DemandSection.tsx');
const HANDLERS_TS          = read('hooks/useSchedulerHandlers.ts');
const EN_TS                = read('locales/en.ts');
const ES_TS                = read('locales/es.ts');

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── A: posForecasting.ts — add multi-role types, presets, function ──────────
  {
    custom_id: 'A-posForecasting',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are editing utils/posForecasting.ts in a React Native / TypeScript scheduling app.

TASK: Add multi-role forecasting capability. Keep ALL existing exports exactly as-is (no breaking changes).
Append the following new exports AFTER the existing forecastDemandFromPOS function (at the end of the file).

## Types to add:

\`\`\`typescript
/**
 * A single role's staffing ratio configuration within a staffing mix.
 *
 * ratioMode determines which demand metric drives headcount:
 *   'covers'  → required = ceil(smoothedCovers / coversPerWorker)  [falls back to revenue if no covers column]
 *   'revenue' → required = ceil(smoothedRevenue / (revenuePerWorkerHour * avgShiftHours))
 */
export type RoleRatio = {
  role: string;                  // e.g. "Server", "Barista"
  ratioMode: 'covers' | 'revenue';
  coversPerWorker: number;       // covers per 1 worker (covers mode)
  revenuePerWorkerHour: number;  // $/hr per worker (revenue mode / fallback)
  avgShiftHours: number;         // hours per shift (revenue mode)
  minWorkers: number;            // always schedule at least this many
  maxWorkers: number | null;     // optional ceiling; null = no cap
};

export type StaffingMix = {
  roles: RoleRatio[];
  smoothingWindow: number;       // rolling-average window in days
};

export type StaffingPresetKey = 'fine_dining' | 'casual_dining' | 'bar_cafe' | 'qsr' | 'custom';
\`\`\`

## STAFFING_PRESETS to add:
Based on published hospitality benchmarks (7shifts, Oysterlink, Escoffier):
- fine_dining: Server 1:4 covers, Cook 1:8, Host 1:20 (max 2), Bartender 1:15; all min 1, shift 8h
- casual_dining: Server 1:6 covers, Cook 1:15, Host 1:30 (max 2); all min 1, shift 8h
- bar_cafe: Barista 1:15 covers, Bartender 1:10 covers; all min 1, shift 8h
- qsr: Counter 1:20 covers, Cook 1:25 covers; all min 1, shift 8h
- custom: empty roles array
Export as: \`export const STAFFING_PRESETS: Record<StaffingPresetKey, { key: StaffingPresetKey; roles: RoleRatio[] }>\`

## forecastDemandFromPOSMultiRole function to add:
Signature:
\`\`\`typescript
export function forecastDemandFromPOSMultiRole(
  rows: PosRow[],
  mix: StaffingMix,
): Array<{ date: string; role: string; required: number; source: string;
           notes: string; lowerBound: number; upperBound: number; confidence: number }>
\`\`\`

Algorithm:
1. Return [] if rows.length === 0 OR mix.roles.length === 0
2. Sort rows by date ascending (ISO 8601 lexicographic)
3. Smooth revenue series via rollingAverage(revenues, mix.smoothingWindow)
4. If ANY row has covers != null && covers > 0, also smooth covers series. Otherwise smoothedCovers = null.
5. For each date × each role:
   a. If ratioMode === 'covers' AND smoothedCov > 0: rawRequired = ceil(smoothedCov / coversPerWorker), notesSuffix = "{cov} covers → {raw}"
   b. Else (revenue fallback): denominator = revenuePerWorkerHour * avgShiftHours; rawRequired = denominator > 0 ? ceil(rev/denominator) : 1; notesSuffix = "\${rev} → {raw}"
   c. Apply floor: required = Math.max(roleRatio.minWorkers, rawRequired)
   d. Apply ceiling if maxWorkers !== null: required = Math.min(maxWorkers, required)
   e. Ensure absolute minimum: required = Math.max(1, required)
   f. lowerBound = Math.max(roleRatio.minWorkers, required - 1)  [at least minWorkers]
   g. upperBound = required + 1
   h. Push: { date, role: roleRatio.role, required, source: 'pos_forecast', notes: "POS: {notesSuffix}", lowerBound, upperBound, confidence: 0.80 }

## Rules:
- Use JSDoc comments on all new exports matching the existing style in the file
- Keep the file header comment and all existing code exactly as-is
- TypeScript strict mode — no 'any' types
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (utils/posForecasting.ts):
${POS_FORECAST_TS}`,
      }],
    },
  },

  // ── B: posForecasting.test.ts — add multi-role tests ─────────────────────
  {
    custom_id: 'B-posForecasting-test',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are editing utils/__tests__/posForecasting.test.ts in a React Native / TypeScript app.

TASK: Add a new describe block for forecastDemandFromPOSMultiRole and STAFFING_PRESETS at the end of the file.
Keep all existing tests exactly as-is.

## New imports needed (add to the existing import at the top):
Also import: forecastDemandFromPOSMultiRole, STAFFING_PRESETS, type RoleRatio, type StaffingMix, type StaffingPresetKey
(from '../posForecasting')

## New tests to write (append after the existing describe block):

describe('STAFFING_PRESETS', () => {
  - it('all preset keys exist') → expect all 5 keys to be present in STAFFING_PRESETS
  - it('casual_dining has 3 roles') → expect STAFFING_PRESETS.casual_dining.roles.length === 3
  - it('fine_dining host has maxWorkers 2') → expect the Host role in fine_dining.roles to have maxWorkers === 2
  - it('custom has empty roles') → expect STAFFING_PRESETS.custom.roles.length === 0
});

describe('forecastDemandFromPOSMultiRole', () => {
  - it('returns empty array for empty rows') → mix with 1 role, rows=[], expect []
  - it('returns empty array for empty roles') → 1 row, mix.roles=[], expect []
  - it('produces rows × roles forecasts') → 2 rows × 2 roles = 4 forecasts
  - it('covers-based required workers: 40 covers / 10 per worker = 4 required')
    rows: [{ date:'2026-01-01', revenue:1000, covers:40, notes:null }]
    mix.roles: [{ role:'Server', ratioMode:'covers', coversPerWorker:10, revenuePerWorkerHour:50, avgShiftHours:8, minWorkers:1, maxWorkers:null }]
    smoothingWindow: 1
    → result[0].required === 4
  - it('enforces minWorkers floor') → 1 cover, coversPerWorker=10, minWorkers=3 → required=3
  - it('enforces maxWorkers ceiling') → 100 covers, coversPerWorker=10, maxWorkers=2 → required=2
  - it('falls back to revenue when no covers data (covers mode)')
    rows: [{ date:'2026-01-01', revenue:800, covers:null, notes:null }]
    role: { ratioMode:'covers', coversPerWorker:10, revenuePerWorkerHour:100, avgShiftHours:8, minWorkers:1, maxWorkers:null }
    smoothingWindow:1
    → required = ceil(800/(100*8)) = 1
  - it('revenue mode: 2400 / (50*8) = 6 required')
  - it('sorts rows by date ascending')
  - it('sets source to pos_forecast for all entries')
  - it('sets confidence to 0.80 for all entries')
  - it('produces correct role names in output') → each forecast.role matches the roleRatio.role
  - it('multi-role: 1 date × 2 roles → 2 output entries with different role names')
});

## Rules:
- Use the same test style as existing tests (describe/it/expect, Jest)
- TypeScript strict mode — no 'any' types
- Concrete numeric assertions where possible
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (utils/__tests__/posForecasting.test.ts):
${POS_FORECAST_TEST_TS}`,
      }],
    },
  },

  // ── C: DemandSection.tsx — role mix configurator UI ─────────────────────
  {
    custom_id: 'C-DemandSection',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: `You are editing components/scheduler/DemandSection.tsx in a React Native / Expo TypeScript scheduling app.

TASK: Replace the current single-role POS import panel with a multi-role staffing mix configurator.
This is the biggest UX improvement in the file — it transforms the POS tab from "one role at a time"
to "define your whole team composition in one place".

## Research-backed UX decisions:
- Users think in covers-per-role: "1 server per 6 covers, 1 cook per 15 covers"
- Industry presets reduce setup friction: Fine Dining / Casual / Bar / QSR / Custom
- Each role needs: name, ratio mode (Covers vs Revenue $), per-worker value, min floor
- Revenue fallback automatically kicks in when CSV has no covers column (show warning)
- All existing features (homogeneous, manual modes) stay exactly the same

## Changes needed:

### 1. New imports (add at top alongside existing posForecasting import):
\`\`\`
import {
  forecastDemandFromPOSMultiRole,
  STAFFING_PRESETS,
  type RoleRatio,
  type StaffingMix,
  type StaffingPresetKey,
} from '@/utils/posForecasting';
\`\`\`
(Remove the old forecastDemandFromPOS and DEFAULT_POS_CONFIG imports since they are no longer used in this file)

### 2. Replace posConfig state with:
\`\`\`typescript
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
\`\`\`

### 3. New callbacks (add after existing parsePosPreview callback):
\`\`\`typescript
const PRESET_KEYS: StaffingPresetKey[] = ['fine_dining', 'casual_dining', 'bar_cafe', 'qsr', 'custom'];

const getPresetLabel = (key: StaffingPresetKey): string => ({
  fine_dining: t('scheduler.demand.posPresetFine'),
  casual_dining: t('scheduler.demand.posPresetCasual'),
  bar_cafe: t('scheduler.demand.posPresetBar'),
  qsr: t('scheduler.demand.posPresetQSR'),
  custom: t('scheduler.demand.posPresetCustom'),
}[key]);

const handlePresetSelect = useCallback((key: StaffingPresetKey) => {
  setSelectedPreset(key);
  if (key !== 'custom') {
    setRoleMixForms(STAFFING_PRESETS[key].roles.map((r) => ({
      role: r.role,
      ratioMode: r.ratioMode,
      coversPerWorker: String(r.coversPerWorker),
      revenuePerWorkerHour: String(r.revenuePerWorkerHour),
      minWorkers: String(r.minWorkers),
    })));
  }
}, [t]);

const addRoleRow = useCallback(() => {
  setSelectedPreset('custom');
  setRoleMixForms((prev) => [...prev, {
    role: '',
    ratioMode: 'covers',
    coversPerWorker: '20',
    revenuePerWorkerHour: '50',
    minWorkers: '1',
  }]);
}, []);

const removeRoleRow = useCallback((idx: number) => {
  setSelectedPreset('custom');
  setRoleMixForms((prev) => prev.filter((_, i) => i !== idx));
}, []);

const updateRoleRowFn = useCallback((idx: number, updates: Partial<RoleRatioForm>) => {
  setSelectedPreset('custom');
  setRoleMixForms((prev) => prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)));
}, []);
\`\`\`

### 4. Update handlePosPreview: add setHasCoversWarning(false) when resetting CSV state
### 5. Update handlePosGenerate:
\`\`\`typescript
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
\`\`\`

### 6. New local styles to add to makeLocalStyles:
\`\`\`typescript
// Preset chip row
presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
presetChip: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 5 },
presetChipActive: { backgroundColor: brand.primary, borderColor: brand.primary },
presetChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
presetChipTextActive: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
// Role mix table
roleMixHeaderRow: { flexDirection: 'row', gap: 4, marginBottom: 2 },
roleMixHeaderCell: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
roleMixRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginBottom: 6 },
// compact TextInput for role rows — same border/bg pattern as posTextArea
roleMixInput: {
  borderColor: colors.border, borderWidth: 1, borderRadius: 6,
  paddingHorizontal: 6, paddingVertical: 4, fontSize: 12, color: colors.text,
  backgroundColor: colors.surface,
},
ratioToggle: { flexDirection: 'row', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
ratioToggleOption: { paddingHorizontal: 5, paddingVertical: 4, backgroundColor: colors.surface },
ratioToggleOptionActive: { backgroundColor: brand.primary },
ratioToggleText: { fontSize: 11, color: colors.textSecondary },
ratioToggleTextActive: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
roleMixDeleteBtn: { width: 24, alignItems: 'center', justifyContent: 'center' },
// amber #D97706: 4.52:1 on white ✓ AA
warningText: { color: '#D97706', fontSize: 13, marginTop: 4 },
\`\`\`

### 7. POS tab JSX — replace the existing {fallbackMode === 'pos' && ( ... )} block entirely:

The new POS panel structure inside {fallbackMode === 'pos' && ( <> ... </> )}:

a) Section heading:
<ThemedText type="defaultSemiBold" style={{ marginBottom: 2 }}>{t('scheduler.demand.posMixTitle')}</ThemedText>
<ThemedText style={styles.mutedText}>{t('scheduler.demand.posMixDesc')}</ThemedText>

b) Preset picker chips (use PRESET_KEYS array, getPresetLabel helper):
<View style={local.presetRow}>
  {PRESET_KEYS.map((key) => (
    <Pressable key={key} onPress={() => handlePresetSelect(key)}
      accessibilityRole="radio" accessibilityState={{ selected: selectedPreset === key }}
      accessibilityLabel={getPresetLabel(key)}
      style={[local.presetChip, selectedPreset === key && local.presetChipActive]}>
      <ThemedText style={[local.presetChipText, selectedPreset === key && local.presetChipTextActive]}>
        {getPresetLabel(key)}
      </ThemedText>
    </Pressable>
  ))}
</View>

c) Role mix table header row:
<View style={local.roleMixHeaderRow}>
  <ThemedText style={[local.roleMixHeaderCell, { flex: 2.5 }]}>{t('scheduler.demand.posMixRole')}</ThemedText>
  <ThemedText style={[local.roleMixHeaderCell, { flex: 2 }]}>{t('scheduler.demand.posMixRatioMode')}</ThemedText>
  <ThemedText style={[local.roleMixHeaderCell, { flex: 1.2 }]}>{t('scheduler.demand.posMixPerWorker')}</ThemedText>
  <ThemedText style={[local.roleMixHeaderCell, { flex: 0.8 }]}>{t('scheduler.demand.posMixMin')}</ThemedText>
  <View style={{ width: 24 }} />
</View>

d) Role mix rows (map over roleMixForms):
For each row at index idx:
  - TextInput for role name: flex:2.5, value=f.role, placeholder=t('scheduler.demand.posMixRolePlaceholder'), onChangeText=v=>updateRoleRowFn(idx,{role:v})
  - Ratio mode toggle (View flex:2 with ratioToggle style):
      Pressable for 'covers': shows t('scheduler.demand.posMixCovers'), active when f.ratioMode==='covers'
      Pressable for 'revenue': shows t('scheduler.demand.posMixRevenue'), active when f.ratioMode==='revenue'
  - TextInput for per-worker value: flex:1.2, value=(f.ratioMode==='covers'?f.coversPerWorker:f.revenuePerWorkerHour), numeric,
      onChangeText=v=>updateRoleRowFn(idx, f.ratioMode==='covers' ? {coversPerWorker:v} : {revenuePerWorkerHour:v})
  - TextInput for min workers: flex:0.8, value=f.minWorkers, numeric, onChangeText=v=>updateRoleRowFn(idx,{minWorkers:v})
  - Delete Pressable (roleMixDeleteBtn style): onPress=()=>removeRoleRow(idx),
      accessibilityRole="button", accessibilityLabel=t('scheduler.demand.posMixRemoveRole',{role:f.role||String(idx+1)}),
      ThemedText child: '×' with color:colors.error fontSize:18 lineHeight:22

e) "No roles" inline warning (when roleMixForms.length === 0):
<ThemedText style={local.warningText}>{t('scheduler.demand.posNoRoles')}</ThemedText>

f) Add role button (secondaryButton style with tightButton):
<Pressable onPress={addRoleRow} style={[local.secondaryButton, styles.tightButton]} accessibilityRole="button">
  <ThemedText style={local.secondaryButtonText}>{t('scheduler.demand.posMixAddRole')}</ThemedText>
</Pressable>

g) Global settings row:
<View style={[styles.inlineInputs, { marginTop: 8 }]}>
  <InputField label={t('scheduler.demand.posShiftHours')} value={globalShiftHours}
    placeholder="8" keyboardType="numeric" onChangeText={setGlobalShiftHours} />
  <InputField label={t('scheduler.demand.posSmoothing')} value={globalSmoothingWindow}
    placeholder="7" keyboardType="numeric" onChangeText={setGlobalSmoothingWindow} />
</View>

h) Covers warning (when hasCoversWarning):
<ThemedText style={local.warningText}>{t('scheduler.demand.posCoversWarning')}</ThemedText>

i) CSV textarea (same as before but add setHasCoversWarning(false) to onChangeText):
TextInput multiline, value=pasteText, onChangeText=v=>{setPasteText(v);setPosState('idle');setHasCoversWarning(false);}
Same styles, placeholder, accessibilityLabel as before.

j) Preview button (same as before)

k) Preview table (same as before — shows first 5 parsed rows with Date/Revenue/Covers columns)

l) Validation errors (same map as before)

m) Generate button with updated label:
accessibilityLabel={t('scheduler.demand.posGenerateBtn', { n: String(parsedPosRows.length * Math.max(1, roleMixForms.filter(f=>f.role.trim()).length)) })}
Show same label in button text

n) Done message (same posDone key as before):
{t('scheduler.demand.posDone', { n: String(parsedPosRows.length * roleMixForms.filter(f=>f.role.trim()).length) })}

### 8. Hide the "Role field — always visible" InputField when fallbackMode === 'pos':
Change: <InputField label={t('scheduler.demand.roleLabel')} ... />
To: {fallbackMode !== 'pos' && <InputField label={t('scheduler.demand.roleLabel')} ... />}

## Rules:
- Keep ALL existing code outside the POS tab exactly as-is (homogeneous/manual forms, target form, forecast, LostRevenueSummary, etc.)
- TypeScript strict mode — no 'any' types
- All Pressables have accessibilityRole and accessibilityLabel
- Keep all existing comments and style tokens
- IMPORTANT: Do not import useCallback again (it's already imported)
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (components/scheduler/DemandSection.tsx):
${DEMAND_SECTION_TSX}`,
      }],
    },
  },

  // ── D: useSchedulerHandlers.ts — update posTargetsGenerated banner ────────
  {
    custom_id: 'D-schedulerHandlers',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are editing hooks/useSchedulerHandlers.ts in a React Native / TypeScript scheduling app.

TASK: Make 2 targeted changes to handlePosTargetsGenerated (around line 1016):

### Change 1: Add try/catch around overrideTarget and count distinct roles
Replace the current handlePosTargetsGenerated implementation with:
\`\`\`typescript
const handlePosTargetsGenerated = useCallback(async (targets: Array<{date: string; role: string; required: number; source: string; notes: string; lowerBound?: number; upperBound?: number; confidence?: number}>) => {
  let savedCount = 0;
  for (const target of targets) {
    try {
      await overrideTarget({
        date: target.date,
        role: target.role,
        required: target.required,
        source: 'override',
        notes: target.notes,
        lowerBound: target.lowerBound,
        upperBound: target.upperBound,
        confidence: target.confidence,
      });
      savedCount++;
    } catch {
      // Skip individual failures silently; report saved count at end.
    }
  }
  const distinctRoles = new Set(targets.map((tgt) => tgt.role)).size;
  const msg =
    distinctRoles > 1
      ? t('scheduler.demand.posTargetsSavedMulti', { n: String(savedCount), roles: String(distinctRoles) })
      : t('scheduler.demand.posTargetsSaved', { n: String(savedCount) });
  showActionBanner(msg, 'success');
}, [overrideTarget, showActionBanner, t]);
\`\`\`

### Change 2: Nothing else should change — only this one function.

## Rules:
- TypeScript strict mode — no 'any' types
- The 't' variable is already declared at the top of useSchedulerHandlers via const { t } = useT()
- Keep ALL other code in the file exactly as-is
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (hooks/useSchedulerHandlers.ts):
${HANDLERS_TS}`,
      }],
    },
  },

  // ── E: locales/en.ts — new role mix keys ─────────────────────────────────
  {
    custom_id: 'E-locales-en',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are editing locales/en.ts in a React Native / TypeScript scheduling app.

TASK: Add new keys to the scheduler.demand section. Keep ALL existing keys exactly as-is.
Also fix the posTargetsSaved key (remove the broken {plural} placeholder).

## Keys to ADD inside scheduler.demand (after the existing posTooltip key):
\`\`\`
posPresetFine: 'Fine Dining',
posPresetCasual: 'Casual',
posPresetBar: 'Bar / Café',
posPresetQSR: 'Quick Service',
posPresetCustom: 'Custom',
posMixTitle: 'Role staffing mix',
posMixDesc: 'Set how many workers you need per role based on expected covers or revenue.',
posMixRole: 'Role',
posMixRolePlaceholder: 'e.g. Server',
posMixRatioMode: 'By',
posMixCovers: 'Cvr',
posMixRevenue: 'Rev',
posMixPerWorker: '/wkr',
posMixMin: 'Min',
posMixAddRole: '+ Add role',
posMixRemoveRole: 'Remove {role} row',
posNoRoles: 'Add at least one role to generate forecasts.',
posCoversWarning: 'No covers data in CSV — using revenue estimate for cover-ratio roles.',
posTargetsSavedMulti: '{n} targets saved across {roles} roles.',
\`\`\`

## Key to UPDATE (fix broken {plural} placeholder):
Change: posTargetsSaved: '{n} demand target{plural} saved from POS data.',
To:     posTargetsSaved: '{n} demand targets saved from POS data.',

## Rules:
- Add new keys AFTER the posTooltip key in scheduler.demand, before the closing brace of demand
- Keep ALL other content exactly as-is (no reformatting)
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (locales/en.ts):
${EN_TS}`,
      }],
    },
  },

  // ── F: locales/es.ts — Spanish translations ───────────────────────────────
  {
    custom_id: 'F-locales-es',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are editing locales/es.ts in a React Native / TypeScript scheduling app.

TASK: Add Spanish translations for new role mix keys inside scheduler.demand.
Keep ALL existing content exactly as-is.

## Keys to ADD inside scheduler.demand (after posTooltip, before the closing of demand):
\`\`\`
posPresetFine: 'Alta Cocina',
posPresetCasual: 'Informal',
posPresetBar: 'Bar / Café',
posPresetQSR: 'Comida Rápida',
posPresetCustom: 'Personalizado',
posMixTitle: 'Composición de personal por rol',
posMixDesc: 'Establece cuántos trabajadores necesitas por rol según los cubiertos o los ingresos esperados.',
posMixRole: 'Rol',
posMixRolePlaceholder: 'p. ej. Camarero',
posMixRatioMode: 'Por',
posMixCovers: 'Cub',
posMixRevenue: 'Rev',
posMixPerWorker: '/trab',
posMixMin: 'Mín',
posMixAddRole: '+ Agregar rol',
posMixRemoveRole: 'Eliminar fila {role}',
posNoRoles: 'Agrega al menos un rol para generar pronósticos.',
posCoversWarning: 'Sin datos de cubiertos en el CSV — usando estimación de ingresos para roles por cubiertos.',
posTargetsSavedMulti: '{n} objetivos guardados en {roles} roles.',
\`\`\`

## Key to UPDATE (fix broken {plural} placeholder):
Change the posTargetsSaved line from:
  posTargetsSaved: '{n} objetivo{plural} de demanda guardado{plural} desde datos POS.'
To:
  posTargetsSaved: '{n} objetivos de demanda guardados desde datos POS.'

## Important: The es.ts file is in a single-line compact format (all keys on one line per section).
Find the scheduler.demand section and add the new keys inside it, maintaining the same compact format.

## Rules:
- Keep ALL existing content exactly as-is
- Return ONLY the complete updated file with no markdown fences

CURRENT FILE (locales/es.ts):
${ES_TS}`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`Submitting ${requests.length}-request batch to claude-sonnet-4-6…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

// ─── Poll ─────────────────────────────────────────────────────────────────────

let finalBatch = batch;
while (finalBatch.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 10000));
  finalBatch = await client.messages.batches.retrieve(batch.id);
  const { processing, succeeded, errored } = finalBatch.request_counts;
  console.log(`  polling… processing=${processing} succeeded=${succeeded} errored=${errored}`);
}

console.log('\nBatch complete. Processing results…');

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(finalBatch.id)) {
  if (result.result.type === 'succeeded') {
    const text = result.result.message.content.find((b) => b.type === 'text')?.text ?? '';
    results[result.custom_id] = { ok: true, text };
  } else {
    console.error(`  FAILED ${result.custom_id}:`, result.result);
    results[result.custom_id] = { ok: false };
  }
}

// ─── Apply changes ─────────────────────────────────────────────────────────────

const FILE_MAP = {
  'A-posForecasting':    'utils/posForecasting.ts',
  'B-posForecasting-test': 'utils/__tests__/posForecasting.test.ts',
  'C-DemandSection':     'components/scheduler/DemandSection.tsx',
  'D-schedulerHandlers': 'hooks/useSchedulerHandlers.ts',
  'E-locales-en':        'locales/en.ts',
  'F-locales-es':        'locales/es.ts',
};

for (const [customId, relPath] of Object.entries(FILE_MAP)) {
  const r = results[customId];
  if (!r?.ok) { console.error(`  SKIP ${relPath} (request failed)`); continue; }
  write(relPath, stripFences(r.text));
}

// Save raw results for audit
write('scripts/role-mix-results.json', JSON.stringify(results, null, 2));

console.log('\nDone! Run: npm test && npm run lint');
