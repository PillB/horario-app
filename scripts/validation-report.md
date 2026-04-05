# Input Validation Analysis — Scheduling Application

---

## Summary Table

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | 🔴 Critical | `isValidTime` | Accepts `25:99` and other out-of-range times |
| 2 | 🔴 Critical | All string inputs | No maximum length limits — unbounded storage writes |
| 3 | 🔴 Critical | `handleAddWorker` / `handleAddTemplate` | No special-character sanitization before DB write |
| 4 | 🔴 Critical | `handleShiftSubmit` | `templateId` accepted verbatim from form state — no format check |
| 5 | 🟠 High | `handleAvailabilitySubmit` | `errors` is `ValidationErrorItem[]` but joined as `.join(' ')` — always empty string |
| 6 | 🟠 High | `validateAvailabilitySubmission` | Duplicate-check executes inside `if (!errors.length)` block after overlap check — unreachable |
| 7 | 🟠 High | `handleTargetSubmit` | `notes` field: no length cap, no sanitization |
| 8 | 🟠 High | `handleFallbackSubmit` | `homogeneousDemand` / `shiftsPerDay` / `workersPerShift` accept `Infinity` |
| 9 | 🟠 High | `handleTargetSubmit` | `required` accepts `0` silently — no minimum-of-1 business-rule guard |
| 10 | 🟠 High | Date validation | Past dates accepted everywhere without business-rule rejection |
| 11 | 🟡 Medium | `isValidTime` | Does not reject non-numeric strings like `0a:00` that pass the regex |
| 12 | 🟡 Medium | `normalizeDay` | No length guard — arbitrarily long strings traverse the lookup |
| 13 | 🟡 Medium | `handleShiftSubmit` | Availability check silently skipped when `worker` or `template` not yet resolved |
| 14 | 🟡 Medium | `validateShiftReadiness` | `params` in error items contain raw user data — XSS risk when rendered as HTML |
| 15 | 🟡 Medium | `windowsOverlap` | Treats midnight-spanning shifts (e.g. 22:00–02:00) as zero-length |
| 16 | 🟡 Medium | Role name | Whitespace-only role accepted everywhere |
| 17 | 🟡 Medium | `handleAddTemplate` | Start/end validated with bare regex — same `25:99` gap as `isValidTime` |
| 18 | 🟢 Low | `localizeValidationErrors` | Falls back silently to English key path — hides missing translation keys |
| 19 | 🟢 Low | `handleAutoAssign` | Date sourced from `shiftForm.date` without cross-checking `shiftForm` worker/template |
| 20 | 🟢 Low | Error UX | Many errors joined with `' '` producing run-on sentences with no structure |

---

## Finding 1 — 🔴 `isValidTime` Accepts Out-of-Range Values

### Root cause

```typescript
// schedulerUtils.ts
export const isValidTime = (value: string): boolean => {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};
```

The regex `^\d{2}:\d{2}$` matches `25:99`, `00:60`, `23:60`, etc. The subsequent numeric bounds check is **correct** for hours/minutes individually, but `Number('09')` parses fine — the real problem is that the regex allows digit strings that `Number()` silently converts to out-of-range integers the bounds check then catches. However there are two concrete bypass paths:

1. **`handleAddTemplate`** validates start/end with **only** the bare regex, never calling `isValidTime`:

```typescript
// hooks/useSchedulerHandlers.ts — handleAddTemplate
if (!/^\d{2}:\d{2}$/.test(trimmedStart)) { setTemplateError('Start time must be HH:MM.'); return; }
if (!/^\d{2}:\d{2}$/.test(trimmedEnd))   { setTemplateError('End time must be HH:MM.'); return; }
```

`25:99` passes this check and reaches `addShiftTemplate`.

2. **`parseTimeToMinutes`** is called unconditionally in `getTemplateWindow` and `findCoveringAvailability` without any prior validity assertion, so a persisted bad template causes silent arithmetic corruption downstream.

### Fix

