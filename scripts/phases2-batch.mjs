/**
 * phases2-batch.mjs
 *
 * Comprehensive Phase 1-3 improvement batch for Horario app.
 * Model: claude-sonnet-4-6 (Batch API — 50% off standard pricing)
 *
 * Phases:
 *   REQ-1 locale-pos-wiring  — scheduler.pos locale keys + PosUploadSection in scheduler.tsx
 *   REQ-2 forecast-engine    — wire forecastEngine into demand pipeline (usePosData hook)
 *   REQ-3 forecast-tests     — unit tests for services/forecastEngine.ts
 *   REQ-4 playwright-tests   — Playwright e2e test scripts for all happy paths
 *   REQ-5 logger-wiring      — wire structured logger into useWorkers, useRoster, useShiftTemplates
 *   REQ-6 diagnostics-screen — DiagnosticsScreen component with useAuditLog
 *
 * Usage:
 *   node --env-file=.env.local scripts/phases2-batch.mjs
 *
 * Results written to scripts/phases2-results.json
 * Generated files written to disk automatically.
 *
 * Today's date: 2026-04-02
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Strip markdown code fences from model output.
 * Handles ```typescript, ```tsx, ```ts, ```js, ```json, ```sql, plain ```, etc.
 */
function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|sql|json|markdown|md|mjs|bash)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

/** Split a response that contains multiple FILE: sections */
function splitFiles(text) {
  const files = {};
  const sections = text.split(/^FILE:\s*/m).filter(Boolean);
  for (const section of sections) {
    const newline = section.indexOf('\n');
    if (newline === -1) continue;
    const filePath = section.slice(0, newline).trim();
    const rawContent = section.slice(newline + 1).trim();
    files[filePath] = stripFences(rawContent);
  }
  return files;
}

// ─── Read source files ────────────────────────────────────────────────────────

const LOCALE_EN = read('locales/en.ts');
const SCHEDULER_TSX = read('app/(tabs)/scheduler.tsx');
const FORECAST_ENGINE = read('services/forecastEngine.ts');
const LOGGER_TS = read('services/logger.ts');
const USE_AUDIT_LOG = read('hooks/useAuditLog.ts');
const POS_UPLOAD_SECTION = read('components/scheduler/PosUploadSection.tsx');
const USE_WORKERS = read('hooks/useWorkers.ts');
const USE_ROSTER = read('hooks/useRoster.ts');
const USE_SHIFT_TEMPLATES = read('hooks/useShiftTemplates.ts');
const ROSTER_SERVICE = read('services/rosterService.ts');
const COLORS_TS = read('constants/Colors.ts');
const SECURE_PROXY_SNIPPET = read('app/api/secure-proxy+api.ts').slice(0, 6000); // first 6k chars

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are an expert TypeScript/React Native engineer working on "Horario", a workforce scheduling app built with Expo SDK 53, Expo Router v5, React 19, Supabase, and Clerk auth.

Key constraints:
- TypeScript strict mode — no implicit any, no unsafe casts.
- React Native + Expo — no direct DOM APIs except guarded by Platform.OS === 'web'.
- Use @/ path aliases (configured in tsconfig).
- Follow existing patterns in the codebase exactly.
- Functional components only, StyleSheet.create for styles.
- All interactive elements need accessibilityRole + accessibilityLabel.
- PII must never appear in logs.
- Today's date: 2026-04-02.

Output format: When producing multiple files, prefix each with:
FILE: path/from/repo/root.ts
<code here>

