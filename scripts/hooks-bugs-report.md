# React Native Hooks Bug Analysis

---

## Bug 1: Optimistic Updates Are Never Rolled Back on DB Failure

**Severity: High**
**Files: `useWorkers.ts`, `useRoster.ts`, `useShiftTemplates.ts`**

### Root Cause

All three hooks apply optimistic updates unconditionally, then on DB failure log a warning and return `{ success: true }` — lying to the caller. The local state is permanently diverged from the server and there is no mechanism to reverse the phantom entry. The caller in `useSchedulerHandlers.ts` checks `result.success` and shows a success message, so the user believes the operation succeeded when the record was never persisted.

```typescript
// useWorkers.ts — current broken pattern
setWorkers((prev) => [...prev, dbToWorker(newWorker, [], prev.length)]);
const result = await upsertWorker(newWorker);
if (!result.success) {
  log.warn(...); // ← state is left dirty
  return { success: true, worker: newWorker }; // ← caller is deceived
}
```

### Fix

Roll back the optimistic state on failure and return the real result:

```typescript
// useWorkers.ts
const addWorker = useCallback(
  async (name: string, role: string, skills: string[]): Promise<UpsertWorkerResult> => {
    const newWorker: DbWorker = {
      id: generateId(),
      accountId,
      name,
      role,
      skills,
    };

    // 1. Optimistic insert
    setWorkers((prev) => [...prev, dbToWorker(newWorker, [], prev.length)]);

    const result = await upsertWorker(newWorker);

    if (!result.success) {
      // 2. Roll back: remove the optimistically added worker
      setWorkers((prev) => prev.filter((w) => w.id !== newWorker.id));
      log.warn('WORKER', 'Worker upsert failed, rolled back optimistic update', {
        workerId: newWorker.id,
      });
      return result; // ← return real failure to the caller
    }

    log.info('WORKER', 'Worker added successfully', {
      workerId: newWorker.id,
      accountId,
      skillCount: skills.length,
    });
    return result;
  },
  [accountId]
);

// useWorkers.ts — addAvailability rollback
const addAvailability = useCallback(
  async (workerId: string, day: DayOfWeek, from: string, to: string): Promise<UpsertAvailabilityResult> => {
    const newAvailability: DbAvailability = {
      id: generateId(),
      accountId,
      workerId,
      dayOfWeek: day,
      fromTime: from,
      toTime: to,
    };

    setWorkers((prev) =>
      prev.map((w) =>
        w.id !== workerId ? w : { ...w, availability: [...w.availability, { day, from, to }] }
      )
    );

    const result = await upsertAvailability(newAvailability);

    if (!result.success) {
      // Roll back: remove the optimistically added slot
      setWorkers((prev) =>
        prev.map((w) =>
          w.id !== workerId
            ? w
            : {
                ...w,
                availability: w.availability.filter(
                  (slot) => !(slot.day === day && slot.from === from && slot.to === to)
                ),
              }
        )
      );
      log.warn('WORKER', 'Availability upsert failed, rolled back', { workerId });
      return result;
    }

    log.info('WORKER', 'Availability added successfully', { workerId, day });
    return result;
  },
  [accountId]
);
```

Apply the same pattern to `useRoster.ts` (`addShift`, `setShiftStatus`, `notifyShift`, `removeShift`) and `useShiftTemplates.ts` (`addShiftTemplate`):

```typescript
// useRoster.ts — setShiftStatus rollback example
const setShiftStatus = useCallback(
  async (id: string, status: 'Draft' | 'Published'): Promise<MutationResult> => {
    // Capture previous state for rollback
    let previousShift: Shift | undefined;
    setRoster((prev) => {
      previousShift = prev.find((s) => s.id === id);
      return prev.map((s) => (s.id === id ? { ...s, status, notified: false } : s));
    });

    const result = await updateShiftStatus(id, status);

    if (!result.success && previousShift) {
      // Roll back to the captured previous status
      const snapshot = previousShift;
      setRoster((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: snapshot.status, notified: snapshot.notified } : s
        )
      );
      log.warn('ROSTER', 'Shift status update failed, rolled back', { shiftId: id });
      return result;
    }

    log.info('ROSTER', 'Shift status changed', { shiftId: id, status });
    return result;
  },
  []
);
```

---

## Bug 2: `applyAutoAssign` Reads Stale `autoAssignSuggestions` After Setting It to `null`

**Severity: High**
**File: `useSchedulerHandlers.ts`**

