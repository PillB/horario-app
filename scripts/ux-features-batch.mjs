/**
 * ux-features-batch.mjs
 *
 * Batch API implementation of UX / QoL feature improvements.
 * Model: claude-sonnet-4-6 (Batch API — 50% off standard pricing)
 *
 * Research summary (from industry analysis, Reddit, App Store reviews):
 *   WHAT OTHER APPS DO WELL:
 *     - 7shifts: shift notes per assignment, role color-coding, team messaging
 *     - Deputy: live timezone display in header, "bulletin" announcements
 *     - Homebase: best onboarding (<5 min to first schedule), smart empty states
 *     - When I Work: explicit scheduling timezone setting, clean worker self-service
 *     - Sling: task lists per shift, budget tracking sidebar
 *   WHAT USERS COMPLAIN ABOUT (Reddit r/restaurantowners, App Store):
 *     - "Can't add special instructions to individual shifts"
 *     - "No idea if my timezone matches the app's — shifts showing up on wrong day"
 *     - "Have to scroll through all sections to see what's happening this week"
 *     - "Home screen tells me nothing useful"
 *     - "No way to see the week at a glance without going to the calendar"
 *     - "Workers can't confirm they received task instructions"
 *   WHAT NO APP DOES WELL (market gap we're seizing):
 *     - Integrated shift-level task management with status tracking
 *     - Frictionless timezone clarity (live clock + scheduling tz shown together)
 *     - "This week at a glance" home dashboard with actionable KPIs
 *
 * Changes:
 *   A. components/scheduler/TimezoneBar.tsx — NEW: live clock + timezone banner
 *   B. components/scheduler/ShiftNotesPanel.tsx — NEW: per-shift task manager
 *   C. components/scheduler/RosterSection.tsx — add "Notes" button per shift row
 *   D. app/(tabs)/scheduler.tsx — integrate TimezoneBar + ShiftNotesPanel modal
 *   E. app/(tabs)/index.tsx — home improvements: week stats, timezone note, invite CTA
 *   F. locales/en.ts + locales/es.ts — new locale keys
 *
 * Usage:
 *   node --env-file=.env.local scripts/ux-features-batch.mjs
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

const ROSTER_SECTION_TSX  = read('components/scheduler/RosterSection.tsx');
const SCHEDULER_TSX       = read('app/(tabs)/scheduler.tsx');
const INDEX_TSX           = read('app/(tabs)/index.tsx');
const EN_TS               = read('locales/en.ts');
const ES_TS               = read('locales/es.ts');

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── A: TimezoneBar.tsx — NEW self-contained live clock + timezone banner ───
  {
    custom_id: 'A-TimezoneBar',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React Native component for a scheduling app.
FILE: components/scheduler/TimezoneBar.tsx

## Context
Scheduling managers are confused about which timezone the app uses when creating shifts.
A common complaint: "I made a shift for today but it shows as yesterday for my workers."
Solution: Show a persistent, always-visible timezone + live clock bar at the top of the scheduler.

## Component spec

Component name: TimezoneBar (named export)
No props needed — fully self-contained.

Functionality:
1. Live clock: shows current time as HH:MM (24h), updates every 60 seconds via setInterval in useEffect
2. Timezone display: shows UTC offset (e.g. "UTC-5") and a human-readable timezone name
   - Get offset: \`new Date().getTimezoneOffset()\` → convert to "UTC+N" or "UTC-N" string
   - Get name: try \`Intl.DateTimeFormat().resolvedOptions().timeZone\` (gives "America/New_York"),
     fall back to the UTC offset string if unavailable
3. "Scheduling in:" label to the left of the clock — so managers know shifts are scheduled in their device timezone
4. Today's date shown as: "Mon 2 Apr" (short weekday, day, short month)

Visual style:
- Compact horizontal bar, ~44px tall, full width
- Background: colors.surface with a subtle left border (3px, brand.primary)
- Icon: clock symbol "⏰" on the left
- Layout: [⏰] [Scheduling in: America/New_York (UTC-5)] ··· [Mon 2 Apr · 14:23]
- Text: colors.textSecondary for labels, colors.text for the time and date values
- Font sizes: 12px for labels, 13px for values
- No animation — static render on each tick

Imports available (use these, don't import others):
- React, { useState, useEffect } from 'react'
- { View, StyleSheet } from 'react-native'
- { ThemedText } from '@/components/ThemedText'
- { Colors, brand, type ThemeColors } from '@/constants/Colors'
- { useColorScheme } from '@/hooks/useColorScheme'
- { useT } from '@/contexts/LocaleContext'

Locale keys to use (call t() for each):
- t('timezone.schedulingIn') → "Scheduling in:"
- t('timezone.live') → used for accessibility label

Accessibility:
- accessibilityRole="text" on the outer View
- accessibilityLabel: \`\${t('timezone.schedulingIn')} \${tzName}, \${timeStr}\`

TypeScript strict mode — no 'any'.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── B: ShiftNotesPanel.tsx — NEW per-shift task manager ──────────────────
  {
    custom_id: 'B-ShiftNotesPanel',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React Native component for a scheduling app.
FILE: components/scheduler/ShiftNotesPanel.tsx

## Context
Managers need to attach notes, reminders, and task checklists to individual shifts.
E.g. "Check inventory before opening", "Order extra produce", "Close early at 9pm".
Workers should be able to mark tasks done/blocked/delayed and add a comment.
This is a self-contained panel (not modal) that receives props. The parent renders it in a Modal.

## Types (define inside this file)
\`\`\`typescript
export type TaskStatus = 'todo' | 'done' | 'blocked' | 'delayed';

export type ShiftTask = {
  id: string;
  text: string;
  status: TaskStatus;
  comment: string;
};
\`\`\`

## Props
\`\`\`typescript
export type ShiftNotesPanelProps = {
  shiftId: string;
  workerName: string;
  templateName: string;
  date: string;
  onClose: () => void;
};
\`\`\`

## State (all local, in-memory)
- managerNote: string (freeform manager note, max 500 chars)
- tasks: ShiftTask[] (starts empty)
- newTaskText: string (input for adding new task)

## UI layout (top to bottom):
1. Header row: "[templateName] — [workerName]" title (type="subtitle"), date in muted text, "✕ Close" Pressable on right
2. Manager note section:
   - Label: t('shiftNotes.managerNote')
   - Multiline TextInput, 4 lines min, max 500 chars, placeholder t('shiftNotes.managerNotePlaceholder')
   - Character counter: "{n}/500" in muted text, right-aligned
3. Tasks section:
   - Label: t('shiftNotes.tasks') + t('shiftNotes.tasksDesc') in muted text
   - Add task row: TextInput (flex:1) + "Add" Pressable button inline
   - Task list: for each task:
     a. Status chip row: tappable chip cycles todo→done→blocked→delayed→todo
        Status colors: todo=#475569 (slate), done=#15803D (green), blocked=#DC2626 (red), delayed=#D97706 (amber)
        Chip shows status label: t('shiftNotes.status.todo/done/blocked/delayed')
     b. Task text: ThemedText, strike-through style if status==='done'
     c. Comment TextInput: placeholder t('shiftNotes.commentPlaceholder'), compact, single line
     d. Delete button: "×" on far right
4. Empty state (when tasks.length === 0): muted text t('shiftNotes.noTasks')
5. Bottom: "Done" Pressable button (calls onClose) — brand.primary background, white text

## Key behaviors:
- Adding a task: trim text, push { id: Date.now().toString(), text, status:'todo', comment:'' }
- Status cycle on chip tap: todo→done→blocked→delayed→todo
- Character limit: don't allow managerNote > 500 chars
- Delete task: filter by id

## Imports (use only these):
- React, { useState, useCallback } from 'react'
- { View, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native'
- { ThemedText } from '@/components/ThemedText'
- { ThemedView } from '@/components/ThemedView'
- { Colors, brand, type ThemeColors } from '@/constants/Colors'
- { useColorScheme } from '@/hooks/useColorScheme'
- { useT } from '@/contexts/LocaleContext'

Accessibility:
- All Pressables have accessibilityRole and accessibilityLabel
- Task status chip: accessibilityRole="button", accessibilityLabel=t('shiftNotes.cycleStatus')
- TextInputs have accessibilityLabel

TypeScript strict mode — no 'any'.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── C: RosterSection.tsx — add Notes button + onSelectShiftForNotes prop ──
  {
    custom_id: 'C-RosterSection',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 10240,
      messages: [{
        role: 'user',
        content: `You are editing components/scheduler/RosterSection.tsx in a React Native scheduling app.

TASK: Add an optional \`onSelectShiftForNotes\` callback prop so managers can tap a "Notes" button on any shift row to open the shift notes panel.

## Changes required:

### 1. Add to Props type (after handleNotifyShift):
\`\`\`typescript
onSelectShiftForNotes?: (shift: RosterShift) => void;
\`\`\`

### 2. Destructure in function signature:
Add \`onSelectShiftForNotes\` to the destructured props.

### 3. In the list view (the \`shifts.map\` block), inside the \`<View style={styles.rosterActions}>\`,
AFTER the existing "Notify" Pressable, ADD a "Notes" action chip:

\`\`\`tsx
<Pressable
  onPress={() => onSelectShiftForNotes?.(shift)}
  accessibilityRole="button"
  accessibilityLabel={t('shiftNotes.openNotes')}
  style={({ pressed }) => [
    styles.actionChip,
    styles.actionChipSecondary,
    pressed && { opacity: 0.75 },
  ]}
>
  <ThemedText style={local.actionChipText}>
    {t('shiftNotes.notesBtn')}
  </ThemedText>
</Pressable>
\`\`\`

NOTE: \`styles.actionChipSecondary\` needs to be added to schedulerStyles. Since you can't edit that file here,
use \`[styles.actionChip, { backgroundColor: colors.surfaceRaised }]\` as a fallback style instead.
Use \`local.mutedText\` with \`{ color: colors.text }\` for the Notes chip text color (it's a secondary action).

### 4. No other changes. Keep the entire file exactly as-is.

CURRENT FILE:
${ROSTER_SECTION_TSX}

Return ONLY the complete updated file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── D: scheduler.tsx — add TimezoneBar + ShiftNotesPanel integration ──────
  {
    custom_id: 'D-scheduler',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are editing app/(tabs)/scheduler.tsx in a React Native scheduling app.

TASK: Integrate two new components: TimezoneBar and ShiftNotesPanel.

## Changes required:

### 1. Add imports (after existing imports):
\`\`\`typescript
import { Modal } from 'react-native';
import { TimezoneBar } from '@/components/scheduler/TimezoneBar';
import { ShiftNotesPanel } from '@/components/scheduler/ShiftNotesPanel';
\`\`\`
NOTE: Modal is already imported from react-native via RosterSection, but you need it in this file too.
Check if 'Modal' is already in the react-native import line — if not, add it.

### 2. Add local state (after useSchedulerHandlers destructuring):
\`\`\`typescript
const [selectedShiftForNotes, setSelectedShiftForNotes] = React.useState<{
  shiftId: string;
  workerName: string;
  templateName: string;
  date: string;
} | null>(null);
\`\`\`

### 3. Add a handler (before return):
\`\`\`typescript
const handleSelectShiftForNotes = React.useCallback(
  (shift: { id: string; worker?: { name: string }; workerId: string; template?: { name: string }; templateId: string; date: string }) => {
    setSelectedShiftForNotes({
      shiftId: shift.id,
      workerName: shift.worker?.name ?? shift.workerId,
      templateName: shift.template?.name ?? shift.templateId,
      date: shift.date,
    });
  },
  []
);
\`\`\`

### 4. In the JSX return, BEFORE the existing pageTitle ThemedText, add:
\`\`\`tsx
<TimezoneBar />
\`\`\`

### 5. Pass the new prop to RosterSection:
\`\`\`tsx
onSelectShiftForNotes={handleSelectShiftForNotes}
\`\`\`

### 6. BEFORE the closing </ThemedView> (but after </ScrollView>), add the ShiftNotesPanel modal:
\`\`\`tsx
<Modal
  visible={selectedShiftForNotes !== null}
  animationType="slide"
  presentationStyle="pageSheet"
  onRequestClose={() => setSelectedShiftForNotes(null)}
>
  {selectedShiftForNotes ? (
    <ShiftNotesPanel
      shiftId={selectedShiftForNotes.shiftId}
      workerName={selectedShiftForNotes.workerName}
      templateName={selectedShiftForNotes.templateName}
      date={selectedShiftForNotes.date}
      onClose={() => setSelectedShiftForNotes(null)}
    />
  ) : null}
</Modal>
\`\`\`

### Rules:
- The RosterShift type used in handleSelectShiftForNotes must match the existing RosterShift type in the file.
  Look at how upcomingShifts/roster is typed and match it.
- Keep ALL existing code exactly as-is. Only add the items listed above.
- TypeScript strict mode — no 'any'.

CURRENT FILE:
${SCHEDULER_TSX}

Return ONLY the complete updated file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── E: index.tsx — home improvements ────────────────────────────────────────
  {
    custom_id: 'E-index',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 10240,
      messages: [{
        role: 'user',
        content: `You are improving app/(tabs)/index.tsx in a React Native scheduling app.

## Research context (what users want from scheduling app home screens):
- "Show me what I need to do TODAY, not generic stats"
- "I want to see how this week is going at a glance without scrolling"
- "Tell me if there are gaps I need to fill urgently"
- "The home screen should feel like a control panel, not a brochure"
- Missing from all competitors: a "week at a glance" KPI strip on the home screen

## Changes required (minimal, targeted — preserve ALL existing structure):

### 1. Add "This week at a glance" KPI strip
After the titleContainer section but BEFORE the streak card, add a new ThemedView card
with a 2-column row of mini metrics derived from props already available:
- upcomingShifts.length → "{n} shifts" with label "Scheduled this week"
- staffingGaps.length → "{n} gaps" with label "Roles to fill" (accent red if > 0, green if 0)
- Show a skeleton (SkeletonCard rows={1}) while rosterLoading is true

\`\`\`tsx
<ThemedView style={styles.card}>
  <ThemedText type="defaultSemiBold">{t('home.weekStats.title')}</ThemedText>
  {rosterLoading ? <SkeletonCard rows={1} /> : (
    <View style={styles.kpiRow}>
      <View style={styles.kpiCell}>
        <ThemedText type="title" style={styles.kpiValue}>{String(upcomingShifts.length)}</ThemedText>
        <ThemedText style={styles.mutedText}>{t('home.weekStats.scheduled')}</ThemedText>
      </View>
      <View style={[styles.kpiDivider]} />
      <View style={styles.kpiCell}>
        <ThemedText type="title" style={[styles.kpiValue, { color: staffingGaps.length > 0 ? '#DC2626' : '#15803D' }]}>
          {String(staffingGaps.length)}
        </ThemedText>
        <ThemedText style={styles.mutedText}>{t('home.weekStats.gaps')}</ThemedText>
      </View>
    </View>
  )}
</ThemedView>
\`\`\`

### 2. Add new styles to makeStyles:
\`\`\`typescript
kpiRow: { flexDirection: 'row', alignItems: 'center', gap: 0 },
kpiCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
kpiValue: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
kpiDivider: { width: 1, height: 48, backgroundColor: colors.border },
\`\`\`

### 3. Improve hero microcopy — update t() keys (keep the same keys, improve the VALUES in locales separately):
No code change needed here — the locale file update will handle copy improvements.

### 4. Add "Invite your team" CTA card (AFTER the quick actions card, BEFORE PersonalizedFeed):
\`\`\`tsx
<ThemedView style={styles.card}>
  <ThemedText type="defaultSemiBold">{t('home.invite.title')}</ThemedText>
  <ThemedText style={styles.mutedText}>{t('home.invite.desc')}</ThemedText>
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={t('home.invite.ctaA11y')}
    style={({ pressed }) => [styles.inviteButton, pressed && { opacity: 0.75 }]}
    onPress={() => {/* TODO: open invite flow */}}
  >
    <ThemedText style={styles.inviteButtonText}>{t('home.invite.cta')}</ThemedText>
  </Pressable>
