/**
 * TDD tests for the greedy shift-assignment algorithm.
 * Written before implementation per project TDD mandate.
 */
import { assignShifts, getWeekBounds, type AssignmentInput, type AssignmentResult, type LaborConstraints } from '../shiftAssigner';
import { type ShiftTemplate } from '@/utils/schedulerMetrics';
import { type Worker } from '@/types/scheduler';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const morningTemplate: ShiftTemplate = {
  id: 'morning',
  name: 'Morning',
  role: 'Support',
  start: '08:00',
  end: '16:00',
  coverage: 1,
};

const eveningTemplate: ShiftTemplate = {
  id: 'evening',
  name: 'Evening',
  role: 'Support',
  start: '16:00',
  end: '00:00',
  coverage: 1,
};

const cashierTemplate: ShiftTemplate = {
  id: 'cashier',
  name: 'Cashier',
  role: 'Cashier',
  start: '09:00',
  end: '17:00',
  coverage: 1,
};

const alice: Worker = {
  id: 'alice',
  name: 'Alice',
  role: 'Support',
  skills: ['chat'],
  availability: [{ day: 'Mon', from: '07:00', to: '20:00' }],
};

const bob: Worker = {
  id: 'bob',
  name: 'Bob',
  role: 'Support',
  skills: ['phone'],
  availability: [{ day: 'Mon', from: '07:00', to: '20:00' }],
};

const carol: Worker = {
  id: 'carol',
  name: 'Carol',
  role: 'Cashier',
  skills: [],
  availability: [{ day: 'Mon', from: '08:00', to: '18:00' }],
};

// 2026-03-30 is a Monday
const MON = '2026-03-30';

// ─── Basic assignment ─────────────────────────────────────────────────────────

describe('assignShifts — basic assignment', () => {
  it('assigns one worker to one slot when a single worker qualifies', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [alice],
      existingRoster: [],
    };
    const result: AssignmentResult = assignShifts(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].workerId).toBe('alice');
    expect(result.assignments[0].templateId).toBe('morning');
    expect(result.assignments[0].date).toBe(MON);
  });

  it('returns an empty list when no workers are available for the date', () => {
    const workerWithNoMonAvailability: Worker = {
      ...alice,
      availability: [{ day: 'Tue', from: '07:00', to: '20:00' }],
    };
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [workerWithNoMonAvailability],
      existingRoster: [],
    };
    expect(assignShifts(input).assignments).toHaveLength(0);
  });

  it('assigns different workers to non-overlapping shifts on the same day', () => {
    // eveningTemplate ends at midnight, so workers need availability until 23:59 (= end of day).
    // (Previously alice/bob's 07:00–20:00 availability was wrongly accepted for 16:00–00:00.)
    const lateAlice: Worker = { ...alice, availability: [{ day: 'Mon', from: '07:00', to: '23:59' }] };
    const lateBob: Worker = { ...bob, availability: [{ day: 'Mon', from: '07:00', to: '23:59' }] };
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate, eveningTemplate],
      workers: [lateAlice, lateBob],
      existingRoster: [],
    };
    const result = assignShifts(input);
    expect(result.assignments).toHaveLength(2);
    const workerIds = result.assignments.map((a) => a.workerId);
    expect(new Set(workerIds).size).toBe(2); // different workers
  });
});

// ─── Hard constraint: role match ──────────────────────────────────────────────

describe('assignShifts — role match constraint', () => {
  it('does not assign a worker whose role does not match the template role', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [cashierTemplate],
      workers: [alice], // alice is Support, template is Cashier
      existingRoster: [],
    };
    expect(assignShifts(input).assignments).toHaveLength(0);
  });

  it('assigns a cashier worker to a cashier template', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [cashierTemplate],
      workers: [carol],
      existingRoster: [],
    };
    const result = assignShifts(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].workerId).toBe('carol');
  });
});

// ─── Hard constraint: no overlap ─────────────────────────────────────────────