### Root Cause

The callback captures `autoAssignSuggestions` in its closure. After the `for` loop, `setAutoAssignSuggestions(null)` is called, but the closure still holds the original array reference. The subsequent `showActionBanner` call then reads `autoAssignSuggestions.length` from the captured (now stale) variable. This is actually the one case where it works by accident — but the real bug is structural: setting state and then immediately reading it in the same closure is an anti-pattern that will break if the code is refactored. More critically, if the component unmounts mid-loop, `setAutoAssignApplying(false)` and `showActionBanner` will trigger state updates on an unmounted component.

```typescript
// current code — subtle stale reference and no unmount guard
const applyAutoAssign = useCallback(async () => {
  if (!autoAssignSuggestions?.length) return;
  setAutoAssignApplying(true);
  let successCount = 0;
  for (const suggestion of autoAssignSuggestions) {
    const result = await addShift({ ... });
    if (result.success) successCount += 1;
  }
  setAutoAssignSuggestions(null);
  setAutoAssignApplying(false);
  if (successCount > 0) {
    await incrementUsage();
    void trackEvent('auto_assign_used', { successCount });
  }
  // BUG: autoAssignSuggestions is already null in React state but the closure
  // still references the captured value — works here but is fragile.
  showActionBanner(
    `Applied ${successCount} of ${autoAssignSuggestions.length} ...`,
    ...
  );
}, [addShift, autoAssignSuggestions, incrementUsage, showActionBanner]);
```

### Fix

Snapshot the array at the top of the function and add an unmount guard:

```typescript
const applyAutoAssign = useCallback(async () => {
  if (!autoAssignSuggestions?.length) return;

  // Snapshot immediately so the closure is self-contained regardless of
  // state mutations during the async loop.
  const suggestions = autoAssignSuggestions;
  const totalCount = suggestions.length;

  let isCancelled = false;
  setAutoAssignApplying(true);

  let successCount = 0;
  for (const suggestion of suggestions) {
    if (isCancelled) break;
    const result = await addShift({
      date: suggestion.date,
      workerId: suggestion.workerId,
      templateId: suggestion.templateId,
      location: 'HQ',
      status: 'Draft',
      notified: false,
    });
    if (result.success) successCount += 1;
  }

  setAutoAssignSuggestions(null);
  setAutoAssignApplying(false);

  if (successCount > 0) {
    await incrementUsage();
    void trackEvent('auto_assign_used', { successCount });
  }

  // Use the snapshotted length — never read state after awaits
  showActionBanner(
    `Applied ${successCount} of ${totalCount} auto-assign suggestion(s).`,
    successCount === totalCount ? 'success' : 'info'
  );

  return () => { isCancelled = true; };
}, [addShift, autoAssignSuggestions, incrementUsage, showActionBanner]);
```

---

## Bug 3: Onboarding Persistence Effect Creates an Infinite Loop

**Severity: High**
**File: `useSchedulerHandlers.ts`**

### Root Cause

The `persistProgress` effect depends on `savedOnboardingProgress`. When persistence succeeds, it calls `setSavedOnboardingProgress(persisted)`, which changes `savedOnboardingProgress`, which re-runs the effect. On the next run, `shouldPersist` is `false` because `next === previous` — so it returns early. This means there is no infinite network loop in the happy path, but on repeated renders caused by other state changes, the effect re-evaluates `savedOnboardingProgress`, computes `shouldPersist`, and exits. The real danger is during error recovery: if `upsertOnboardingProgress` throws or returns `null`, `savedOnboardingProgress` is never updated, so every re-render triggered by `derivedOnboardingFlags` or `accountId` re-fires the upsert indefinitely.

```typescript
// current — savedOnboardingProgress in deps causes re-evaluation loop
useEffect(() => {
  const persistProgress = async () => {
    const previous = savedOnboardingProgress ?? { ... }; // ← reads from deps
    // ...
    const persisted = await upsertOnboardingProgress(accountId, next, userId);
    if (persisted) {
      setSavedOnboardingProgress(persisted); // ← changes dep → re-runs effect
    }
    // if persisted is null/undefined: no update → next render re-fires upsert
  };
  persistProgress();
}, [accountId, derivedOnboardingFlags, savedOnboardingProgress, userId]); // ← problem
```

### Fix

Use a ref to track what has already been persisted, so the effect only fires when `derivedOnboardingFlags` changes, not when `savedOnboardingProgress` is written:

```typescript
const persistedFlagsRef = useRef<OnboardingProgress | null>(null);

useEffect(() => {
  // Only persist when derivedOnboardingFlags change; never react to our own writes.
  const persistProgress = async () => {
    const baseline = persistedFlagsRef.current ?? savedOnboardingProgress ?? {
      workers: false,
      templates: false,
      forecast: false,
    };

    const next: OnboardingProgress = { ...baseline };
    let changed = false;
    (['workers', 'templates', 'forecast'] as const).forEach((key) => {
      if (derivedOnboardingFlags[key] && !baseline[key]) {
        next[key] = true;
        changed = true;
      }
    });

    if (!changed) return;

    // Optimistically mark as persisted so a retry storm cannot occur
    persistedFlagsRef.current = next;
    setSavedOnboardingProgress(next);

    const persisted = await upsertOnboardingProgress(accountId, next, userId);
    if (!persisted) {
      // Revert the ref so the next genuine change retries
      persistedFlagsRef.current = baseline;
      log.warn('ONBOARDING', 'Failed to persist onboarding progress');
    } else {
      persistedFlagsRef.current = persisted;
      setSavedOnboardingProgress(persisted);
    }
  };

  void persistProgress();
  // Intentionally exclude savedOnboardingProgress: we write to it here and
  // must not react to our own writes.
}, [accountId, derivedOnboardingFlags, userId]);
```

---

## Bug 4: `useRoster` — `loadWorkers` Missing `setError` on Exception Path

**Severity: High**
**Files: `useWorkers.ts`, `useRoster.ts`, `useShiftTemplates.ts`**

### Root Cause

All three `load*` callbacks do not wrap the `await` calls in try/catch. If `listWorkers`, `listRoster`, or `listShiftTemplates` rejects (network error, DB timeout), `setLoading(false)` is never called, leaving the component in a permanent loading state. The `error` state is also never set, so the UI has no information to show.

```typescript
// useWorkers.ts — current broken
const loadWorkers = useCallback(async () => {
  setLoading(true);
  setError(null);
  const [dbWorkers, dbAvailabilities] = await Promise.all([ // ← throws → hangs
    listWorkers(accountId),
    listWorkerAvailability(accountId),
  ]);
  // ...
  setLoading(false); // ← never reached on rejection
}, [accountId]);
```

### Fix

```typescript
// useWorkers.ts
const loadWorkers = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const [dbWorkers, dbAvailabilities] = await Promise.all([
      listWorkers(accountId),
      listWorkerAvailability(accountId),
    ]);
    const mapped = dbWorkers.map((w, i) => dbToWorker(w, dbAvailabilities, i));
    setWorkers(mapped);
    log.debug('WORKER', 'Workers loaded', { count: mapped.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load workers';
    setError(message);
    log.error('WORKER', 'Failed to load workers', { error: message });
  } finally {
    setLoading(false);
  }
}, [accountId]);
```

Apply identically to `loadRoster` in `useRoster.ts` and `loadTemplates` in `useShiftTemplates.ts`.

---

## Bug 5: State Updates on Unmounted Component in `useWorkers` / `useRoster` / `useShiftTemplates`

**Severity: High**
**Files: `useWorkers.ts`, `useRoster.ts`, `useShiftTemplates.ts`**

### Root Cause

The `loadWorkers` / `loadRoster` / `loadTemplates` callbacks are triggered by `useEffect`, but if the component unmounts while the `await Promise.all(...)` is in flight, the subsequent `setWorkers(mapped)` / `setRoster(mapped)` / `setShiftTemplates(mapped)` calls target an unmounted component. React 18 silently ignores these but they are a logic error and waste work; in React 17 they generate the "Can't perform a React state update on an unmounted component" warning.

The same problem affects `fetchOnboardingProgress` in `useSchedulerHandlers.ts` — it already has an `isMounted` guard, but the pattern is inconsistently applied.

### Fix

Use an `AbortController` so in-flight fetches are cancelled cleanly:

```typescript
// useWorkers.ts
const loadWorkers = useCallback(
  async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [dbWorkers, dbAvailabilities] = await Promise.all([
        listWorkers(accountId, signal),
        listWorkerAvailability(accountId, signal),
      ]);
      if (signal?.aborted) return;
      const mapped = dbWorkers.map((w, i) => dbToWorker(w, dbAvailabilities, i));
      setWorkers(mapped);
      log.debug('WORKER', 'Workers loaded', { count: mapped.length });
    } catch (err) {
      if (signal?.aborted) return; // ignore cancellation errors
      const message = err instanceof Error ? err.message : 'Failed to load workers';
      setError(message);
      log.error('WORKER', 'Failed to load workers', { error: message });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  },
  [accountId]
);

useEffect(() => {
  const controller = new AbortController();
  loadWorkers(controller.signal);
  return () => controller.abort();
}, [loadWorkers]);

// Expose refresh without the signal (user-initiated, component is mounted)
const refresh = useCallback(() => loadWorkers(), [loadWorkers]);

return { workers, loading, error, addWorker, addAvailability, refresh };
```

---

## Bug 6: `useRoster` — `filtersKey` / `filtersRef` Approach Causes ESLint Exhaustive-Deps Suppression That Hides a Real Bug

**Severity: High**
**File: `useRoster.ts`**

### Root Cause

`loadRoster` is declared with `// eslint-disable-next-line react-hooks/exhaustive-deps` and depends on `filtersKey` (a JSON string) rather than the `filters` object. However, `filtersRef.current` — read inside `loadRoster` — is the *live* filters value at the time of the call, not the value at the time the callback was created. This means:

1. If `filters` changes between renders and `loadRoster` is called from a ref-based timer or event (outside the effect), it reads the latest filter but `loadRoster` is only recreated when `filtersKey` changes. Stale closure is partially avoided but the dependency suppression makes the linter unable to flag future breakage.
2. The `filtersRef` is updated on every render (`filtersRef.current = filters`), which is outside any `useCallback`. If `listRoster` is slow and a new render updates `filtersRef.current` before the Promise resolves, the results returned by the old `listRoster` call will be stored in state even though they correspond to a different filter set.

```typescript
// Problematic: filtersRef.current may have changed by the time the await resolves
const loadRoster = useCallback(async () => {
  setLoading(true);
  setError(null);
  const shifts = await listRoster(accountId, filtersRef.current); // ← stale by resolve time
  const mapped = shifts.map(dbToShift);
  setRoster(mapped); // ← wrong filter results stored
  setLoading(false);
}, [accountId, filtersKey]); // ← eslint-disable hides this
```

### Fix

Capture the filter value at invocation time, not via ref:

```typescript
export const useRoster = (accountId: string, filters?: RosterFilters) => {
  const [roster, setRoster] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable serialised key drives the effect; no ref needed.
  const filtersKey = JSON.stringify(filters ?? null);

  const loadRoster = useCallback(
    async (signal?: AbortSignal) => {
      // Parse back from the stable key so the closure value is consistent
      // with the render that produced filtersKey.
      const currentFilters: RosterFilters | undefined =
        filtersKey !== 'null' ? (JSON.parse(filtersKey) as RosterFilters) : undefined;

      setLoading(true);
      setError(null);
      try {
        const shifts = await listRoster(accountId, currentFilters, signal);
        if (signal?.aborted) return;
        const mapped = shifts.map(dbToShift);
        setRoster(mapped);
        log.debug('ROSTER', 'Roster loaded', { count: mapped.length });
      } catch (err) {
        if (signal?.aborted) return;
        const message = err instanceof Error ? err.message : 'Failed to load roster';
        setError(message);
        log.error('ROSTER', 'Failed to load roster', { error: message });
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [accountId, filtersKey] // no eslint-disable needed now
  );

  useEffect(() => {
    const controller = new AbortController();
    loadRoster(controller.signal);
    return () => controller.abort();
  }, [loadRoster]);

  // ... rest unchanged
};
```

---

## Bug 7: Forecast Auto-Trigger Effect Can Fire `runForecast` While `forecasting` Is Already True

**Severity: High**
**File: `useSchedulerHandlers.ts`**

### Root Cause

`runForecast` is listed as a dependency of the debounce effect. `runForecast` itself depends on `forecasting` and `forecastLoading` — so when those change (e.g., when a forecast starts), `runForecast` is recreated, which causes the debounce effect to re-run, which clears and resets the 600ms timer. Because `forecastLoading || forecasting` is checked inside the effect body and causes an early return, the timer is never set. However, there is a window between when the timeout fires and calls `runForecast()` and when `forecasting` becomes `true` in the next render. During that window the guard inside `runForecast` does check the captured `forecasting` value, which is stale (still `false`), so a duplicate forecast request can be submitted.