Never output explanations between files — only the file sections.
`;

// ─── Build requests ───────────────────────────────────────────────────────────

const requests = [

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-1: scheduler.pos locale keys + PosUploadSection wiring
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-1-locale-pos-wiring',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Add POS locale keys + wire PosUploadSection into the scheduler

### Context

**locales/en.ts** (current):
\`\`\`typescript
${LOCALE_EN}
\`\`\`

**PosUploadSection.tsx** (uses these locale keys — all currently MISSING from en.ts):
- t('scheduler.pos.sectionTitle')
- t('scheduler.pos.sectionSubtitle')
- t('scheduler.pos.tooltip')
- t('scheduler.pos.uploadButton')
- t('scheduler.pos.pasteLabel')
- t('scheduler.pos.pastePlaceholder')
- t('scheduler.pos.previewTitle')  — has {n} param
- t('scheduler.pos.validationErrors')  — has {n} param
- t('scheduler.pos.resetButton')
- t('scheduler.pos.uploadAction')  — has {n} param
- t('scheduler.pos.uploadSuccess')  — has {n} param
- t('scheduler.pos.uploadError')   — has {msg} param

**app/(tabs)/scheduler.tsx** (current — PosUploadSection NOT yet imported):
\`\`\`typescript
${SCHEDULER_TSX}
\`\`\`

### Requirements

1. **locales/en.ts**: Add a \`pos\` subsection inside \`scheduler\` with all the keys listed above. Use clear, business-friendly English copy. The tooltip should explain that uploading POS (point-of-sale) revenue data improves demand forecasting accuracy by revealing which days are busiest.

2. **app/(tabs)/scheduler.tsx**:
   - Import PosUploadSection from '@/components/scheduler/PosUploadSection'.
   - Import EXPO_PUBLIC_ACCOUNT_ID from process.env (already available in app via constants/Config or use process.env.EXPO_PUBLIC_ACCOUNT_ID directly — check what the existing code uses for accountId; useSchedulerHandlers exposes nothing about accountId but other hooks use a constant). Look at how other components in this file pass accountId — there is none passed explicitly in this file. Use \`process.env.EXPO_PUBLIC_ACCOUNT_ID ?? ''\` consistent with how hooks use it internally.
   - Render PosUploadSection **between DemandSection and RosterSection** (after the demand section closing TourStep, before the RosterSection TourStep). Wrap it in an ErrorBoundary-style View if needed but keep it simple. No TourStep wrapper needed.
   - Pass \`accountId={process.env.EXPO_PUBLIC_ACCOUNT_ID ?? ''}\` to PosUploadSection.
   - Import useT if not already imported (it is already imported).

Output both complete updated files.`,
      }],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-2: usePosData hook + forecastEngine integration in DemandSection
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-2-forecast-engine-integration',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Create usePosData hook + integrate forecastEngine into demand view

### Context

**services/forecastEngine.ts** (pure statistical engine — already written):
\`\`\`typescript
${FORECAST_ENGINE}
\`\`\`

**hooks/useRoster.ts** (reference for hook pattern):
\`\`\`typescript
${USE_ROSTER}
\`\`\`

**services/rosterService.ts** (shows how secure proxy is called):
\`\`\`typescript
${ROSTER_SERVICE.slice(0, 4000)}
\`\`\`

**constants/Colors.ts** (for styling reference):
\`\`\`typescript
${COLORS_TS.slice(0, 2000)}
\`\`\`

### Requirements

**File 1: hooks/usePosData.ts** — new hook

Create a hook that:
- Calls the secure proxy action 'listPosSales' to fetch POS data.
- The proxy endpoint is at \`process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy'\` (same pattern as rosterService.ts).
- Returns \`{ sales: PosSalesRow[], loading: boolean, error: string | null, refresh: () => void }\`.
- \`PosSalesRow\` is imported from '@/services/forecastEngine' (already exported there).
- Accepts \`accountId: string\` and optional \`limit?: number\` (default 365).
- Passes \`Authorization: Bearer <token>\` header (use getSessionToken from '@/services/authToken').
- Maps the proxy response \`{ rows: Array<{date: string; revenue: number; covers: number | null}> }\` to \`PosSalesRow[]\`.
- Handles fetch errors gracefully (sets error, returns empty sales).
- Calls refresh on mount.

**File 2: components/scheduler/ForecastEnhancementsCard.tsx** — new display component

Create a compact component that:
- Props: \`sales: PosSalesRow[], baseForecast: DemandForecast[], roster: Shift[], shiftTemplates: ShiftTemplate[]\`
- Imports \`applyForecastEnhancements, PosSalesRow\` from '@/services/forecastEngine'.
- Imports \`DemandForecast\` from '@/services/demandForecast'.
- Imports \`Shift, ShiftTemplate\` from '@/utils/schedulerMetrics'.
- Computes \`scheduledHoursByDate\` from roster + shiftTemplates (sum hours per date from published shifts; assume 8h per shift if no template duration data available).
- Calls \`applyForecastEnhancements(baseForecast.map(f => ({date: f.date, role: f.role, required: f.required})), sales, scheduledHoursByDate)\`.
- If \`sales.length === 0\` or \`baseForecast.length === 0\`: renders nothing (return null).
- Otherwise renders a SectionCard-style View (use inline card styles similar to the existing SectionCard component):
  - Title: "AI-Enhanced Forecast" with a confidence indicator.
  - For each DemandRecommendation, show: date, role, base→adjusted headcount, confidence bar, and the first 2 reasons as bullet points.
  - Limit to first 5 recommendations to avoid overwhelming the UI.
  - Show a note if the forecast lacks confidence (< 0.75).
- Use \`StyleSheet.create\`, Colors.light tokens, proper accessibilityRole.
- Import \`useT\` from '@/contexts/LocaleContext' for any user-facing strings (use English hardcoded strings in the component if locale keys don't exist yet — the component should still work).
- Keep it under 200 lines.

These two files together allow scheduler.tsx to call \`usePosData\` and render \`ForecastEnhancementsCard\` with the live POS data after the DemandSection.`,
      }],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-3: Unit tests for forecastEngine.ts
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-3-forecast-tests',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Write comprehensive unit tests for services/forecastEngine.ts