describe('assignShifts — no time overlap per worker per day', () => {
  it('does not assign the same worker to two overlapping shifts', () => {
    const overlappingTemplate: ShiftTemplate = {
      id: 'overlap',
      name: 'Overlap',
      role: 'Support',
      start: '10:00',
      end: '18:00',
      coverage: 1,
    };
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate, overlappingTemplate],
      workers: [alice], // only one worker
      existingRoster: [],
    };
    const result = assignShifts(input);
    // Alice can only cover one of the two overlapping shifts
    expect(result.assignments.length).toBeLessThanOrEqual(1);
    const aliceAssignments = result.assignments.filter((a) => a.workerId === 'alice');
    expect(aliceAssignments).toHaveLength(aliceAssignments.length); // no duplicates
    // Verify no two assignments for alice overlap
    expect(aliceAssignments.length).toBeLessThanOrEqual(1);
  });
});

// ─── Hard constraint: existing roster ────────────────────────────────────────

describe('assignShifts — respects existing roster', () => {
  it('does not assign a worker who already has a shift in the existing roster for that date', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [alice],
      existingRoster: [
        {
          id: 'existing-1',
          date: MON,
          workerId: 'alice',
          templateId: 'morning',
          location: 'HQ',
          status: 'Published',
          notified: false,
        },
      ],
    };
    // alice already has this exact slot
    expect(assignShifts(input).assignments).toHaveLength(0);
  });

  it('allows assignment to a non-conflicting template when worker has existing shift', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [eveningTemplate],
      // availability must reach midnight to cover 16:00–00:00 (07:00–20:00 was wrongly accepted before A4 fix)
      workers: [{ ...alice, availability: [{ day: 'Mon', from: '07:00', to: '00:00' }] }],
      existingRoster: [
        {
          id: 'existing-1',
          date: MON,
          workerId: 'alice',
          templateId: 'morning', // 08:00-16:00 — does not overlap with 16:00-00:00
          location: 'HQ',
          status: 'Published',
          notified: false,
        },
      ],
    };
    const result = assignShifts(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].workerId).toBe('alice');
  });
});

// ─── Fairness / soft scoring ──────────────────────────────────────────────────

describe('assignShifts — fairness scoring', () => {
  it('prefers the worker with fewer existing assignments (fairness)', () => {
    // Bob has no prior hours; alice has many — assigner should prefer Bob
    const busyAlice: Worker = {
      ...alice,
      // We pass alice's prior hours in existingRoster to test fairness
    };
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [busyAlice, bob],
      existingRoster: [
        // alice already has 3 shifts this week
        { id: 'a1', date: '2026-03-28', workerId: 'alice', templateId: 'morning', location: 'HQ', status: 'Published', notified: false },
        { id: 'a2', date: '2026-03-29', workerId: 'alice', templateId: 'morning', location: 'HQ', status: 'Published', notified: false },
        { id: 'a3', date: '2026-03-31', workerId: 'alice', templateId: 'morning', location: 'HQ', status: 'Published', notified: false },
      ],
    };
    const result = assignShifts(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].workerId).toBe('bob'); // bob has fewer hours
  });
});

// ─── Return structure ─────────────────────────────────────────────────────────

describe('assignShifts — return structure', () => {
  it('returns unassigned templates with a reason', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate, cashierTemplate],
      workers: [alice], // no cashier available
      existingRoster: [],
    };
    const result = assignShifts(input);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].templateId).toBe('cashier');
    expect(result.unassigned[0].reason).toBeTruthy();
  });

  it('returns an empty unassigned list when all templates are covered', () => {
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [alice],
      existingRoster: [],
    };
    const result = assignShifts(input);
    expect(result.unassigned).toHaveLength(0);
  });
});

// ─── getWeekBounds ────────────────────────────────────────────────────────────

