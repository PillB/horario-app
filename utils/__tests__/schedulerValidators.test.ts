import { findCoveringAvailability, validateAvailabilitySubmission, validateShiftReadiness } from '../schedulerValidators';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';

const template: ShiftTemplate = {
  id: 'morning',
  name: 'Morning Coverage',
  role: 'Support',
  start: '08:00',
  end: '12:00',
  coverage: 1,
};

const worker: Worker = {
  id: 'W-01',
  name: 'Alice',
  role: 'Support',
  skills: ['chat'],
  availability: [{ day: 'Mon', from: '07:00', to: '16:00' }],
};

// ─── findCoveringAvailability ─────────────────────────────────────────────────

describe('findCoveringAvailability', () => {
  it('returns a covering slot when availability fully contains the template window', () => {
    const { coveringSlot, weekdayLabel } = findCoveringAvailability(worker, template, '2024-12-16', 0);
    expect(weekdayLabel).toBe('Mon');
    expect(coveringSlot).toEqual(worker.availability[0]);
  });

  it('returns undefined slot for a day with no matching availability', () => {
    const { coveringSlot } = findCoveringAvailability(worker, template, '2024-12-17', 0); // Tuesday
    expect(coveringSlot).toBeUndefined();
  });

  it('returns correct weekday when timezone pushes date to prior day', () => {
    const fridayWorker: Worker = {
      ...worker,
      availability: [{ day: 'Fri', from: '07:00', to: '16:00' }],
    };
    // 2024-06-01 is Saturday UTC; UTC-12 pushes it to Friday
    const { coveringSlot, weekdayLabel } = findCoveringAvailability(fridayWorker, template, '2024-06-01', -720);
    expect(weekdayLabel).toBe('Fri');
    expect(coveringSlot).toEqual(fridayWorker.availability[0]);
  });

  it('returns null weekdayLabel for an invalid date', () => {
    const { coveringSlot, weekdayLabel } = findCoveringAvailability(worker, template, 'not-a-date', 0);
    expect(weekdayLabel).toBeNull();
    expect(coveringSlot).toBeUndefined();
  });
});

// ─── validateAvailabilitySubmission ──────────────────────────────────────────

describe('validateAvailabilitySubmission', () => {
  const workers: Worker[] = [worker];

  it('passes for valid inputs', () => {
    const result = validateAvailabilitySubmission(
      { workerId: 'W-01', day: 'Tue', from: '09:00', to: '17:00' },
      workers
    );
    expect(result.errors).toHaveLength(0);
    expect(result.normalizedDay).toBe('Tue');
    expect(result.trimmedWorkerId).toBe('W-01');
  });

  it('reports missing required fields', () => {
    const result = validateAvailabilitySubmission(
      { workerId: '', day: '', from: '', to: '' },
      workers
    );
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown worker ID', () => {
    const { errors } = validateAvailabilitySubmission(
      { workerId: 'W-99', day: 'Mon', from: '09:00', to: '17:00' },
      workers
    );
    expect(errors.some((e) => e.code === 'WORKER_NOT_FOUND')).toBe(true);
  });

  it('rejects an invalid day name', () => {
    const { errors } = validateAvailabilitySubmission(
      { workerId: 'W-01', day: 'Holiday', from: '09:00', to: '17:00' },
      workers
    );
    expect(errors.some((e) => e.code === 'DAY_INVALID')).toBe(true);
  });

  it('rejects inverted time window', () => {
    const { errors } = validateAvailabilitySubmission(
      { workerId: 'W-01', day: 'Tue', from: '17:00', to: '09:00' },
      workers
    );
    expect(errors.some((e) => e.code === 'FROM_BEFORE_TO')).toBe(true);
  });

  it('rejects overlapping availability on same day', () => {
    const workerWithSlot: Worker = {
      ...worker,
      availability: [{ day: 'Mon', from: '09:00', to: '17:00' }],
    };
    const { errors } = validateAvailabilitySubmission(
      { workerId: 'W-01', day: 'Mon', from: '10:00', to: '14:00' },
      [workerWithSlot]
    );
    expect(errors.some((e) => e.code === 'AVAILABILITY_OVERLAP')).toBe(true);
  });

  it('reports an overlap error for an identical slot (identical slots are a superset of overlaps)', () => {
    // An identical slot triggers the overlap check first (windowsOverlap returns true
    // for identical windows). The "already exists" branch is only reached when
    // the slot matches exactly but the window comparison finds no strict overlap —
    // which cannot happen for same-day same-time entries.
    const workerWithSlot: Worker = {
      ...worker,
      availability: [{ day: 'Tue', from: '09:00', to: '17:00' }],
    };
    const { errors } = validateAvailabilitySubmission(
      { workerId: 'W-01', day: 'Tue', from: '09:00', to: '17:00' },
      [workerWithSlot]
    );
    expect(errors.some((e) => e.code === 'AVAILABILITY_OVERLAP' || e.code === 'AVAILABILITY_DUPLICATE')).toBe(true);
  });
});

// ─── validateShiftReadiness ───────────────────────────────────────────────────

describe('validateShiftReadiness', () => {
  const shift: Shift = {
    id: 's1',
    date: '2024-12-16',
    workerId: 'W-01',
    templateId: 'morning',
    location: 'HQ',
    status: 'Draft',
  };

  it('passes for a valid, covered shift', () => {
    const { errors } = validateShiftReadiness(shift, [shift], [template], [worker], 0);
    expect(errors).toHaveLength(0);
  });

  it('reports missing template', () => {
    const { errors } = validateShiftReadiness(shift, [shift], [], [worker], 0);
    expect(errors.some((e) => e.code === 'TEMPLATE_MISSING')).toBe(true);
  });

  it('reports missing worker', () => {
    const { errors } = validateShiftReadiness(shift, [shift], [template], [], 0);
    expect(errors.some((e) => e.code === 'WORKER_MISSING')).toBe(true);
  });

  it('reports role mismatch', () => {
    const wrongRoleWorker: Worker = { ...worker, role: 'Cashier' };
    const { errors } = validateShiftReadiness(shift, [shift], [template], [wrongRoleWorker], 0);
    expect(errors.some((e) => e.code === 'ROLE_MISMATCH')).toBe(true);
  });

  it('reports inadequate availability coverage', () => {
    const lateWorker: Worker = {
      ...worker,
      availability: [{ day: 'Mon', from: '10:00', to: '16:00' }], // starts after template 08:00
    };
    const { errors } = validateShiftReadiness(shift, [shift], [template], [lateWorker], 0);
    expect(errors.some((e) => e.code === 'COVERAGE_MISSING')).toBe(true);
  });

  it('reports time-window overlap with existing shift', () => {
    const overlap: Shift = { ...shift, id: 's2' };
    const { errors } = validateShiftReadiness(shift, [shift, overlap], [template], [worker], 0);
    expect(errors.some((e) => e.code === 'SHIFT_OVERLAP')).toBe(true);
  });
});
