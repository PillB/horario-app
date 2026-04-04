# High-ROI Test Coverage Gaps — Ranked Action List

## Methodology Note
Rankings weight: (severity of bug if missed × likelihood of occurrence) ÷ implementation effort.

---

## 1. 🕐 Timezone-Sensitive Property Tests
**Type:** Property-based (fast-check) + timezone mocking
**Target:** `schedulerUtils`, `demandForecast` service, `shiftAssigner`
**Effort:** M

**What current tests miss:**
Shift boundary calculations (`shiftStart`, `shiftEnd`, overlap detection, duration math) almost certainly use `new Date()` or `.toISOString()` internally. These pass in CI (UTC) but silently produce off-by-one-hour bugs for users in `America/Chicago`, `Asia/Kolkata` (UTC+5:30 — a non-integer offset), or during DST transitions. A 2 AM shift on the DST "spring forward" night is 3 hours long, not 8.

```typescript
// fast-check + @sinonjs/fake-timers pattern
import * as fc from 'fast-check';
import { shiftDuration } from '../schedulerUtils';

const IANA_ZONES = [
  'America/New_York', 'America/Chicago', 'Asia/Kolkata',
  'Australia/Lord_Howe', // UTC+10:30 / UTC+11 — extreme DST edge
  'Pacific/Apia',        // UTC+13, crossed dateline
];

test('shift duration is never negative and always ≤ 24h', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...IANA_ZONES),
      fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
      fc.integer({ min: 0, max: 23 }),
      fc.integer({ min: 1, max: 12 }),
      (zone, date, startHour, durationHours) => {
        process.env.TZ = zone; // or use fake-timers
        const result = shiftDuration(date, startHour, startHour + durationHours);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(86400);
      }
    ),
    { numRuns: 500 }
  );
});
```

**What it catches:** DST gap/overlap crashes, negative durations, incorrect 30/45-minute offset handling, midnight-crossing shift miscalculations.

---

## 2. 🏎️ Performance Regression Benchmarks
**Type:** Benchmark / performance regression
**Target:** `shiftAssigner` algorithm, `posForecasting` engine, `schedulerMetrics`
**Effort:** S

**What current tests miss:**
`shiftAssigner` is a scheduling algorithm — likely O(n²) or worse on roster×shift combinations. No current test verifies it completes in bounded time. A roster growing from 20→200 workers could make the UI unresponsive with zero test signal.

```typescript
// jest-bench or simple performance.now() regression guard
import { assignShifts } from '../shiftAssigner';
import { generateRoster } from '../__fixtures__/rosterFactory';

test.each([
  [20, 50],   // small: must complete < 100ms
  [100, 200], // medium: must complete < 500ms
  [500, 1000], // large: must complete < 2000ms
])('assignShifts(%i workers, %i shifts) completes within budget', 
  (workerCount, shiftCount) => {
    const { workers, shifts } = generateRoster(workerCount, shiftCount);
    const start = performance.now();
    assignShifts(workers, shifts);
    const elapsed = performance.now() - start;
    
    const budgets = { 20: 100, 100: 500, 500: 2000 };
    expect(elapsed).toBeLessThan(budgets[workerCount]);
  }
);
```

Store baseline in `perf-baseline.json`, fail CI if regression > 20%. Use `jest-bench` or Vitest bench for stable measurements.

**What it catches:** Accidental O(n³) regressions, memory leaks causing GC pauses, algorithmic changes that seem correct but destroy mobile performance.

---

## 3. 🔄 Concurrency / Race Condition Tests
**Type:** Async race condition / stale closure
**Target:** `useAutoAssign`, `syncQueue`, `useDemandAnalysis`
**Effort:** M

**What current tests miss:**
`useAutoAssign` almost certainly fires an async request, and if the user triggers it twice rapidly (or navigates away mid-flight), the second response can overwrite the first. `syncQueue` likely has ordering guarantees that break under concurrent flushes.

