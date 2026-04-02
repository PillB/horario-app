/**
 * phases-batch.mjs
 *
 * 6-phase comprehensive improvement batch for Horario app.
 * Model: claude-sonnet-4-6 (Batch API — 50% off standard pricing)
 *
 * Phases:
 *   1. Calendar UI/UX — add week/month calendar view with navigation
 *   2. Compliance — Vercel, Clerk, Supabase best-practices audit
 *   3. Feature inventory — gaps across all user flows
 *   4. Demand prediction — enhanced stats + POS/CSV upload implementation
 *   5. Logging/audit trail — structured client + server logging
 *   6. Secure proxy POS actions — uploadPosSales / listPosSales
 *
 * Usage:
 *   node --env-file=.env.local scripts/phases-batch.mjs
 *
 * After completion results are written to scripts/phases-results.json
 * and generated files are written to disk.
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

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|sql|json|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Codebase snapshot ────────────────────────────────────────────────────────

const CODEBASE = `
=== app/(tabs)/scheduler.tsx ===
${read('app/(tabs)/scheduler.tsx')}

=== app/(tabs)/explore.tsx (Analytics) ===
${read('app/(tabs)/explore.tsx')}

=== components/scheduler/RosterSection.tsx ===
${read('components/scheduler/RosterSection.tsx')}

=== components/scheduler/DemandSection.tsx ===
${read('components/scheduler/DemandSection.tsx')}

=== components/scheduler/WorkerSection.tsx ===
${read('components/scheduler/WorkerSection.tsx')}

=== components/scheduler/ShiftTemplateSection.tsx ===
${read('components/scheduler/ShiftTemplateSection.tsx')}

=== components/scheduler/SectionCard.tsx ===
${read('components/scheduler/SectionCard.tsx')}

=== components/scheduler/InputField.tsx ===
${read('components/scheduler/InputField.tsx')}

=== hooks/useSchedulerHandlers.ts ===
${read('hooks/useSchedulerHandlers.ts')}

=== hooks/useRoster.ts ===
${read('hooks/useRoster.ts')}

=== hooks/useDemandForecast.ts ===
${read('hooks/useDemandForecast.ts')}

=== services/demandForecast.ts ===
${read('services/demandForecast.ts')}

=== services/rosterService.ts ===
${read('services/rosterService.ts')}

=== app/api/secure-proxy+api.ts (first 200 lines) ===
${read('app/api/secure-proxy+api.ts').split('\n').slice(0, 200).join('\n')}

=== types/scheduler.ts ===
${read('types/scheduler.ts')}

=== utils/schedulerMetrics.ts (types only) ===
${read('utils/schedulerMetrics.ts').split('\n').slice(0, 30).join('\n')}

=== constants/Colors.ts ===
${read('constants/Colors.ts')}

=== styles/scheduler.styles.ts ===
${read('styles/scheduler.styles.ts')}

=== locales/en.ts (scheduler section) ===
${read('locales/en.ts').split('\n').slice(140, 340).join('\n')}

=== supabase/migrations/project_migrations.md (summary) ===
Tables: shifts, external_signals, demand_targets, onboarding_progress, workers,
worker_availability, shift_templates, roster, usage_limits, pos_sales

=== CLAUDE.md (excerpt) ===
Tech stack: Expo SDK 53, React Native 0.79.2, React 19, Expo Router v5,
TypeScript 5.8 strict, Supabase (PostgreSQL + RLS), Clerk auth,
AsyncStorage, React Native StyleSheet, Jest+jest-expo.
Secure proxy: app/api/secure-proxy+api.ts (service-role Supabase key server-side only).
All writes go through the proxy. RLS on all tables.
`;

const PROJECT_CONTEXT = `
## Project: Horario — workforce scheduling app
- Expo SDK 53 / React Native 0.79.2 / React 19 / Expo Router v5
- TypeScript 5.8 strict mode
- Supabase PostgreSQL with RLS; service-role key is SERVER-ONLY (in secure proxy)
- Clerk auth (JWT verified in proxy; dev-bypass when no key)
- Design tokens in constants/Colors.ts; styled via StyleSheet.create
- i18n via contexts/LocaleContext (useT hook); all user-facing strings must use t()
- All Supabase writes go through app/api/secure-proxy+api.ts
- Tests: Jest + jest-expo. Run: npm test. All 164 tests must stay green.
- Lint: ESLint with eslint-config-expo. Must stay at 0 errors.
- Today: 2026-04-02

## Key absence: NO calendar view exists
The RosterSection currently displays shifts as a flat list grouped by date string.
There is no visual week/month calendar grid, no date navigation (prev/next week),
no "today" button, and no fullscreen/maximize mode.

## POS sales table exists
Migration 5 (20260401000001_pos_sales.sql) created the pos_sales table.
The secure proxy does NOT yet have uploadPosSales / listPosSales actions.
The DemandSection UI does NOT yet have a POS upload component.
`;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are an expert React Native / Expo / TypeScript engineer working on the Horario workforce scheduling app.

CRITICAL RULES:
1. Return ONLY the requested file(s) — nothing else.
2. Each file must be complete and self-contained (no elisions like "...rest of file...").
3. Do NOT use any library not already in package.json (no date-fns, no react-native-calendar, etc.).
4. All user-facing strings must use the useT()/t() i18n hook — no hardcoded English.
5. All Supabase writes go through the secure proxy (never directly from the client).
6. TypeScript strict mode: no implicit 'any'; all props typed; no ts-ignore without comment.
7. Respect WCAG AA contrast — use design tokens from constants/Colors.ts.
8. After changes, all 164 jest tests must continue to pass.
9. Provide code that works TODAY (2026-04-02) with the listed library versions.

Output format for multiple files:
--- FILE: path/to/file.tsx ---
<complete file content>
--- END FILE ---

Output format for a single file: just the raw file content.`;

// ─── Build requests ───────────────────────────────────────────────────────────

const requests = [];

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1 — Calendar component: WeekCalendar
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-1-calendar-component',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 1a: Create WeekCalendar component

Create \`components/scheduler/WeekCalendar.tsx\` — a visual weekly calendar for the Roster.

### Requirements
1. **Week grid**: 7 columns (Sun–Sat) × rows for each hour block (e.g. 08:00–22:00)
   OR a simpler day-column view showing shifts as colored blocks within each day column.
   Use the simpler approach: 7 day columns, each showing shift chips for that day.

2. **Navigation**: Prev week / Today / Next week buttons.
   - State: currentWeekStart (Date, Monday of displayed week)
   - "Today" resets to current week
   - Prev/Next move ±7 days

3. **Data**: Accept \`rosterByDate: Record<string, RosterShift[]>\` where RosterShift = Shift & { template?: ShiftTemplate; worker?: Worker }.
   Filter displayed shifts to dates within the current week only.

4. **Shift chip**: Show template name + worker name + status color (Draft=amber, Published=teal).

5. **Maximize button**: A "⛶" or "⤢" button top-right that calls an \`onMaximize?: () => void\` prop.
   When maximized, the parent wraps this in a Modal — this component itself stays the same.

6. **Print hint**: Add a comment \`{/* @print-region */}\` around the grid so it can be targeted
   via CSS @media print on web.

7. **Accessibility**:
   - Nav buttons: accessibilityRole="button", accessibilityLabel with date range
   - Shift chips: accessibilityLabel = "worker name, template, status"
   - Column headers: accessibilityRole="columnheader"

8. **Empty state**: Show "No shifts this week" when no shifts in range.

9. **Styling**: Use Colors tokens + StyleSheet.create factory pattern.
   Horizontal ScrollView for mobile (7 columns can overflow narrow screens).

### Type imports available
\`\`\`typescript
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';
\`\`\`

### Existing codebase context
${CODEBASE.split('\n').slice(0, 200).join('\n')}

Return the COMPLETE \`components/scheduler/WeekCalendar.tsx\` file.`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 1b — RosterSection update to embed WeekCalendar
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-1-roster-section',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 1b: Update RosterSection to embed WeekCalendar