```typescript
// schedulerUtils.ts — replace isValidTime
export const isValidTime = (value: string): boolean => {
  // Strict format: exactly HH:MM with no surrounding whitespace
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hourStr, minuteStr] = value.split(':');
  const hours   = parseInt(hourStr,   10);
  const minutes = parseInt(minuteStr, 10);
  // parseInt is safer than Number() for strings like '08' (no octal in strict mode,
  // but explicit radix documents intent)
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

// schedulerUtils.ts — add a safe parser that throws on invalid input
export const parseTimeToMinutesSafe = (value: string): number => {
  if (!isValidTime(value)) {
    throw new RangeError(`Invalid time value: "${value}"`);
  }
  return parseTimeToMinutes(value);
};
```

```typescript
// hooks/useSchedulerHandlers.ts — handleAddTemplate: replace bare regex
const trimmedStart = templateForm.start.trim();
const trimmedEnd   = templateForm.end.trim();

if (!isValidTime(trimmedStart)) {
  setTemplateError('Start time must use the 24-hour HH:MM format (e.g. 09:00).');
  return;
}
if (!isValidTime(trimmedEnd)) {
  setTemplateError('End time must use the 24-hour HH:MM format (e.g. 17:00).');
  return;
}
if (parseTimeToMinutes(trimmedStart) >= parseTimeToMinutes(trimmedEnd)) {
  setTemplateError('Start time must be earlier than end time.');
  return;
}
```

---

## Finding 2 — 🔴 No Maximum Length Limits on Any String Input

### Root cause

Every user-facing string field (`name`, `role`, `skills`, `notes`, `from`, `to`, `day`, `workerId`, `templateId`, `date`) is trimmed but never length-capped before being passed to `addWorker`, `addShiftTemplate`, `addAvailability`, `addShift`, or `overrideTarget`. An attacker or misbehaving client can submit arbitrarily large payloads that are forwarded verbatim to the database service.

### Fix

```typescript
// utils/schedulerValidators.ts — add a shared length-check helper
const MAX_LENGTHS = {
  name:       100,
  role:        80,
  skills:     200,   // comma-separated list
  notes:      500,
  workerId:    36,   // UUID length
  templateId:  36,
  day:         10,   // e.g. "wednesday"
  time:         5,   // HH:MM
  date:        10,   // YYYY-MM-DD
} as const;

function assertMaxLength(
  value: string,
  field: keyof typeof MAX_LENGTHS,
  errors: ValidationErrorItem[]
): void {
  if (value.length > MAX_LENGTHS[field]) {
    errors.push({
      code:    `${field.toUpperCase()}_TOO_LONG`,
      message: `${field} must not exceed ${MAX_LENGTHS[field]} characters.`,
      params:  { field, max: String(MAX_LENGTHS[field]) },
    });
  }
}
```

```typescript
// hooks/useSchedulerHandlers.ts — handleAddWorker
const trimmedName  = workerForm.name.trim();
const trimmedRole  = workerForm.role.trim();
const trimmedSkills = workerForm.skills.trim();

if (!trimmedName)                    { setWorkerError('Worker name is required.');         return; }
if (trimmedName.length  > 100)       { setWorkerError('Name must be 100 characters or fewer.');  return; }
if (!trimmedRole)                    { setWorkerError('Role is required.');                return; }
if (trimmedRole.length  > 80)        { setWorkerError('Role must be 80 characters or fewer.');   return; }
if (trimmedSkills.length > 200)      { setWorkerError('Skills list must be 200 characters or fewer.'); return; }
```

```typescript
// hooks/useSchedulerHandlers.ts — handleTargetSubmit
if (trimmedNotes.length > 500) {
  errors.push('Notes must be 500 characters or fewer.');
}
```

Apply the same pattern to `templateForm.name`, `templateForm.role`, `fallbackForm.notes`, and `fallbackForm.role`.

---

## Finding 3 — 🔴 No Special-Character Sanitization Before Database Write

### Root cause

