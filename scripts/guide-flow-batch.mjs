/**
 * guide-flow-batch.mjs
 *
 * Batches 6 requests to claude-sonnet-4-6 via the Batch API to implement:
 *   1. tour-context   — WelcomeTourContext.tsx (new step arrays, tour modes, interactive hints)
 *   2. tour-spotlight — TourSpotlight.tsx (guide mode picker, cross-tab nav, hint chips)
 *   3. home-targets   — app/(tabs)/index.tsx (TourStep wrappers for all home sections)
 *   4. analytics-targets — app/(tabs)/explore.tsx (TourStep wrappers for all analytics sections)
 *   5. layout-profile — app/(tabs)/_layout.tsx (Profile tab) + app/(tabs)/profile.tsx (Guide section)
 *   6. locale-guide   — locales/en.ts tour additions + snippet for all 8 other languages
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── File helpers ─────────────────────────────────────────────────────────────

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function write(rel, content) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|javascript|js|json)?\r?\n/gm, '')
    .replace(/^```\r?\n/gm, '')
    .replace(/^```$/gm, '')
    .trim();
}

// ─── Split multi-file response ────────────────────────────────────────────────

function splitFiles(raw) {
  const result = {};
  const parts = raw.split(/^===FILE_\d+:\s*/m).filter(Boolean);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl === -1) continue;
    const filePath = part.slice(0, nl).trim();
    const content = stripFences(part.slice(nl + 1).trim());
    if (filePath && content) result[filePath] = content;
  }
  return result;
}

// ─── Read source files ────────────────────────────────────────────────────────

const WELCOME_TOUR_CTX = read('contexts/WelcomeTourContext.tsx');
const TOUR_SPOTLIGHT = read('components/TourSpotlight.tsx');
const HOME_TAB = read('app/(tabs)/index.tsx');
const EXPLORE_TAB = read('app/(tabs)/explore.tsx');
const LAYOUT = read('app/(tabs)/_layout.tsx');
const PROFILE = read('app/(tabs)/profile.tsx');
const LOCALE_EN_TAIL = (() => {
  const full = read('locales/en.ts');
  // Return last ~100 lines for context on the tour namespace
  const lines = full.split('\n');
  return lines.slice(Math.max(0, lines.length - 100)).join('\n');
})();

// ─── Requests ─────────────────────────────────────────────────────────────────