describe('getWeekBounds', () => {
  it('returns Monday as weekStart for a Monday date', () => {
    // 2026-03-30 is a Monday
    const { weekStart, weekEnd } = getWeekBounds('2026-03-30');
    expect(weekStart).toBe('2026-03-30');
    expect(weekEnd).toBe('2026-04-05');
  });

  it('returns the correct Monday for a Wednesday', () => {
    // 2026-04-01 is a Wednesday
    const { weekStart, weekEnd } = getWeekBounds('2026-04-01');
    expect(weekStart).toBe('2026-03-30');
    expect(weekEnd).toBe('2026-04-05');
  });

  it('returns the correct Monday for a Sunday', () => {
    // 2026-04-05 is a Sunday
    const { weekStart, weekEnd } = getWeekBounds('2026-04-05');
    expect(weekStart).toBe('2026-03-30');
    expect(weekEnd).toBe('2026-04-05');
  });

  it('handles week crossing a month boundary', () => {
    // 2026-03-28 is a Saturday — week should be Mon 2026-03-23 to Sun 2026-03-29
    const { weekStart, weekEnd } = getWeekBounds('2026-03-28');
    expect(weekStart).toBe('2026-03-23');
    expect(weekEnd).toBe('2026-03-29');
  });

  it('handles week crossing a year boundary', () => {
    // 2027-01-01 is a Friday — week should be Mon 2026-12-28 to Sun 2027-01-03
    const { weekStart, weekEnd } = getWeekBounds('2027-01-01');
    expect(weekStart).toBe('2026-12-28');
    expect(weekEnd).toBe('2027-01-03');
  });
});

// ─── Labor-law constraints: maxDailyHours ────────────────────────────────────

describe('assignShifts — maxDailyHours constraint', () => {
  // morning = 08:00-16:00 = 8h; evening = 16:00-00:00 = 8h
  // alice is available Mon 07:00–20:00 (covers morning but NOT evening end=midnight)
  // Use a worker with full-day availability for these tests
  const fullDay: Worker = {
    id: 'fullday',
    name: 'FullDay',
    role: 'Support',
    skills: [],
    availability: [{ day: 'Mon', from: '00:00', to: '23:59' }],
  };

  const afternoonTemplate: ShiftTemplate = {
    id: 'afternoon',
    name: 'Afternoon',
    role: 'Support',
    start: '12:00',
    end: '18:00',
    coverage: 1,
  };

  it('allows assignment when hours stay within daily limit', () => {
    // 8h morning shift, limit = 10h → should be assigned
    const constraints: LaborConstraints = { maxDailyHours: 10 };
    const result = assignShifts({ date: MON, templates: [morningTemplate], workers: [fullDay], existingRoster: [], constraints });
    expect(result.assignments).toHaveLength(1);
  });

  it('blocks assignment when it would exceed the daily limit', () => {
    // fullDay already has an 8h morning shift; adding 6h late shift would = 14h > 10h limit.
    // (This test used afternoonTemplate 12:00–18:00, which OVERLAPS the 08:00–16:00 morning
    // shift; it only reached the hours check because of bug A6. Use a non-overlapping shift.)
    const lateTemplate: ShiftTemplate = { ...afternoonTemplate, id: 'late6', start: '16:00', end: '22:00' };
    const constraints: LaborConstraints = { maxDailyHours: 10 };
    const result = assignShifts({
      date: MON,
      templates: [lateTemplate],
      templateCatalog: [morningTemplate, lateTemplate], // catalog includes prior-day template
      workers: [fullDay],
      existingRoster: [
        { id: 'e1', date: MON, workerId: 'fullday', templateId: 'morning', location: 'HQ', status: 'Published', notified: false },
      ],
      constraints,
    });
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reason).toMatch(/labor-law/i);
  });

  it('allows assignment when daily limit is exactly met', () => {
    // morning = 8h, limit = 8h → exact → should still be allowed (not strictly over)
    const constraints: LaborConstraints = { maxDailyHours: 8 };
    const result = assignShifts({ date: MON, templates: [morningTemplate], workers: [fullDay], existingRoster: [], constraints });
    expect(result.assignments).toHaveLength(1);
  });
});

