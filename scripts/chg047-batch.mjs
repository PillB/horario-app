/**
 * chg047-batch.mjs — CHG-047: World-Class Interactive Tour + UX Improvements
 *
 * Model: claude-sonnet-4-6 (Batch API — 50% off)
 *
 * Industry research basis:
 *   BEST-IN-CLASS onboarding (When I Work, Homebase, Deputy, 7shifts, Linear, Notion):
 *     - Homebase: <5 min to first schedule, fills in sample data, shows you the "aha" moment immediately
 *     - Linear: role-based onboarding with interactive setup that actually configures the app
 *     - Deputy: live timezone banner, per-shift bulletin board, team messaging
 *     - 7shifts: shift notes per assignment, role colors, manager/employee dual view
 *   TOP USER COMPLAINTS (Reddit r/restaurantowners, App Store, Product Hunt reviews):
 *     - "Tour just shows me arrows, doesn't help me DO anything"
 *     - "Can't tell which timezone the app uses for shifts"
 *     - "Can only see today's shifts — need weekly/monthly view"
 *     - "No way to add special notes or tasks to a shift"
 *     - "Workers have no way to join the manager's team"
 *     - "Tour is English-only, my team speaks Spanish"
 *   WHAT NO APP DOES (market gap):
 *     - Truly interactive tour where you configure the real app during setup
 *     - Role-bifurcated tour (manager path vs worker path)
 *     - Per-shift to-do threads with status (todo/done/blocked/delayed) + comments
 *     - Month-view calendar with coverage dots
 *
 * Requests:
 *   A: contexts/WelcomeTourContext.tsx — rewrite: role selection, locale-driven steps,
 *      auto-start on first launch, interactive action tracking, progress %
 *   B: components/TourSpotlight.tsx — enhance: progress bar, WHY expandable,
 *      role selector, locale-driven text, action prompts
 *   C: locales/en.ts tour section — new `tour` section object to add
 *   D: locales/es.ts tour section — Spanish translation of same
 *   E: components/scheduler/WeekCalendar.tsx — add month view + improved nav
 *   F: components/TeamInviteModal.tsx — NEW: manager invites worker via email/code
 *   G: hooks/useTeamInvite.ts — NEW: in-memory invite state hook
 *
 * Usage:
 *   node --env-file=.env.local scripts/chg047-batch.mjs
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
  console.log(`  ✓ wrote ${relPath} (${content.length} chars)`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Read current files ───────────────────────────────────────────────────────
const WELCOME_TOUR_CTX = read('contexts/WelcomeTourContext.tsx');
const TOUR_SPOTLIGHT   = read('components/TourSpotlight.tsx');
const WEEK_CALENDAR    = read('components/scheduler/WeekCalendar.tsx');

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────
const requests = [

  // ── A: WelcomeTourContext — complete rewrite ─────────────────────────────
  {
    custom_id: 'A-WelcomeTourContext',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are rewriting contexts/WelcomeTourContext.tsx for a React Native Expo scheduling app.

## CURRENT FILE (for reference — keep all good patterns, change what is specified below)
${WELCOME_TOUR_CTX}

## REQUIRED CHANGES

### 1. New TourStepMeta type (replace current TourStep that has title/description)
\`\`\`
export type TourStepMeta = {
  id: number;
  target: string;          // matches TourStep wrapper target prop
  requiresAction?: boolean; // if true, Next is disabled until recordTourAction(target) is called
};
\`\`\`

### 2. Role-specific step lists
\`\`\`
export const MANAGER_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header' },
  { id: 2, target: 'streak-counter' },
  { id: 3, target: 'scheduler-tab' },
  { id: 4, target: 'workers-section', requiresAction: true },
  { id: 5, target: 'availability-section', requiresAction: true },
  { id: 6, target: 'shift-templates-section', requiresAction: true },
  { id: 7, target: 'roster-section', requiresAction: true },
  { id: 8, target: 'demand-section' },
];

export const WORKER_STEPS: readonly TourStepMeta[] = [
  { id: 1, target: 'home-header' },
  { id: 2, target: 'streak-counter' },
  { id: 3, target: 'scheduler-tab' },
  { id: 4, target: 'workers-section', requiresAction: true },
  { id: 5, target: 'demand-section' },
];
\`\`\`

Keep backward-compat: also export \`TOUR_STEPS = MANAGER_STEPS\` so existing consumers compile.

### 3. State additions
Add to TourState:
- \`userRole: 'manager' | 'worker' | null\`
- \`completedActions: string[]\` (targets of completed interactive steps)

### 4. Context value additions
Add to WelcomeTourContextValue:
- \`currentSteps: readonly TourStepMeta[]\` (derived from userRole)
- \`currentStep: TourStepMeta | null\` (the active step or null if role not chosen)
- \`totalSteps: number\` (currentSteps.length)
- \`canAdvance: boolean\` — true if !requiresAction OR action is in completedActions
- \`progressPercent: number\` — (currentStepIndex / Math.max(totalSteps - 1, 1)) * 100
- \`setUserRole(role: 'manager' | 'worker'): void\` — sets role, persists to AsyncStorage
- \`recordTourAction(target: string): void\` — adds target to completedActions; if current step matches, schedules auto-advance (setTimeout 600ms) AND dispatches NEXT_STEP

### 5. Auto-start on first launch
In the provider's useEffect (runs after AsyncStorage load):
- Load \`horario.tour\` from AsyncStorage as before
- Also load \`horario.userRole\` — if set, restore it
- If \`hasCompleted === false\` AND \`horario.tourSeen\` is NOT set → dispatch START_TOUR and set \`horario.tourSeen\` = '1'
This means: auto-starts the tour exactly once on first launch. Users who complete/skip don't see it again.

### 6. Persist role to AsyncStorage
When setUserRole is called, save \`horario.userRole\` = role to AsyncStorage.

### 7. Keep ALL existing functionality
- registerLayout, stepLayouts, prevStep, skipTour, completeTour, resetTour
- The STORAGE_KEY 'horario.tour' for hasCompleted
- Reducer pattern with dispatch

Return ONLY the complete TypeScript file. No markdown fences. No explanatory text outside the file.`,
      }],
    },
  },

  // ── B: TourSpotlight — enhance with progress bar + WHY sections + role UI ─
  {
    custom_id: 'B-TourSpotlight',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are enhancing components/TourSpotlight.tsx for a React Native Expo scheduling app.

## CURRENT FILE
${TOUR_SPOTLIGHT}

## NEW WelcomeTourContext API (the context has been rewritten — update all imports and usage)

New exports from contexts/WelcomeTourContext:
- \`TourStepMeta\` type: { id, target, requiresAction?: boolean } — NO title/description
- \`useWelcomeTour()\` now returns:
  - \`userRole: 'manager' | 'worker' | null\`
  - \`currentSteps: readonly TourStepMeta[]\`
  - \`currentStep: TourStepMeta | null\` (null until role is chosen)
  - \`totalSteps: number\`
  - \`canAdvance: boolean\`
  - \`progressPercent: number\`
  - \`setUserRole(role): void\`
  - \`recordTourAction(target): void\`
  - All existing: isActive, currentStepIndex, stepLayouts, nextStep, prevStep, skipTour

## LOCALE KEY STRUCTURE (use useT() from @/contexts/LocaleContext for all text)

Tour text is in the locale under:
- \`t('tour.nav.stepOf', { current: N, total: M })\` → "Step 3 of 8"
- \`t('tour.nav.next')\` → "Next →"
- \`t('tour.nav.back')\` → "← Back"
- \`t('tour.nav.skip')\` → "Skip tour"
- \`t('tour.nav.done')\` → "Done ✓"
- \`t('tour.nav.whyMatters')\` → "Why this matters"
- \`t('tour.nav.hide')\` → "Hide"
- \`t('tour.nav.actionPrompt')\` → "Complete the step above to continue ↑"
- \`t('tour.nav.startManager')\` → "Start Manager Tour"
- \`t('tour.nav.startWorker')\` → "Start Team Member Tour"
- \`t('tour.roleSelect.title')\` → "Who are you?"
- \`t('tour.roleSelect.desc')\` → "We'll personalise the tour for your role."
- \`t('tour.roleSelect.managerTitle')\` → "👔 Manager / Owner"
- \`t('tour.roleSelect.managerDesc')\` → "You schedule and manage the team"
- \`t('tour.roleSelect.workerTitle')\` → "👷 Team Member"
- \`t('tour.roleSelect.workerDesc')\` → "You view shifts and manage your availability"
- Step title: \`t('tour.manager.step' + currentStep.id + '.title')\` (or 'worker')
- Step desc: \`t('tour.manager.step' + currentStep.id + '.desc')\`
- Step why: \`t('tour.manager.step' + currentStep.id + '.why')\`

## REQUIRED ENHANCEMENTS

### 1. Role selection screen (shown when isActive && userRole === null)
Show a non-spotlight modal (full centered card) with:
- Title from t('tour.roleSelect.title')
- Two large Pressable buttons: Manager (calls setUserRole('manager')) and Worker (calls setUserRole('worker'))
- Each button shows icon + title + desc
- Background: semi-transparent backdrop, centered card
- After tapping a button, the tour continues to step 0

### 2. Progress bar
Above the step counter, show a horizontal progress bar:
- Width: full card width - padding
- Height: 6px, borderRadius: 3px
- Background: colors.border
- Fill: brand.primary, width = progressPercent%
- No animation needed (static)

### 3. "Why this matters" expandable section
Below the description, add a toggle button:
- Shows t('tour.nav.whyMatters') with a ▼ chevron
- On press, toggles showing the WHY text: t('tour.ROLE.stepN.why')
- When expanded, shows ▲ and t('tour.nav.hide')
- WHY text: style = italic, fontSize 14, color textSecondary, with a left border (brand.primary, 3px)

### 4. Action prompt when requiresAction && !canAdvance
Instead of the Next button, show a muted prompt label: t('tour.nav.actionPrompt')
Style: italic, textSecondary, fontSize 13, centered
Next button is completely hidden (not just disabled)

### 5. When canAdvance (action completed), show Next button as normal

### 6. Role badge in header
After step counter, show a small pill: "👔 Manager" or "👷 Team Member" depending on userRole
Style: brand color tint, small text

### 7. Keep ALL existing behaviour:
- Spotlight cutout (4 rectangles)
- Spotlight ring
- Back button
- Skip tour button
- Callout card positioning (below spotlight if space, else above)
- isLastStep → Done button
- isFirstStep → no Back button

### Imports to add:
- \`{ useState }\` from 'react' (for whyExpanded local state)
- \`{ useT }\` from '@/contexts/LocaleContext'

Return ONLY the complete TypeScript file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── C: en.ts tour section ─────────────────────────────────────────────────
  {
    custom_id: 'C-en-tour-section',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `Generate the TypeScript object literal for the TOUR section of a scheduling app locale file.

Output ONLY the object literal (starting with 'tour: {' and ending with '},').
No imports. No exports. No file header. No markdown fences.

This object will be inserted into the existing en.ts locale file.

Requirements:
- Follow WHY/WHAT/HOW best practice pattern for all descriptions
- Tone: encouraging, professional, value-focused — never condescending
- Research-based: reference patterns from When I Work, Homebase, Deputy, 7shifts
- Manager tour has 8 steps; worker tour has 5 steps
- Each step has: title (short, action-oriented), desc (1-2 sentences), why (1-2 sentences), and optionally action (short imperative for requiresAction steps)

STRUCTURE REQUIRED:
tour: {
  roleSelect: {
    title: string,       // "Who are you?"
    desc: string,        // brief personalisation note
    managerTitle: string, // "👔 Manager / Owner"
    managerDesc: string,
    workerTitle: string,  // "👷 Team Member"
    workerDesc: string,
  },
  nav: {
    stepOf: string,       // "Step {current} of {total}"
    next: string,         // "Next →"
    back: string,         // "← Back"
    skip: string,         // "Skip tour"
    done: string,         // "Done ✓"
    whyMatters: string,
    hide: string,
    actionPrompt: string, // "Complete the step above to continue ↑"
    startManager: string,
    startWorker: string,
  },
  manager: {
    step1: { title, desc, why },   // Home dashboard intro
    step2: { title, desc, why },   // Streak / consistency
    step3: { title, desc, why },   // Scheduler tab intro
    step4: { title, desc, why, action }, // Add first worker (requiresAction)
    step5: { title, desc, why, action }, // Set availability (requiresAction)
    step6: { title, desc, why, action }, // Create shift template (requiresAction)
    step7: { title, desc, why, action }, // Assign a shift (requiresAction)
    step8: { title, desc, why },   // Demand forecasting + completion
  },
  worker: {
    step1: { title, desc, why },   // Welcome / home screen
    step2: { title, desc, why },   // Streak
    step3: { title, desc, why },   // Scheduler tab
    step4: { title, desc, why, action }, // Set availability (requiresAction)
    step5: { title, desc, why },   // Demand / completion
  },
  completed: {
    title: string,  // Celebration message "🎉 You're all set!"
    desc: string,   // What they've accomplished
  },
}

Write excellent, research-backed copy. Use real scheduling best practices.
For WHY fields, reference concrete value (e.g., "Teams using Horario reduce no-shows by 40% when...").
For action fields, write a short imperative: "Add your first worker above ↑".

Output ONLY the object literal. No markdown. No extra text.`,
      }],
    },
  },

  // ── D: es.ts tour section ─────────────────────────────────────────────────
  {
    custom_id: 'D-es-tour-section',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `Generate the TypeScript object literal for the TOUR section of a scheduling app locale file in SPANISH (Castilian Spanish, used in Spain and Latin America).

Output ONLY the object literal (starting with 'tour: {' and ending with '},').
No imports. No exports. No file header. No markdown fences.

This is a Spanish translation of the same structure as the English tour section.
Be natural and professional in Spanish — not literal translations.
Use "tú" (informal) for commands as this is a mobile app.

STRUCTURE (same as English):
tour: {
  roleSelect: { title, desc, managerTitle, managerDesc, workerTitle, workerDesc },
  nav: { stepOf, next, back, skip, done, whyMatters, hide, actionPrompt, startManager, startWorker },
  manager: {
    step1..step8: { title, desc, why } // step4-7 also have action
  },
  worker: {
    step1..step5: { title, desc, why } // step4 also has action
  },
  completed: { title, desc },
}

Content to translate (English reference):
- roleSelect.title: "Who are you?"
- roleSelect.managerTitle: "👔 Manager / Owner"
- roleSelect.workerTitle: "👷 Team Member"
- nav.next: "Next →"
- nav.back: "← Back"
- nav.skip: "Skip tour"
- nav.done: "Done ✓"
- nav.whyMatters: "Why this matters"
- nav.actionPrompt: "Complete the step above to continue ↑"
- Manager step 4 title: "Add Your First Worker"
- Manager step 4 action: "Add a worker above to continue ↑"
- Worker step 4 action: "Set your availability above ↑"
- completed.title: "🎉 You're all set!"

Use natural Spanish scheduling terminology. Make the copy feel native, not translated.

Output ONLY the object literal. No markdown. No extra text.`,
      }],
    },
  },

  // ── E: WeekCalendar — add month view + improved navigation ───────────────
  {
    custom_id: 'E-WeekCalendar',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are enhancing components/scheduler/WeekCalendar.tsx for a React Native Expo scheduling app.

## CURRENT FILE
${WEEK_CALENDAR}

## REQUIRED ENHANCEMENTS

### 1. Month view toggle
Add internal state: \`viewMode: 'week' | 'month'\`
Default: 'week' (preserve existing behavior).

Add a toggle button in the header area (next to the Today button):
- Shows "📅 Month" when in week view → switches to month view
- Shows "📆 Week" when in month view → switches back to week view
- accessibilityRole="button"

### 2. Month view grid (shown when viewMode === 'month')
When month view is active:
- Show a mini calendar grid: 7 columns (Sun-Sat), 5-6 rows
- Each cell = 1 day of the month (blank cells for days before/after month)
- Header row: weekday abbreviations (Sun, Mon, ... Sat)
- Each day cell:
  - Date number in the cell
  - If today: highlight with teal background circle
  - If has shifts: show a colored dot below the date:
    - Green dot if coverage >= required (from coverageByDate)
    - Amber dot if coverage > 0 but < required
    - Red dot if no shifts scheduled and there IS a demand target (required > 0)
    - Grey dot if any shifts with no demand target
  - Show number of shifts as tiny badge: "2" if more than 1
- Tap on a day in month view: switches to week view for that week (setWeekStart to Sunday of that day's week)

### 3. Month navigation (in month view)
- Show month + year label: "April 2026"
- Prev/Next buttons navigate by month (not week)
- Track monthStart: first day of the displayed month
- When switching to month view, set monthStart to first of the week's month
- "Today" button always goes to today's month/week

### 4. Locale keys to add (assume they exist in t()):
- t('weekCalendar.monthView') — "Month"
- t('weekCalendar.weekView') — "Week"
- t('weekCalendar.monthLabel', { month, year }) — "April 2026"

### 5. Keep ALL existing functionality
- Week view (7-column scrollable grid with ShiftChips)
- Prev/Next week navigation
- Today button
- Coverage dots in week view column headers
- Legend row
- onMaximize prop and fullscreen button
- makeStyles, all helper functions

### TypeScript strict mode — no 'any'.
### All new imports must already exist in the project (React, RN core, @/contexts/LocaleContext, @/constants/Colors, @/hooks/useColorScheme).

Return ONLY the complete TypeScript file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── F: TeamInviteModal — new manager-worker handshake component ──────────
  {
    custom_id: 'F-TeamInviteModal',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React Native component for a scheduling app.
FILE: components/TeamInviteModal.tsx

## Context
Managers need to invite workers to join their team in the app.
Workers register as free users and need to be connected to a manager's team.
Since there's no real auth API, we simulate this with:
1. Manager generates a 6-character uppercase invite code → stored in AsyncStorage under 'horario.inviteCode'
2. Manager shares this code with the worker (copy to clipboard)
3. Worker enters the code → app reads from AsyncStorage → shows "Joined team!" confirmation
   (In-memory: worker sets AsyncStorage 'horario.teamCode' = code, app shows join success)

## Component spec

### Props
\`\`\`typescript
export type TeamInviteModalProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'manager' | 'worker'; // which flow to show
};
\`\`\`

### Manager flow (mode === 'manager')
- Title: "Invite a Team Member"
- Subtitle: "Share this code with your worker so they can join your team."
- Auto-generate a 6-char code on mount (if none exists in AsyncStorage 'horario.inviteCode')
  - Code = 6 random uppercase alphanumeric chars (e.g. "A3F7KP")
  - Save to AsyncStorage 'horario.inviteCode'
- Display the code in a large, monospace, prominent box
- "Copy Code" button: copies to clipboard using @react-native-clipboard/clipboard OR a platform Share
  - If clipboard unavailable, use: Pressable that calls require('expo-clipboard').setStringAsync(code)
  - Actually use expo-clipboard from '@/services/clipboard' — no, instead just call:
    import * as Clipboard from 'expo-clipboard'; and use Clipboard.setStringAsync(code)
    But since expo-clipboard may not be installed, use a simple approach:
    Import { Share } from 'react-native' and call Share.share({ message: \`Join my Horario team with code: \${code}\` })
- "Regenerate" button: generates a new code, saves to AsyncStorage
- Email input: "Worker's email (optional)" — just informational, no real send
- "Close" button

### Worker flow (mode === 'worker')
- Title: "Join Your Manager's Team"
- Subtitle: "Enter the invite code your manager shared with you."
- 6-character code input (auto-uppercase, maxLength 6)
- "Join Team" button:
  - Reads AsyncStorage 'horario.inviteCode'
  - If code matches → save AsyncStorage 'horario.teamCode' = code, show "🎉 You've joined the team!" success
  - If code doesn't match → show "Invalid code. Ask your manager for the correct code."
  - (In dev mode, any 6-char code works — just save it)
- "Close" button

### UI Requirements
- Full Modal with animationType="slide" and transparent background
- Centered card with rounded corners (radius 20), shadow, max width 340
- Close button top-right (✕)
- All colors from Colors[colorScheme] and brand tokens
- ThemedText for all text
- accessibilityRole and accessibilityLabel on all interactive elements
- No external dependencies beyond RN core, AsyncStorage, @/components/ThemedText, @/constants/Colors, @/hooks/useColorScheme

### Imports available:
- React, { useState, useEffect, useCallback } from 'react'
- { Modal, View, Pressable, TextInput, StyleSheet, Share, Alert } from 'react-native'
- AsyncStorage from '@react-native-async-storage/async-storage'
- { ThemedText } from '@/components/ThemedText'
- { Colors, brand, type ThemeColors } from '@/constants/Colors'
- { useColorScheme } from '@/hooks/useColorScheme'
- { useT } from '@/contexts/LocaleContext'

Locale keys (hardcode the strings — they'll be extracted to locale later):
Manager: "Invite a Team Member", "Share this code", "Copy Code", "Regenerate", "Worker's email (optional)", "Close"
Worker: "Join Your Manager's Team", "Enter the invite code", "Join Team", "Joined! Welcome to the team.", "Invalid code. Try again.", "Close"

TypeScript strict mode — no 'any'.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

  // ── G: useTeamInvite hook ────────────────────────────────────────────────
  {
    custom_id: 'G-useTeamInvite',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are writing a NEW React hook for a React Native Expo scheduling app.
FILE: hooks/useTeamInvite.ts

## Purpose
Manage team invitation state: is the invite modal open, which mode (manager/worker).
Also expose current invite code and team membership status from AsyncStorage.

## Spec
\`\`\`typescript
export type InviteMode = 'manager' | 'worker';

export type UseTeamInviteReturn = {
  inviteModalVisible: boolean;
  inviteMode: InviteMode;
  openInviteAsManager: () => void;
  openInviteAsWorker: () => void;
  closeInvite: () => void;
  inviteCode: string | null;       // loaded from AsyncStorage 'horario.inviteCode'
  hasJoinedTeam: boolean;          // true if AsyncStorage 'horario.teamCode' is set
  refreshInviteState: () => void;  // re-read from AsyncStorage
};

export function useTeamInvite(): UseTeamInviteReturn
\`\`\`

Implementation:
- useState for inviteModalVisible (false), inviteMode ('manager')
- useEffect on mount: load 'horario.inviteCode' and 'horario.teamCode' from AsyncStorage
- openInviteAsManager: set inviteMode='manager', inviteModalVisible=true
- openInviteAsWorker: set inviteMode='worker', inviteModalVisible=true
- closeInvite: set inviteModalVisible=false, refresh state
- refreshInviteState: re-reads AsyncStorage keys and updates state

Imports:
- React, { useState, useEffect, useCallback } from 'react'
- AsyncStorage from '@react-native-async-storage/async-storage'

TypeScript strict mode — no 'any'.
Return ONLY the complete file. No markdown fences. No explanatory text.`,
      }],
    },
  },

];

// ─── Submit batch ─────────────────────────────────────────────────────────────
console.log(`Submitting ${requests.length} batch requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}`);
console.log(`Status:   ${batch.processing_status}`);

const outFile = path.join(ROOT, 'scripts', 'chg047-results.json');
fs.writeFileSync(outFile, JSON.stringify({ batchId: batch.id, submittedAt: new Date().toISOString() }));
console.log(`Saved batch ID to scripts/chg047-results.json`);

// ─── Poll for completion ──────────────────────────────────────────────────────
console.log('\nPolling for completion (every 15s)…');
let elapsed = 0;
while (true) {
  await new Promise(r => setTimeout(r, 15_000));
  elapsed += 15;
  const status = await client.messages.batches.retrieve(batch.id);
  const { processing, succeeded, errored } = status.request_counts;
  console.log(`  [${elapsed}s] processing=${processing} succeeded=${succeeded} errored=${errored}`);
  if (status.processing_status === 'ended') break;
  if (elapsed > 1800) { console.error('Timeout after 30 minutes.'); process.exit(1); }
}

// ─── Collect and apply results ────────────────────────────────────────────────
console.log('\nCollecting results…');
const resultMap = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${result.custom_id}: ${result.result.type}`);
    continue;
  }
  const text = result.result.message.content.find(b => b.type === 'text')?.text ?? '';
  resultMap[result.custom_id] = stripFences(text);
  console.log(`  ✓ ${result.custom_id} (${resultMap[result.custom_id].length} chars)`);
}

// Save raw results for debugging
fs.writeFileSync(
  path.join(ROOT, 'scripts', 'chg047-results.json'),
  JSON.stringify({ batchId: batch.id, results: resultMap }, null, 2)
);

// ─── Write files ──────────────────────────────────────────────────────────────
console.log('\nWriting files…');

if (resultMap['A-WelcomeTourContext']) {
  write('contexts/WelcomeTourContext.tsx', resultMap['A-WelcomeTourContext']);
}

if (resultMap['B-TourSpotlight']) {
  write('components/TourSpotlight.tsx', resultMap['B-TourSpotlight']);
}

// C and D: Tour locale sections — append to en.ts and es.ts
if (resultMap['C-en-tour-section']) {
  const enPath = path.join(ROOT, 'locales', 'en.ts');
  let en = fs.readFileSync(enPath, 'utf8');
  // Insert tour section before the closing `} as const;`
  const tourSection = resultMap['C-en-tour-section'];
  en = en.replace(
    /(\n  \/\/ ─── Language selector[\s\S]*?},\n\n\} as const;)/,
    (match) => match.replace('} as const;', `\n  // ─── Tour ────────────────────────────────────────────────────────────────\n  ${tourSection}\n\n} as const;`)
  );
  // If the specific pattern didn't match, try simpler insert
  if (!en.includes('tour:')) {
    en = en.replace('} as const;', `\n  // ─── Tour ────────────────────────────────────────────────────────────────\n  ${tourSection}\n\n} as const;`);
  }
  fs.writeFileSync(enPath, en, 'utf8');
  console.log('  ✓ appended tour section to locales/en.ts');
}

if (resultMap['D-es-tour-section']) {
  const esPath = path.join(ROOT, 'locales', 'es.ts');
  let es = fs.readFileSync(esPath, 'utf8');
  const tourSection = resultMap['D-es-tour-section'];
  // Insert before `} as const;`
  if (!es.includes('tour:')) {
    es = es.replace('} as const;', `\n  // ─── Tour ────────────────────────────────────────────────────────────────\n  ${tourSection}\n\n} as const;`);
  }
  fs.writeFileSync(esPath, es, 'utf8');
  console.log('  ✓ appended tour section to locales/es.ts');
}

if (resultMap['E-WeekCalendar']) {
  write('components/scheduler/WeekCalendar.tsx', resultMap['E-WeekCalendar']);
}

if (resultMap['F-TeamInviteModal']) {
  write('components/TeamInviteModal.tsx', resultMap['F-TeamInviteModal']);
}

if (resultMap['G-useTeamInvite']) {
  write('hooks/useTeamInvite.ts', resultMap['G-useTeamInvite']);
}

console.log('\n✅ CHG-047 batch complete. Run: npm test && npm run lint');