Update \`components/scheduler/RosterSection.tsx\` to:

1. **Add a view toggle**: "List" | "Calendar" buttons at the top of the SectionCard.
   - Default: "List" (current flat list view preserved exactly)
   - "Calendar": renders the new WeekCalendar component

2. **Maximize modal**: When user taps "⛶" on WeekCalendar:
   - Show a Platform-aware fullscreen Modal (use React Native Modal on native,
     ReactDOM.createPortal with position:fixed on web — same pattern as InfoTooltip)
   - Modal contains the WeekCalendar at full width/height
   - Close button top-right

3. **Print-friendly web**: On web, add a \`@media print\` style block via inline \`<style>\` tag
   injected to document.head that hides everything except \`.print-region\` class.
   Gate this with \`Platform.OS === 'web'\`.

4. **New locale keys needed** (add to i18n calls with t()):
   - scheduler.roster.calendarView = 'Calendar'
   - scheduler.roster.listView = 'List'
   - scheduler.roster.noShiftsThisWeek = 'No shifts this week'
   - scheduler.roster.maximize = 'Fullscreen calendar'
   - scheduler.roster.closeFullscreen = 'Close fullscreen'

5. Keep ALL existing props and the existing list view 100% unchanged.

### Current RosterSection source
${read('components/scheduler/RosterSection.tsx')}

### Note on WeekCalendar import
Import as: \`import { WeekCalendar } from './WeekCalendar';\`
Props: \`rosterByDate\`, \`onMaximize\`

Return the COMPLETE updated \`components/scheduler/RosterSection.tsx\`.`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Compliance audit fixes
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-2-compliance',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 2: Compliance audit and fixes

