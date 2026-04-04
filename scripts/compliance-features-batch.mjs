/**
 * compliance-features-batch.mjs
 *
 * Phase 2 (Compliance) + Phase 3 (Feature Inventory & Implementation)
 * Model: claude-sonnet-4-6  (Batch API — 50% off)
 *
 * Batch requests:
 *   1. Vercel deployment + API-route compliance → fixes in app/api/ + vercel.json
 *   2. Clerk auth compliance → fixes in auth flow + authToken pattern
 *   3. Supabase compliance → RLS audit + migration hardening + query fixes
 *   4. Feature flows 1-3 (Team Setup, Availability, Shift Optimization) → implementation
 *   5. Feature flows 4-5 (Demand Prediction, Schedule Optimization) → implementation
 *   6. Feature flows 6-7 (Capacity gaps, Tactical/Strategic Recommendations) → implementation
 *
 * Usage:
 *   node --env-file=.env.local scripts/compliance-features-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8')
    : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|sql|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

function splitFiles(text) {
  // Split on ===FILE_N: path=== separators
  const parts = {};
  const segments = text.split(/===FILE_\d+:\s*/);
  for (const seg of segments) {
    const lineEnd = seg.indexOf('\n');
    if (lineEnd < 0) continue;
    const header = seg.slice(0, lineEnd).replace(/===$/, '').trim(); // "path/to/file"
    const body = stripFences(seg.slice(lineEnd + 1).trim());
    if (header && body) parts[header] = body;
  }
  return parts;
}

// ─── Source file snapshots ────────────────────────────────────────────────────

const SECURE_PROXY     = read('app/api/secure-proxy+api.ts');
const AUTH_TOKEN       = read('services/authToken.ts');
const IDENTITY_CTX     = read('contexts/IdentityContext.tsx');
const SIGN_IN_TSX      = read('app/(auth)/sign-in.tsx');
const SIGN_UP_TSX      = read('app/(auth)/sign-up.tsx');
const SUPABASE_CLIENT  = read('services/supabaseClient.ts');
const CORE_TABLES_SQL  = read('supabase/migrations/20260327000001_core_tables.sql');
const USAGE_SQL        = read('supabase/migrations/20260328000001_usage_limits.sql');
const POS_SQL          = read('supabase/migrations/20260401000001_pos_sales.sql');
const ROSTER_SVC       = read('services/rosterService.ts');
const FORECAST_SVC     = read('services/demandForecast.ts');
const FORECAST_ENGINE  = read('services/forecastEngine.ts');
const SHIFT_ASSIGNER   = read('services/shiftAssigner.ts');
const USE_ROSTER       = read('hooks/useRoster.ts');
const USE_WORKERS      = read('hooks/useWorkers.ts');
const USE_TEMPLATES    = read('hooks/useShiftTemplates.ts');
const USE_DEMAND       = read('hooks/useDemandForecast.ts');
const USE_HANDLERS     = read('hooks/useSchedulerHandlers.ts').slice(0, 4000);
const USE_INSIGHTS     = read('hooks/useSchedulerInsights.ts');
const LIVE_ROSTER      = read('hooks/useLiveRosterSummary.ts');
const ANALYTICS_TS     = read('services/analytics.ts');
const SYNC_QUEUE       = read('services/syncQueue.ts').slice(0, 2000);
const COLORS_TS        = read('constants/Colors.ts').slice(0, 1000);
const VERCEL_JSON      = read('vercel.json');
const NEXT_CFG         = read('next.config.js');

const client = new Anthropic();

// ─── Requests ─────────────────────────────────────────────────────────────────