### Context

\`\`\`typescript
${FORECAST_ENGINE}
\`\`\`

### Requirements

Write the file **services/__tests__/forecastEngine.test.ts** using Jest (jest-expo preset) that covers:

**computeSeasonality tests:**
- Empty array → all multipliers 1.0
- All revenues 0 → all multipliers 1.0
- Known revenue pattern → correct multipliers (e.g. Saturdays always 2× average)
- Rows with invalid dates are skipped
- Missing weekday data → multiplier 1.0 for that weekday

**computeTrend tests:**
- Empty array → slope 0, direction "flat"
- Single row → slope 0, direction "flat", intercept = revenue
- All X identical (degenerate) → slope 0, direction "flat", intercept = yMean
- 10 rows with strong positive slope → direction "growing", r2 > 0.8
- 10 rows with strong negative slope → direction "declining"
- 10 rows with flat/random data → direction "flat", r2 near 0
- Rows with invalid dates are skipped
- At least 2 valid rows → computed correctly

**computeWMA tests:**
- Empty array → 0
- All invalid dates → 0
- 3 rows → uses trimmed weights correctly
- 7 rows → uses full weight array, most recent rows weighted more
- 10 rows → only the 7 most recent are used

**applyForecastEnhancements tests:**
- Empty baseForecast → returns []
- Empty sales → returns base forecast unchanged with confidence 0
- baseForecast with 3 items + 0 sales → all adjustedRequired === baseRequired
- baseForecast with items + 30+ sales rows → confidence === 1.0
- baseForecast with items + < 7 sales rows → confidence === 0.5
- Seasonality multiplier correctly applied (Saturday with high revenue multiplier → adjusted > base)
- Final adjustedRequired is always ≥ 0 (no negative workers)
- Each item has reasons.length > 0
- Trend applied when r2 ≥ 0.3 (verify with synthetic data)

Use \`describe\` + \`it\` blocks. No mocks needed — all functions are pure.
Import only from '@/../services/forecastEngine' (adjust to correct relative path from __tests__ dir).
Cover at least 25 test cases total.`,
      }],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-4: Playwright e2e test scripts for all happy paths
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-4-playwright-tests',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Write Playwright e2e test scripts for Horario happy paths

### App context