const REQUESTS = [
  // ── 1. tour-context ──────────────────────────────────────────────────────
  {
    custom_id: 'tour-context',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Rewrite contexts/WelcomeTourContext.tsx to add multi-mode guide flows.

## Current file:
\`\`\`tsx
${WELCOME_TOUR_CTX}
\`\`\`

## Requirements:

### 1. Extend TourStepMeta:
\`\`\`typescript
export type TourStepMeta = {
  id: number;
  target: string;
  requiresAction?: boolean;
  /** Which tab this step lives on — used for cross-tab navigation prompts */
  tab?: 'home' | 'scheduler' | 'analytics';
  /** Shown as a 💡 chip in the callout card to guide interactive field filling */
  interactiveHint?: string;
};
\`\`\`

### 2. Add TourMode type:
\`\`\`typescript
export type TourMode = 'overview' | 'manager' | 'worker' | 'home' | 'scheduler' | 'analytics';
\`\`\`

### 3. New step arrays to add (keep existing MANAGER_STEPS and WORKER_STEPS as-is):

\`\`\`typescript
/** 5-step overview: one highlight per app section, no required actions */
export const OVERVIEW_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header', tab: 'home' },
  { id: 2, target: 'streak-counter', tab: 'home' },
  { id: 3, target: 'workers-section', tab: 'scheduler' },
  { id: 4, target: 'demand-section', tab: 'scheduler' },
  { id: 5, target: 'analytics-kpis', tab: 'analytics' },
] as const;

/** 6-step Home tab detail tour */
export const HOME_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header', tab: 'home' },
  { id: 2, target: 'week-stats', tab: 'home' },
  { id: 3, target: 'streak-counter', tab: 'home' },
  { id: 4, target: 'upcoming-shifts', tab: 'home' },
  { id: 5, target: 'staffing-gaps', tab: 'home' },
  { id: 6, target: 'quick-actions', tab: 'home' },
] as const;

/** 5-step Scheduler tab detail tour with interactive hints */
export const SCHEDULER_DETAIL_STEPS: readonly TourStepMeta[] = [
  {
    id: 1,
    target: 'workers-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Enter a worker name, role, and skills — then tap "Add worker" to continue',
  },
  {
    id: 2,
    target: 'availability-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Select a day (e.g. Mon), enter From: 09:00, To: 17:00 — then tap "Add availability"',
  },
  {
    id: 3,
    target: 'shift-templates-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Enter a template name, role, start/end times, and coverage count — then tap "Add template"',
  },
  {
    id: 4,
    target: 'roster-section',
    tab: 'scheduler',
    requiresAction: true,
    interactiveHint: 'Pick a worker, pick a template, enter a date (YYYY-MM-DD) — then tap "Save and notify team"',
  },
  {
    id: 5,
    target: 'demand-section',
    tab: 'scheduler',
    interactiveHint: 'Try entering a role, start date, and daily demand — then tap "Save baseline targets"',
  },
] as const;

/** 4-step Analytics tab detail tour */
export const ANALYTICS_DETAIL_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'analytics-kpis', tab: 'analytics' },
  { id: 2, target: 'analytics-revenue', tab: 'analytics' },
  { id: 3, target: 'analytics-hours', tab: 'analytics' },
  { id: 4, target: 'analytics-fairness', tab: 'analytics' },
] as const;
\`\`\`

### 4. Add tourMode to state:
\`\`\`typescript
type TourState = {
  isActive: boolean;
  currentStepIndex: number;
  hasCompleted: boolean;
  stepLayouts: Record<string, StepLayout>;
  userRole: 'manager' | 'worker' | null;
  completedActions: string[];
  tourMode: TourMode | null;  // NEW
};
\`\`\`

### 5. Add new action to TourAction union:
\`\`\`typescript
| { type: 'START_TOUR_MODE'; payload: TourMode }
\`\`\`

### 6. Extend context value:
Add to WelcomeTourContextValue:
- \`tourMode: TourMode | null\`
- \`startTourMode: (mode: TourMode) => void\`

### 7. stepsForMode helper:
\`\`\`typescript
function stepsForMode(mode: TourMode | null, role: 'manager' | 'worker' | null): readonly TourStepMeta[] {
  switch (mode) {
    case 'overview': return OVERVIEW_STEPS;
    case 'home': return HOME_DETAIL_STEPS;
    case 'scheduler': return SCHEDULER_DETAIL_STEPS;
    case 'analytics': return ANALYTICS_DETAIL_STEPS;
    case 'manager': return MANAGER_STEPS;
    case 'worker': return WORKER_STEPS;
    default:
      // Legacy fallback when mode is null but role is set
      if (role === 'worker') return WORKER_STEPS;
      return MANAGER_STEPS;
  }
}
\`\`\`

### 8. Update reducer START_TOUR_MODE case:
\`\`\`typescript
case 'START_TOUR_MODE':
  return {
    ...state,
    isActive: true,
    currentStepIndex: 0,
    tourMode: action.payload,
    completedActions: [],
    // Keep userRole unchanged — it may already be set
  };
\`\`\`

### 9. Update currentSteps derivation:
\`\`\`typescript
const currentSteps = useMemo(
  () => stepsForMode(state.tourMode, state.userRole),
  [state.tourMode, state.userRole],
);
\`\`\`

### 10. Update NEXT_STEP to use stepsForMode:
Replace all calls to \`stepsForRole\` with \`stepsForMode\`.

### 11. Add startTourMode action:
\`\`\`typescript
const startTourMode = useCallback(
  (mode: TourMode) => {
    dispatch({ type: 'START_TOUR_MODE', payload: mode });
    // For manager/worker modes, persist the role
    if (mode === 'manager') persistRole('manager');
    if (mode === 'worker') persistRole('worker');
  },
  [persistRole],
);
\`\`\`

### 12. Update currentStep derivation:
currentStep should work even when tourMode !== null and userRole === null (for overview, home, scheduler, analytics modes).

\`\`\`typescript
const currentStep: TourStepMeta | null = useMemo(() => {
  // Allow steps without a role for mode-based tours
  if (!state.isActive) return null;
  return currentSteps[state.currentStepIndex] ?? null;
}, [state.isActive, state.currentStepIndex, currentSteps]);
\`\`\`

### 13. Also update canAdvance so it works when userRole is null for mode-based tours:
\`\`\`typescript
const canAdvance = useMemo(() => {
  if (!currentStep) return false;
  if (!currentStep.requiresAction) return true;
  return state.completedActions.includes(currentStep.target);
}, [currentStep, state.completedActions]);
\`\`\`

### Important:
- Keep all existing exports (MANAGER_STEPS, WORKER_STEPS, TOUR_STEPS, useWelcomeTour, WelcomeTourProvider)
- Keep backward compat for all existing consumers
- tourMode starts as null in initialState
- Export TourMode type

Output the complete file, no truncation. Return ONLY the TypeScript file content with no markdown fences.`,
      }],
    },
  },

  // ── 2. tour-spotlight ────────────────────────────────────────────────────
  {
    custom_id: 'tour-spotlight',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Rewrite components/TourSpotlight.tsx to support multi-mode guide flows with a GuideModePicker, cross-tab navigation for all tabs, and interactive hint chips.

## Current file:
\`\`\`tsx
${TOUR_SPOTLIGHT}
\`\`\`

## Changes required:

### 1. GuideModePicker replaces RoleSelectionModal
The condition \`userRole === null\` showed a role selection modal. Now use \`tourMode === null\` to show a **GuideModePicker** instead. This picker shows:

**Language row** (unchanged — keep existing horizontal scroll chip row)

**Divider**

**Section label**: "Choose a guide"

**6 mode buttons** in a 2-column grid layout:
\`\`\`
[ 🗺️ Quick Overview ] [ 📋 Manager Tour   ]
[ 👷 Team Member Tour] [ 🏠 Home Tab Guide ]
[ 📅 Scheduler Guide ] [ 📊 Analytics Guide]
\`\`\`

Each button shows:
- Emoji + title (bold, 15px)
- One-line description (13px, muted)
- onPress calls startTourMode(mode)

Mode buttons:
- overview → t('tour.mode.overview') / t('tour.mode.overviewDesc')
- manager → t('tour.mode.manager') / t('tour.mode.managerDesc')
- worker → t('tour.mode.worker') / t('tour.mode.workerDesc')
- home → t('tour.mode.home') / t('tour.mode.homeDesc')
- scheduler → t('tour.mode.scheduler') / t('tour.mode.schedulerDesc')
- analytics → t('tour.mode.analytics') / t('tour.mode.analyticsDesc')

Remove the separate RoleSelectionModal function entirely. The GuideModePicker handles both first-launch and repeat launches.

### 2. Import startTourMode from context:
\`\`\`typescript
const { ..., startTourMode, tourMode } = useWelcomeTour();
\`\`\`

### 3. Cross-tab navigation for ALL tabs (not just scheduler):
Currently only handles scheduler. Extend to handle all three tabs:

\`\`\`typescript
const SCHEDULER_TARGETS = new Set([
  'workers-section', 'availability-section', 'shift-templates-section',
  'roster-section', 'demand-section',
]);
const HOME_TARGETS = new Set([
  'home-header', 'week-stats', 'streak-counter',
  'upcoming-shifts', 'staffing-gaps', 'quick-actions',
]);
const ANALYTICS_TARGETS = new Set([
  'analytics-kpis', 'analytics-revenue', 'analytics-hours', 'analytics-fairness',
]);

function tabForTarget(target: string): string | null {
  if (SCHEDULER_TARGETS.has(target)) return '/(tabs)/scheduler';
  if (HOME_TARGETS.has(target)) return '/';
  if (ANALYTICS_TARGETS.has(target)) return '/(tabs)/explore';
  return null;
}

function tabNameForTarget(target: string, t: (key: string) => string): string {
  if (SCHEDULER_TARGETS.has(target)) return t('nav.scheduler');
  if (HOME_TARGETS.has(target)) return t('nav.home');
  if (ANALYTICS_TARGETS.has(target)) return t('nav.analytics');
  return '';
}
\`\`\`

The "wrong screen" detection:
\`\`\`typescript
const targetTab = currentStep ? tabForTarget(currentStep.target) : null;
const isOnWrongScreen =
  requiresActionAndBlocked === false && // Only for non-action steps (action steps have their own prompt)
  currentStep !== null &&
  targetTab !== null &&
  rawLayout === null && // Element not yet measured (not on this screen)
  !pathMatchesTab(pathname, targetTab);
\`\`\`

Wait, actually: even non-requiresAction steps need cross-tab nav if not on the right screen. Use:
\`\`\`typescript
const isOnWrongScreen =
  currentStep !== null &&
  targetTab !== null &&
  rawLayout === null &&
  !pathMatchesTab(pathname, targetTab);

function pathMatchesTab(pathname: string, tabPath: string): boolean {
  if (tabPath === '/') return pathname === '/' || pathname.endsWith('/index');
  return pathname.includes(tabPath.replace('/(tabs)/', ''));
}
\`\`\`

The "Go to [Tab]" button text: "Go to [tabName] →" using t('tour.nav.goToTab', { tab: tabName })

### 4. Interactive hint chip:
When currentStep.interactiveHint is set, show a chip below the description:
\`\`\`tsx
{currentStep?.interactiveHint ? (
  <View style={styles.hintChip}>
    <ThemedText style={styles.hintChipText}>
      💡 {currentStep.interactiveHint}
    </ThemedText>
  </View>
) : null}
\`\`\`

Style for hintChip:
\`\`\`
backgroundColor: brand.primary + '14',
borderRadius: 8,
padding: 10,
marginBottom: 10,
borderLeftWidth: 3,
borderLeftColor: brand.primary,
\`\`\`

Style for hintChipText:
\`\`\`
fontSize: 13,
color: brand.primaryDeep,
lineHeight: 20,
\`\`\`

### 5. Show GuideModePicker when tourMode === null (not userRole === null):
\`\`\`typescript
if (!isActive) return null;
if (tourMode === null) {
  return <GuideModePicker colors={colors} />;
}
if (!currentStep) return null;
// ... rest of spotlight rendering
\`\`\`

### 6. Role badge — update to show tourMode label instead of role:
\`\`\`typescript
const modeBadgeText = (() => {
  switch (tourMode) {
    case 'overview': return '🗺️ Overview';
    case 'manager': return '👔 Manager';
    case 'worker': return '👷 Team Member';
    case 'home': return '🏠 Home';
    case 'scheduler': return '📅 Scheduler';
    case 'analytics': return '📊 Analytics';
    default: return null;
  }
})();
\`\`\`

### 7. Step title/desc keys — use tourMode for key path:
\`\`\`typescript
const modeKey = tourMode ?? (userRole === 'worker' ? 'worker' : 'manager');
const stepTitle = currentStep ? t(\`tour.\${modeKey}.step\${stepId}.title\`) : '';
const stepDesc = currentStep ? t(\`tour.\${modeKey}.step\${stepId}.desc\`) : '';
const stepWhy = currentStep ? t(\`tour.\${modeKey}.step\${stepId}.why\`) : '';
\`\`\`

For backward compat:
- mode 'manager' → key path: tour.manager.stepN.title (existing)
- mode 'worker' → key path: tour.worker.stepN.title (existing)
- mode 'overview' → key path: tour.overview.stepN.title (new)
- mode 'home' → key path: tour.home.stepN.title (new)
- mode 'scheduler' → key path: tour.scheduler.stepN.title (new)
- mode 'analytics' → key path: tour.analytics.stepN.title (new)

### 8. GuideModePicker component (new):
\`\`\`typescript
function GuideModePicker({ colors }: { colors: ThemeColors }) {
  const { startTourMode } = useWelcomeTour();
  const { t, langCode, setLanguage } = useT();
  const styles = makeStyles(colors);

  const modes: Array<{
    mode: TourMode;
    emoji: string;
    title: string;
    desc: string;
  }> = [
    { mode: 'overview', emoji: '🗺️', title: t('tour.mode.overview'), desc: t('tour.mode.overviewDesc') },
    { mode: 'manager', emoji: '📋', title: t('tour.mode.manager'), desc: t('tour.mode.managerDesc') },
    { mode: 'worker', emoji: '👷', title: t('tour.mode.worker'), desc: t('tour.mode.workerDesc') },
    { mode: 'home', emoji: '🏠', title: t('tour.mode.home'), desc: t('tour.mode.homeDesc') },
    { mode: 'scheduler', emoji: '📅', title: t('tour.mode.scheduler'), desc: t('tour.mode.schedulerDesc') },
    { mode: 'analytics', emoji: '📊', title: t('tour.mode.analytics'), desc: t('tour.mode.analyticsDesc') },
  ];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.roleBackdrop}>
        <ScrollView contentContainerStyle={styles.roleScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.roleCard}>
            {/* Language picker — unchanged from existing */}
            ...existing language chip row...

            <View style={styles.roleDivider} />

            <ThemedText style={styles.roleTitle}>{t('tour.mode.pickTitle')}</ThemedText>
            <ThemedText style={styles.roleDesc}>{t('tour.mode.pickDesc')}</ThemedText>

            {/* 2-column grid of mode buttons */}
            <View style={styles.modeGrid}>
              {modes.map(({ mode, emoji, title, desc }) => (
                <Pressable
                  key={mode}
                  onPress={() => startTourMode(mode)}
                  accessibilityRole="button"
                  accessibilityLabel={title}
                  style={({ pressed }) => [styles.modeButton, pressed && styles.modeButtonPressed]}
                >
                  <ThemedText style={styles.modeEmoji}>{emoji}</ThemedText>
                  <ThemedText style={styles.modeTitle}>{title}</ThemedText>
                  <ThemedText style={styles.modeDesc}>{desc}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
\`\`\`

Grid styles:
\`\`\`
modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }
modeButton: { width: '47%', borderWidth: 1.5, borderColor: brand.primary + '55', borderRadius: 12, padding: 12, gap: 4 }
modeButtonPressed: { backgroundColor: brand.primary + '14' }
modeEmoji: { fontSize: 22, marginBottom: 2 }
modeTitle: { fontSize: 13, fontWeight: '700', color: brand.primaryDeep, lineHeight: 18 }
modeDesc: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 }
\`\`\`

### 9. Import TourMode from context:
\`\`\`typescript
import { useWelcomeTour, type TourMode } from '@/contexts/WelcomeTourContext';
\`\`\`

Output the complete file without truncation. Return ONLY the TSX file content with no markdown fences.`,
      }],
    },
  },

  // ── 3. home-targets ──────────────────────────────────────────────────────
  {
    custom_id: 'home-targets',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Add TourStep wrappers to app/(tabs)/index.tsx for the Home tab detail tour.

## Current file:
\`\`\`tsx
${HOME_TAB}
\`\`\`

## Add these 4 TourStep wrappers (TourStep is already imported):

1. **week-stats** — wrap the ThemedView at line ~75 that contains the kpiRow (week statistics card):
   \`\`\`tsx
   <TourStep target="week-stats">
     <ThemedView style={styles.card}>
       ...kpi content...
     </ThemedView>
   </TourStep>
   \`\`\`

2. **upcoming-shifts** — wrap the ThemedView that shows upcomingShifts (around line ~110):
   \`\`\`tsx
   <TourStep target="upcoming-shifts">
     <ThemedView style={styles.card}>
       <ThemedText type="subtitle">{t('home.upcomingShifts.title')}</ThemedText>
       ...
     </ThemedView>
   </TourStep>
   \`\`\`

3. **staffing-gaps** — wrap the ThemedView that shows staffingGaps (around line ~140):
   \`\`\`tsx
   <TourStep target="staffing-gaps">
     <ThemedView style={styles.card}>
       <ThemedText type="subtitle">{t('home.staffingGaps.title')}</ThemedText>
       ...
     </ThemedView>
   </TourStep>
   \`\`\`

4. **quick-actions** — wrap the ThemedView with the 3 quick action buttons (around line ~167):
   \`\`\`tsx
   <TourStep target="quick-actions">
     <ThemedView style={styles.card}>
       <ThemedText type="subtitle">{t('home.quickActions.title')}</ThemedText>
       ...
     </ThemedView>
   </TourStep>
   \`\`\`

## Rules:
- Do NOT change any logic, props, or styling — only add/remove TourStep wrapper elements
- TourStep is already imported, do NOT add another import
- The week-stats and streak-counter TourSteps that already exist must remain unchanged
- Output the COMPLETE updated file. Return ONLY file content, no markdown fences, no commentary.
- Use exactly: ===FILE_1: app/(tabs)/index.tsx`,
      }],
    },
  },

  // ── 4. analytics-targets ─────────────────────────────────────────────────
  {
    custom_id: 'analytics-targets',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Add TourStep wrappers to app/(tabs)/explore.tsx for the Analytics tab detail tour.

## Current file:
\`\`\`tsx
${EXPLORE_TAB}
\`\`\`

## Changes needed:

### 1. Import TourStep:
Add to existing imports:
\`\`\`typescript
import { TourStep } from '@/components/TourStep';
\`\`\`

### 2. Wrap these 4 sections with TourStep:

**analytics-kpis** — wrap the \`<View style={styles.kpiRow}>\` (the two MetricCards):
\`\`\`tsx
<TourStep target="analytics-kpis">
  <View style={styles.kpiRow}>
    <MetricCard ... />
    <MetricCard ... />
  </View>
</TourStep>
\`\`\`

**analytics-revenue** — wrap the revenue at risk ThemedView card:
\`\`\`tsx
<TourStep target="analytics-revenue">
  <ThemedView style={styles.card}>
    <ThemedText type="subtitle">{t('analytics.revenueAtRisk')}</ThemedText>
    ...
  </ThemedView>
</TourStep>
\`\`\`

**analytics-hours** — wrap the worker hours ThemedView card:
\`\`\`tsx
<TourStep target="analytics-hours">
  <ThemedView style={styles.card}>
    <ThemedText type="subtitle">{t('analytics.workerHours')}</ThemedText>
    ...
  </ThemedView>
</TourStep>
\`\`\`

**analytics-fairness** — wrap the fairness score ThemedView card:
\`\`\`tsx
<TourStep target="analytics-fairness">
  <ThemedView style={styles.card}>
    <ThemedText type="subtitle">{t('analytics.fairness')}</ThemedText>
    ...
  </ThemedView>
</TourStep>
\`\`\`

## Rules:
- Do NOT change any logic, styling, or props — only add TourStep wrappers
- Output the COMPLETE updated file
- Return ONLY file content, no markdown fences, no commentary
- Use exactly: ===FILE_1: app/(tabs)/explore.tsx`,
      }],
    },
  },

  // ── 5. layout-profile ────────────────────────────────────────────────────
  {
    custom_id: 'layout-profile',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Make two changes. Output as two separate files using the ===FILE_N: path=== format.

## File 1: app/(tabs)/_layout.tsx
Current file:
\`\`\`tsx
${LAYOUT}
\`\`\`

Changes:
1. Add a 4th tab for Profile. Add this Tabs.Screen AFTER the explore screen:
\`\`\`tsx
<Tabs.Screen
  name="profile"
  options={{
    title: t('nav.profile'),
    tabBarIcon: ({ color }) => (
      <IconSymbol size={28} name="person.crop.circle.fill" color={color} />
    ),
  }}
/>
\`\`\`

2. Add a TourStep wrapper around the analytics (explore) tab icon, similar to the scheduler tab:
\`\`\`tsx
<Tabs.Screen
  name="explore"
  options={{
    title: t('nav.analytics'),
    tabBarIcon: ({ color }) => (
      <TourStep target="analytics-tab">
        <IconSymbol size={28} name="chart.bar.fill" color={color} />
      </TourStep>
    ),
  }}
/>
\`\`\`

Output the COMPLETE updated file.

---

## File 2: app/(tabs)/profile.tsx
Current file:
\`\`\`tsx
${PROFILE}
\`\`\`

Changes:
1. Import useWelcomeTour and TourMode:
\`\`\`typescript
import { useWelcomeTour, type TourMode } from '@/contexts/WelcomeTourContext';
\`\`\`

2. Add a "Guides & Tour" card BEFORE the "About" card. The card should use the same SectionHeader pattern and contain 4 guide mode buttons with a clean row layout:

\`\`\`tsx
{/* ── Guides & Tour ─────────────────────────────────────────── */}
<ThemedView style={styles.card}>
  <SectionHeader
    title={t('profile.guides.sectionTitle')}
    subtitle={t('profile.guides.sectionSubtitle')}
    styles={styles}
  />
  <View style={styles.guideGrid}>
    {([
      ['overview', '🗺️', t('profile.guides.overview')],
      ['manager', '📋', t('profile.guides.manager')],
      ['scheduler', '📅', t('profile.guides.scheduler')],
      ['analytics', '📊', t('profile.guides.analytics')],
    ] as [TourMode, string, string][]).map(([mode, emoji, label]) => (
      <Pressable
        key={mode}
        onPress={() => startTourMode(mode)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.guideButton, pressed && { opacity: 0.75 }]}
      >
        <ThemedText style={styles.guideEmoji}>{emoji}</ThemedText>
        <ThemedText style={styles.guideLabel}>{label}</ThemedText>
      </Pressable>
    ))}
  </View>
</ThemedView>
\`\`\`

3. Add in the component body:
\`\`\`typescript
const { startTourMode } = useWelcomeTour();
\`\`\`

4. Add these styles to makeStyles:
\`\`\`
guideGrid: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 10,
},
guideButton: {
  width: '47%',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  borderWidth: 1.5,
  borderColor: brand.primary + '55',
  borderRadius: 10,
  paddingVertical: 10,
  paddingHorizontal: 12,
},
guideEmoji: {
  fontSize: 18,
},
guideLabel: {
  fontSize: 13,
  fontWeight: '600',
  color: brand.primaryDeep,
  flex: 1,
},
\`\`\`

Output BOTH files completely. Format:
===FILE_1: app/(tabs)/_layout.tsx
[complete file content]
===FILE_2: app/(tabs)/profile.tsx
[complete file content]`,
      }],
    },
  },

  // ── 6. locale-guide ──────────────────────────────────────────────────────
  {
    custom_id: 'locale-guide',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Generate locale keys for the new guide flow system. Output TWO files.

## Context (end of current locales/en.ts):
\`\`\`
${LOCALE_EN_TAIL}
\`\`\`

---

## FILE 1: scripts/guide-locale-snippet-en.txt
This is the ENGLISH snippet to be inserted into locales/en.ts just before the closing \`} as const;\`.
Include these top-level namespaces (all string values in English):

\`\`\`
tour: {
  // Add to existing tour namespace — these are NEW additions only:
  mode: {
    pickTitle: 'Choose your guide',
    pickDesc: 'Select a tour to explore different parts of the app.',
    overview: 'Quick Overview',
    overviewDesc: '5-step intro to all tabs',
    manager: 'Manager Tour',
    managerDesc: 'Build your first schedule',
    worker: 'Team Member Tour',
    workerDesc: 'Get started as team member',
    home: 'Home Tab Guide',
    homeDesc: 'Dashboard, streak & gaps',
    scheduler: 'Scheduler Guide',
    schedulerDesc: 'Workers, templates & roster',
    analytics: 'Analytics Guide',
    analyticsDesc: 'KPIs, hours & fairness',
  },
  nav: {
    // Add to existing nav namespace:
    goToTab: 'Go to {tab} →',
  },
  overview: {
    step1: {
      title: 'Welcome to Horario',
      desc: 'This is your Home dashboard — see your scheduling health, upcoming shifts, and staffing gaps at a glance.',
      why: 'A daily dashboard check keeps you ahead of gaps before they become no-shows.',
    },
    step2: {
      title: 'Your Scheduling Streak',
      desc: 'Your streak tracks how consistently you keep your team schedule up to date. The higher your streak, the more reliable your roster becomes.',
      why: 'Teams with consistent scheduling see up to 40% fewer last-minute shift swaps.',
    },
    step3: {
      title: 'The Scheduler Tab',
      desc: 'The Scheduler is where you build your team, set availability, create shift templates, and publish the roster.',
      why: 'Centralised scheduling eliminates double-bookings and gives your whole team a single source of truth.',
    },
    step4: {
      title: 'Demand Forecasting',
      desc: 'Use historical data and POS imports to predict how many staff you need on any given day.',
      why: 'Demand-aware scheduling cuts excess labour costs while keeping service quality high.',
    },
    step5: {
      title: 'Analytics Dashboard',
      desc: 'Track coverage rate, revenue at risk, hours distribution, and fairness score — all in real time.',
      why: 'What gets measured gets improved. Operators who track these KPIs reduce uncovered shifts by 30% within a month.',
    },
  },
  home: {
    step1: {
      title: 'Your Command Centre',
      desc: 'The Home tab gives you an instant health check: shifts scheduled this week, open gaps, and your roster reliability streak.',
      why: 'Managers who review this dashboard daily catch gaps before they become a crisis.',
    },
    step2: {
      title: 'Week at a Glance',
      desc: 'The week stats card shows how many shifts are scheduled and how many roles still need to be filled.',
      why: 'A single number for gaps vs scheduled shifts is faster to act on than scrolling through a full roster.',
    },
    step3: {
      title: 'Reliability Streak',
      desc: 'Your streak counts consecutive days you\'ve kept the schedule up to date. Tap "Log today\'s progress" to advance it.',
      why: 'Teams with a 7-day streak see 40% fewer no-shows thanks to advance visibility.',
    },
    step4: {
      title: 'Upcoming Shifts',
      desc: 'See every shift scheduled for the coming days — worker name, template, and time — at a glance.',
      why: 'Knowing what\'s ahead lets you spot thin coverage before the shift starts.',
    },
    step5: {
      title: 'Staffing Gaps',
      desc: 'Any role that has fewer assigned workers than required shows up here as an open gap.',
      why: 'Every uncovered gap is potential lost revenue. Closing them early keeps service running smoothly.',
    },
    step6: {
      title: 'Quick Actions',
      desc: 'Jump directly to Add Availability, Build Shifts, or Publish Roster — the three most common scheduling tasks.',
      why: 'One tap to the right screen saves the time it takes to navigate and scroll, making daily scheduling 30% faster.',
    },
  },
  scheduler: {
    step1: {
      title: 'Add a Team Member',
      desc: 'Enter the worker\'s name, role (e.g. Barista, Server), and skills separated by commas.',
      why: 'Every person on your roster needs a profile so the auto-assign engine can match them to the right shifts.',
      action: 'Fill in the worker form above and tap "Add worker" to continue ↑',
    },
    step2: {
      title: 'Set Availability',
      desc: 'Tell Horario when your team members are available — day of week, start time, and end time.',
      why: 'Scheduling against confirmed availability is the single biggest driver of shift acceptance — teams see 35% fewer swap requests.',
      action: 'Add an availability window above and tap "Add availability" to continue ↑',
    },
    step3: {
      title: 'Create a Shift Template',
      desc: 'A template is a reusable shift definition — name, role, start time, end time, and minimum workers required.',
      why: 'Templates cut schedule-build time by 60% by removing repetitive data entry every week.',
      action: 'Fill in the template form above and tap "Add template" to continue ↑',
    },
    step4: {
      title: 'Assign Your First Shift',
      desc: 'Pick a worker, pick a template, enter a date, and publish. Horario validates availability and role match automatically.',
      why: 'Publishing even one assigned shift activates the notification pipeline, so your team experiences reliability from day one.',
      action: 'Assign a shift above and tap "Save and notify team" to continue ↑',
    },
    step5: {
      title: 'Forecast Demand',
      desc: 'Set how many staff you need per role per day. Use Homogeneous mode for uniform weeks, Manual for specific dates, or POS CSV import for data-driven forecasts.',
      why: 'Demand-informed scheduling helps operators cut excess labour costs by an average of 15% while maintaining service quality.',
    },
  },
  analytics: {
    step1: {
      title: 'Coverage KPIs',
      desc: 'Coverage Rate shows the percentage of required shifts that are filled. Draft shifts are waiting to be published.',
      why: 'Keeping coverage above 80% is the threshold where service quality is reliably maintained.',
    },
    step2: {
      title: 'Revenue at Risk',
      desc: 'Every uncovered gap has a cost. This figure estimates potential revenue lost from understaffed shifts.',
      why: 'Operators who track revenue at risk close gaps 2x faster than those who don\'t.',
    },
    step3: {
      title: 'Hours Distribution',
      desc: 'See how total scheduled hours are spread across your team. Uneven bars indicate one worker is carrying more load.',
      why: 'Balanced hours improve team morale and reduce burnout — the two biggest drivers of unexpected absences.',
    },
    step4: {
      title: 'Fairness Score',
      desc: 'The fairness gauge measures how evenly hours are distributed. A lower score (greener) means a fairer schedule.',
      why: 'Teams with a fairness score below 4 report 25% higher shift acceptance rates.',
    },
  },
},
profile: {
  guides: {
    sectionTitle: 'Guides & Tour',
    sectionSubtitle: 'Replay any guide to explore app features',
    overview: 'Quick Overview',
    manager: 'Manager Tour',
    scheduler: 'Scheduler Guide',
    analytics: 'Analytics Guide',
  },
},
\`\`\`

The snippet file should show the complete objects ready to paste. Mark clearly which keys are NEW vs additions to existing objects.

---

## FILE 2: scripts/guide-locale-snippet-others.txt
A single file containing translations for all 8 other languages (es, de, fr, it, zh, sw, tl, hi).
Format each language as a section:

\`\`\`
=== LANGUAGE: es ===
[translated content for the same structure as above]

=== LANGUAGE: de ===
[translated content]
... etc
\`\`\`

Only include the VALUES translated — the key structure is identical to English.
Translate all user-facing strings to the target language.
Keep proper typography for each language (accents, special chars).

Format output:
===FILE_1: scripts/guide-locale-snippet-en.txt
[content]
===FILE_2: scripts/guide-locale-snippet-others.txt
[content]`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`Submitting ${REQUESTS.length} requests to claude-sonnet-4-6 (Batch API)…`);