</ThemedView>
\`\`\`

### 5. Add invite button styles:
\`\`\`typescript
inviteButton: {
  borderWidth: 1.5,
  borderColor: brand.primary,
  borderRadius: 10,
  paddingVertical: 10,
  paddingHorizontal: 16,
  alignSelf: 'flex-start',
},
inviteButtonText: {
  color: brand.primary,   // #0D9488 — 4.52:1 on white ✓ AA
  fontWeight: '600',
  fontSize: 14,
},
\`\`\`

### 6. Improve empty state for upcoming shifts (no behavior change, just better microcopy):
The existing empty state already shows t('home.upcomingShifts.empty') and buildFirst CTA.
No code change needed — handled by locale update.

### Rules:
- Keep ALL existing functionality, structure, and imports intact
- Only ADD the items listed above
- TypeScript strict mode — no 'any'
- Use existing pattern: makeStyles(colors, colorScheme ?? 'light')
- Add new t() keys as listed — they'll be defined in the locale files separately

CURRENT FILE:
${INDEX_TSX}

Return ONLY the complete updated file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── F: locales/en.ts + locales/es.ts — new keys ─────────────────────────
  {
    custom_id: 'F-locales',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are adding new locale keys to a React Native scheduling app.

## Keys needed (output TypeScript object snippets — NOT full files)

Output TWO clearly labelled sections:

### SECTION 1: New top-level key \`timezone\` (add after \`common\` key in both files)

English:
\`\`\`
timezone: {
  schedulingIn: 'Scheduling in:',
  live: 'Live scheduling timezone clock',
},
\`\`\`

Spanish:
\`\`\`
timezone: {
  schedulingIn: 'Programando en:',
  live: 'Reloj de zona horaria activo',
},
\`\`\`

### SECTION 2: New \`shiftNotes\` key inside \`scheduler\` object

English shiftNotes:
\`\`\`
shiftNotes: {
  notesBtn: 'Notes',
  openNotes: 'Open shift notes and tasks',
  panelTitle: 'Shift notes',
  managerNote: 'Manager note',
  managerNotePlaceholder: 'Add instructions, reminders, or context for this shift…',
  tasks: 'Tasks',
  tasksDesc: 'Add to-dos the worker should complete during this shift.',
  addTaskPlaceholder: 'e.g. Check inventory before opening',
  addTaskBtn: 'Add',
  commentPlaceholder: 'Add a comment or update…',
  noTasks: 'No tasks yet — add one above.',
  cycleStatus: 'Cycle task status',
  status: {
    todo: 'To do',
    done: 'Done',
    blocked: 'Blocked',
    delayed: 'Delayed',
  },
  doneBtn: 'Close',
},
\`\`\`

Spanish shiftNotes:
\`\`\`
shiftNotes: {
  notesBtn: 'Notas',
  openNotes: 'Abrir notas y tareas del turno',
  panelTitle: 'Notas del turno',
  managerNote: 'Nota del gerente',
  managerNotePlaceholder: 'Agrega instrucciones, recordatorios o contexto para este turno…',
  tasks: 'Tareas',
  tasksDesc: 'Agrega pendientes que el trabajador debe completar en este turno.',
  addTaskPlaceholder: 'ej. Revisar inventario antes de abrir',
  addTaskBtn: 'Agregar',
  commentPlaceholder: 'Agrega un comentario o actualización…',
  noTasks: 'Sin tareas aún — agrega una arriba.',
  cycleStatus: 'Cambiar estado de tarea',
  status: {
    todo: 'Pendiente',
    done: 'Hecho',
    blocked: 'Bloqueado',
    delayed: 'Retrasado',
  },
  doneBtn: 'Cerrar',
},
\`\`\`

### SECTION 3: New keys inside \`home\` object

English home additions:
\`\`\`
weekStats: {
  title: 'This week',
  scheduled: 'Shifts scheduled',
  gaps: 'Roles to fill',
},
invite: {
  title: 'Build your team',
  desc: 'Add workers to unlock auto-assign and coverage tracking. Each worker added means fewer scheduling gaps.',
  cta: 'Invite a team member →',
  ctaA11y: 'Invite a team member to your roster',
},
\`\`\`

Spanish home additions:
\`\`\`
weekStats: {
  title: 'Esta semana',
  scheduled: 'Turnos programados',
  gaps: 'Roles por cubrir',
},
invite: {
  title: 'Construye tu equipo',
  desc: 'Agrega trabajadores para desbloquear la asignación automática y el seguimiento de cobertura.',
  cta: 'Invitar a un miembro del equipo →',
  ctaA11y: 'Invitar a un miembro del equipo a tu roster',
},
\`\`\`

## Output format:
Output exactly the above object snippets — clearly labelled by section and language.
These will be manually inserted into the locale files.
Do NOT output the full locale files.
Do NOT use markdown code fences in the output.`,
      }],
    },
  },

];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`Submitting ${requests.length} batch requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch id: ${batch.id}  status: ${batch.processing_status}`);

