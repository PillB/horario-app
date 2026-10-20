import {
  findCoveringAvailability,
  validateAvailabilitySubmission,
  validateShiftReadiness,
  localizeValidationErrors,
  type ValidationErrorItem,
  type AvailabilityFormInput,
} from '../schedulerValidators';
import { type Worker } from '@/types/scheduler';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: 'worker-uuid-1',
    displayId: 'W-1',
    name: 'Alice',
    role: 'nurse',
    availability: [],
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 'template-1',
    name: 'Morning',
    role: 'nurse',
    start: '09:00',
    end: '17:00',
    ...overrides,
  };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    workerId: 'worker-uuid-1',
    templateId: 'template-1',
    date: '2024-01-15', // known Monday in UTC
    location: 'HQ',
    status: 'Draft',
    ...overrides,
  };
}

// A fixed timezone offset (UTC+0) to make tests deterministic
const UTC_OFFSET = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────

let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ─── findCoveringAvailability ─────────────────────────────────────────────────

describe('findCoveringAvailability', () => {
  test('1. worker availability 08:00-16:00 does NOT cover template 09:00-17:00', () => {
    const worker = makeWorker({
      availability: [{ day: 'Mon', from: '08:00', to: '16:00' }],
    });
    const template = makeTemplate({ start: '09:00', end: '17:00' });
    // 2024-01-15 is a Monday (UTC)
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-01-15', UTC_OFFSET);
    expect(coveringSlot).toBeUndefined();
  });

  test('2. worker availability 07:00-18:00 fully covers template 09:00-17:00 → coveringSlot set', () => {
    const slot = { day: 'Mon', from: '07:00', to: '18:00' };
    const worker = makeWorker({ availability: [slot] });
    const template = makeTemplate({ start: '09:00', end: '17:00' });
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-01-15', UTC_OFFSET);
    expect(coveringSlot).toEqual(slot);
  });

  test('3. worker with no availability → coveringSlot is undefined', () => {
    const worker = makeWorker({ availability: [] });
    const template = makeTemplate({ start: '09:00', end: '17:00' });
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-01-15', UTC_OFFSET);
    expect(coveringSlot).toBeUndefined();
  });

  test('4. worker availability on wrong day (Tue vs Mon) → coveringSlot undefined', () => {
    const worker = makeWorker({
      availability: [{ day: 'Tue', from: '07:00', to: '18:00' }],
    });
    const template = makeTemplate({ start: '09:00', end: '17:00' });
    // 2024-01-15 is Monday
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-01-15', UTC_OFFSET);
    expect(coveringSlot).toBeUndefined();
  });

  test('5. timezone offset does not shift a business-local date to another weekday', () => {
    // 2024-01-15 is a Monday as a calendar date in every timezone.
    const negativeOffset = -720;
    const slot = { day: 'Sun', from: '00:00', to: '23:59' };
    const worker = makeWorker({ availability: [slot] });
    const template = makeTemplate({ start: '09:00', end: '17:00' });
    const { weekdayLabel, coveringSlot } = findCoveringAvailability(
      worker,
      template,
      '2024-01-15',
      negativeOffset
    );
    expect(weekdayLabel).toBe('Mon');
    expect(coveringSlot).toBeUndefined();
  });

  test('6. worker role does not match template role — findCoveringAvailability still returns slot (role check is separate)', () => {
    const slot = { day: 'Mon', from: '07:00', to: '18:00' };
    const worker = makeWorker({ role: 'doctor', availability: [slot] });
    const template = makeTemplate({ role: 'nurse', start: '09:00', end: '17:00' });
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-01-15', UTC_OFFSET);
    // findCoveringAvailability ignores role — it only checks time coverage
    expect(coveringSlot).toEqual(slot);
  });

  describe('overnight windows', () => {
    const night = makeTemplate({ start: '22:00', end: '06:00' });

    test('7. availability 21:00-07:00 covers a 22:00-06:00 shift', () => {
      const slot = { day: 'Mon', from: '21:00', to: '07:00' };
      const { coveringSlot } = findCoveringAvailability(makeWorker({ availability: [slot] }), night, '2024-01-15');
      expect(coveringSlot).toEqual(slot);
    });

    test('8. a daytime slot 05:00-23:00 does NOT cover a 22:00-06:00 shift', () => {
      const worker = makeWorker({ availability: [{ day: 'Mon', from: '05:00', to: '23:00' }] });
      expect(findCoveringAvailability(worker, night, '2024-01-15').coveringSlot).toBeUndefined();
    });

    test('9. availability 21:00-05:00 does NOT cover a shift ending at 06:00', () => {
      const worker = makeWorker({ availability: [{ day: 'Mon', from: '21:00', to: '05:00' }] });
      expect(findCoveringAvailability(worker, night, '2024-01-15').coveringSlot).toBeUndefined();
    });

    test('10. an overnight slot from the previous day covers early-morning hours', () => {
      const slot = { day: 'Mon', from: '21:00', to: '07:00' };
      const early = makeTemplate({ start: '01:00', end: '05:00' });
      // 2024-01-16 is a Tuesday; the Mon 21:00-07:00 slot runs into it.
      expect(findCoveringAvailability(makeWorker({ availability: [slot] }), early, '2024-01-16').coveringSlot).toEqual(slot);
      expect(findCoveringAvailability(makeWorker({ availability: [slot] }), early, '2024-01-15').coveringSlot).toBeUndefined();
    });

    test('11. a slot ending at 23:59 covers a shift ending at midnight', () => {
      const slot = { day: 'Mon', from: '16:00', to: '23:59' };
      const evening = makeTemplate({ start: '16:00', end: '00:00' });
      expect(findCoveringAvailability(makeWorker({ availability: [slot] }), evening, '2024-01-15').coveringSlot).toEqual(slot);
    });

    test('12. validateShiftReadiness accepts an overnight shift inside overnight availability', () => {
      const worker = makeWorker({ id: 'w-night', availability: [{ day: 'Mon', from: '21:00', to: '07:00' }] });
      const template = makeTemplate({ id: 'tpl-night', start: '22:00', end: '06:00' });
      const shift = makeShift({ id: 's1', date: '2024-01-15', workerId: 'w-night', templateId: 'tpl-night' });
      const { errors } = validateShiftReadiness(shift, [shift], [template], [worker]);
      expect(errors.map((e) => e.code)).not.toContain('COVERAGE_MISSING');
    });
  });
});