```typescript
// runForecast captures forecasting at creation time
const runForecast = useCallback(() => {
  if (!isForecastInputValid || forecasting || forecastLoading) return; // ← stale closure value
  // ...
  triggerForecast({ date: forecastDate, role: forecastRole });
}, [..., forecasting, forecastLoading, ...]);

// The 600ms setTimeout captures the runForecast that was current when the
// effect ran — if forecasting flips to true before the timeout fires, the
// callback's check sees the old false value.
```

### Fix

Use a ref to hold the latest `forecasting` state for the synchronous guard, so the check at call-time reflects the current value:

```typescript
const forecastingRef = useRef(forecasting);
forecastingRef.current = forecasting;
const forecastLoadingRef = useRef(forecastLoading);
forecastLoadingRef.current = forecastLoading;

const runForecast = useCallback(() => {
  // Read from refs for an up-to-date check at the moment of invocation
  if (!isForecastInputValid || forecastingRef.current || forecastLoadingRef.current) return;
  setForecastPending(false);
  if (!baselineTargetsRef.current && demandTargets.length) {
    baselineTargetsRef.current = demandTargets;
  }
  triggerForecast({ date: forecastDate, role: forecastRole });
}, [
  baselineTargetsRef,
  demandTargets,
  forecastDate,
  forecastRole,
  // forecasting and forecastLoading removed — read from refs
  isForecastInputValid,
  triggerForecast,
]);
```

---

## Bug 8: `celebrateRosterPublish` Captures `reduceMotionEnabled` as Stale Closure

**Severity: Medium**
**File: `useSchedulerHandlers.ts`**

### Root Cause

`celebrateRosterPublish` is memoised with `reduceMotionEnabled` in its dependency array. However, the callback is stored inside `handlePublishShift`, which calls `doPublish` asynchronously after an `Alert.alert` confirmation. If the user switches reduce-motion between when the Alert appears and when they confirm, the captured `reduceMotionEnabled` inside `celebrateRosterPublish` is stale.

```typescript
const celebrateRosterPublish = useCallback(() => {
  setPublishCelebration((prev) => ({
    badgeVisible: true,
    confettiBurst: prev.badgeVisible || reduceMotionEnabled ? false : true,
    //                                   ^^^ captured at useCallback creation time
  }));
}, [reduceMotionEnabled]);
```

### Fix

Read from a ref to always reflect the latest value:

```typescript
const reduceMotionRef = useRef(reduceMotionEnabled);
useEffect(() => {
  reduceMotionRef.current = reduceMotionEnabled;
}, [reduceMotionEnabled]);

const celebrateRosterPublish = useCallback(() => {
  setPublishCelebration((prev) => ({
    badgeVisible: true,
    confettiBurst: prev.badgeVisible || reduceMotionRef.current ? false : true,
  }));
}, []); // stable — reads from ref at call time
```

---

## Bug 9: `seedTourData` Race Condition — Worker IDs Accessed Before `addWorker` Resolves Correctly

**Severity: Medium**
**File: `useSchedulerHandlers.ts`**

### Root Cause

`addWorker` for worker 3 (`James Williams`) is awaited serially, but the comment says "to avoid race on optimistic state". However, `w1.worker?.id` and `w2.worker?.id` use optional chaining — if `addWorker` returns a failure result (which the current broken implementation never does, but a corrected one will), `w1.worker` is `undefined`, the ID is silently `undefined`, and the subsequent `addShift` calls are skipped with no user feedback. The `Promise.all` for templates runs concurrently with a serially awaited third worker, which creates the following ordering: `w1`+`w2` start → `w3` starts only after `w1`+`w2` resolve → `tmpl1`+`tmpl2` start only after `w3` resolves. This is unnecessarily sequential.

Additionally, `addShiftTemplate` now (after Bug 1 fix) can return `result.template` as `undefined` on failure, causing `t1Id` / `t2Id` to be `undefined` and all shift creation to be silently skipped.

```typescript
// Current — workers and templates depend on success of earlier steps but failures are silent
const [w1, w2] = await Promise.all([addWorker(...), addWorker(...)]);
await addWorker('James Williams', ...);          // result discarded
const [tmpl1, tmpl2] = await Promise.all([...]);

const w1Id = w1.worker?.id;   // undefined if addWorker failed
const w2Id = w2.worker?.id;   // undefined if addWorker failed
```

### Fix