Horario is a React Native Web app (Expo Router v5) running at http://localhost:8081 in development.
Auth is handled by Clerk — but the app has a dev bypass: when no Clerk key is set it renders unauthenticated.
For tests, use the scheduler screen directly at http://localhost:8081/(tabs)/scheduler (or / → tabs auto).

The scheduler screen has these sections (in order):
1. Worker management (WorkerSection) — add workers, set availability
2. Shift template management (ShiftTemplateSection) — create templates, assign shifts, auto-assign
3. Demand forecasting (DemandSection) — run forecast, add targets
4. POS Upload (PosUploadSection) — CSV paste/upload for sales data
5. Roster (RosterSection) — publish/notify shifts

### Requirements

Write **e2e/scheduler.spec.ts** — a Playwright TypeScript test file that tests these happy paths:

**Happy Path 1: Add a worker**
- Navigate to scheduler
- Fill in "Name" = "Alice Chen", "Role" = "Server", "Skills" = "barista"
- Click "Add worker"
- Verify success message appears containing "Alice Chen"
- Verify Alice appears in the worker list

**Happy Path 2: Set worker availability**
- After adding Alice, the availability form should be pre-filled with her ID
- Fill Day = "Mon", From = "09:00", To = "17:00"
- Click "Add availability"
- Verify availability is saved (success text visible)

**Happy Path 3: Create a shift template**
- Fill template form: Name = "Morning Server", Role = "Server", Start = "09:00", End = "17:00", Coverage = "3"
- Click "Add template"
- Verify template appears in list

**Happy Path 4: Create a roster shift**
- Fill shift form: Date = "2026-04-07", Worker ID (pre-filled from step 1)
- Click "Assign shift"
- Verify shift appears in roster or success message

**Happy Path 5: POS CSV upload**
- Navigate to POS upload section
- Paste CSV text: "date,revenue,covers\\n2026-03-01,1500.00,45\\n2026-03-02,1200.50,38"
- Click upload/parse button
- Verify preview table shows 2 rows
- Verify no fatal error message

**Happy Path 6: Demand forecast**
- Fill fallback form with Role = "Server", Start Date = "2026-04-07", Days = "7", Shifts per Day = "2", Workers per Shift = "2"
- Click "Add homogeneous demand"
- Verify success message or targets appear

Use:
- \`import { test, expect } from '@playwright/test';\`
- \`page.getByRole('textbox', { name: '...' })\` selectors (prefer accessible name selectors)
- \`page.getByRole('button', { name: '...' })\`
- \`page.getByText('...')\`
- Wait patterns: \`await expect(locator).toBeVisible({ timeout: 10000 })\`
- Each test is independent (beforeEach: navigate to scheduler)
- Handle that the app may take a moment to load — add \`page.waitForLoadState('networkidle')\`
- The base URL is 'http://localhost:8081'
- Include a \`playwright.config.ts\` at repo root (webServer config pointing to the running dev server)

Output two files:
FILE: playwright.config.ts
FILE: e2e/scheduler.spec.ts`,
      }],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-5: Wire structured logger into useWorkers, useRoster, useShiftTemplates
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-5-logger-wiring',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Wire the structured logger into data hooks

### Context