const requests = [

  // ── 1. Vercel deployment compliance ───────────────────────────────────────
  {
    custom_id: 'phase2-vercel',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{ role: 'user', content: `
You are a Vercel deployment expert. Audit the following Horario app files for Vercel best-practice compliance.

## Current vercel.json
\`\`\`json
${VERCEL_JSON}
\`\`\`

## Current app/api/secure-proxy+api.ts (Expo Router API route, 1056 lines)
\`\`\`typescript
${SECURE_PROXY}
\`\`\`

## Current services/authToken.ts
\`\`\`typescript
${AUTH_TOKEN}
\`\`\`

Vercel best practices to check:
1. API routes should use Edge runtime where possible for latency (or Node.js for crypto operations).
2. Response headers: CORS, Cache-Control, Content-Security-Policy for API routes.
3. Cold-start mitigation: avoid importing heavy modules at top level inside API routes.
4. Environment variable access: all server secrets must NEVER be in EXPO_PUBLIC_ vars.
5. API route file naming: Expo Router uses \`+api.ts\` suffix — verify route is correctly named.
6. Rate limiting: API routes should implement basic rate limiting or document intent.
7. Request size limits and timeout handling.
8. Error responses should never leak stack traces in production.

Generate the following files with all compliance fixes:

===FILE_1: vercel.json===
[Updated vercel.json with correct rewrites, headers (CORS, CSP, Cache-Control), functions config]

===FILE_2: app/api/secure-proxy+api.ts===
[Full rewrite of secure-proxy with: edge-compatible crypto check, proper error sanitization (no stack leaks in prod), request size guard (reject >1MB), CORS headers on every response, cache-control: no-store for auth responses, rate-limit comment with TODO, all existing functionality preserved]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 2. Clerk auth compliance ───────────────────────────────────────────────
  {
    custom_id: 'phase2-clerk',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{ role: 'user', content: `
You are a Clerk authentication expert. Audit the following Horario files for Clerk best-practice compliance.

## app/(auth)/sign-in.tsx
\`\`\`typescript
${SIGN_IN_TSX}
\`\`\`

## app/(auth)/sign-up.tsx
\`\`\`typescript
${SIGN_UP_TSX}
\`\`\`

## services/authToken.ts
\`\`\`typescript
${AUTH_TOKEN}
\`\`\`

## contexts/IdentityContext.tsx
\`\`\`typescript
${IDENTITY_CTX}
\`\`\`

Clerk best practices to check:
1. Use \`@clerk/expo\` (not legacy) for all hooks — \`useSignIn\`, \`useSignUp\`, \`useAuth\`, \`useUser\`.
2. Deep-link handling: \`__clerk_ticket\` param must be handled robustly with proper URL clearing after use.
3. Session token refresh: \`getToken({ template })\` should be called fresh per-request, not cached longer than 50s.
4. Error handling: Clerk errors have \`errors[].code\` field — map common codes (form_identifier_not_found, form_password_incorrect) to user-friendly messages.
5. OAuth/SSO redirect: sign-in should support \`afterSignInUrl\` redirect param passed from the referring screen.
6. Verification flow in sign-up: email code verification should show a countdown/resend timer.
7. \`setActive\` must be awaited before router.replace to avoid flash of unauthenticated state.
8. Token provider in authToken.ts should handle null gracefully and not throw.

Generate these files with all compliance fixes:

===FILE_1: app/(auth)/sign-in.tsx===
[Full rewrite: use @clerk/expo (not legacy), proper error code mapping, __clerk_ticket handling with URL param clearing, afterSignInUrl redirect support, setActive before navigation]

===FILE_2: app/(auth)/sign-up.tsx===
[Full rewrite: use @clerk/expo (not legacy), proper error code mapping, resend timer for email verification (60s countdown), setActive before navigation]

===FILE_3: services/authToken.ts===
[Enhanced with: per-request token freshness comment, graceful null handling, dev-mode logging toggle]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 3. Supabase compliance ─────────────────────────────────────────────────
  {
    custom_id: 'phase2-supabase',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 7168,
      messages: [{ role: 'user', content: `
You are a Supabase database expert. Audit the following Horario files for Supabase best-practice compliance.

## supabase/migrations/20260327000001_core_tables.sql
\`\`\`sql
${CORE_TABLES_SQL}
\`\`\`

## supabase/migrations/20260328000001_usage_limits.sql
\`\`\`sql
${USAGE_SQL}
\`\`\`

## supabase/migrations/20260401000001_pos_sales.sql
\`\`\`sql
${POS_SQL}
\`\`\`

## services/supabaseClient.ts
\`\`\`typescript
${SUPABASE_CLIENT}
\`\`\`

## services/rosterService.ts (excerpt)
\`\`\`typescript
${ROSTER_SVC.slice(0, 3000)}
\`\`\`

Supabase best practices to check:
1. RLS policies: anon SELECT with NO account_id filter is a multi-tenant data leak risk — every table needs \`account_id = current_setting('request.jwt.claims', true)::json->>'sub'\` or use service-role-only writes with application-enforced account scoping on reads.
2. Missing indexes: composite indexes on (account_id, created_at) for time-range queries.
3. Cascade deletes: verify FK cascade rules are correct (e.g., deleting a worker should cascade to roster/availability).
4. Generated columns or check constraints for time-range validation.
5. supabaseClient.ts uses \`persistSession: false\` — correct for server-side but document explicitly.
6. Missing \`updated_at\` triggers on workers and shift_templates tables.
7. \`text\` vs \`uuid\` types: account_id stored as \`text\` but Clerk user IDs start with \`user_\` prefix — this is fine, but should be documented.
8. Missing \`shift_messages\` table referenced by shiftMessaging.ts.
9. Missing \`referrals\` table referenced by referrals+api.ts.

Generate the following:

===FILE_1: supabase/migrations/20260403000001_compliance_fixes.sql===
[New migration that: adds account_id RLS policies using JWT claims on anon reads, adds missing updated_at triggers for workers and shift_templates, adds composite index (account_id, created_at) on workers/shift_templates, adds shift_messages table with proper RLS, adds referrals table with proper RLS and indexes]

===FILE_2: services/supabaseClient.ts===
[Enhanced client factory: add TypeScript generic database type support, add per-request auth header injection helper \`getAuthenticatedClient(token: string|null)\` that sets Authorization header, keep existing \`getSupabaseClient()\` for backward compat, add JSDoc comments explaining persistSession: false rationale]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 4. Feature flows 1-3: Team setup, Availability, Shift optimization ────
  {
    custom_id: 'phase3-flows-1-3',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are building Horario, a workforce scheduling app. Analyze and implement three user flows.

## Current state context:

### services/rosterService.ts
\`\`\`typescript
${ROSTER_SVC.slice(0, 3000)}
\`\`\`

### hooks/useWorkers.ts
\`\`\`typescript
${USE_WORKERS}
\`\`\`

### hooks/useShiftTemplates.ts
\`\`\`typescript
${USE_TEMPLATES}
\`\`\`

### services/shiftAssigner.ts (excerpt)
\`\`\`typescript
${SHIFT_ASSIGNER.slice(0, 3000)}
\`\`\`

### hooks/useSchedulerHandlers.ts (excerpt)
\`\`\`typescript
${USE_HANDLERS}
\`\`\`

---

## FLOW 1: Team Setup
Current state: Workers added via form → saved to Supabase via secure proxy. Missing: bulk import, role validation against templates, worker profile photo URL, invite-link onboarding path.

## FLOW 2: Availability Setup
Current state: Worker availability stored per day-of-week with from/to times. Missing: recurring exceptions (e.g., "unavailable Jul 4"), preferred shift preferences, mobile-friendly toggle-grid UI.

## FLOW 3: Shift Optimization
Current state: shiftAssigner.ts has greedy + 2-opt algorithm with labor constraints. Missing: auto-assign trigger integrated into roster hook, coverage gap feedback after auto-assign, assignment explanation shown to manager ("Alice assigned: role match + best availability coverage").

Generate THREE files:

===FILE_1: hooks/useTeamSetup.ts===
[New hook wrapping useWorkers with: bulkImportWorkers(csv: string): Promise<{imported: number, errors: string[]}> — parses CSV of name,role,skills rows and calls addWorker for each; validateWorkerAgainstTemplates(worker, templates): string|null — returns error if no template matches worker role; exportWorkersCSV(): string — returns CSV string of current workers; all typed, strict TS, no any]

===FILE_2: hooks/useAvailabilityGrid.ts===
[New hook for a 7×24 availability grid: state is a Record<DayOfWeek, {from: string, to: string}[]>; addSlot(day, from, to), removeSlot(day, from), toggleDay(day, defaultFrom, defaultTo) helpers; addException(date: string, reason: string) for one-off unavailability stored in AsyncStorage keyed by workerId; getAvailabilitySummary() returns human-readable string like "Mon–Fri 09:00–17:00, exceptions: 3"; all typed strict TS, imports DayOfWeek from @/services/rosterService]

===FILE_3: hooks/useAutoAssign.ts===
[New hook: wraps shiftAssigner.assignShifts with UI integration; state: {assigning: boolean, result: AssignmentResult|null, explanation: AssignmentExplanation[]}; AssignmentExplanation type: {templateId: string, workerId: string, workerName: string, reason: string}; autoAssign(date, templates, workers, existingRoster, constraints?) calls assignShifts then generates explanation strings ("Alice Chen: role match (Barista), covers 09:00–17:00, fairness score 0.92"); persists assignments via upsertRosterShift from rosterService; emits trackEvent('auto_assign_used'); all typed strict TS]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 5. Feature flows 4-5: Demand prediction, Schedule optimization ─────────
  {
    custom_id: 'phase3-flows-4-5',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are building Horario, a workforce scheduling app. Analyze and implement two user flows.

## Current state context:

### services/demandForecast.ts
\`\`\`typescript
${FORECAST_SVC}
\`\`\`

### services/forecastEngine.ts
\`\`\`typescript
${FORECAST_ENGINE.slice(0, 3000)}
\`\`\`

### hooks/useDemandForecast.ts
\`\`\`typescript
${USE_DEMAND}
\`\`\`

### hooks/useSchedulerInsights.ts
\`\`\`typescript
${USE_INSIGHTS}
\`\`\`

---

## FLOW 4: Demand Prediction
Current state: forecastEngine.ts computes seasonality index + OLS trend from POS data, produces DemandRecommendation[]. useDemandForecast hook wraps the service call. Missing: confidence interval visualization data, week-over-week comparison, "why this forecast" explanation surfaced to UI, forecast accuracy tracking (actual vs predicted after-the-fact).

## FLOW 5: Optimizing Schedules According to Demand
Current state: Demand targets stored in Supabase, auto-assign runs independently. Missing: demand-aware auto-assign (feed demand targets as required coverage into shiftAssigner), overstaffing detection (assigned > required+20%), understaffing alert per role per day.

Generate TWO files:

===FILE_1: hooks/useDemandAnalysis.ts===
[New hook that extends demand insight with:
- demandVsPrior: {date: string, role: string, current: number, prior: number, changePct: number}[] computed from last 2 weeks of targets
- forecastExplanation: {date: string, role: string, factors: string[]}[] — human-readable reasons ("Weekend premium +25%", "OLS trend +8%", "External signal: local event +15%")
- forecastAccuracy: {date: string, role: string, predicted: number, actual: number, errorPct: number}[] — populated after roster shifts are published for past dates by comparing demand_targets to actual roster fills
- weeklyDemandSummary: {role: string, avgRequired: number, peakDay: string, peakRequired: number}[]
All typed strict TS, imports from @/services/demandForecast and @/hooks/useRoster and @/hooks/useShiftTemplates]

===FILE_2: hooks/useDemandAwareSchedule.ts===
[New hook that bridges demand and scheduling:
- getDemandForDate(date: string, role: string): number — looks up demand target or returns 0
- getStaffingStatus(date: string, role: string, roster: Shift[], templates: ShiftTemplate[]): {assigned: number, required: number, status: 'ok'|'understaffed'|'overstaffed', gap: number}
- buildDailyStaffingMatrix(dates: string[], roles: string[], roster: Shift[], templates: ShiftTemplate[], demandTargets: DemandForecast[]): StaffingMatrixRow[] where StaffingMatrixRow = {date, role, required, assigned, gap, status}
- demandAwareAutoAssign(date, templates, workers, roster, demandTargets, constraints?): runs assignShifts with coverage count from demandTargets[role].required, returns AssignmentResult + StaffingMatrixRow[]
All typed strict TS, no any, imports from @/services/shiftAssigner, @/services/demandForecast, @/utils/schedulerMetrics]

No markdown fences inside file content sections.
` }],
    },
  },

  // ── 6. Feature flows 6-7: Capacity gaps + Recommendations ─────────────────
  {
    custom_id: 'phase3-flows-6-7',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: `
You are building Horario, a workforce scheduling app. Analyze and implement two advanced user flows.

## Current state context:

### hooks/useSchedulerInsights.ts
\`\`\`typescript
${USE_INSIGHTS}
\`\`\`

### hooks/useLiveRosterSummary.ts
\`\`\`typescript
${LIVE_ROSTER}
\`\`\`

### services/shiftAssigner.ts (LaborConstraints + AssignmentResult types)
\`\`\`typescript
${SHIFT_ASSIGNER.slice(0, 2000)}
\`\`\`

### services/analytics.ts
\`\`\`typescript
${ANALYTICS_TS.slice(0, 2000)}
\`\`\`

---

## FLOW 6: Predicting Capacity Gaps or Overcapacity
Current state: useSchedulerInsights has 8 rules covering coverage %, uncovered revenue, and fairness. Missing: forward-looking capacity gap PREDICTION (not just current state), worker burnout risk score (workers assigned >90% of their available hours), coverage trend projection (if current pattern continues, will we be under/over in 2 weeks?), per-role capacity utilization %.

## FLOW 7: Tactical and Strategic Recommendations for Leaders
Current state: PlaybookLibrary.tsx has 5 hardcoded playbooks. useSchedulerInsights returns rule-based insight cards. Missing: tactical recommendations ("Hire 1 more Barista for peak weekend coverage"), strategic recommendations ("Based on 4-week trend, your Friday dinner service is 30% understaffed — model 2 additional Server shifts"), priority-ranked action list with estimated revenue impact.

Generate TWO files:

===FILE_1: hooks/useCapacityForecast.ts===
[New hook for predictive capacity analysis:
Types:
  - CapacityGap: {date: string, role: string, required: number, available: number, gap: number, risk: 'critical'|'warning'|'ok', isProjected: boolean}
  - BurnoutRisk: {workerId: string, workerName: string, assignedHours: number, availableHours: number, utilizationPct: number, risk: 'high'|'medium'|'low'}
  - CapacityTrend: {role: string, direction: 'improving'|'stable'|'degrading', projectedGapIn14Days: number, confidence: number}

Functions:
  - computeCapacityGaps(demandTargets, roster, templates, workers, availability): CapacityGap[]
  - computeBurnoutRisks(workers, roster, templates, availability, lookbackDays: number): BurnoutRisk[] — utilization = assignedHours / totalAvailableHours; flag >90% as high, 70–90% as medium
  - projectCapacityTrend(capacityGaps: CapacityGap[], lookbackWeeks: number): CapacityTrend[] — simple linear extrapolation of gap over past N weeks to predict next 14 days
  - Hook return: {gaps: CapacityGap[], burnoutRisks: BurnoutRisk[], trends: CapacityTrend[], loading: boolean}

All typed strict TS, pure computation functions, hook wraps them with useMemo, imports from @/services/rosterService, @/services/demandForecast]

===FILE_2: hooks/useLeaderInsights.ts===
[New hook for tactical + strategic recommendations:
Types:
  - TacticalRecommendation: {id: string, priority: number, category: 'staffing'|'scheduling'|'compliance'|'retention', title: string, description: string, action: string, estimatedRevenueImpact: number, effort: 'low'|'medium'|'high', timeframe: 'immediate'|'this_week'|'this_month'}
  - StrategicRecommendation: {id: string, category: 'hiring'|'training'|'process'|'technology', title: string, insight: string, evidence: string, recommendedAction: string, projectedImpactPct: number, timeframe: 'month'|'quarter'|'half_year'}

Functions:
  - generateTacticalRecommendations(gaps: CapacityGap[], burnoutRisks: BurnoutRisk[], insights: SchedulerInsight[], uncoveredRevenue: number): TacticalRecommendation[]
    — Rules: critical gap → "Cover [role] gap on [date]" with revenue calc; burnout high → "Redistribute [worker] shifts"; many drafts → "Publish pending shifts"; uncovered revenue > $1000 → "Auto-assign now"
  - generateStrategicRecommendations(trends: CapacityTrend[], workerCount: number, avgWeeklyGap: number, avgUtilization: number): StrategicRecommendation[]
    — Rules: degrading trend → "Hire additional [role]"; avg utilization > 85% → "Workforce is near capacity — plan hiring Q+1"; stable good coverage → "Optimize shift templates for cost efficiency"
  - Hook return: {tactical: TacticalRecommendation[], strategic: StrategicRecommendation[], loading: boolean}
  - On mount, emits trackEvent('schedule_published') if any critical tactical recs exist (as a proxy for manager engagement)

All typed strict TS, no any, imports from @/hooks/useCapacityForecast, @/hooks/useSchedulerInsights, @/services/analytics]

No markdown fences inside file content sections.
` }],
    },
  },
];