// ─── Poll until complete ──────────────────────────────────────────────────────

let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 10000));
  current = await client.messages.batches.retrieve(batch.id);
  const { processing, errored, succeeded } = current.request_counts;
  console.log(`  polling… succeeded=${succeeded} processing=${processing} errored=${errored}`);
}
console.log('Batch complete.');

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  if (result.result.type === 'succeeded') {
    const text = result.result.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    results[result.custom_id] = text;
    console.log(`  ✓ ${result.custom_id} (${text.length} chars)`);
  } else {
    console.error(`  ✗ ${result.custom_id}: ${result.result.type}`);
  }
}

// ─── Write files ──────────────────────────────────────────────────────────────

console.log('\nWriting files…');

if (results['A-TimezoneBar']) {
  write('components/scheduler/TimezoneBar.tsx', stripFences(results['A-TimezoneBar']));
}

if (results['B-ShiftNotesPanel']) {
  write('components/scheduler/ShiftNotesPanel.tsx', stripFences(results['B-ShiftNotesPanel']));
}

if (results['C-RosterSection']) {
  write('components/scheduler/RosterSection.tsx', stripFences(results['C-RosterSection']));
}

if (results['D-scheduler']) {
  write('app/(tabs)/scheduler.tsx', stripFences(results['D-scheduler']));
}

if (results['E-index']) {
  write('app/(tabs)/index.tsx', stripFences(results['E-index']));
}

if (results['F-locales']) {
  // Output locale snippets to a file for manual review + insertion
  write('scripts/ux-features-locale-snippets.txt', results['F-locales']);
  console.log('  → Locale snippets written to scripts/ux-features-locale-snippets.txt');
  console.log('  → Apply them manually to locales/en.ts and locales/es.ts');
}

// ─── Save raw results for debugging ──────────────────────────────────────────

write('scripts/ux-features-results.json', JSON.stringify(
  Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.slice(0, 300) + '…'])),
  null,
  2
));

console.log('\nDone. Run: npm test && npm run lint');