Perform a differential compliance analysis against best practices for:
1. **Vercel** — deployment, edge runtime, environment variable exposure, CORS
2. **Clerk** — JWT verification, session management, token refresh, auth state
3. **Supabase** — RLS policies, service-role key usage, query patterns, error handling

### Current secure proxy (first 200 lines)
${read('app/api/secure-proxy+api.ts').split('\n').slice(0, 200).join('\n')}

### Current services/authToken.ts
${read('services/authToken.ts')}

### Current services/demandForecast.ts
${read('services/demandForecast.ts')}

### Analysis and findings needed

For each compliance area, identify:
- Current implementation
- Gap vs best practice
- Corrective action
- Preventative measure

Then provide:

**File 1: \`docs/COMPLIANCE_AUDIT.md\`**
A structured compliance report with findings table (Area | Finding | Severity | Status | Action).
Include specific line numbers where issues exist.

**File 2: \`services/authToken.ts\` (updated if needed)**
Any fixes to the token management service.

**File 3: \`docs/SECURITY_CHECKLIST.md\`**
A security checklist for ongoing compliance verification.

Format:
--- FILE: docs/COMPLIANCE_AUDIT.md ---
<content>
--- END FILE ---
--- FILE: services/authToken.ts ---
<content>
--- END FILE ---
--- FILE: docs/SECURITY_CHECKLIST.md ---
<content>
--- END FILE ---`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Feature inventory + gap analysis
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-3-feature-inventory',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 3: Feature inventory and gap analysis

Inventory ALL user flows and features in the Horario app. For each, document:
- Current status (Working / Partial / Missing / Broken)
- Root cause of any gap
- Recommended fix (with priority: P0=blocker, P1=high, P2=medium, P3=low)
- Estimated effort (S/M/L/XL)

### User flows to evaluate
1. Team setup (add workers, roles, skills)
2. Availability management (set worker availability windows)
3. Shift template management (create reusable templates)
4. Shift assignment (manual + auto-assign)
5. Demand forecasting (run forecast, set targets, baseline seeding)
6. Capacity gap analysis (identify over/understaffing)
7. Roster publication (publish drafts, notify workers)
8. Analytics / reporting (coverage rate, fairness, revenue at risk)
9. POS data upload (CSV upload to enrich forecasting)
10. Onboarding checklist (guided setup flow)
11. Authentication (sign in, sign up, session management)
12. Calendar view (visual week/month schedule)
13. Multi-language support (9 languages)
14. Welcome tour (guided product tour)
15. Freemium / upgrade flow (usage limits)