Names and notes containing `<script>`, SQL meta-characters, or Unicode control characters are passed directly to `addWorker`, `addShiftTemplate`, and `overrideTarget`. If any downstream surface renders these values as HTML (e.g. a web admin panel, email notification, or PDF export), stored XSS is possible. The `workerSuccessMessage` and `templateSuccessMessage` banners already interpolate `trimmedName` directly:

```typescript
// hooks/useSchedulerHandlers.ts
setWorkerSuccessMessage(
  `${trimmedName} added! Now set their availability…`  // raw interpolation
);
```

### Fix

```typescript
// utils/sanitize.ts — new file
/**
 * Strips characters that have no place in human-readable display strings:
 * - HTML-significant characters
 * - Unicode control characters (C0, C1, Cf category)
 * - Zero-width / invisible characters
 */
export function sanitizeDisplayString(value: string): string {
  return value
    // HTML-encode the five dangerous characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Strip C0/C1 control chars except tab (0x09) and newline (0x0A)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '')
    // Strip Unicode zero-width and invisible characters
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
}

/**
 * Validates that a display string contains only printable, non-HTML characters.
 * Returns an error message or null.
 */
export function validateDisplayString(
  value: string,
  fieldLabel: string
): string | null {
  if (/<|>|&[a-z]+;/i.test(value)) {
    return `${fieldLabel} must not contain HTML or special characters.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(value)) {
    return `${fieldLabel} contains invalid characters.`;
  }
  return null;
}
```

```typescript
// hooks/useSchedulerHandlers.ts — handleAddWorker
import { sanitizeDisplayString, validateDisplayString } from '@/utils/sanitize';

const trimmedName = workerForm.name.trim();
const nameError   = validateDisplayString(trimmedName, 'Worker name');
if (nameError) { setWorkerError(nameError); return; }
const safeName = sanitizeDisplayString(trimmedName);

// Pass safeName (not trimmedName) to addWorker and success message
const result = await addWorker(safeName, safeRole, skills);
setWorkerSuccessMessage(`${safeName} added! Now set their availability…`);
```

---

## Finding 4 — 🔴 `templateId` Accepted Verbatim Without Format Validation

### Root cause

```typescript
// hooks/useSchedulerHandlers.ts — handleShiftSubmit
const trimmedTemplateId = shiftForm.templateId.trim();
// ...
if (trimmedTemplateId && !shiftTemplates.some((t) => t.id === trimmedTemplateId))
  errors.push('Template ID must match an existing template.');
```

The check against `shiftTemplates` is a logical lookup, but `trimmedTemplateId` is never validated for format before the lookup. If `shiftTemplates` is empty (loading state) or the lookup service is offline, an arbitrary string (including SQL injection payloads) propagates to `addShift`. Unlike `workerId`, there is no display-ID-to-UUID resolution for templates.

### Fix

```typescript
// hooks/useSchedulerHandlers.ts — handleShiftSubmit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimmedTemplateId = shiftForm.templateId.trim();

if (!trimmedTemplateId) {
  errors.push('Template is required.');
} else if (!UUID_RE.test(trimmedTemplateId)) {
  errors.push('Template ID format is invalid.');
} else if (!shiftTemplates.some((t) => t.id === trimmedTemplateId)) {
  errors.push('Template ID must match an existing template.');
}
```

Apply the same UUID check to `trimmedWorkerId` in `handleShiftSubmit`.

---

## Finding 5 — 🟠 `errors.join(' ')` on `ValidationErrorItem[]` Always Produces `[object Object]`

### Root cause

```typescript
// hooks/useSchedulerHandlers.ts — handleAvailabilitySubmit
const { errors, … } = validateAvailabilitySubmission(availabilityForm, workers);

if (errors.length > 0 || !normalizedDay) {
  setAvailabilityError(errors.join(' '));  // ← errors is ValidationErrorItem[], not string[]
  …
}
```

`ValidationErrorItem` is `{ code, message, params? }`. Calling `.join(' ')` on it produces `"[object Object] [object Object]"` — the user sees nothing useful.

### Fix

```typescript
// hooks/useSchedulerHandlers.ts — handleAvailabilitySubmit
import { localizeValidationErrors } from '@/utils/schedulerValidators';