```typescript
const seedTourData = useCallback(async () => {
  if (workers.length > 0) return;

  const dateOffset = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // Workers are independent — run concurrently but check every result
  const [w1Result, w2Result, w3Result] = await Promise.all([
    addWorker('Alex Johnson', 'Server', ['Tables', 'POS']),
    addWorker('Maria Garcia', 'Barista', ['Espresso', 'Cold Brew']),
    addWorker('James Williams', 'Server', ['Tables', 'Bar']),
  ]);

  const [tmpl1Result, tmpl2Result] = await Promise.all([
    addShiftTemplate('Morning Server', 'Server', '08:00', '14:00', 2),
    addShiftTemplate('Evening Barista', 'Barista', '16:00', '22:00', 1),
  ]);

  // Bail out with feedback if any critical step failed
  if (!w1Result.success || !w2Result.success || !tmpl1Result.success || !tmpl2Result.success) {
    showActionBanner('Tour data setup partially failed. Please try again.', 'error');
    return;
  }

  const w1Id = w1Result.worker.id;
  const w2Id = w2Result.worker.id;
  const t1Id = tmpl1Result.template.id;
  const t2Id = tmpl2Result.template.id;

  await Promise.all([
    addShift({ date: dateOffset(1), workerId: w1Id, templateId: t1Id, location: 'Main Floor', status: 'Draft', notified: false }),
    addShift({ date: dateOffset(3), workerId: w1Id, templateId: t1Id, location: 'Main Floor', status: 'Published', notified: true }),
    addShift({ date: dateOffset(2), workerId: w2Id, templateId: t2Id, location: 'Bar', status: 'Draft', notified: false }),
    addShift({ date: dateOffset(5), workerId: w2Id, templateId: t2Id, location: 'Bar', status: 'Published', notified: true }),
  ]);

  if (!reduceMotionEnabled) {
    setPublishCelebration({ badgeVisible: false, confettiBurst: true });
  }
  showActionBanner(t('tour.completed.seedConfirmation'), 'success');
}, [workers.length, addWorker, addShiftTemplate, addShift, reduceMotionEnabled, showActionBanner, t]);
```

---

## Bug 10: `handleAddWorker` Reads `workers.length` After the Optimistic State Update Has Already Incremented It

**Severity: Medium**
**File: `useSchedulerHandlers.ts`**

### Root Cause

`handleAddWorker` determines whether this is the first worker via `const isFirst = workers.length === 0`. This is evaluated *after* `await addWorker(...)` returns, which has already applied an optimistic `setWorkers((prev) => [...prev, ...])`. By the time the check runs, `workers` from the closure reflects the state at the time `handleAddWorker` was created, not the current state post-optimistic-update. However, the closure value of `workers` is from the previous render — if there were zero workers before the call, `workers.length` in the closure is still `0`, so `isFirst` is `true` correctly. But if two `addWorker` calls race (e.g., rapid double-submit), both may see `workers.length === 0` and both track `isFirst: true`.

```typescript
const handleAddWorker = useCallback(async () => {
  // ...
  const result = await addWorker(trimmedName, trimmedRole, skills);
  if (result.success) {
    const isFirst = workers.length === 0; // ← stale closure, race on double-submit
```

### Fix

Capture the pre-call count before the await:

```typescript
const handleAddWorker = useCallback(async () => {
  const trimmedName = workerForm.name.trim();
  const trimmedRole = workerForm.role.trim();
  if (!trimmedName) { setWorkerError('Worker name is required.'); return; }
  if (!trimmedRole) { setWorkerError('Role is required.'); return; }
  setWorkerError(null);

  // Capture before the await — immune to optimistic state changes
  const isFirst = workers.length === 0;

  const skills = workerForm.skills.split(',').map((s) => s.trim()).filter(Boolean);
  const result = await addWorker(trimmedName, trimmedRole, skills);
  if (result.success) {
    setWorkerForm({ name: '', role: '', skills: '' });
    setAvailabilityForm((prev) => ({ ...prev, workerId: result.worker.id }));
    setShiftForm((prev) => ({ ...prev, workerId: result.worker.id }));
    void trackEvent('worker_added', { isFirst }); // ← uses pre-call snapshot
    // ...
  }
}, [addWorker, recordTourAction, workerForm, workers.length]);
```

---

## Bug 11: `handleUnpublishShift` Has No Error Handling — Silent Failure

**Severity: Medium**
**File: `useSchedulerHandlers.ts`**

### Root Cause

`handleUnpublishShift` calls `await setShiftStatus(shiftId, 'Draft')` but never inspects the result. If the status update fails (network error