### What users say they need (but competitors don't provide)
- Real-time visibility of staffing gaps vs demand
- Fairness-based auto-assignment (not just skill matching)
- Revenue impact of uncovered shifts
- Day-of-week seasonality in demand prediction
- Historical POS data integration

### Codebase context
${CODEBASE.split('\n').slice(0, 300).join('\n')}

Produce:
**File: \`docs/FEATURE_INVENTORY.md\`**
A comprehensive feature matrix with all flows, current status, gaps, priorities, and recommended next actions.
Include a "Quick wins" section (P0+P1 items completable in <1 day).

--- FILE: docs/FEATURE_INVENTORY.md ---
<content>
--- END FILE ---`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4a — Enhanced demand forecast with POS data + statistical methods
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-4a-demand-forecast-engine',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 4a: Enhanced demand forecast engine

Update the secure proxy forecast engine to use POS sales data for more accurate predictions.

### pos_sales table schema
\`\`\`sql
id uuid PK, account_id text, date date, revenue numeric(12,2),
covers integer, notes text, source text, created_at timestamptz
Unique: (account_id, date)
\`\`\`

### Implement in the secure proxy (server-side, TypeScript)

Create \`services/forecastEngine.ts\` — a pure TypeScript module (no external ML libs)
implementing these statistical methods:

#### 1. Day-of-week seasonality index
- Group pos_sales by weekday (0=Sun, 6=Sat)
- Compute: avgRevPerWeekday / overallAvgRev → seasonality multiplier per weekday
- Apply: multiply base demand × seasonality[weekday]

#### 2. Linear trend detection (OLS regression)
- Input: array of {date, revenue} sorted by date (last 90 days)
- Output: slope (revenue/day), intercept, R²
- If slope > 0: "growing demand" → scale up future targets proportionally
- If slope < 0: "declining" → scale down

#### 3. Weighted moving average (WMA)
- 7-day WMA with weights [1,1,1,2,2,3,4] (more recent = higher weight)
- Normalize by average workday template coverage

#### 4. Revenue-per-worker-hour efficiency
- revenue / (scheduled_hours_that_day) → $/hr
- Compare to avg → flag days where efficiency deviates >20%

#### 5. Capacity gap alerts
- Projected revenue (from trend+seasonality) → divide by avg revenue/worker/hr
  → workers_needed
- Compare workers_needed to scheduled → gap score

### File: \`services/forecastEngine.ts\`
Export:
\`\`\`typescript
export type PosSalesRow = { date: string; revenue: number; covers: number | null };
export type SeasonalityIndex = Record<number, number>; // weekday 0-6 → multiplier
export type TrendResult = { slope: number; intercept: number; r2: number; direction: 'growing' | 'flat' | 'declining' };
export type DemandRecommendation = { date: string; role: string; baseRequired: number; adjustedRequired: number; confidence: number; reasons: string[] };

export function computeSeasonality(sales: PosSalesRow[]): SeasonalityIndex
export function computeTrend(sales: PosSalesRow[]): TrendResult
export function computeWMA(sales: PosSalesRow[], days?: number): number
export function applyForecastEnhancements(
  baseForecast: Array<{ date: string; role: string; required: number }>,
  sales: PosSalesRow[],
  scheduledHoursByDate: Record<string, number>
): DemandRecommendation[]
\`\`\`

All functions must be pure (no I/O). Include JSDoc. Include edge-case handling
(empty arrays, division by zero, insufficient data fallbacks).

Return the COMPLETE \`services/forecastEngine.ts\` file.`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4b — POS Upload UI component
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-4b-pos-upload-ui',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 4b: POS Upload UI component