**services/logger.ts** (already written):
\`\`\`typescript
${LOGGER_TS}
\`\`\`

**hooks/useWorkers.ts** (current):
\`\`\`typescript
${USE_WORKERS}
\`\`\`

**hooks/useRoster.ts** (current):
\`\`\`typescript
${USE_ROSTER}
\`\`\`

**hooks/useShiftTemplates.ts** (current):
\`\`\`typescript
${USE_SHIFT_TEMPLATES}
\`\`\`

### Requirements

Update all three hooks to add structured logging. Rules:
- Import \`log\` from '@/services/logger'.
- Use the correct LogCategory: 'WORKER' for useWorkers, 'ROSTER' for useRoster, 'TEMPLATE' for useShiftTemplates.
- Log levels: DEBUG for routine reads, INFO for successful mutations, WARN for recoverable failures, ERROR for unexpected exceptions.
- NEVER log: name, email, role (actual content), or any PII. Log only: IDs, counts, booleans, error messages.
- data object passed to log functions must only contain non-PII fields.
- Keep log calls minimal: 1 per operation max (don't spam).

Specific log points:
- **useWorkers**:
  - INFO when worker added successfully: \`{ workerId, accountId, skillCount }\`
  - INFO when availability added: \`{ workerId, day }\` (day is not PII)
  - WARN when DB unavailable (optimistic only): \`{ workerId, reason: 'db-unavailable' }\`
  - DEBUG on load: \`{ count: workers.length }\`

- **useRoster**:
  - INFO when shift added: \`{ shiftId, date, status }\`
  - INFO when shift status changed: \`{ shiftId, status }\`
  - INFO when shift notified: \`{ shiftId }\`
  - WARN when DB unavailable
  - DEBUG on load: \`{ count: roster.length }\`

- **useShiftTemplates**:
  - INFO when template added: \`{ templateId }\`
  - WARN when DB unavailable
  - DEBUG on load: \`{ count: templates.length }\`

Output all three complete updated files.`,
      }],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // REQ-6: DiagnosticsScreen component
  // ──────────────────────────────────────────────────────────────────────────
  {
    custom_id: 'req-6-diagnostics-screen',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `## Task: Create a Diagnostics / Support Logs screen

### Context

**hooks/useAuditLog.ts** (already written):
\`\`\`typescript
${USE_AUDIT_LOG}
\`\`\`

**services/logger.ts** (for LogEntry type):
\`\`\`typescript
${LOGGER_TS.slice(0, 1500)}
\`\`\`

**constants/Colors.ts** (theming):
\`\`\`typescript
${COLORS_TS.slice(0, 2000)}
\`\`\`

**Existing explore.tsx screen** (as structural reference — it uses tabs layout):
\`\`\`typescript
${read('app/(tabs)/explore.tsx').slice(0, 2000)}
\`\`\`

### Requirements

Create a Diagnostics screen that support staff or admins can use to inspect and share logs.

**File 1: components/DiagnosticsPanel.tsx** — reusable panel component

- Props: none (reads directly from useAuditLog hook)
- Uses \`useAuditLog\` hook.
- Shows a FlatList of LogEntry items, newest first (reverse order).
- Each row shows: level badge (color-coded: DEBUG=grey, INFO=blue, WARN=amber, ERROR=red), category, timestamp (time only, not full ISO), message.
- Header row with:
  - "Refresh" button (calls refresh())
  - "Copy logs" button (calls copyToClipboard())
  - "Clear" button (calls clear())
  - Count badge: "N entries"
- If entries is empty: show "No log entries yet. Use the app to generate activity."
- lastRefreshedAt shown as "Updated HH:MM:SS"
- Use ThemedText, ThemedView, StyleSheet.create, Colors tokens.
- All buttons have accessibilityRole="button" and accessibilityLabel.
- Max height 400 for the list (scrollable).
- Privacy note at bottom: "All logs are sanitised — no passwords or personal data are stored."

**File 2: app/(tabs)/diagnostics.tsx** — screen that hosts the panel

- A simple screen that renders DiagnosticsPanel inside a ThemedView with a ScrollView.
- Title "Support Diagnostics" using ThemedText type="title".
- Subtitle: "Share these logs with support to diagnose issues."
- Includes an export/share section with a prominent "Copy all logs to clipboard" button.
- Tab bar should not show this screen (it's accessed via a Settings or Profile button — but just create the screen file; navigation wiring is separate).

Output both complete files.`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

const client = new Anthropic();

console.log(`\n📦 Submitting ${requests.length} batch requests to claude-sonnet-4-6 (Batch API — 50% off)\n`);

let batch;
try {
  batch = await client.messages.batches.create({ requests });
} catch (err) {
  console.error('Failed to create batch:', err);
  process.exit(1);
}

console.log(`✅ Batch created: ${batch.id}`);
console.log(`   Status: ${batch.processing_status}`);
console.log(`   Requests: ${batch.request_counts.processing} processing\n`);

// ─── Poll until done ──────────────────────────────────────────────────────────

console.log('⏳ Polling every 30s until batch completes…');
while (true) {
  await new Promise((r) => setTimeout(r, 30_000));
  batch = await client.messages.batches.retrieve(batch.id);
  const { processing, succeeded, errored, expired, canceled } = batch.request_counts;
  console.log(`   [${new Date().toISOString()}] processing=${processing} succeeded=${succeeded} errored=${errored} expired=${expired} canceled=${canceled}`);
  if (batch.processing_status === 'ended') break;
}

console.log(`\n✅ Batch complete — processing_status: ${batch.processing_status}`);

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  if (result.result.type === 'succeeded') {
    const textBlock = result.result.message.content.find((b) => b.type === 'text');
    results[id] = { ok: true, text: textBlock?.text ?? '' };
  } else if (result.result.type === 'errored') {
    results[id] = { ok: false, error: result.result.error };
    console.warn(`  ⚠ ${id} errored:`, result.result.error);
  } else {
    results[id] = { ok: false, error: result.result.type };
    console.warn(`  ⚠ ${id}: ${result.result.type}`);
  }
}

