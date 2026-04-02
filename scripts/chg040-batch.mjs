/**
 * CHG-040 Batch Script
 * Generates 7 file changes via Anthropic Batch API (claude-sonnet-4-6, 50% off)
 *
 * Run: node scripts/chg040-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

config({ path: resolve(ROOT, '.env.local') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── helpers ──────────────────────────────────────────────────────────────────

function stripFences(text) {
  return text
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

// ── read existing files we need as context ───────────────────────────────────

const demandSectionFull = readFileSync(resolve(ROOT, 'components/scheduler/DemandSection.tsx'), 'utf8');
const weekCalendarFull  = readFileSync(resolve(ROOT, 'components/scheduler/WeekCalendar.tsx'), 'utf8');
const handlersFile      = readFileSync(resolve(ROOT, 'hooks/useSchedulerHandlers.ts'), 'utf8');
const schedulerFile     = readFileSync(resolve(ROOT, 'app/(tabs)/scheduler.tsx'), 'utf8');
const enFile            = readFileSync(resolve(ROOT, 'locales/en.ts'), 'utf8');
const esFile            = readFileSync(resolve(ROOT, 'locales/es.ts'), 'utf8');
const posUploadFull     = readFileSync(resolve(ROOT, 'components/scheduler/PosUploadSection.tsx'), 'utf8');

// ── batch requests ────────────────────────────────────────────────────────────

const requests = [

  // ── Change 1: utils/posForecasting.ts ─────────────────────────────────────
  {
    custom_id: 'change1-posForecasting',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Create a NEW TypeScript file \`utils/posForecasting.ts\` for the Horario scheduling app.

REQUIREMENTS (implement EXACTLY as described):

1. Type: \`PosRow = { date: string; revenue: number; covers: number | null; notes: string | null }\`
2. Type: \`PosForecasterConfig = { role: string; revenuePerWorkerHour: number; avgShiftHours: number; smoothingWindow: number }\`
3. \`DEFAULT_POS_CONFIG\`: exported const with values: role='', revenuePerWorkerHour=50, avgShiftHours=8, smoothingWindow=7
4. Exported function \`rollingAverage(values: number[], window: number): number[]\`:
   - Centered rolling average (pad edges by replicating first/last valid average)
   - Returns array same length as input
5. Exported function \`forecastDemandFromPOS(rows: PosRow[], config: PosForecasterConfig)\` returning:
   \`Array<{date: string; role: string; required: number; source: string; notes: string; lowerBound: number; upperBound: number; confidence: number}>\`
   - Sort rows by date ascending
   - Extract revenue array, apply rollingAverage with config.smoothingWindow
   - required = Math.max(1, Math.ceil(smoothedRevenue / (config.revenuePerWorkerHour * config.avgShiftHours)))
   - lowerBound = Math.max(1, required - 1)
   - upperBound = required + 1
   - confidence = 0.80
   - source = 'pos_forecast'
   - notes = \`POS: \$\${smoothedRevenue.toFixed(0)} rev → \${required} workers\`
   - role = config.role

CONSTRAINTS:
- TypeScript strict mode — no \`any\`
- No external dependencies
- Export rollingAverage for tests
- Include JSDoc comments

Output the COMPLETE file content only (no markdown fences, no explanation).`
      }]
    }
  },

  // ── Change 2: DemandSection.tsx (modified) ────────────────────────────────
  {
    custom_id: 'change2-demandSection',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the DemandSection.tsx component for the Horario scheduling app.

EXISTING FILE:
\`\`\`tsx
${demandSectionFull}
\`\`\`

EXISTING PosUploadSection.tsx CSV helpers (for reference — copy the pure functions):
\`\`\`tsx
${posUploadFull.slice(0, 3000)}
\`\`\`

CHANGES TO MAKE:

1. Update Props type:
   - Change \`fallbackMode\` type from \`'homogeneous' | 'manual'\` to \`'homogeneous' | 'manual' | 'pos'\`
   - Change \`setFallbackMode\` param to accept \`'homogeneous' | 'manual' | 'pos'\`
   - Add new prop: \`onBulkSave: (targets: Array<{date: string; role: string; required: number; source: string; notes: string; lowerBound: number; upperBound: number; confidence: number}>) => void\`

2. Add imports:
   - \`import { forecastDemandFromPOS, DEFAULT_POS_CONFIG } from '@/utils/posForecasting';\`
   - \`import { TextInput } from 'react-native';\` (add TextInput to existing RN import)
   - Keep all existing imports

3. Inside DemandSection component body (before return), add local POS state:
   \`\`\`
   const [pasteText, setPasteText] = React.useState('');
   const [posState, setPosState] = React.useState<'idle'|'preview'|'generating'|'done'|'error'>('idle');
   const [parsedPosRows, setParsedPosRows] = React.useState<Array<{date: string; revenue: number; covers: number|null; notes: string|null}>>([]);
   const [posErrors, setPosErrors] = React.useState<string[]>([]);
   const [posConfig, setPosConfig] = React.useState({ revenuePerWorkerHour: '50', avgShiftHours: '8' });
   \`\`\`

4. Add inline CSV parsing helpers (copy these pure functions VERBATIM from PosUploadSection — do NOT import them):
   - \`function splitCsvLine(line: string): string[]\`
   - \`function parseRevenue(raw: string): number | null\`
   - \`function normaliseDate(raw: string): string | null\`
   - \`function parsePosPreview(text: string): { rows: Array<{date: string; revenue: number; covers: number|null; notes: string|null}>; errors: string[] }\`
     (this is a new wrapper that uses the above helpers and returns rows + validation errors as strings)

5. Add a "POS Import" toggle chip AFTER the "Manual worker/shift counts" chip in the fallbackCard toggle row.

6. When fallbackMode === 'pos', show a POS import sub-panel (REPLACE the homogeneous/manual form area only — the role InputField, notes InputField, and Save baseline button stay):
   - Two InputField components for config:
     * label={t('scheduler.demand.posRevenuePerHour')} value={posConfig.revenuePerWorkerHour} placeholder="50" keyboardType="numeric" onChangeText={(v) => setPosConfig(p => ({...p, revenuePerWorkerHour: v}))}
     * label={t('scheduler.demand.posShiftHours')} value={posConfig.avgShiftHours} placeholder="8" keyboardType="numeric" onChangeText={(v) => setPosConfig(p => ({...p, avgShiftHours: v}))}
   - A TextInput for CSV paste (multiline, style: monospace fontFamily, minHeight 120, backgroundColor surface, borderColor border, borderWidth 1, borderRadius 8, padding 8, fontSize 12, color text)
   - A "Preview CSV" Pressable button (style: local.secondaryButton) that calls parsePosPreview and sets state
   - When posState === 'preview' and parsedPosRows.length > 0: show a preview table header row (Date | Revenue | Covers) and up to 5 rows as ThemedText lines
   - Show posErrors as red ThemedText lines
   - When parsedPosRows.length > 0: show "Generate N demand targets" Pressable (local.secondaryButton) that:
     * Sets posState to 'generating'
     * Calls forecastDemandFromPOS with parsed rows and config
     * Calls onBulkSave with the results
     * Sets posState to 'done'
     * On error: sets posState to 'error'
   - Show appropriate status messages using t() keys: posGenerating, posDone (with n=count), posError (with msg)

7. KEEP ALL existing homogeneous and manual UI unchanged (only show/hide based on fallbackMode).
8. KEEP all accessibility attributes.
9. KEEP all contrast-compliance comments.
10. Add makeLocalStyles entries for the POS CSV textarea if needed.

Output the COMPLETE updated file content only (no markdown fences).`
      }]
    }
  },

  // ── Change 3: WeekCalendar.tsx (modified) ─────────────────────────────────
  {
    custom_id: 'change3-weekCalendar',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the WeekCalendar.tsx component for the Horario scheduling app.

EXISTING FILE:
\`\`\`tsx
${weekCalendarFull}
\`\`\`

CHANGES TO MAKE:

1. Add optional prop to WeekCalendarProps:
   \`coverageByDate?: Record<string, { scheduled: number; required: number }>\`

2. Change COLUMN_WIDTH from 110 to 120 in makeStyles.

3. In ShiftChip, add time range below the worker name:
   - Below the workerText, add a new Text showing \`\${shift.template?.start ?? ''} – \${shift.template?.end ?? ''}\` (only when both start and end exist: \`shift.template?.start && shift.template?.end\`)
   - Style: fontSize 9, color chipText, opacity 0.75

4. In the columnHeaderRow, for each day column header, when coverageByDate prop is provided:
   - After the day label Text, add a coverage indicator row:
     * A colored dot (small View, width/height 8, borderRadius 4) — green (#16A34A) if scheduled>=required, amber (#D97706) if scheduled>0 but <required, red (#DC2626) if scheduled===0 and required>0
     * A Text showing "\${scheduled}/\${required}" in fontSize 9, color same as dot color
   - Only show this when the coverageByDate entry exists AND required > 0
   - Look up coverage as: \`const cov = coverageByDate?.[key];\`

5. Add a LEGEND row between the columnHeaderRow and the columnsRow/emptyStateRow (only shown when hasAnyShifts is true):
   - A View with flexDirection:'row', justifyContent:'center', gap:16, paddingVertical:4, backgroundColor: colors.surface, borderBottomWidth:1, borderBottomColor:colors.border
   - Left item: amber dot (width/height 8, borderRadius 4, backgroundColor brand.accentDark) + Text "Draft" (fontSize 11, color colors.textSecondary, marginLeft:4)
   - Right item: teal dot (width/height 8, borderRadius 4, backgroundColor colors.tint) + Text "Published" (fontSize 11, color colors.textSecondary, marginLeft:4)
   - Each item is a View with flexDirection:'row', alignItems:'center'
   - Use t('weekCalendar.legend'), t('weekCalendar.legendDraft'), t('weekCalendar.legendPublished') for accessibility labels

6. Keep ALL existing functionality intact (navigation, today highlight, empty state, accessibility).
7. Keep all existing imports. Add brand to existing import if not already there (it already is).

Output the COMPLETE updated file content only (no markdown fences).`
      }]
    }
  },

  // ── Change 4: scheduler.tsx (modified) ────────────────────────────────────
  {
    custom_id: 'change4-scheduler',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the scheduler.tsx screen for the Horario scheduling app.

EXISTING FILE:
\`\`\`tsx
${schedulerFile}
\`\`\`

CHANGES TO MAKE:

1. REMOVE the import line: \`import PosUploadSection from '@/components/scheduler/PosUploadSection';\`

2. In the useSchedulerHandlers() destructuring block, ADD \`handlePosTargetsGenerated\` to the Handlers section (after \`runForecast\`):
   \`handlePosTargetsGenerated,\`

3. REMOVE the entire <PosUploadSection> block:
   \`\`\`
   <PosUploadSection
     accountId={process.env.EXPO_PUBLIC_ACCOUNT_ID ?? ''}
   />
   \`\`\`

4. REORDER sections so that Demand comes BEFORE Templates+Shifts:
   New order:
   a. Workers section (workerSectionRef) — UNCHANGED
   b. Demand section (demandSectionRef) — MOVED UP (was after Templates)
   c. Templates+Shifts section (templateSectionRef) — MOVED DOWN (was before Demand)
   d. Roster section — UNCHANGED

   To do the reorder:
   - Move the entire \`<View ref={demandSectionRef} ...>\` block to be BEFORE the \`<View ref={templateSectionRef} ...>\` block
   - Keep the shiftSectionRef anchor \`<View ref={shiftSectionRef} ...>\` in its current position (between the two moved blocks or at end — it's just an empty anchor, keep it between demand and templates)

   Actually: new order should be:
   1. workerSectionRef block
   2. demandSectionRef block
   3. shiftSectionRef anchor (empty View)
   4. templateSectionRef block
   5. RosterSection

5. ADD \`onBulkSave={handlePosTargetsGenerated}\` prop to <DemandSection>:
   Add it after the \`forecastError={forecastError}\` prop.

6. Update the \`fallbackMode\` and \`setFallbackMode\` types — they're already passed as props so no type changes needed in this file, just ensure they're passed.

Output the COMPLETE updated file content only (no markdown fences).`
      }]
    }
  },

  // ── Change 5: useSchedulerHandlers.ts (modified) ──────────────────────────
  {
    custom_id: 'change5-handlers',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the useSchedulerHandlers.ts hook for the Horario scheduling app.

EXISTING FILE (first 200 lines):
\`\`\`typescript
${handlersFile.slice(0, 5000)}
\`\`\`

EXISTING FILE (lines 750 to end):
\`\`\`typescript
${handlersFile.slice(handlersFile.indexOf('  const handleTargetSubmit'))}
\`\`\`

CHANGES TO MAKE:

1. Add a new \`handlePosTargetsGenerated\` callback AFTER the \`applyAutoAssign\` callback and BEFORE the return statement.

   Add this code exactly:
   \`\`\`typescript
   const handlePosTargetsGenerated = useCallback(async (targets: Array<{date: string; role: string; required: number; source: string; notes: string; lowerBound?: number; upperBound?: number; confidence?: number}>) => {
     let savedCount = 0;
     for (const target of targets) {
       await overrideTarget({
         date: target.date,
         role: target.role,
         required: target.required,
         source: target.source as 'manual' | 'model' | 'override',
         notes: target.notes,
       });
       savedCount++;
     }
     setActionBanner({ type: 'success', message: \`\${savedCount} demand targets generated from POS data.\` });
   }, [overrideTarget, setActionBanner]);
   \`\`\`

2. In the return object (the \`return { ... } as const;\` block), add \`handlePosTargetsGenerated,\` to the Handlers section (after \`applyAutoAssign\`).

3. Update the \`fallbackMode\` state type from \`useState<'homogeneous' | 'manual'>\` to \`useState<'homogeneous' | 'manual' | 'pos'>\`:
   - Find: \`const [fallbackMode, setFallbackMode] = useState<'homogeneous' | 'manual'>('homogeneous');\`
   - Change to: \`const [fallbackMode, setFallbackMode] = useState<'homogeneous' | 'manual' | 'pos'>('homogeneous');\`

   Also update \`handleFallbackSubmit\` — its \`fallbackMode\` condition checks \`if (fallbackMode === 'homogeneous')\` — add an early return/guard for 'pos' mode since POS targets are saved via handlePosTargetsGenerated:
   In handleFallbackSubmit, after the initial validation checks and before the \`if (fallbackMode === 'homogeneous')\` block, add:
   \`\`\`typescript
   if (fallbackMode === 'pos') {
     // POS targets are generated and saved via handlePosTargetsGenerated in DemandSection
     return;
   }
   \`\`\`

Output ONLY the COMPLETE updated file content (no markdown fences, no explanation).`
      }]
    }
  },

  // ── Change 6: locales/en.ts ────────────────────────────────────────────────
  {
    custom_id: 'change6-en',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the locales/en.ts file for the Horario scheduling app.

EXISTING FILE:
\`\`\`typescript
${enFile}
\`\`\`

CHANGES TO MAKE:

1. In the \`scheduler.demand\` object, ADD these new keys after the existing \`tooltip\` key:
\`\`\`
posTab: 'POS Import',
posRole: 'Assign to role',
posRevenuePerHour: 'Revenue / worker-hour ($)',
posRevenuePerHourPlaceholder: '50',
posShiftHours: 'Avg shift hours',
posShiftHoursPlaceholder: '8',
posSmoothing: 'Smoothing (days)',
posText: 'Paste CSV (date,revenue,covers,notes)',
posPreviewBtn: 'Preview CSV',
posGenerateBtn: 'Generate {n} demand targets',
posGenerating: 'Generating…',
posDone: '{n} targets saved from POS data',
posError: 'Error: {msg}',
posTooltip: 'Upload POS sales CSV to automatically calculate how many workers you need per day. The engine uses a rolling average to smooth revenue and converts it to required headcount using your revenue-per-worker-hour target.',
\`\`\`

2. Find the \`scheduler.roster\` object. It has keys like \`calendarView\`, \`listView\`, \`noShiftsThisWeek\`, etc.
   Look for how WeekCalendar keys are referenced. There is no \`weekCalendar\` top-level key yet — ADD it as a NEW top-level key in the \`en\` object (after the \`scheduler\` key and before the \`analytics\` key):
\`\`\`
weekCalendar: {
  prevWeek: 'Previous week',
  nextWeek: 'Next week',
  today: 'Today',
  maximize: 'Fullscreen calendar',
  closeFullscreen: 'Close fullscreen',
  noShifts: 'No shifts this week.',
  legend: 'Legend:',
  legendDraft: 'Draft',
  legendPublished: 'Published',
  coverageMet: '{s}/{r} covered',
  coverageShort: '{s}/{r} short',
},
\`\`\`

NOTE: The existing WeekCalendar uses t('weekCalendar.prevWeek'), t('weekCalendar.today'), t('weekCalendar.nextWeek'), t('weekCalendar.maximize'), t('weekCalendar.noShifts') — these keys already exist in the roster object as roster.prevWeek etc., but the WeekCalendar component uses the weekCalendar namespace. Add the weekCalendar namespace with all these keys (including the existing ones used by the component AND the new legend/coverage keys).

Output the COMPLETE updated file content only (no markdown fences).`
      }]
    }
  },

  // ── Change 7: locales/es.ts ────────────────────────────────────────────────
  {
    custom_id: 'change7-es',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{
        role: 'user',
        content: `Modify the locales/es.ts file for the Horario scheduling app (Spanish translations).

EXISTING FILE:
\`\`\`typescript
${esFile}
\`\`\`

CHANGES TO MAKE:

1. In the \`scheduler.demand\` object, ADD the same new keys as English but in Spanish:
\`\`\`
posTab: 'Importar POS',
posRole: 'Asignar a rol',
posRevenuePerHour: 'Ingresos / hora-trabajador ($)',
posRevenuePerHourPlaceholder: '50',
posShiftHours: 'Horas de turno promedio',
posShiftHoursPlaceholder: '8',
posSmoothing: 'Suavizado (días)',
posText: 'Pega CSV (fecha,ingresos,cubiertos,notas)',
posPreviewBtn: 'Previsualizar CSV',
posGenerateBtn: 'Generar {n} objetivos de demanda',
posGenerating: 'Generando…',
posDone: '{n} objetivos guardados desde datos POS',
posError: 'Error: {msg}',
posTooltip: 'Sube el CSV de ventas POS para calcular automáticamente cuántos trabajadores necesitas por día. El motor usa un promedio móvil para suavizar los ingresos y los convierte en personal requerido usando tu objetivo de ingresos por hora-trabajador.',
\`\`\`

2. ADD a new top-level \`weekCalendar\` key in the \`es\` object (after the \`scheduler\` key and before the \`analytics\` key):
\`\`\`
weekCalendar: {
  prevWeek: 'Semana anterior',
  nextWeek: 'Semana siguiente',
  today: 'Hoy',
  maximize: 'Pantalla completa',
  closeFullscreen: 'Salir de pantalla completa',
  noShifts: 'Sin turnos esta semana.',
  legend: 'Leyenda:',
  legendDraft: 'Borrador',
  legendPublished: 'Publicado',
  coverageMet: '{s}/{r} cubierto',
  coverageShort: '{s}/{r} con déficit',
},
\`\`\`

Output the COMPLETE updated file content only (no markdown fences).`
      }]
    }
  },

];

// ── Submit batch ──────────────────────────────────────────────────────────────

console.log(`Submitting batch with ${requests.length} requests...`);

const batch = await client.messages.batches.create({ requests });

console.log(`Batch ID: ${batch.id}`);
console.log(`Status:   ${batch.processing_status}`);

const meta = { batchId: batch.id, submittedAt: new Date().toISOString() };
writeFileSync(resolve(ROOT, 'scripts/chg040-batch-meta.json'), JSON.stringify(meta, null, 2));

console.log('\nMeta saved to scripts/chg040-batch-meta.json');
console.log('Run `node scripts/chg040-retrieve.mjs` to poll and write results.');