const { errors, normalizedDay, trimmedFrom, trimmedTo, trimmedWorkerId } =
  validateAvailabilitySubmission(availabilityForm, workers);

if (errors.length > 0 || !normalizedDay) {
  // Localize first, then join with a separator that aids readability
  const messages = localizeValidationErrors(errors, t);
  setAvailabilityError(messages.join(' '));
  setAvailabilitySuccessPromptVisible(false);
  return;
}
```

The same pattern must be applied wherever `ValidationErrorItem[]` results are rendered — e.g. `handlePublishShift` calls `errors.join(' ')` on the result of `validateShiftReadiness`, which has the same bug:

```typescript
// hooks/useSchedulerHandlers.ts — handlePublishShift (both call sites)
const { errors } = validateShiftReadiness(…);
if (errors.length) {
  const messages = localizeValidationErrors(errors, t);
  showActionBanner(messages.join(' '), 'error');
  return;
}
```

---

## Finding 6 — 🟠 Duplicate-Check Is Unreachable

### Root cause

```typescript
// utils/schedulerValidators.ts — validateAvailabilitySubmission
if (!errors.length) {                          // outer guard
  // … overlap check — may push AVAILABILITY_OVERLAP

  if (
    !errors.length &&                          // inner guard re-checks
    worker?.availability.some(
      (slot) => slot.day === dayKey && slot.from === trimmedFrom && slot.to === trimmedTo
    )
  ) {
    errors.push({ code: 'AVAILABILITY_DUPLICATE', … });
  }
}
```

When `AVAILABILITY_OVERLAP` is pushed, `errors.length` becomes 1, so `!errors.length` in the inner guard is `false` and the duplicate check never runs. But a **duplicate** is a subset of an overlap (`windowsOverlap` returns true when windows are identical), so an exact duplicate always triggers `AVAILABILITY_OVERLAP` first and the `AVAILABILITY_DUPLICATE` code is **dead code** in all current paths.

The fix is to either:

- Remove the redundant duplicate check (overlap already catches it), **or**
- Run the duplicate check before the overlap check so exact duplicates get a clearer message.

```typescript
// utils/schedulerValidators.ts — validateAvailabilitySubmission
// Move duplicate check BEFORE the overlap check so it fires first with a cleaner message.
if (!errors.length && worker && normalizedDay) {
  const isDuplicate = worker.availability.some(
    (slot) =>
      slot.day === normalizedDay &&
      slot.from === trimmedFrom &&
      slot.to === trimmedTo
  );
  if (isDuplicate) {
    errors.push({
      code: 'AVAILABILITY_DUPLICATE',
      message: 'This availability interval already exists for the worker.',
    });
  }
}