// ─── Submit ────────────────────────────────────────────────────────────────────

console.log(`Submitting ${requests.length} requests to claude-sonnet-4-6 (Batch API)…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

const metaPath = path.join(ROOT, 'scripts', 'compliance-features-batch-meta.json');
fs.writeFileSync(metaPath, JSON.stringify({
  batchId: batch.id,
  createdAt: Date.now(),
  requests: requests.map(r => r.custom_id),
}, null, 2));
console.log(`Meta saved → ${metaPath}`);

// ─── Poll ──────────────────────────────────────────────────────────────────────

let done = false;
while (!done) {
  await new Promise(r => setTimeout(r, 15_000));
  const status = await client.messages.batches.retrieve(batch.id);
  const c = status.request_counts;
  console.log(`[${new Date().toISOString()}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);
  if (status.processing_status === 'ended') done = true;
}

// ─── Write results ─────────────────────────────────────────────────────────────

console.log('\nRetrieving results…');
const outDir = path.join(ROOT, 'scripts', 'compliance-features-output');
fs.mkdirSync(outDir, { recursive: true });

for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${id}: ${result.result.type}`);
    continue;
  }
  const raw = result.result.message.content[0].text;
  fs.writeFileSync(path.join(outDir, `${id}.txt`), raw, 'utf8');

  const files = splitFiles(raw);

  if (id === 'phase2-vercel') {
    if (files['vercel.json']) write('vercel.json', files['vercel.json']);
    if (files['app/api/secure-proxy+api.ts']) write('app/api/secure-proxy+api.ts', files['app/api/secure-proxy+api.ts']);
  }

  if (id === 'phase2-clerk') {
    if (files['app/(auth)/sign-in.tsx']) write('app/(auth)/sign-in.tsx', files['app/(auth)/sign-in.tsx']);
    if (files['app/(auth)/sign-up.tsx']) write('app/(auth)/sign-up.tsx', files['app/(auth)/sign-up.tsx']);
    if (files['services/authToken.ts']) write('services/authToken.ts', files['services/authToken.ts']);
  }

  if (id === 'phase2-supabase') {
    if (files['supabase/migrations/20260403000001_compliance_fixes.sql'])
      write('supabase/migrations/20260403000001_compliance_fixes.sql', files['supabase/migrations/20260403000001_compliance_fixes.sql']);
    if (files['services/supabaseClient.ts']) write('services/supabaseClient.ts', files['services/supabaseClient.ts']);
  }

  if (id === 'phase3-flows-1-3') {
    if (files['hooks/useTeamSetup.ts']) write('hooks/useTeamSetup.ts', files['hooks/useTeamSetup.ts']);
    if (files['hooks/useAvailabilityGrid.ts']) write('hooks/useAvailabilityGrid.ts', files['hooks/useAvailabilityGrid.ts']);
    if (files['hooks/useAutoAssign.ts']) write('hooks/useAutoAssign.ts', files['hooks/useAutoAssign.ts']);
  }

  if (id === 'phase3-flows-4-5') {
    if (files['hooks/useDemandAnalysis.ts']) write('hooks/useDemandAnalysis.ts', files['hooks/useDemandAnalysis.ts']);
    if (files['hooks/useDemandAwareSchedule.ts']) write('hooks/useDemandAwareSchedule.ts', files['hooks/useDemandAwareSchedule.ts']);
  }

  if (id === 'phase3-flows-6-7') {
    if (files['hooks/useCapacityForecast.ts']) write('hooks/useCapacityForecast.ts', files['hooks/useCapacityForecast.ts']);
    if (files['hooks/useLeaderInsights.ts']) write('hooks/useLeaderInsights.ts', files['hooks/useLeaderInsights.ts']);
  }

  // Log which files were extracted
  const fileKeys = Object.keys(files);
  if (fileKeys.length === 0) {
    console.warn(`  ⚠ ${id}: no FILE_N separators found — check ${id}.txt for raw output`);
  } else {
    console.log(`  [${id}] extracted: ${fileKeys.join(', ')}`);
  }
}

console.log('\n✅ All done.');