```typescript
// Testing stale requestId guard pattern
import { renderHook, act } from '@testing-library/react-native';
import { useAutoAssign } from '../useAutoAssign';

test('rapid successive calls only apply result from latest request', async () => {
  let resolvers: Array<() => void> = [];
  
  mockAssignShifts.mockImplementation(() => 
    new Promise(resolve => resolvers.push(resolve))
  );

  const { result } = renderHook(() => useAutoAssign());
  
  act(() => { result.current.trigger(); }); // request 1
  act(() => { result.current.trigger(); }); // request 2 (supersedes)
  
  // Resolve request 1 AFTER request 2 — simulates slow first response
  act(() => resolvers[1](mockResult2)); // resolve 2nd first
  act(() => resolvers[0](mockResult1)); // resolve 1st last (stale)
  
  await waitFor(() => {
    // Must show result2, never result1
    expect(result.current.assignments).toEqual(mockResult2.assignments);
  });
  expect(result.current.assignments).not.toEqual(mockResult1.assignments);
});

// SyncQueue ordering test
test('syncQueue processes operations in FIFO order under concurrent pressure', async () => {
  const executionOrder: number[] = [];
  const ops = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    execute: () => Promise.resolve(executionOrder.push(i)),
  }));
  
  // Enqueue all simultaneously
  await Promise.all(ops.map(op => syncQueue.enqueue(op)));
  
  expect(executionOrder).toEqual([0,1,2,3,4,5,6,7,8,9]);
});
```

**What it catches:** UI showing wrong assignments after fast double-click, sync conflicts corrupting offline queue, memory leaks from unresolved promises after unmount.

---

## 4. 🧬 Property-Based Tests for Scheduler Invariants
**Type:** Property-based (fast-check)
**Target:** `shiftAssigner`, `schedulerValidators`, `schedulerMetrics`
**Effort:** M

**What current tests miss:**
Example-based tests verify specific cases. Property tests verify *invariants hold for all valid inputs*. Critical invariants nobody is testing:

```typescript
import * as fc from 'fast-check';

// Invariant 1: No worker is double-booked
test('no worker appears in overlapping shifts', () => {
  fc.assert(
    fc.property(
      arbitraryRoster(), // custom fast-check arbitrary
      (roster) => {
        const result = assignShifts(roster.workers, roster.shifts);
        const workerShifts = groupBy(result.assignments, 'workerId');
        
        for (const [workerId, assignments] of Object.entries(workerShifts)) {
          for (let i = 0; i < assignments.length; i++) {
            for (let j = i + 1; j < assignments.length; j++) {
              expect(shiftsOverlap(assignments[i], assignments[j])).toBe(false);
            }
          }
        }
      }
    ),
    { numRuns: 1000, seed: 42 } // deterministic seed for CI
  );
});

// Invariant 2: Metric calculations are internally consistent
test('schedulerMetrics coverage + understaffed + overstaffed = total shifts', () => {
  fc.assert(
    fc.property(arbitraryAssignmentResult(), (result) => {
      const metrics = calculateMetrics(result);
      expect(
        metrics.covered + metrics.understaffed + metrics.overstaffed
      ).toBe(metrics.totalShifts);
    })
  );
});

// Invariant 3: Validator is monotone — fixing violations never creates new ones
test('applying suggested fix never increases violation count', () => {
  fc.assert(
    fc.property(arbitrarySchedule(), (schedule) => {
      const initial = validateSchedule(schedule).violations.length;
      const fixed = applyFixes(schedule, suggestFixes(schedule));
      const after = validateSchedule(fixed).violations.length;
      expect(after).toBeLessThanOrEqual(initial);
    })
  );
});
```

**What it catches:** Edge cases in constraint satisfaction (0 workers, single worker, more shifts than workers), metric arithmetic bugs, validator regression on fix application.

---

## 5. 🤝 Contract Tests for Supabase Service Boundaries
**Type:** Contract / integration tests
**Target:** `rosterService`, `demandForecast` service, `syncQueue` ↔ Supabase
**Effort:** L

**What current tests miss:**
Your mocks of Supabase likely don't reflect the *actual* response shape, null behavior, or error codes. When Supabase changes a column type or your RLS policy silently filters rows, mocked tests stay green while production breaks.

```typescript
// pact-js consumer contract or simpler: schema validation against real responses
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod'; // or use generated types

// Schema derived from your Supabase TypeScript types
const ShiftSchema = z.object({
  id: z.string().uuid(),
  worker_id: z.string().uuid().nullable(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  role: z.enum(['cashier', 'supervisor', 'stock']),
  created_at: z.string().datetime(),
});

// Run against local Supabase (supabase start)
describe('rosterService contract', () => {
  test('getShifts returns shape matching application schema', async () => {
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .limit(1);
    
    expect(() => ShiftSchema.parse(data![0])).not.toThrow();
  });

  test('RLS: user cannot read other org shifts', async () => {
    const otherUserClient = createClient(url, key, { 
      global: { headers: { Authorization: `Bearer ${otherUserJwt}` }}
    });
    const { data, error } = await otherUserClient
      .from('shifts').select('*');
    
    expect(data).toHaveLength(0); // RLS filters, not errors
  });
  
  test('syncQueue handles Supabase 409 conflict correctly', async () => {
    // Force conflict, verify retry behavior
  });
});
```

