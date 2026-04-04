/**
 * tests-batch.mjs
 *
 * Batch API: best-in-class simulations and tests for horario-app.
 * Model: claude-sonnet-4-6  (Batch API — 50% off standard pricing)
 *
 * Requests batched:
 *   1. hooks/__tests__/useAutoAssign.test.ts   (NEW — complex hook + algorithm)
 *   2. services/__tests__/demandForecast.test.ts (NEW — HTTP proxy service)
 *   3. hooks/__tests__/useDemandAnalysis.test.ts (NEW — analytics + pure math)
 *   4. services/__tests__/syncQueue.test.ts     (NEW — retry queue + hook)
 *   5. services/__tests__/analytics.test.ts     (NEW — event tracking)
 *   6. e2e/scheduler-negative.spec.ts           (NEW — negative + edge E2E)
 *   7. META: best-in-class test ideas           (advisory — saved to scripts/test-ideas.md)
 *
 * Usage:
 *   node --env-file=.env.local scripts/tests-batch.mjs
 *
 * After completion, run:
 *   npm test
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
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Read source files ────────────────────────────────────────────────────────

const USE_AUTO_ASSIGN_TS        = read('hooks/useAutoAssign.ts');
const DEMAND_FORECAST_TS        = read('services/demandForecast.ts');
const USE_DEMAND_ANALYSIS_TS    = read('hooks/useDemandAnalysis.ts');
const SYNC_QUEUE_TS             = read('services/syncQueue.ts');
const ANALYTICS_TS              = read('services/analytics.ts');
const SHIFT_ASSIGNER_TS         = read('services/shiftAssigner.ts');
const ROSTER_SERVICE_TS         = read('services/rosterService.ts');
const SCHEDULER_UTILS_TS        = read('utils/schedulerUtils.ts');
const SCHEDULER_METRICS_TS      = read('utils/schedulerMetrics.ts');

// Reference test for style guide
const USE_ROSTER_TEST_TSX       = read('hooks/__tests__/useRoster.test.tsx');
const SCHEDULER_SPEC_TS         = read('e2e/scheduler.spec.ts');

const client = new Anthropic();

// ─── System prompt (shared) ───────────────────────────────────────────────────

const SYSTEM = `You are a senior TypeScript/React Native test engineer.
Rules:
- Use jest + react-test-renderer + act (NO @testing-library/react-native)
- Import style: import React, { useEffect } from 'react'; renderer from 'react-test-renderer'
- Mock fetch via: (global as unknown as { fetch: jest.Mock }).fetch = jest.fn()...
- Mock modules with jest.mock() at the top level, before imports
- TypeScript strict mode — no 'any', use proper types
- Spy on console.warn / console.error and restore in afterEach
- Use jest.clearAllMocks() in beforeEach
- Each test must have a descriptive name and test ONE behaviour
- Export nothing — test files are scripts
- Return ONLY the complete file content. No markdown fences. No explanations.`;

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── 1: useAutoAssign.test.ts ────────────────────────────────────────────────
  {
    custom_id: '1-useAutoAssign',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for hooks/useAutoAssign.ts.

## Source under test:
\`\`\`typescript
${USE_AUTO_ASSIGN_TS}
\`\`\`

## Key dependencies to mock:
- @/services/shiftAssigner  → mock assignShifts
- @/services/rosterService  → mock upsertRosterShift
- @/services/analytics      → mock trackEvent
- @/services/logger         → mock log (log.info, log.warn, log.error)

## Style reference (follow exactly):
\`\`\`typescript
${USE_ROSTER_TEST_TSX.slice(0, 500)}
\`\`\`

## Test cases to cover (write ALL of them):
1. autoAssign — happy path: assignShifts returns 2 assignments, both persist → persisted.length=2, totalAssigned=2, coverageGaps=[]
2. autoAssign — algorithm throws → error message set, assigning=false, empty result, analytics called with success:false
3. autoAssign — upsertRosterShift fails for one shift → failedToPersist.length=1, persisted.length=1
4. autoAssign — coverage gap: template requires 2 but only 1 persists → coverageGaps has entry with shortfall=1
5. autoAssign — produces explanations with worker name, role, time window in reason string
6. reset() — clears result, explanations, error back to null
7. autoAssign — assigns=false during call, true after → check assigning transitions via state reads
8. analytics trackEvent — called with auto_assign_used on success AND on algorithm throw

Output file path: hooks/__tests__/useAutoAssign.test.ts`,
      }],
    },
  },

  // ── 2: demandForecast.test.ts ───────────────────────────────────────────────
  {
    custom_id: '2-demandForecast',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for services/demandForecast.ts.

## Source under test:
\`\`\`typescript
${DEMAND_FORECAST_TS}
\`\`\`

## Dependencies to mock:
- @/services/authToken  → mock getSessionToken (returns 'mock-token' or null)
- global fetch          → (global as unknown as { fetch: jest.Mock }).fetch = jest.fn()

## Test cases to cover (write ALL of them):
1. getForecastDataStatus — happy path: proxy returns hasHistorical:true, hasExternalSignals:false → returns matching status object
2. getForecastDataStatus — fetch throws → returns all-false fallback (no throw)
3. getForecastDataStatus — includes Authorization header when getSessionToken returns a token
4. getForecastDataStatus — omits Authorization header when getSessionToken returns null
5. generateDemandForecast — happy path: returns forecasts array and metadata from proxy
6. generateDemandForecast — fetch rejects → returns empty forecasts + fallback metadata (no throw)
7. generateDemandForecast — response.ok=false → returns fallback (no throw)
8. loadDemandTargets — filters out non-override targets (source !== 'override')
9. loadDemandTargets — fetch throws → returns [] (no throw)
10. upsertDemandTarget — happy path: proxy returns success:true → {success:true, target}
11. upsertDemandTarget — proxy returns success:false with error → {success:false, error}
12. upsertDemandTarget — fetch throws → {success:false, error message from Error}
13. upsertDemandTarget — normalises required to Number() and defaults source to 'override'

Output file path: services/__tests__/demandForecast.test.ts`,
      }],
    },
  },

  // ── 3: useDemandAnalysis.test.ts ────────────────────────────────────────────
  {
    custom_id: '3-useDemandAnalysis',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for hooks/useDemandAnalysis.ts.

## Source under test:
\`\`\`typescript
${USE_DEMAND_ANALYSIS_TS}
\`\`\`

## Dependencies to mock:
- @/services/demandForecast  → mock loadDemandTargets
- @/hooks/useRoster          → mock useRoster (returns { roster: [], loading: false })
- @/hooks/useShiftTemplates  → mock useShiftTemplates (returns { shiftTemplates: [] })

## Style reference:
\`\`\`typescript
${USE_ROSTER_TEST_TSX.slice(0, 400)}
\`\`\`

## Test cases to cover (write ALL):
1. Initial state — loading=false, all arrays empty when no targets
2. Loads current and prior week targets on mount (loadDemandTargets called twice)
3. demandVsPrior — changePct=100 when prior=0 and current>0
4. demandVsPrior — changePct=0 when both prior=0 and current=0
5. demandVsPrior — correct percentage when prior!=0 (e.g. prior=10, current=12 → +20%)
6. weeklyDemandSummary — correct avgRequired and peakDay from multiple targets
7. forecastExplanation — includes weekend premium factor for Saturday/Sunday dates
8. forecastExplanation — includes OLS trend factor when multiple targets exist for a role
9. forecastExplanation — includes external signal factor when target has notes
10. forecastAccuracy — computes errorPct against published roster shifts matching role+date
11. confidenceIntervals — only includes targets that have lowerBound + upperBound + confidence
12. loadDemandTargets throws → error state set, loading false
13. Stale request ignored — second call supersedes first (requestId guard)

Output file path: hooks/__tests__/useDemandAnalysis.test.ts`,
      }],
    },
  },

  // ── 4: syncQueue.test.ts ────────────────────────────────────────────────────
  {
    custom_id: '4-syncQueue',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for services/syncQueue.ts.

## Source under test:
\`\`\`typescript
${SYNC_QUEUE_TS}
\`\`\`

## Dependencies to mock:
- @react-native-async-storage/async-storage  → jest.mock, already mocked by jest-expo
- global fetch                               → (global as unknown as { fetch: jest.Mock }).fetch = jest.fn()
- timers (setInterval/clearInterval)         → jest.useFakeTimers() in beforeEach

## Important: the module uses module-level state (_queue, _flushing, etc.)
  Reset module between tests with jest.resetModules() in beforeEach, then re-import
  OR manually reset by calling configureSyncQueue with fresh config each test.

## Test cases (write ALL):
1. enqueueSyncOp — adds operation to queue (getSyncStatus().pendingCount increases)
2. enqueueSyncOp — drops operation when queue is at MAX_QUEUE_SIZE (200)
3. enqueueSyncOp — transitions status to 'saving'
4. _flush via interval — successful HTTP response removes op from queue
5. _flush — 4xx response discards op (does not retry), pendingCount goes to 0
6. _flush — 5xx response retries op (retries counter increments)
7. _flush — op discarded after maxRetries exceeded
8. _flush — offline (_isOnline=false) skips flushing
9. _flush — not configured (no proxyUrl) skips flushing
10. _flush — concurrent flush guard (_flushing=true) prevents double flush
11. _loadPersistedQueue — merges persisted queue from AsyncStorage on configureSyncQueue
12. _loadPersistedQueue — ignores malformed AsyncStorage data (no throw)
13. _isSyncOperation — rejects invalid shapes
14. retryNow — resets retry counters and triggers flush
15. useSyncStatus hook — status reflects module-level _currentStatus; updates on enqueue

Output file path: services/__tests__/syncQueue.test.ts`,
      }],
    },
  },

  // ── 5: analytics.test.ts ────────────────────────────────────────────────────
  {
    custom_id: '5-analytics',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 5120,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for services/analytics.ts.

## Source under test:
\`\`\`typescript
${ANALYTICS_TS}
\`\`\`

## Dependencies to mock:
- @react-native-async-storage/async-storage  → already mocked by jest-expo preset
- ./analyticsTransport                       → mock enqueue function
- react-native (Platform)                    → jest.mock with Platform.OS = 'ios'

## Test cases (write ALL):
1. trackEvent — stores event in AsyncStorage (getTrackedEvents returns it)
2. trackEvent — merges _baseProps into stored props
3. trackEvent — calls enqueue() on analyticsTransport with correct shape
4. trackEvent — calls _provider.track() when provider set via setAnalyticsProvider
5. trackEvent — does NOT throw when AsyncStorage fails (swallowed)
6. trackEvent — does NOT throw when enqueue fails (swallowed)
7. trackEvent — caps stored events at MAX_EVENTS (200) — oldest dropped
8. trackEvent — typed constraint: error_displayed requires code+screen props (TypeScript compile test — just assert props flow)
9. setBaseProps — injected into subsequent trackEvent calls
10. setAnalyticsProvider — provider.track called on next event, not on previous
11. getTrackedEvents — returns [] when AsyncStorage is empty
12. getTrackedEvents — returns [] when AsyncStorage throws (swallowed)
13. getTrackedEvents — parses and returns stored EventRecord[]

Output file path: services/__tests__/analytics.test.ts`,
      }],
    },
  },

  // ── 6: E2E negative + edge cases ────────────────────────────────────────────
  {
    custom_id: '6-e2e-negative',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: `You are a senior Playwright test engineer.
Rules:
- Use @playwright/test: test, expect, Page
- Follow the exact helper pattern from the reference spec (fillField, clickButton, goToScheduler)
- Use VISIBLE_TIMEOUT=10_000, NAV_TIMEOUT=30_000
- test.describe groups related negative/edge scenarios
- Never use hardcoded sleep — use waitFor, waitForLoadState, getByRole().waitFor()
- Return ONLY the complete file content. No markdown fences. No explanations.`,
      messages: [{
        role: 'user',
        content: `Write a complete Playwright E2E test file for NEGATIVE and EDGE-CASE scenarios in the scheduler.

## Reference spec (style + helpers to replicate):
\`\`\`typescript
${SCHEDULER_SPEC_TS}
\`\`\`

## Scenarios to cover (write ALL):

### Validation errors
1. Adding a worker with empty Name field → error/validation message visible
2. Adding a shift template with missing Role → error/validation message visible
3. Assigning a shift to a worker whose role does NOT match the template role → assignment rejected or error shown
4. Assigning a shift to a worker with NO availability set → assignment rejected or error shown

### Edge cases
5. Adding a worker with a very long name (200 chars) → graceful truncation or acceptance without crash
6. Adding duplicate worker name → UI either allows (and both show) or shows a helpful message — assert one of these outcomes
7. Creating a template with identical start and end time → validation error or graceful handling

### State persistence
8. After adding a worker, refreshing the page → worker list is empty (in-memory reset confirmed — documents the known limitation)

### Status transitions
9. Published shift → verify status badge shows "Published" text in the roster

Output file path: e2e/scheduler-negative.spec.ts`,
      }],
    },
  },

  // ── 7: META — best-in-class test ideas ──────────────────────────────────────
  {
    custom_id: '7-meta-test-ideas',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are a principal engineer reviewing a React Native scheduling app (Expo SDK 53, TypeScript strict, Supabase, jest-expo, Playwright E2E).

Current test coverage: ~23% of source files.
Existing tests cover: schedulerMetrics (pure functions), rosterService (CRUD), shiftAssigner (algorithm), useRoster/useWorkers/useShiftTemplates/useDemandForecast (hooks), posForecasting (engine), schedulerUtils/schedulerValidators (utils), basic E2E happy path.

About to add: useAutoAssign, demandForecast service, useDemandAnalysis, syncQueue, analytics, E2E negative scenarios.

## Your task
Think deeply about what ELSE the best engineering teams test that average teams miss. Consider:
1. Property-based / generative tests (fast-check) — where would random inputs expose bugs?
2. Snapshot tests — which components are stable UI and would benefit?
3. Performance / regression benchmarks — which pure functions run in hot paths?
4. Contract / integration tests — which service boundaries need real-vs-mock divergence checks?
5. Accessibility tests — axe-core / ARIA role coverage gaps?
6. Visual regression tests — Playwright screenshots for key states?
7. Mutation testing — where would Jest mutant survive and indicate weak assertions?
8. Timezone-sensitive tests — what date math is fragile across UTC offsets?
9. Concurrency / race condition tests — which async flows have stale-closure or requestId guard issues?
10. Security tests — input sanitization, XSS in user-provided strings rendered as text?

Produce a ranked, actionable list (top 15 ideas, highest ROI first) with:
- Test type
- Target file/module
- What it would catch that current tests miss
- Estimated effort (S/M/L)

Format as clean markdown.`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`\nSubmitting ${requests.length} requests to Anthropic Batch API…`);

const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID : ${batch.id}`);
console.log(`Status   : ${batch.processing_status}`);
console.log(`\nPolling every 30 s until batch completes…\n`);

// ─── Poll ─────────────────────────────────────────────────────────────────────

let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 30_000));
  current = await client.messages.batches.retrieve(batch.id);
  const counts = current.request_counts;
  console.log(
    `[${new Date().toISOString()}] processing=${counts.processing} ` +
    `succeeded=${counts.succeeded} errored=${counts.errored}`,
  );
}

console.log('\nBatch complete. Processing results…\n');

// ─── Output map ───────────────────────────────────────────────────────────────

const OUTPUT_MAP = {
  '1-useAutoAssign':   'hooks/__tests__/useAutoAssign.test.ts',
  '2-demandForecast':  'services/__tests__/demandForecast.test.ts',
  '3-useDemandAnalysis': 'hooks/__tests__/useDemandAnalysis.test.ts',
  '4-syncQueue':       'services/__tests__/syncQueue.test.ts',
  '5-analytics':       'services/__tests__/analytics.test.ts',
  '6-e2e-negative':    'e2e/scheduler-negative.spec.ts',
  '7-meta-test-ideas': 'scripts/test-ideas.md',
};

// ─── Collect results ──────────────────────────────────────────────────────────

for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  const outPath = OUTPUT_MAP[id];

  if (!outPath) {
    console.warn(`  ! Unknown custom_id: ${id}`);
    continue;
  }

  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${id} — ${result.result.type}`);
    if (result.result.type === 'errored') {
      console.error('    ', result.result.error);
    }
    continue;
  }

  const content = result.result.message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Meta request is markdown — don't strip fences from it
  const finalContent = id === '7-meta-test-ideas' ? content.trim() : stripFences(content);

  write(outPath, finalContent);
}

console.log('\nDone. Run `npm test` to verify the new test suites.');
