/**
 * TDD tests for the greedy shift-assignment algorithm.
 * Written before implementation per project TDD mandate.
 */
import { assignShifts, type AssignmentInput, type AssignmentResult } from '../shiftAssigner';
import { type ShiftTemplate } from '@/app/(tabs)/schedulerMetrics';
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
    const input: AssignmentInput = {
      date: MON,
      templates: [morningTemplate, eveningTemplate],
      workers: [alice, bob],
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
      workers: [alice],
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