**What it catches:** Silent RLS policy breaks, column renames breaking the app, null vs undefined mismatches between mock and real, missing indexes causing timeout-based failures.

---

## 6. 🧟 Mutation Testing
**Type:** Mutation testing (Stryker)
**Target:** `schedulerValidators`, `schedulerMetrics`, `shiftAssigner`
**Effort:** M

**What current tests miss:**
Your `schedulerMetrics` tests are described as covering "pure functions" but mutation testing reveals whether assertions are *tight enough*. A mutant that changes `>=` to `>` in a coverage calculation survives if your test only checks truthy/falsy or a range.

```bash
# stryker.config.json
{
  "mutate": [
    "src/services/schedulerMetrics.ts",
    "src/services/schedulerValidators.ts", 
    "src/services/shiftAssigner.ts"
  ],
  "testRunner": "jest",
  "reporters": ["html", "json"],
  "thresholds": { "high": 80, "low": 60, "break": 50 }
}
```

**Expected survivors to fix:**
- `coverageRate >= threshold` → `coverageRate > threshold` (off-by-one in boundary conditions)
- `violations.length === 0` → `violations.length < 1` (trivially different but semantically important)
- Array index arithmetic in shift overlap: `endA > startB` → `endA >= startB`

**What it catches:** Tests that assert the wrong thing (check type not value), tests using `toBeTruthy` instead of `toBe(true)`, missing branch coverage for boundary values.

---

## 7. ♿ Accessibility Tests
**Type:** Accessibility (axe-core + ARIA role assertions)
**Target:** Scheduler screen, Shift assignment modal, Worker list
**Effort:** M

**What current tests miss:**
React Native accessibility is easy to break silently. `accessibilityLabel`, `accessibilityRole`, `accessibilityHint` on interactive elements are often missing or wrong, making the app unusable for screen reader users.

```typescript
// jest-axe doesn't cover RN, but @testing-library/react-native has a11y queries
import { render, screen } from '@testing-library/react-native';
import { ShiftCard } from '../components/ShiftCard';

test('ShiftCard has accessible role and label', () => {
  render(<ShiftCard shift={mockShift} onPress={jest.fn()} />);
  
  // Must be queryable by assistive technology
  expect(screen.getByRole('button', { name: /Morning Shift - John Doe/i }))
    .toBeTruthy();
});

test('unassigned shift communicates state to screen readers', () => {
  render(<ShiftCard shift={unassignedShift} onPress={jest.fn()} />);
  
  const card = screen.getByRole('button');
  expect(card.props.accessibilityState?.disabled).toBe(false);
  expect(card.props.accessibilityHint).toMatch(/tap to assign/i);
});

// Playwright E2E: check focus management after modal open
test('focus moves to modal after shift assignment opens', async ({ page }) => {
  await page.click('[data-testid="assign-shift-btn"]');
  const modal = page.getByRole('dialog');
  await expect(modal).toBeFocused(); // or first focusable child
});
```

**What it catches:** Missing labels on icon-only buttons, modals that trap focus incorrectly, list items without proper roles, color-only status indicators.

---

## 8. 📸 Snapshot Tests for Stable UI Components
**Type:** Snapshot (component) + Playwright visual regression
**Target:** `ShiftCard`, `WorkerBadge`, `DemandChart`, `MetricsSummary`
**Effort:** S

**What current tests miss:**
Pure display components with no logic get changed accidentally during refactors (padding, color tokens, conditional rendering logic).

```typescript
// Component snapshot — stable, logic-free display
import renderer from 'react-test-renderer';

test('ShiftCard renders assigned state correctly', () => {
  const tree = renderer.create(
    <ShiftCard 
      shift={mockAssignedShift}
      worker={mockWorker}
      testID="shift-card"
    />
  ).toJSON();
  expect(tree).toMatchSnapshot();
});

// Critical: test EACH meaningful state variant
test.each([
  ['assigned', mockAssignedShift, mockWorker],
  ['unassigned', mockUnassignedShift, null],
  ['conflict', mockConflictShift, mockWorker],
  ['loading', mockShift, null, true],
])('ShiftCard snapshot: %s state', (state, shift, worker, loading = false) => {
  const tree = renderer.create(
    <ShiftCard shift={shift} worker={worker} loading={loading} />
  ).toJSON();
  expect(tree).to