const batch = await client.messages.batches.create({ requests: REQUESTS });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

const metaPath = path.join(__dirname, 'guide-flow-batch-meta.json');
fs.writeFileSync(metaPath, JSON.stringify({ batchId: batch.id, createdAt: new Date().toISOString() }));
console.log(`Meta saved → ${metaPath}`);

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function poll(batchId) {
  while (true) {
    await new Promise((r) => setTimeout(r, 15_000));
    const b = await client.messages.batches.retrieve(batchId);
    const { processing, succeeded, errored } = b.request_counts;
    console.log(`[${new Date().toISOString()}] processing=${processing} succeeded=${succeeded} errored=${errored}`);
    if (b.processing_status === 'ended') return b;
  }
}

await poll(batch.id);

// ─── Retrieve results ─────────────────────────────────────────────────────────

console.log('\nRetrieving results…');

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  if (result.result.type !== 'succeeded') {
    console.error(`  [${result.custom_id}] FAILED:`, result.result);
    continue;
  }
  const text = result.result.message.content.find((b) => b.type === 'text')?.text ?? '';
  results[result.custom_id] = text;
}

// ─── Write files ──────────────────────────────────────────────────────────────

// 1. tour-context
if (results['tour-context']) {
  const content = stripFences(results['tour-context']);
  write('contexts/WelcomeTourContext.tsx', content);
  console.log('  ✓ wrote contexts/WelcomeTourContext.tsx');
}