// ─── validateAvailabilitySubmission ──────────────────────────────────────────

describe('validateAvailabilitySubmission', () => {
  const baseWorker = makeWorker({
    id: 'worker-uuid-1',
    displayId: 'W-1',
    availability: [],
  });

  function validForm(overrides: Partial<AvailabilityFormInput> = {}): AvailabilityFormInput {
    return {
      workerId: 'W-1',
      day: 'Mon',
      from: '09:00',
      to: '17:00',
      ...overrides,
    };
  }

  test('7. valid submission → no errors returned', () => {
    const result = validateAvailabilitySubmission(validForm(), [baseWorker]);
    expect(result.errors).toHaveLength(0);
  });

  test('8. invalid day (not a weekday abbreviation) → DAY_INVALID error', () => {
    const result = validateAvailabilitySubmission(validForm({ day: 'Someday' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('DAY_INVALID');
  });

  test('9. invalid from time format "25:00" → FROM_TIME_INVALID error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: '25:00' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('FROM_TIME_INVALID');
  });

  test('9b. invalid from time format "9:00am" → FROM_TIME_INVALID error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: '9:00am' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('FROM_TIME_INVALID');
  });

  test('9c. invalid from time format "abc" → FROM_TIME_INVALID error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: 'abc' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('FROM_TIME_INVALID');
  });

  test('10. invalid to time format "25:99" → TO_TIME_INVALID error', () => {
    const result = validateAvailabilitySubmission(validForm({ to: '25:99' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('TO_TIME_INVALID');
  });

  test('11. to time <= from time → FROM_BEFORE_TO error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: '17:00', to: '09:00' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('FROM_BEFORE_TO');
  });

  test('11b. to time equal to from time → FROM_BEFORE_TO error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: '09:00', to: '09:00' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('FROM_BEFORE_TO');
  });

  test('12. overlapping existing availability on same day → AVAILABILITY_OVERLAP error', () => {
    const workerWithSlot = makeWorker({
      id: 'worker-uuid-1',
      displayId: 'W-1',
      availability: [{ day: 'Mon', from: '08:00', to: '14:00' }],
    });
    // New slot 12:00-18:00 overlaps existing 08:00-14:00
    const result = validateAvailabilitySubmission(
      validForm({ from: '12:00', to: '18:00' }),
      [workerWithSlot]
    );
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('AVAILABILITY_OVERLAP');
  });

  test('13. exact duplicate slot → AVAILABILITY_OVERLAP error (overlapping boundary counts as overlap)', () => {
    const workerWithSlot = makeWorker({
      id: 'worker-uuid-1',
      displayId: 'W-1',
      availability: [{ day: 'Mon', from: '09:00', to: '17:00' }],
    });
    const result = validateAvailabilitySubmission(validForm(), [workerWithSlot]);
    const codes = result.errors.map((e) => e.code);
    // Duplicate is an exact overlap, so overlap or duplicate code expected
    expect(codes.some((c) => c === 'AVAILABILITY_OVERLAP' || c === 'AVAILABILITY_DUPLICATE')).toBe(true);
  });

  test('14. worker has no existing availability → no overlap or duplicate errors', () => {
    const result = validateAvailabilitySubmission(validForm(), [baseWorker]);
    const overlapCodes = result.errors.filter(
      (e) => e.code === 'AVAILABILITY_OVERLAP' || e.code === 'AVAILABILITY_DUPLICATE'
    );
    expect(overlapCodes).toHaveLength(0);
  });

  test('worker not found by displayId or id → WORKER_NOT_FOUND error', () => {
    const result = validateAvailabilitySubmission(validForm({ workerId: 'UNKNOWN' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('WORKER_NOT_FOUND');
  });

  test('empty workerId → WORKER_REQUIRED error', () => {
    const result = validateAvailabilitySubmission(validForm({ workerId: '' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('WORKER_REQUIRED');
  });

  test('empty day → DAY_REQUIRED error', () => {
    const result = validateAvailabilitySubmission(validForm({ day: '' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('DAY_REQUIRED');
  });

  test('empty from and to → TIMES_REQUIRED error', () => {
    const result = validateAvailabilitySubmission(validForm({ from: '', to: '' }), [baseWorker]);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('TIMES_REQUIRED');
  });

  test('resolves worker by UUID as well as displayId', () => {
    const result = validateAvailabilitySubmission(
      validForm({ workerId: 'worker-uuid-1' }),
      [baseWorker]
    );
    expect(result.errors).toHaveLength(0);
    expect(result.trimmedWorkerId).toBe('worker-uuid-1');
  });

  test('returns resolvedWorkerId (UUID) even when displayId was provided', () => {
    const result = validateAvailabilitySubmission(validForm({ workerId: 'W-1' }), [baseWorker]);
    expect(result.trimmedWorkerId).toBe('worker-uuid-1');
  });

  test('normalizedDay is set correctly for valid day input', () => {
    const result = validateAvailabilitySubmission(validForm({ day: 'monday' }), [baseWorker]);
    expect(result.normalizedDay).toBe('Mon');
  });
});

// ─── validateShiftReadiness ───────────────────────────────────────────────────

describe('validateShiftReadiness', () => {
  const template = makeTemplate({ id: 'template-1', role: 'nurse', start: '09:00', end: '17:00' });

  const workerWithCoverage = makeWorker({
    id: 'worker-uuid-1',
    role: 'nurse',
    availability: [{ day: 'Mon', from: '07:00', to: '18:00' }],
  });

  // 2024-01-15 is a Monday at UTC+0
  const shift = makeShift({
    id: 'shift-1',
    workerId: 'worker-uuid-1',
    templateId: 'template-1',
    date: '2024-01-15',
  });

  test('15. template not found → TEMPLATE_MISSING error', () => {
    const shiftBadTemplate = makeShift({ templateId: 'nonexistent-template' });
    const { errors } = validateShiftReadiness(
      shiftBadTemplate,
      [],
      [], // no templates
      [workerWithCoverage],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('TEMPLATE_MISSING');
  });

  test('16. worker not found → WORKER_MISSING error', () => {
    const shiftBadWorker = makeShift({ workerId: 'nonexistent-worker' });
    const { errors } = validateShiftReadiness(
      shiftBadWorker,
      [],
      [template],
      [], // no workers
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('WORKER_MISSING');
  });

  test('17. role mismatch (worker.role !== template.role) → ROLE_MISMATCH error', () => {
    const doctorWorker = makeWorker({
      id: 'worker-uuid-1',
      role: 'doctor',
      availability: [{ day: 'Mon', from: '07:00', to: '18:00' }],
    });
    const { errors } = validateShiftReadiness(
      shift,
      [],
      [template],
      [doctorWorker],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('ROLE_MISMATCH');
  });

  test('18. worker availability does not cover shift window → COVERAGE_MISSING error', () => {
    const workerWithPartialCoverage = makeWorker({
      id: 'worker-uuid-1',
      role: 'nurse',
      availability: [{ day: 'Mon', from: '10:00', to: '18:00' }], // starts too late
    });
    const { errors } = validateShiftReadiness(
      shift,
      [],
      [template],
      [workerWithPartialCoverage],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('COVERAGE_MISSING');
  });

  test('18b. worker has no availability on shift weekday → COVERAGE_MISSING error', () => {
    const workerNoAvailability = makeWorker({
      id: 'worker-uuid-1',
      role: 'nurse',
      availability: [], // no availability at all
    });
    const { errors } = validateShiftReadiness(
      shift,
      [],
      [template],
      [workerNoAvailability],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('COVERAGE_MISSING');
  });

  test('19. shift overlaps another shift on same date for same worker → SHIFT_OVERLAP error', () => {
    const overlappingShift = makeShift({
      id: 'shift-2', // different id
      workerId: 'worker-uuid-1',
      templateId: 'template-1',
      date: '2024-01-15',
    });
    // roster contains the overlapping shift, we validate shift-1 against it
    const { errors } = validateShiftReadiness(
      shift,
      [overlappingShift], // roster
      [template],
      [workerWithCoverage],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('SHIFT_OVERLAP');
  });

  test('19b. overlapping shift with a different time template that still overlaps → SHIFT_OVERLAP error', () => {
    const template2 = makeTemplate({
      id: 'template-2',
      role: 'nurse',
      start: '12:00',
      end: '20:00',
    });
    const shift2 = makeShift({
      id: 'shift-2',
      workerId: 'worker-uuid-1',
      templateId: 'template-2',
      date: '2024-01-15',
    });
    // shift uses template-1 (09:00-17:00); shift2 uses template-2 (12:00-20:00) → they overlap
    const { errors } = validateShiftReadiness(
      shift,
      [shift2],
      [template, template2],
      [workerWithCoverage],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('SHIFT_OVERLAP');
  });

  test('20. valid shift → empty errors array', () => {
    const { errors } = validateShiftReadiness(
      shift,
      [], // no other shifts in roster
      [template],
      [workerWithCoverage],
      UTC_OFFSET
    );
    expect(errors).toHaveLength(0);
  });

  test('non-overlapping shifts on same date for same worker → no SHIFT_OVERLAP error', () => {
    const template2 = makeTemplate({
      id: 'template-2',
      role: 'nurse',
      start: '17:00',
      end: '23:00',
    });
    const shift2 = makeShift({
      id: 'shift-2',
      workerId: 'worker-uuid-1',
      templateId: 'template-2',
      date: '2024-01-15',
    });
    // shift uses 09:00-17:00, shift2 uses 17:00-23:00 → adjacent, not overlapping
    const { errors } = validateShiftReadiness(
      shift,
      [shift2],
      [template, template2],
      [workerWithCoverage],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).not.toContain('SHIFT_OVERLAP');
  });

  test('shifts on different dates → no SHIFT_OVERLAP error', () => {
    const shiftDifferentDate = makeShift({
      id: 'shift-2',
      workerId: 'worker-uuid-1',
      templateId: 'template-1',
      date: '2024-01-16', // Tuesday
    });
    const workerTueMon = makeWorker({
      id: 'worker-uuid-1',
      role: 'nurse',
      availability: [
        { day: 'Mon', from: '07:00', to: '18:00' },
        { day: 'Tue', from: '07:00', to: '18:00' },
      ],
    });
    const { errors } = validateShiftReadiness(
      shift,
      [shiftDifferentDate],
      [template],
      [workerTueMon],
      UTC_OFFSET
    );
    const codes = errors.map((e) => e.code);
    expect(codes).not.toContain('SHIFT_OVERLAP');
  });
});

// ─── localizeValidationErrors ─────────────────────────────────────────────────

describe('localizeValidationErrors', () => {
  test('returns translated string when t() returns a real translation', () => {
    const errors: ValidationErrorItem[] = [
      { code: 'WORKER_REQUIRED', message: 'Worker is required.' },
    ];
    const t = (_key: string, _params?: Record<string, string>) => 'Worker requis.';
    const result = localizeValidationErrors(errors, t);
    expect(result).toEqual(['Worker requis.']);
  });

  test('falls back to English message when t() returns the key path unchanged', () => {
    const errors: ValidationErrorItem[] = [
      { code: 'WORKER_REQUIRED', message: 'Worker is required.' },
    ];
    // Simulate missing translation — t returns the key itself
    const t = (key: string, _params?: Record<string, string>) => key;
    const result = localizeValidationErrors(errors, t);
    expect(result).toEqual(['Worker is required.']);
  });

  test('passes params to t() correctly', () => {
    const errors: ValidationErrorItem[] = [
      {
        code: 'ROLE_MISMATCH',
        message: 'Role mismatch.',
        params: { workerRole: 'doctor', templateRole: 'nurse' },
      },
    ];
    const capturedParams: Record<string, string>[] = [];
    const t = (_key: string, params?: Record<string, string>) => {
      if (params) capturedParams.push(params);
      return 'Rôle incorrect.';
    };
    localizeValidationErrors(errors, t);
    expect(capturedParams[0]).toEqual({ workerRole: 'doctor', templateRole: 'nurse' });
  });

  test('handles empty errors array → returns empty array', () => {
    const t = (_key: string) => 'anything';
    const result = localizeValidationErrors([], t);
    expect(result).toEqual([]);
  });
});

// ─── CHG-087: one worker never fills two positions of one slot ────────────────

describe('validateShiftReadiness — same slot twice (CHG-087)', () => {
  test('the same template on the same date is SHIFT_OVERLAP even when its window cannot be measured', () => {
    // A legacy template with an unparsable end gives NaN minutes, so the window
    // comparison alone never reports an overlap.
    const broken = makeTemplate({ id: 'broken', start: '09:00', end: '' });
    const first = makeShift({ id: 'a', templateId: 'broken' });
    const second = makeShift({ id: 'b', templateId: 'broken' });
    const worker = makeWorker({ availability: [{ day: 'Mon', from: '00:00', to: '23:59' }] });
    const { errors } = validateShiftReadiness(second, [first, second], [broken], [worker], UTC_OFFSET);
    expect(errors.map((e) => e.code)).toContain('SHIFT_OVERLAP');
  });
});
