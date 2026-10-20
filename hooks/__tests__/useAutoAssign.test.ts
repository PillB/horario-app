import React from 'react';
import renderer, { act } from 'react-test-renderer';

import type { AssignedShift, LaborConstraints } from '@/services/shiftAssigner';
import type { DbRosterShift, UpsertRosterShiftResult } from '@/services/rosterService';
import type { ShiftTemplate, Shift } from '@/utils/schedulerMetrics';
import type { Worker } from '@/types/scheduler';

// jest.mock calls below are hoisted above these imports by babel-jest.
import { assignShifts } from '@/services/shiftAssigner';
import { upsertRosterShift } from '@/services/rosterService';
import { trackEvent } from '@/services/analytics';
import { log } from '@/services/logger';
import { useAutoAssign, type AssignmentResult } from '../useAutoAssign';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/services/shiftAssigner', () => ({
  ...jest.requireActual('@/services/shiftAssigner'),
  assignShifts: jest.fn(),
}));

jest.mock('@/services/rosterService', () => ({
  upsertRosterShift: jest.fn(),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('@/services/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/utils/schedulerUtils', () => ({
  getTemplateWindow: jest.fn(),
  parseTimeToMinutes: jest.fn((time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + (m ?? 0);
  }),
}));


// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockAssignShifts = assignShifts as jest.Mock;
const mockUpsertRosterShift = upsertRosterShift as jest.Mock;
const mockTrackEvent = trackEvent as jest.Mock;
const mockLogInfo = log.info as jest.Mock;
const mockLogWarn = log.warn as jest.Mock;
const mockLogError = log.error as jest.Mock;

// ─── Fixture factories ────────────────────────────────────────────────────────

const makeTemplate = (overrides: Partial<ShiftTemplate> = {}): ShiftTemplate =>
  ({
    id: 'tpl-1',
    name: 'Morning Shift',
    role: 'Barista',
    coverage: 1,
    start: '09:00',
    end: '17:00',
    ...overrides,
  } as unknown as ShiftTemplate);

const makeWorker = (overrides: Partial<Worker> = {}): Worker =>
  ({
    id: 'worker-1',
    name: 'Alice Chen',
    role: 'Barista',
    ...overrides,
  } as Worker);

const makeAssignedShift = (overrides: Partial<AssignedShift> = {}): AssignedShift =>
  ({
    workerId: 'worker-1',
    templateId: 'tpl-1',
    date: '2024-01-15',
    ...overrides,
  } as AssignedShift);

const makeDbRosterShift = (overrides: Partial<DbRosterShift> = {}): DbRosterShift =>
  ({
    id: 'roster-1',
    workerId: 'worker-1',
    templateId: 'tpl-1',
    date: '2024-01-15',
    accountId: 'acc-1',
    status: 'Draft',
    notified: false,
    location: '',
    ...overrides,
  } as DbRosterShift);

const makeSuccessUpsertResult = (shift: DbRosterShift): UpsertRosterShiftResult =>
  ({ success: true, shift } as UpsertRosterShiftResult);

const makeFailUpsertResult = (error: string): UpsertRosterShiftResult =>
  ({ success: false, error } as UpsertRosterShiftResult);

// ─── Hook test harness ────────────────────────────────────────────────────────

type HookResult = ReturnType<typeof useAutoAssign>;

const renderHook = (accountId: string): { current: HookResult } => {
  const ref: { current: HookResult } = { current: null as unknown as HookResult };

  const TestComponent = (): null => {
    ref.current = useAutoAssign(accountId);
    return null;
  };

  act(() => {
    renderer.create(React.createElement(TestComponent));
  });

  return ref;
};

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const DATE = '2024-01-15';
const ACCOUNT_ID = 'acc-1';
const EXISTING_ROSTER: Shift[] = [];
const CONSTRAINTS: LaborConstraints | undefined = undefined;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useAutoAssign', () => {
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

  // ── Test 1: happy path ─────────────────────────────────────────────────────

  it('happy path: assignShifts returns 2 assignments, both persist → persisted.length=2, totalAssigned=2, coverageGaps=[]', async () => {
    const templates = [
      makeTemplate({ id: 'tpl-1', coverage: 1 }),
      makeTemplate({ id: 'tpl-2', name: 'Evening Shift', coverage: 1 }),
    ];
    const workers = [
      makeWorker({ id: 'worker-1', name: 'Alice Chen' }),
      makeWorker({ id: 'worker-2', name: 'Bob Smith' }),
    ];
    const assignments = [
      makeAssignedShift({ workerId: 'worker-1', templateId: 'tpl-1' }),
      makeAssignedShift({ workerId: 'worker-2', templateId: 'tpl-2' }),
    ];
    const dbShift1 = makeDbRosterShift({ id: 'roster-1', workerId: 'worker-1', templateId: 'tpl-1' });
    const dbShift2 = makeDbRosterShift({ id: 'roster-2', workerId: 'worker-2', templateId: 'tpl-2' });

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift
      .mockResolvedValueOnce(makeSuccessUpsertResult(dbShift1))
      .mockResolvedValueOnce(makeSuccessUpsertResult(dbShift2));

    const ref = renderHook(ACCOUNT_ID);

    let result!: AssignmentResult;
    await act(async () => {
      result = await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(result.persisted).toHaveLength(2);
    expect(result.totalAssigned).toBe(2);
    expect(result.coverageGaps).toHaveLength(0);
    expect(result.failedToPersist).toHaveLength(0);
    expect(ref.current.result?.totalAssigned).toBe(2);
  });

  // ── Test 1b: partial coverage is surfaced with the engine's reason ─────────

  it('partial coverage: template needing 3 with 1 assigned → coverage gap with shortfall 2 and reasonCode', async () => {
    const templates = [makeTemplate({ id: 'tpl-1', coverage: 3 })];
    const workers = [makeWorker({ id: 'worker-1' })];
    const assignments = [makeAssignedShift({ workerId: 'worker-1', templateId: 'tpl-1' })];
    mockAssignShifts.mockReturnValue({
      assignments,
      unassigned: [
        { templateId: 'tpl-1', date: DATE, required: 3, assigned: 1, missing: 2, reasonCode: 'overlap', reason: 'x' },
      ],
    });
    mockUpsertRosterShift.mockResolvedValueOnce(makeSuccessUpsertResult(makeDbRosterShift()));

    const ref = renderHook(ACCOUNT_ID);
    let result!: AssignmentResult;
    await act(async () => {
      result = await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(result.coverageGaps).toEqual([
      expect.objectContaining({ templateId: 'tpl-1', required: 3, assigned: 1, shortfall: 2, reasonCode: 'overlap' }),
    ]);
  });

  // ── Test 2: algorithm throws ───────────────────────────────────────────────

  it('algorithm throws → error message set, assigning=false, empty result, analytics called with success:false', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];

    mockAssignShifts.mockImplementation(() => {
      throw new Error('Algorithm exploded');
    });

    const ref = renderHook(ACCOUNT_ID);

    let result!: AssignmentResult;
    await act(async () => {
      result = await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(result.persisted).toHaveLength(0);
    expect(result.failedToPersist).toHaveLength(0);
    expect(result.coverageGaps).toHaveLength(0);
    expect(result.totalAssigned).toBe(0);

    expect(ref.current.assigning).toBe(false);
    expect(ref.current.error).toBe('Algorithm exploded');

    expect(mockTrackEvent).toHaveBeenCalledWith('auto_assign_used', expect.objectContaining({
      accountId: ACCOUNT_ID,
      date: DATE,
      success: false,
      error: 'Algorithm exploded',
    }));
  });

  // ── Test 3: upsertRosterShift fails for one shift ─────────────────────────

  it('upsertRosterShift fails for one shift → failedToPersist.length=1, persisted.length=1', async () => {
    const templates = [makeTemplate({ id: 'tpl-1', coverage: 1 })];
    const workers = [
      makeWorker({ id: 'worker-1', name: 'Alice Chen' }),
      makeWorker({ id: 'worker-2', name: 'Bob Smith' }),
    ];
    const assignments = [
      makeAssignedShift({ workerId: 'worker-1', templateId: 'tpl-1' }),
      makeAssignedShift({ workerId: 'worker-2', templateId: 'tpl-1' }),
    ];
    const dbShift1 = makeDbRosterShift({ id: 'roster-1', workerId: 'worker-1', templateId: 'tpl-1' });

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift
      .mockResolvedValueOnce(makeSuccessUpsertResult(dbShift1))
      .mockResolvedValueOnce(makeFailUpsertResult('DB timeout'));

    const ref = renderHook(ACCOUNT_ID);

    let result!: AssignmentResult;
    await act(async () => {
      result = await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(result.persisted).toHaveLength(1);
    expect(result.failedToPersist).toHaveLength(1);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  // ── Test 4: coverage gap ───────────────────────────────────────────────────

  it('coverage gap: template requires 2 but only 1 persists → coverageGaps has entry with shortfall=1', async () => {
    const templates = [makeTemplate({ id: 'tpl-1', coverage: 2 })];
    const workers = [
      makeWorker({ id: 'worker-1', name: 'Alice Chen' }),
      makeWorker({ id: 'worker-2', name: 'Bob Smith' }),
    ];
    const assignments = [
      makeAssignedShift({ workerId: 'worker-1', templateId: 'tpl-1' }),
      makeAssignedShift({ workerId: 'worker-2', templateId: 'tpl-1' }),
    ];
    const dbShift1 = makeDbRosterShift({ id: 'roster-1', workerId: 'worker-1', templateId: 'tpl-1' });

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift
      .mockResolvedValueOnce(makeSuccessUpsertResult(dbShift1))
      .mockResolvedValueOnce(makeFailUpsertResult('Network error'));

    const ref = renderHook(ACCOUNT_ID);

    let result!: AssignmentResult;
    await act(async () => {
      result = await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(result.coverageGaps).toHaveLength(1);
    expect(result.coverageGaps[0].templateId).toBe('tpl-1');
    expect(result.coverageGaps[0].required).toBe(2);
    expect(result.coverageGaps[0].assigned).toBe(1);
    expect(result.coverageGaps[0].shortfall).toBe(1);
  });

  // ── Test 5: explanations contain worker name, role, time window ───────────

  it('produces explanations with worker name, role, time window in reason string', async () => {
    const templates = [makeTemplate({ id: 'tpl-1', name: 'Morning Shift', role: 'Barista', start: '09:00', end: '17:00', coverage: 1 })];
    const workers = [makeWorker({ id: 'worker-1', name: 'Alice Chen', role: 'Barista' })];
    const assignments = [makeAssignedShift({ workerId: 'worker-1', templateId: 'tpl-1' })];
    const dbShift = makeDbRosterShift({ id: 'roster-1', workerId: 'worker-1', templateId: 'tpl-1' });

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift.mockResolvedValueOnce(makeSuccessUpsertResult(dbShift));

    const ref = renderHook(ACCOUNT_ID);

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(ref.current.explanations).toHaveLength(1);
    const explanation = ref.current.explanations[0];
    expect(explanation.workerName).toBe('Alice Chen');
    expect(explanation.templateName).toBe('Morning Shift');
    expect(explanation.reason).toContain('Alice Chen');
    expect(explanation.reason).toContain('Barista');
    expect(explanation.reason).toContain('09:00');
    expect(explanation.reason).toContain('17:00');
  });

  // ── Test 6: reset() clears state ──────────────────────────────────────────

  it('reset() clears result, explanations, error back to null', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];
    const assignments = [makeAssignedShift()];
    const dbShift = makeDbRosterShift();

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift.mockResolvedValueOnce(makeSuccessUpsertResult(dbShift));

    const ref = renderHook(ACCOUNT_ID);

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(ref.current.result).not.toBeNull();

    act(() => {
      ref.current.reset();
    });

    expect(ref.current.result).toBeNull();
    expect(ref.current.explanations).toHaveLength(0);
    expect(ref.current.error).toBeNull();
    expect(ref.current.assigning).toBe(false);
  });

  // ── Test 7: assigning transitions ─────────────────────────────────────────

  it('assigning is false initially, becomes false again after autoAssign resolves', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];
    const assignments = [makeAssignedShift()];
    const dbShift = makeDbRosterShift();

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });

    let resolveUpsert!: (value: UpsertRosterShiftResult) => void;
    const upsertPromise = new Promise<UpsertRosterShiftResult>((resolve) => {
      resolveUpsert = resolve;
    });
    mockUpsertRosterShift.mockReturnValueOnce(upsertPromise);

    const ref = renderHook(ACCOUNT_ID);

    expect(ref.current.assigning).toBe(false);

    let assignPromise!: Promise<AssignmentResult>;
    act(() => {
      assignPromise = ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    // After initiating (but before resolving), assigning should be true
    expect(ref.current.assigning).toBe(true);

    await act(async () => {
      resolveUpsert(makeSuccessUpsertResult(dbShift));
      await assignPromise;
    });

    expect(ref.current.assigning).toBe(false);
  });

  // ── Test 8: analytics trackEvent called on success and on algorithm throw ─

  it('trackEvent called with auto_assign_used on success AND on algorithm throw', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];

    // First call: algorithm throws
    mockAssignShifts.mockImplementationOnce(() => {
      throw new Error('Failure');
    });

    const ref = renderHook(ACCOUNT_ID);

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('auto_assign_used', expect.objectContaining({
      success: false,
      accountId: ACCOUNT_ID,
      date: DATE,
    }));

    jest.clearAllMocks();

    // Second call: success path
    const assignments = [makeAssignedShift()];
    const dbShift = makeDbRosterShift();
    mockAssignShifts.mockReturnValueOnce({ assignments, unassigned: [] });
    mockUpsertRosterShift.mockResolvedValueOnce(makeSuccessUpsertResult(dbShift));

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('auto_assign_used', expect.objectContaining({
      success: true,
      accountId: ACCOUNT_ID,
      date: DATE,
      assigned: 1,
    }));
  });

  // ── Test 8b: log.info is called on success ─────────────────────────────────

  it('log.info is called on start and completion of successful auto-assign', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];
    const assignments = [makeAssignedShift()];
    const dbShift = makeDbRosterShift();

    mockAssignShifts.mockReturnValue({ assignments, unassigned: [] });
    mockUpsertRosterShift.mockResolvedValueOnce(makeSuccessUpsertResult(dbShift));

    const ref = renderHook(ACCOUNT_ID);

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(mockLogInfo).toHaveBeenCalledWith('ROSTER', 'Starting auto-assign', expect.objectContaining({ date: DATE }));
    expect(mockLogInfo).toHaveBeenCalledWith('ROSTER', 'Completed', expect.objectContaining({ date: DATE }));
  });

  // ── Test extra: log.error called when algorithm throws ────────────────────

  it('log.error is called when the algorithm throws', async () => {
    const templates = [makeTemplate()];
    const workers = [makeWorker()];

    mockAssignShifts.mockImplementation(() => {
      throw new Error('Boom');
    });

    const ref = renderHook(ACCOUNT_ID);

    await act(async () => {
      await ref.current.autoAssign(DATE, templates, workers, EXISTING_ROSTER, CONSTRAINTS);
    });

    expect(mockLogError).toHaveBeenCalledWith('ROSTER', 'Algorithm threw', expect.objectContaining({ date: DATE, error: 'Boom' }));
  });
});