// Save raw results
const resultsPath = path.join(__dirname, 'phases2-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n💾 Raw results saved to scripts/phases2-results.json\n`);

// ─── Apply results ────────────────────────────────────────────────────────────

console.log('📝 Writing generated files…\n');

// REQ-1: locale + scheduler wiring
if (results['req-1-locale-pos-wiring']?.ok) {
  const files = splitFiles(results['req-1-locale-pos-wiring'].text);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
  }
} else {
  console.warn('⚠ req-1-locale-pos-wiring failed or missing');
}

// REQ-2: usePosData + ForecastEnhancementsCard
if (results['req-2-forecast-engine-integration']?.ok) {
  const files = splitFiles(results['req-2-forecast-engine-integration'].text);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
  }
} else {
  console.warn('⚠ req-2-forecast-engine-integration failed or missing');
}

// REQ-3: forecast engine tests
if (results['req-3-forecast-tests']?.ok) {
  const files = splitFiles(results['req-3-forecast-tests'].text);
  if (Object.keys(files).length > 0) {
    for (const [filePath, content] of Object.entries(files)) {
      write(filePath, content);
    }
  } else {
    // If no FILE: sections, write directly
    write('services/__tests__/forecastEngine.test.ts', stripFences(results['req-3-forecast-tests'].text));
  }
} else {
  console.warn('⚠ req-3-forecast-tests failed or missing');
}

// REQ-4: playwright tests
if (results['req-4-playwright-tests']?.ok) {
  const files = splitFiles(results['req-4-playwright-tests'].text);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
  }
} else {
  console.warn('⚠ req-4-playwright-tests failed or missing');
}

// REQ-5: logger wiring in hooks
if (results['req-5-logger-wiring']?.ok) {
  const files = splitFiles(results['req-5-logger-wiring'].text);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
  }
} else {
  console.warn('⚠ req-5-logger-wiring failed or missing');
}

// REQ-6: DiagnosticsPanel + screen
if (results['req-6-diagnostics-screen']?.ok) {
  const files = splitFiles(results['req-6-diagnostics-screen'].text);
  for (const [filePath, content] of Object.entries(files)) {
    write(filePath, content);
  }
} else {
  console.warn('⚠ req-6-diagnostics-screen failed or missing');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const succeeded = Object.values(results).filter((r) => r.ok).length;
const total = Object.keys(results).length;

console.log(`\n🎉 Done! ${succeeded}/${total} requests succeeded.`);
console.log('\nNext steps:');
console.log('  1. Review generated files for TypeScript errors: npx tsc --noEmit');
console.log('  2. Run tests: npm test');
console.log('  3. Run lint: npm run lint');
console.log('  4. Run Playwright tests: npx playwright test (after starting dev server)');
console.log('  5. Commit with CHG-039: git add -A && git commit -m "CHG-039 Phase 1-3: POS upload, forecast engine, logger, diagnostics"');