Create \`components/scheduler/PosUploadSection.tsx\` — a SectionCard for uploading
Point-of-Sale CSV data to the pos_sales table.

### Accepted CSV format
\`\`\`
date,revenue,covers,notes
2026-01-01,1250.50,45,New Year's Day
2026-01-02,980.00,38,
\`\`\`
- date: YYYY-MM-DD, MM/DD/YYYY, or DD/MM/YYYY (auto-detect)
- revenue: strips $, €, £, commas → float (e.g. "$1,250.50" → 1250.50)
- covers: optional integer
- notes: optional string, max 500 chars
- Max 1000 rows per upload

### Web file input approach
On web: Use \`<input type="file" accept=".csv,.txt">\` rendered via a hidden DOM input
(injected via useEffect + ref pattern). On native: Show a text area where user can
paste CSV content directly (react-native-document-picker not available).

### Component responsibilities
1. Parse + validate CSV in-browser (pure JS, no library)
2. Show preview: first 5 rows in a mini table
3. Show validation errors inline (bad date format, negative revenue, etc.)
4. Upload button → calls \`onUpload(rows)\` prop
5. Show upload result: "X rows saved, Y updated" or error message
6. Reset state after successful upload

### Props
\`\`\`typescript
type PosUploadSectionProps = {
  accountId: string;
  onUploadComplete?: (rowCount: number) => void;
};
\`\`\`

### Service call
Call the secure proxy with action \`uploadPosSales\`:
\`\`\`typescript
POST /api/secure-proxy
{ action: 'uploadPosSales', accountId, rows: [{ date, revenue, covers, notes, source: 'upload' }] }
\`\`\`
Use \`getSessionToken\` for auth header (import from \`@/services/authToken\`).

### Locale keys to add (use t() for all strings)
- scheduler.pos.sectionTitle = 'POS Sales Upload'
- scheduler.pos.sectionSubtitle = 'Upload CSV revenue data to enrich demand forecasting'
- scheduler.pos.tooltip = '...'
- scheduler.pos.uploadButton = 'Choose CSV file' (web) / 'Paste CSV data' (native)
- scheduler.pos.pasteLabel = 'Paste CSV content'
- scheduler.pos.pastePlaceholder = 'date,revenue,covers,notes\\n2026-01-01,1250.50,45,Weekend'
- scheduler.pos.previewTitle = 'Preview ({n} rows)'
- scheduler.pos.uploadAction = 'Upload {n} rows'
- scheduler.pos.uploadSuccess = '{n} rows saved successfully'
- scheduler.pos.uploadError = 'Upload failed: {msg}'
- scheduler.pos.validationErrors = '{n} validation error(s) found'
- scheduler.pos.resetButton = 'Clear'
- scheduler.pos.tooltip = long help text about POS upload

Return the COMPLETE \`components/scheduler/PosUploadSection.tsx\` file.`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4c — Secure proxy: add uploadPosSales + listPosSales actions
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-4c-proxy-pos-actions',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 4c: Add POS proxy actions to secure proxy

The secure proxy at \`app/api/secure-proxy+api.ts\` needs two new actions:
\`uploadPosSales\` and \`listPosSales\`.

### Current proxy file (full)
${read('app/api/secure-proxy+api.ts')}

### Add these actions

#### uploadPosSales
Input body:
\`\`\`typescript
{ action: 'uploadPosSales', accountId: string, rows: Array<{
  date: string;          // YYYY-MM-DD (already validated/normalized by client)
  revenue: number;       // ≥ 0
  covers?: number | null;
  notes?: string | null;
  source: 'upload' | 'manual';
}> }
\`\`\`
- Validate: rows.length ≤ 1000; each date is valid YYYY-MM-DD; revenue ≥ 0
- Upsert into pos_sales ON CONFLICT (account_id, date) DO UPDATE
  SET revenue=EXCLUDED.revenue, covers=EXCLUDED.covers, notes=EXCLUDED.notes
- Return: \`{ inserted: number, updated: number }\`
- Error on invalid rows: return 400 with details

#### listPosSales
Input body: \`{ action: 'listPosSales', accountId: string, limit?: number, offset?: number }\`
- SELECT * FROM pos_sales WHERE account_id = ? ORDER BY date DESC LIMIT ? OFFSET ?
- Default limit: 90 (3 months); max: 365
- Return: \`{ rows: PosSalesRow[], total: number }\`

### ProxyRequest union type
Add to the existing union:
\`\`\`typescript
| { action: 'uploadPosSales'; accountId: string; rows: PosRow[] }
| { action: 'listPosSales'; accountId: string; limit?: number; offset?: number }
\`\`\`

Return the COMPLETE updated \`app/api/secure-proxy+api.ts\` file.
CRITICAL: Preserve all existing actions exactly — only ADD the two new cases.`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 5 — Logging and audit trail service
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-5-audit-logging',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 5: Logging and audit trail

