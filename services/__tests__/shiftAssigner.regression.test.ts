/**
 * Regression tests for the QA red-team findings A1–A4 and A6 (redteam-baseline-2026-10-18,
 * "P1 — scheduling correctness"), plus the overnight hours-attribution rule.
 */
import { assignShifts, type AssignmentInput, type LaborConstraints } from '../shiftAssigner';
import { type Shift, type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';

const SUN = '2026-03-29';
const MON = '2026-03-30';
const TUE = '2026-03-31';

const tpl = (id: string, start: string, end: string, coverage = 1, role = 'Nurse'): ShiftTemplate => ({
  id,
  name: id,
  role,
  start,
  end,
  coverage,
});

const worker = (id: string, availability: Worker['availability'], role = 'Nurse'): Worker => ({
  id,
  displayId: id,
  name: id,
  role,
  skills: [],
  availability,
});

const shift = (id: string, date: string, workerId: string, templateId: string): Shift => ({
  id,
  date,
  workerId,
  templateId,
  location: 'HQ',
  status: 'Published',
  notified: false,
});

const ALL_WEEK = ['Sun', 'Mon', 'Tue', 'Wed'].map((day) => ({ day, from: '00:00', to: '23:59' }));

const base = (overrides: Partial<AssignmentInput>): AssignmentInput => ({
  date: MON,
  templates: [],
  workers: [],
  existingRoster: [],
  timezoneOffsetMinutes: 0,
  ...overrides,
});

// ─── A1: 2-opt swap double-booking ───────────────────────────────────────────

describe('A1 — 2-opt swaps never double-book a worker', () => {
  it('does not put the same worker in both slots of a coverage-2 shift (fuzz seed reproduced from QA)', () => {
    // Before the fix the swap loop left liveRoster stale and returned w2 twice for t0.
    const avail = [{ day: 'Mon', from: '00:00', to: '23:00' }];
    const result = assignShifts(
      base({
        templates: [tpl('t0', '08:00', '13:00', 2), tpl('t1', '02:00', '05:00'), tpl('t2', '05:00', '07:00')],
        workers: [worker('w0', avail), worker('w1', avail), worker('w2', avail)],
      })
    );
    const t0Workers = result.assignments.filter((a) => a.templateId === 't0').map((a) => a.workerId);
    expect(t0Workers).toHaveLength(2);
    expect(new Set(t0Workers).size).toBe(2);
    // and nobody holds two overlapping shifts at all
    const keys = result.assignments.map((a) => `${a.workerId}:${a.templateId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ─── A2: under-coverage is reported ──────────────────────────────────────────

describe('A2 — every shortfall is reported', () => {
  it('reports partial coverage (needs 3, only 1 eligible)', () => {
    const result = assignShifts(
      base({
        templates: [tpl('ward', '08:00', '16:00', 3)],
        workers: [worker('ana', ALL_WEEK), worker('bo', ALL_WEEK, 'Porter')],
      })
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned).toEqual([
      expect.objectContaining({ templateId: 'ward', date: MON, required: 3, assigned: 1, missing: 2, reasonCode: 'overlap' }),
    ]);
  });

  it('uses no_role_match when nobody has the role', () => {
    const result = assignShifts(base({ templates: [tpl('ward', '08:00', '16:00', 2)], workers: [worker('bo', ALL_WEEK, 'Porter')] }));
    expect(result.unassigned[0]).toMatchObject({ required: 2, assigned: 0, missing: 2, reasonCode: 'no_role_match' });
  });

  it('uses no_availability when role matches but nobody is available', () => {
    const result = assignShifts(
      base({ templates: [tpl('ward', '08:00', '16:00')], workers: [worker('ana', [{ day: 'Mon', from: '09:00', to: '16:00' }])] })
    );
    expect(result.unassigned[0]).toMatchObject({ missing: 1, reasonCode: 'no_availability' });
  });

  it('uses max_hours when hour limits block the last candidates', () => {
    const result = assignShifts(
      base({
        templates: [tpl('ward', '08:00', '16:00')],
        workers: [worker('ana', ALL_WEEK)],
        constraints: { maxDailyHours: 6 },
      })
    );
    expect(result.unassigned[0]).toMatchObject({ missing: 1, reasonCode: 'max_hours' });
  });

  it('uses min_rest when rest rules block the last candidates', () => {
    const result = assignShifts(
      base({
        templates: [tpl('early', '06:00', '14:00')],
        templateCatalog: [tpl('late', '14:00', '22:00')],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', SUN, 'ana', 'late')],
        constraints: { minRestHoursBetweenShifts: 11 },
      })
    );
    expect(result.unassigned[0]).toMatchObject({ missing: 1, reasonCode: 'min_rest' });
  });

  it('reports the furthest stage reached across workers', () => {
    // porter: wrong role; ana: no availability; cy: eligible but already on the shift
    const result = assignShifts(
      base({
        templates: [tpl('ward', '08:00', '16:00', 2)],
        workers: [worker('porter', ALL_WEEK, 'Porter'), worker('ana', []), worker('cy', ALL_WEEK)],
      })
    );
    expect(result.unassigned[0]).toMatchObject({ required: 2, assigned: 1, missing: 1, reasonCode: 'overlap' });
  });
});

// ─── A3: min-rest across midnight ────────────────────────────────────────────

describe('A3 — minimum rest includes overnight shifts', () => {
  const night = tpl('night', '22:00', '06:00');
  const morning = tpl('morning', '08:00', '16:00');

  it.each([12, 11])('blocks 08:00 Tue after a Mon 22:00–06:00 night shift with %ih rest', (hours) => {
    const result = assignShifts(
      base({
        date: TUE,
        templates: [morning],
        templateCatalog: [night],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'night')],
        constraints: { minRestHoursBetweenShifts: hours },
      })
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('min_rest');
  });

  it('blocks a night shift that ends too close to a next-day shift', () => {
    // Mon 22:00–Tue 06:00 then Tue 08:00 already rostered → 2h rest
    const result = assignShifts(
      base({
        templates: [night],
        templateCatalog: [morning],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', TUE, 'ana', 'morning')],
        constraints: { minRestHoursBetweenShifts: 12 },
      })
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('min_rest');
  });

  it('blocks a night shift starting too soon after an earlier shift the same day', () => {
    // Mon 08:00–16:00 rostered; new Mon 22:00 night → 6h rest < 12h
    const result = assignShifts(
      base({
        templates: [night],
        templateCatalog: [morning],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'morning')],
        constraints: { minRestHoursBetweenShifts: 12 },
      })
    );
    expect(result.assignments).toHaveLength(0);
  });

  it('allows the next shift once the full rest has elapsed', () => {
    // Mon 22:00–Tue 06:00, then Tue 18:00 → exactly 12h rest
    const result = assignShifts(
      base({
        date: TUE,
        templates: [tpl('late', '18:00', '23:00')],
        templateCatalog: [night],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'night')],
        constraints: { minRestHoursBetweenShifts: 12 },
      })
    );
    expect(result.assignments).toHaveLength(1);
  });
});

// ─── A4: overnight availability + overlap across midnight ────────────────────

describe('A4 — overnight availability and overlaps', () => {
  const night = tpl('night', '22:00', '06:00');

  it('rejects availability that does not extend past midnight (Mon 05:00–23:00)', () => {
    const result = assignShifts(base({ templates: [night], workers: [worker('ana', [{ day: 'Mon', from: '05:00', to: '23:00' }])] }));
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('no_availability');
  });

  it('accepts an overnight availability slot (Mon 21:00–07:00)', () => {
    const result = assignShifts(base({ templates: [night], workers: [worker('ana', [{ day: 'Mon', from: '21:00', to: '07:00' }])] }));
    expect(result.assignments).toHaveLength(1);
  });

  it('accepts availability split across two days (Mon 18:00–23:59 + Tue 00:00–08:00)', () => {
    const result = assignShifts(
      base({
        templates: [night],
        workers: [
          worker('ana', [
            { day: 'Mon', from: '18:00', to: '23:59' },
            { day: 'Tue', from: '00:00', to: '08:00' },
          ]),
        ],
      })
    );
    expect(result.assignments).toHaveLength(1);
  });

  it('rejects split availability with a gap at midnight', () => {
    const result = assignShifts(
      base({
        templates: [night],
        workers: [
          worker('ana', [
            { day: 'Mon', from: '18:00', to: '23:30' },
            { day: 'Tue', from: '00:00', to: '08:00' },
          ]),
        ],
      })
    );
    expect(result.assignments).toHaveLength(0);
  });

  it('requires availability until midnight for a shift ending at 00:00', () => {
    const evening = tpl('evening', '16:00', '00:00');
    const short = assignShifts(base({ templates: [evening], workers: [worker('ana', [{ day: 'Mon', from: '07:00', to: '20:00' }])] }));
    expect(short.assignments).toHaveLength(0);
    const full = assignShifts(base({ templates: [evening], workers: [worker('ana', [{ day: 'Mon', from: '07:00', to: '00:00' }])] }));
    expect(full.assignments).toHaveLength(1);
  });

  it('detects an overlap with the previous night shift that crosses midnight', () => {
    // Mon 22:00–Tue 06:00 rostered; Tue 05:00–09:00 overlaps by 1h
    const result = assignShifts(
      base({
        date: TUE,
        templates: [tpl('dawn', '05:00', '09:00')],
        templateCatalog: [night],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'night')],
      })
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('overlap');
  });

  it('detects an overlap between two night shifts on the same day', () => {
    const result = assignShifts(
      base({
        templates: [night, tpl('late-night', '23:00', '01:00')],
        workers: [worker('ana', ALL_WEEK)],
      })
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
  });
});

// ─── A6: catalog visibility ──────────────────────────────────────────────────

describe('A6 — existing shifts with templates outside today\'s list are visible', () => {
  it('detects an overlap with an existing shift whose template is only in the catalog', () => {
    const result = assignShifts(
      base({
        templates: [tpl('afternoon', '12:00', '18:00')],
        templateCatalog: [tpl('morning', '08:00', '16:00')],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'morning')],
      })
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('overlap');
  });
});

// ─── Hours attribution for overnight shifts ──────────────────────────────────

describe('max hours — overnight shifts count toward their start date', () => {
  const constraints: LaborConstraints = { maxDailyHours: 10 };
  const night = tpl('night', '22:00', '06:00');
  const morning = tpl('morning', '08:00', '16:00');

  it('does not count a Sun 22:00–Mon 06:00 shift toward Monday', () => {
    const result = assignShifts(
      base({
        templates: [tpl('mid', '16:00', '20:00')],
        templateCatalog: [night],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', SUN, 'ana', 'night')],
        constraints,
      })
    );
    expect(result.assignments).toHaveLength(1);
  });

  it('counts the whole night shift toward the day it starts', () => {
    // Mon morning 8h + Mon night 8h = 16h > 10h
    const result = assignShifts(
      base({
        templates: [night],
        templateCatalog: [morning],
        workers: [worker('ana', ALL_WEEK)],
        existingRoster: [shift('s1', MON, 'ana', 'morning')],
        constraints,
      })
    );
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('max_hours');
  });
});