// 2. tour-spotlight
if (results['tour-spotlight']) {
  const content = stripFences(results['tour-spotlight']);
  write('components/TourSpotlight.tsx', content);
  console.log('  ✓ wrote components/TourSpotlight.tsx');
}

// 3. home-targets
if (results['home-targets']) {
  const files = splitFiles(results['home-targets']);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
    console.log(`  ✓ wrote ${filePath}`);
  }
  if (Object.keys(files).length === 0) {
    const content = stripFences(results['home-targets']);
    write('app/(tabs)/index.tsx', content);
    console.log('  ✓ wrote app/(tabs)/index.tsx (raw)');
  }
}

// 4. analytics-targets
if (results['analytics-targets']) {
  const files = splitFiles(results['analytics-targets']);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
    console.log(`  ✓ wrote ${filePath}`);
  }
  if (Object.keys(files).length === 0) {
    const content = stripFences(results['analytics-targets']);
    write('app/(tabs)/explore.tsx', content);
    console.log('  ✓ wrote app/(tabs)/explore.tsx (raw)');
  }
}

// 5. layout-profile
if (results['layout-profile']) {
  const files = splitFiles(results['layout-profile']);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
    console.log(`  ✓ wrote ${filePath}`);
  }
}

// 6. locale-guide
if (results['locale-guide']) {
  const files = splitFiles(results['locale-guide']);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
    console.log(`  ✓ wrote ${filePath}`);
  }
}

console.log('\n✅ Guide flow batch complete.');
console.log('Next: apply locale snippets to locales/en.ts and all 8 other locale files.');