Implement a lightweight structured logging system for the Horario app.

### Requirements
1. **Client-side logger** (\`services/logger.ts\`)
   - Log levels: DEBUG, INFO, WARN, ERROR
   - In production (web build): filter to WARN+ only
   - In dev: log all levels
   - Format: \`{ timestamp, level, category, message, data? }\`
   - NEVER log: passwords, tokens, auth headers, PII (names, emails)
   - Categories: 'ROSTER' | 'FORECAST' | 'WORKER' | 'TEMPLATE' | 'POS' | 'AUTH' | 'UI' | 'PERF'
   - Export: \`log.debug/info/warn/error(category, message, data?)\`
   - In-memory ring buffer: last 100 entries (for support diagnostics)
   - \`log.export()\` → JSON string of buffer (for support copy-paste)
   - \`log.clear()\` → clears buffer

2. **Server-side audit trail** (additions to \`app/api/secure-proxy+api.ts\`)
   - Log every proxy action to console with structured JSON:
     \`{ ts, action, accountId (hashed), durationMs, status: 'ok'|'error', errorCode? }\`
   - Hash accountId with a one-way hash (SHA-256 first 8 chars) for privacy
   - Never log raw data payloads — only metadata (rowCount, action type)

3. **useAuditLog hook** (\`hooks/useAuditLog.ts\`)
   - Wraps log.export() in a useMemo
   - Provides \`copyToClipboard()\` for support diagnostics
   - Returns \`{ entries, copyToClipboard, clear }\`

4. **Integrate logger into key actions** (show integration patterns only, not full files)
   - useSchedulerHandlers: log shift created, worker added, auto-assign run
   - useDemandForecast: log forecast triggered, targets saved
   - useRoster: log status changes

### Files to produce

--- FILE: services/logger.ts ---
<complete implementation>
--- END FILE ---
--- FILE: hooks/useAuditLog.ts ---
<complete implementation>
--- END FILE ---
--- FILE: docs/LOGGING_GUIDE.md ---
<guide: log levels, categories, integration examples, what not to log, how to export for support>
--- END FILE ---`,
      },
    ],
  },
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 6 — Locale additions for new features
// ══════════════════════════════════════════════════════════════════════════════
requests.push({
  custom_id: 'phase-6-locale-additions',
  params: {
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${PROJECT_CONTEXT}

## Your task — Phase 6: Add locale keys for all new features

The following new features need locale keys added to \`locales/en.ts\`:

### New features requiring locale keys
1. **Calendar/Roster view toggle** (Phase 1):
   - scheduler.roster.calendarView, listView, noShiftsThisWeek, maximize, closeFullscreen
   - scheduler.roster.weekOf = 'Week of {date}'
   - scheduler.roster.prevWeek, nextWeek, today (navigation buttons)

2. **POS Upload** (Phase 4):
   - scheduler.pos.sectionTitle, sectionSubtitle, tooltip
   - scheduler.pos.uploadButton (web), pasteLabel, pastePlaceholder
   - scheduler.pos.previewTitle, uploadAction, uploadSuccess, uploadError
   - scheduler.pos.validationErrors, resetButton, noFile
   - scheduler.pos.csvHelp = explanation of accepted format

3. **Audit log** (Phase 5):
   - common.copyToClipboard, copied, auditLogEmpty, exportDiagnostics

### Current locales/en.ts (scheduler + common sections)
${read('locales/en.ts').split('\n').slice(0, 100).join('\n')}
...
${read('locales/en.ts').split('\n').slice(140, 380).join('\n')}

Return the COMPLETE \`locales/en.ts\` file with ALL new keys added in the right sections.
Do NOT remove or change any existing keys. Only add new ones.
CRITICAL: Keep all existing content intact.`,
      },
    ],
  },
});