if (!errors.length && worker && normalizedDay && fromMinutes !== null && toMinutes !== null) {
  const overlappingSlot = worker.availability.find((slot) => {
    if (slot.day !== normalizedDay) return false;
    const existingWindow = {
      startMinutes: parseTimeToMinutes(slot.from),
      endMinutes:   parseTimeToMinutes(slot.to),
    };
    return windowsOverlap(existingWindow, { startMinutes: fromMinutes!, endMinutes: toMinutes! });
  });
  if (overlappingSlot) {
    errors.push({
      code: 'AVAILABILITY_OVERLAP',
      message: `Availability overlaps with an existing interval on ${normalizedDay} from ${overlappingSlot.from} to ${overlappingSlot.to}.`,
      params: { day: normalizedDay, from: overlappingSlot.from, to: overlappingSlot.to },
    });
  }
}
```

---

## Finding 7 — 🟠 `notes` Field: No Length Cap, No Sanitization

### Root cause

```typescript
// hooks/useSchedulerHandlers.ts — handleTargetSubmit
const trimmedNotes = targetForm.notes.trim();
// trimmedNotes is used directly in overrideTarget() with no further checks
overrideTarget({
  …
  notes: trimmedNotes,
  …
});
```

`notes` accepts arbitrary length and arbitrary character content. In `handleFallbackSubmit`, `fallbackForm.notes` has the same gap and is passed into `seedBaselineTargets`.

### Fix

```typescript
// hooks/useSchedulerHandlers.ts — handleTargetSubmit
const trimmedNotes = targetForm.notes.trim();
const noteError    = validateDisplayString(trimmedNotes, 'Notes');
if (noteError) { errors.push(noteError); }
if (trimmedNotes.length > 500) {
  errors.push('Notes must be 500 characters or fewer.');
}
```

```typescript
// hooks/useSchedulerHandlers.ts — handleFallbackSubmit
const trimmedNotes = fallbackForm.notes.trim();
if (trimmedNotes.length > 500) {
  setFallbackError('Notes must be 500 characters or fewer.'); return;
}
const noteError = validateDisplayString(trimmedNotes, 'Notes');
if (noteError) { setFallbackError(noteError); return; }
```

---

## Finding 8 — 🟠 `Infinity` and `-Infinity` Pass Numeric Validation in `handleFallbackSubmit`

### Root cause

```typescript
// hooks/useSchedulerHandlers.ts — handleFallbackSubmit
const normalized = Number(fallbackForm.homogeneousDemand);
if (!Number.isFinite(normalized) || normalized <= 0) {
  setFallbackError('Enter a positive homogeneous demand.'); return;
}
required = normalized;
```

`Number('Infinity')` returns `Infinity` and `Number.isFinite(Infinity)` is `false` — that part is correctly caught. However `Number('1e308')` returns `1e308`, which _is_ finite but is astronomically large. Additionally `Number('1.5')` is finite and positive, yielding a non-integer `required` that breaks DB integer columns.

```typescript
// hooks/useSchedulerHandlers.ts — handleFallbackSubmit
const normalizedShifts  = Number(fallbackForm.shiftsPerDay);
const normalizedWorkers = Number(fallbackForm.workersPerShift);
```

Non-integer floats (`1.5 * 2.5 = 3.75`) are never integer-checked before use as `required`.

### Fix

```typescript
// utils/schedulerValidators.ts — add a shared positive-integer validator
export function parsePositiveInteger(
  raw: string,
  fieldLabel: string,
  max = 10_000
): { value: number; error: string | null } {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { value: 0, error: `${fieldLabel} must be a whole number (digits only).` };
  }
  const value = parseInt(trimmed, 10);
  if (value <= 0)   return { value: 0, error: `${fieldLabel} must be greater than 0.` };
  if (value > max)  return { value: 0, error: `${fieldLabel} must not exceed ${max}.` };
  return { value, error: null };
}
```

```typescript
// hooks/useSchedulerHandlers.ts — handleFallbackSubmit (homogeneous branch)
const { value: demand, error: demandError } =
  parsePositiveInteger(fallbackForm.homogeneousDemand, 'Homogeneous demand', 500);
if (demandError) { setFallbackError(demandError); return; }
required = demand;

// manual branch
const { value: shiftsPerDay,    error: shiftsError   } =
  parsePositiveInteger(fallbackForm.shiftsPerDay,    'Shifts per day',       50);
const { value: workersPerShift, error: workersError  } =
  parsePositiveInteger(fallbackForm.workersPerShift, 'Workers per shift',   100);
if (shiftsError)  { setFallbackError(shiftsError);  return; }
if (workersError) { setFallbackError(workersError); return; }
required = shiftsPerDay * workersPerShift;
```

Apply `parsePositiveInteger` to `targetForm.required` in `handleTargetSubmit` as well:

```typescript
// hooks/useSchedulerHandlers.ts — handleTargetSubmit
const { value: normalizedRequired, error: requiredError } =
  parsePositiveInteger(targetForm.required, 'Required', 10_000);
if (requiredError) { errors.push(requiredError); }
// Note: if the business allows 0 (no one scheduled), add a specific allowed-zero path.
```

---

## Finding 9 — 🟠 `required = 0` Accepted Without Business-Rule Guard

### Root cause

```typescript
// hooks/useSchedul