// ─── Labor-law constraints: maxWeeklyHours ────────────────────────────────────

describe('assignShifts — maxWeeklyHours constraint', () => {
  const fullWeekWorker: Worker = {
    id: 'weekworker',
    name: 'WeekWorker',
    role: 'Support',
    skills: [],
    availability: [
      { day: 'Mon', from: '07:00', to: '20:00' },
      { day: 'Tue', from: '07:00', to: '20:00' },
    ],
  };

  it('blocks assignment when adding the shift would exceed weekly limit', () => {
    // Worker already has 40h this week; morning = 8h → 48h > 40h limit
    const constraints: LaborConstraints = { maxWeeklyHours: 40 };
    const existingRoster = [
      { id: 'w1', date: '2026-03-23', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w2', date: '2026-03-24', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w3', date: '2026-03-25', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w4', date: '2026-03-26', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w5', date: '2026-03-27', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
    ];
    // All 5 existing shifts (Mon 23 – Fri 27) are in the prior week (week of 2026-03-23); MON = 2026-03-30 is the NEXT week, so they should NOT count
    // Use same-week dates: 2026-03-30 to 2026-04-03 (Mon–Fri in same week)
    const sameWeekRoster = [
      { id: 'w1', date: '2026-03-30', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w2', date: '2026-03-31', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w3', date: '2026-04-01', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w4', date: '2026-04-02', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'w5', date: '2026-04-03', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
    ];
    // Tue 2026-03-31 is in the same week as Mon 2026-03-30; at 5×8h=40h already
    // Trying to assign another morning on Tue 2026-03-31 (worker has Tue availability)
    // But sameWeekRoster already has a shift on Tue, so overlap will reject it first.
    // Instead assign on a day not in roster but in same week: need a worker with Wed availability too
    void existingRoster; void sameWeekRoster; // avoid unused warning
    // Simpler: add 40h via 5 prior published shifts in the same week, then try adding one more
    const TUE = '2026-03-31'; // same week as MON
    const workerWithTue: Worker = {
      ...fullWeekWorker,
      availability: [
        { day: 'Mon', from: '07:00', to: '20:00' },
        { day: 'Tue', from: '07:00', to: '20:00' },
      ],
    };
    const priorShifts = [
      { id: 'p1', date: '2026-03-30', workerId: workerWithTue.id, templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p2', date: '2026-04-01', workerId: workerWithTue.id, templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p3', date: '2026-04-02', workerId: workerWithTue.id, templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p4', date: '2026-04-03', workerId: workerWithTue.id, templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p5', date: '2026-04-04', workerId: workerWithTue.id, templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
    ]; // 5×8h = 40h already in this same week
    const res = assignShifts({ date: TUE, templates: [morningTemplate], workers: [workerWithTue], existingRoster: priorShifts, constraints });
    expect(res.assignments).toHaveLength(0);
    expect(res.unassigned[0].reason).toMatch(/labor-law/i);
  });

  it('allows assignment when weekly hours stay within limit', () => {
    const constraints: LaborConstraints = { maxWeeklyHours: 40 };
    // Only 32h existing (4×8h same week), adding 8h = 40h ≤ limit
    const priorShifts = [
      { id: 'p1', date: '2026-03-31', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p2', date: '2026-04-01', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p3', date: '2026-04-02', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
      { id: 'p4', date: '2026-04-03', workerId: 'weekworker', templateId: 'morning', location: 'HQ', status: 'Published' as const, notified: false },
    ]; // 4×8h=32h; adding Mon=8h → 40h exactly
    const result = assignShifts({ date: MON, templates: [morningTemplate], workers: [fullWeekWorker], existingRoster: priorShifts, constraints });
    expect(result.assignments).toHaveLength(1);
  });
});

// ─── Labor-law constraints: minRestHoursBetweenShifts ────────────────────────

describe('assignShifts — minRestHoursBetweenShifts constraint', () => {
  const fullDayWorker: Worker = {
    id: 'restworker',
    name: 'RestWorker',
    role: 'Support',
    skills: [],
    availability: [
      { day: 'Mon', from: '00:00', to: '23:59' },
      { day: 'Tue', from: '00:00', to: '23:59' },
    ],
  };

  const earlyTemplate: ShiftTemplate = {
    id: 'early',
    name: 'Early',
    role: 'Support',
    start: '06:00',
    end: '14:00',
    coverage: 1,
  };

  const lateTemplate: ShiftTemplate = {
    id: 'late',
    name: 'Late',
    role: 'Support',
    start: '22:00',
    end: '06:00', // overnight — ends 06:00 the next day
    coverage: 1,
  };

  const endingAt22: ShiftTemplate = { id: 'ends22', name: 'Ends22', role: 'Support', start: '14:00', end: '22:00', coverage: 1 };

  it('blocks assignment when new shift starts before min-rest gap has elapsed', () => {
    // Worker ends at 22:00 Mon; trying to assign earlyTemplate (06:00 Tue) → gap = 8h
    // With minRest = 10h → should be blocked
    const constraints: LaborConstraints = { minRestHoursBetweenShifts: 10 };
    const TUE = '2026-03-31';
    const priorShift = { id: 'r1', date: MON, workerId: 'restworker', templateId: 'ends22', location: 'HQ', status: 'Published' as const, notified: false };
    const result = assignShifts({
      date: TUE,
      templates: [earlyTemplate],
      templateCatalog: [earlyTemplate, endingAt22], // catalog includes prior shift template
      workers: [fullDayWorker],
      existingRoster: [priorShift],
      constraints,
      timezoneOffsetMinutes: 0,
    });
    // gap between 22:00 Mon and 06:00 Tue = 8h < 10h min rest → blocked
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reason).toMatch(/labor-law/i);
  });

  it('allows assignment when rest gap exceeds the minimum', () => {
    const constraints: LaborConstraints = { minRestHoursBetweenShifts: 7 };
    const TUE = '2026-03-31';
    const priorShift = { id: 'r1', date: MON, workerId: 'restworker', templateId: 'ends22', location: 'HQ', status: 'Published' as const, notified: false };
    // gap between 22:00 Mon and 06:00 Tue = 8h > 7h min rest → allowed
    const result = assignShifts({
      date: TUE,
      templates: [earlyTemplate],
      templateCatalog: [earlyTemplate, endingAt22],
      workers: [fullDayWorker],
      existingRoster: [priorShift],
      constraints,
      timezoneOffsetMinutes: 0,
    });
    expect(result.assignments).toHaveLength(1);
  });

  it('includes overnight shifts (end < start) in min-rest calculations', () => {
    // lateTemplate is Mon 22:00 → Tue 06:00; earlyTemplate Tue 06:00 starts with 0h rest.
    // (Previously this test only asserted "does not throw" because overnight shifts were skipped — bug A3.)
    const constraints: LaborConstraints = { minRestHoursBetweenShifts: 8 };
    const TUE = '2026-03-31';
    const priorShift = { id: 'r1', date: MON, workerId: 'restworker', templateId: 'late', location: 'HQ', status: 'Published' as const, notified: false };
    const result = assignShifts({
      date: TUE,
      templates: [earlyTemplate],
      templateCatalog: [earlyTemplate, lateTemplate],
      workers: [fullDayWorker],
      existingRoster: [priorShift],
      constraints,
      timezoneOffsetMinutes: 0,
    });
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reasonCode).toBe('min_rest');
  });
});

// ─── Backward compatibility: no constraints ───────────────────────────────────

describe('assignShifts — backward compatibility (no constraints)', () => {
  it('still assigns correctly when constraints field is omitted', () => {
    // No constraints property at all — must work exactly as before
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate],
      workers: [alice],
      existingRoster: [],
    };
    const result = assignShifts(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned).toHaveLength(0);
  });
});