// ─── Submit batch ─────────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

console.log(`Submitting ${requests.length} requests to Batch API (claude-sonnet-4-6)...`);
console.log('Requests:', requests.map(r => r.custom_id).join(', '));

const batch = await client.messages.batches.create({ requests });

console.log(`\nBatch submitted: ${batch.id}`);
console.log(`Status: ${batch.processing_status}`);
write('scripts/phases-batch-meta.json', JSON.stringify({ batchId: batch.id, submittedAt: new Date().toISOString(), requestCount: requests.length, requestIds: requests.map(r => r.custom_id) }, null, 2));

// ─── Poll until complete ──────────────────────────────────────────────────────

console.log('\nPolling for completion...');

let finalBatch = batch;
let polls = 0;
while (finalBatch.processing_status === 'in_progress') {
  await new Promise(r => setTimeout(r, 15000)); // 15s
  finalBatch = await client.messages.batches.retrieve(batch.id);
  polls++;
  const counts = finalBatch.request_counts;
  process.stdout.write(`\r  [${polls * 15}s] processing=${counts.processing} succeeded=${counts.succeeded} errored=${counts.errored}`);
}
console.log(`\n\nBatch complete: ${finalBatch.processing_status}`);
console.log('Counts:', finalBatch.request_counts);

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  if (result.result.type === 'succeeded') {
    const text = result.result.message.content.find(b => b.type === 'text')?.text ?? '';
    results[id] = { ok: true, text };
  } else {
    results[id] = { ok: false, error: result.result.error };
    console.error(`  ✗ ${id} failed:`, result.result.error);
  }
}

write('scripts/phases-results.json', JSON.stringify(results, null, 2));
console.log(`\nSaved all results to scripts/phases-results.json`);

// ─── Write generated files ────────────────────────────────────────────────────

console.log('\nWriting generated files to disk...');

/**
 * Parse multi-file response (--- FILE: path --- ... --- END FILE --- format).
 * Returns array of { path, content }.
 */
function parseMultiFile(text) {
  const files = [];
  const pattern = /---\s*FILE:\s*([^\n]+)\s*---\n([\s\S]*?)---\s*END FILE\s*---/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2].trim() });
  }
  return files;
}

for (const [id, result] of Object.entries(results)) {
  if (!result.ok) continue;
  const text = result.text;

  const multiFiles = parseMultiFile(text);

  if (multiFiles.length > 0) {
    for (const { path: filePath, content } of multiFiles) {
      write(filePath, stripFences(content));
    }
  } else {
    // Single file — use the id to determine output path
    const singleFilePaths = {
      'phase-1-calendar-component': 'components/scheduler/WeekCalendar.tsx',
      'phase-1-roster-section': 'components/scheduler/RosterSection.tsx',
      'phase-4a-demand-forecast-engine': 'services/forecastEngine.ts',
      'phase-4b-pos-upload-ui': 'components/scheduler/PosUploadSection.tsx',
      'phase-4c-proxy-pos-actions': 'app/api/secure-proxy+api.ts',
      'phase-6-locale-additions': 'locales/en.ts',
    };
    if (singleFilePaths[id]) {
      write(singleFilePaths[id], stripFences(text));
    } else {
      console.log(`  ℹ ${id}: no output path mapped, see phases-results.json`);
    }
  }
}

console.log('\n✅ All phases complete. Review the generated files, then run: npm test && npm run lint');
