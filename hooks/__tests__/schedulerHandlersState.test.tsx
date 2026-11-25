/**
 * useSchedulerHandlers state that must follow the server and the tenant
 * (CHG-109): staffing gaps (D1), focus reloads (D5), auto-assign suggestions
 * tied to their location (D7), edit forms that keep the `updatedAt` they read
 * (D8), and onboarding flags from server-confirmed rows only (D9).
 *
 * The data hooks are replaced by plain objects the tests control, so each
 * case says exactly what the server has confirmed.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import type { AssignedShift } from '@/services/shiftAssigner';

// ─── Controlled dependencies ──────────────────────────────────────────────────

let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ section: undefined }),
  useRouter: () => ({ setParams: jest.fn(), push: jest.fn() }),
  useFocusEffect: (cb: () => void) => { mockFocus = cb; },
}));

jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

let mockAccountId = 'org_a';
jest.mock('@/contexts/IdentityContext', () => ({
  useIdentity: () => ({ accountId: mockAccountId, userId: 'u1', isLoaded: true }),
}));

jest.mock('@/contexts/WelcomeTourContext', () => ({
  useWelcomeTour: () => ({ recordTourAction: jest.fn() }),
}));

jest.mock('@/hooks/useSessionWellness', () => ({
  useSessionWellness: () => ({
    acknowledgeBreak: jest.fn(), dismissPrompt: jest.fn(), minutesActive: 0, promptVisible: false, recordInteraction: jest.fn(),
  }),
}));

type Row = { id: string; updatedAt?: string };
const mockData: {
  workers: (Row & { name: string; role: string; skills: string[]; availability: unknown[]; displayId: string })[];
  templates: (Row & { name: string; role: string; start: string; end: string; coverage: number })[];
  roster: { id: string; date: string; workerId: string; templateId: string; location: string; status: 'Draft' | 'Published'; notified: boolean }[];
  targets: { date: string; role: string; required: number; source?: 'model' | 'override' }[];
  locations: { id: string; time_zone?: string }[];
  forecastRan: boolean;
} = { workers: [], templates: [], roster: [], targets: [], locations: [], forecastRan: false };

const mockUpdateWorker = jest.fn();
const mockUpdateTemplate = jest.fn();
const mockAddShifts = jest.fn();
const mockRefreshLocations = jest.fn();
const mockRefreshUsage = jest.fn();

jest.mock('@/hooks/useWorkers', () => ({
  useWorkers: () => ({
    workers: mockData.workers, loading: false, loaded: true, error: null, truncated: false,
    addWorker: jest.fn(), updateWorker: mockUpdateWorker, addAvailability: jest.fn(),
    removeWorker: jest.fn(), removeAvailability: jest.fn(), refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/useShiftTemplates', () => ({
  useShiftTemplates: () => ({
    shiftTemplates: mockData.templates, loading: false, loaded: true, error: null, truncated: false,
    addShiftTemplate: jest.fn(), updateShiftTemplate: mockUpdateTemplate, removeShiftTemplate: jest.fn(), refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/useRoster', () => ({
  useRoster: () => ({
    roster: mockData.roster, loading: false, loaded: true, error: null, truncated: false,
    addShift: jest.fn(), addShifts: mockAddShifts, setShiftStatus: jest.fn(), notifyShift: jest.fn(),
    removeShift: jest.fn(), refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/useDemandForecast', () => ({
  useDemandForecast: () => ({
    demandTargets: mockData.targets, triggerForecast: jest.fn(), overrideTarget: jest.fn(), removeOverride: jest.fn(),
    loading: false, error: null, forecasting: false,
    dataStatus: { hasHistorical: false, hasExternalSignals: false, hasExistingTargets: false, apiAvailable: false },
    seedBaselineTargets: jest.fn(), forecastModels: [], forecastNotices: { historyEndsDaysAgo: null, signalsTruncated: false },
    targetsError: null, refresh: jest.fn(), forecastRan: mockData.forecastRan,
  }),
}));
jest.mock('@/hooks/useLocations', () => ({
  useLocations: () => ({ locations: mockData.locations, loaded: true, refresh: mockRefreshLocations }),
}));
jest.mock('@/hooks/useUsageLimit', () => ({
  useUsageLimit: () => ({ canAutoAssign: true, count: 0, loading: false, refresh: mockRefreshUsage }),
}));
jest.mock('@/hooks/useTimeOff', () => ({
  fetchDaysOffOn: jest.fn(async () => ({ ok: true, daysOff: [] })),
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn(async () => undefined) }));
jest.mock('@/services/onboardingProgress', () => ({
  fetchOnboardingProgress: jest.fn(async () => null),
  upsertOnboardingProgress: jest.fn(async (_a: string, progress: unknown) => progress),
}));
const mockRunAutoAssign = jest.fn();
jest.mock('@/services/optimizer/autoAssignClient', () => ({
  runAutoAssign: (...args: unknown[]) => mockRunAutoAssign(...args),
}));
// The labor rules of a location are not under test here (autoAssignLegalConstraints.test.tsx).
jest.mock('@/utils/autoAssignSettings', () => ({
  ...jest.requireActual('@/utils/autoAssignSettings'),
  autoAssignSettings: () => ({ constraints: {}, timeZone: 'America/Lima' }),
}));
jest.mock('@/utils/staffingGaps', () => {
  const actual = jest.requireActual('@/utils/staffingGaps');
  return { ...actual, computeStaffingGaps: jest.fn(actual.computeStaffingGaps) };
});

// eslint-disable-next-line import/first
import { useSchedulerHandlers } from '../useSchedulerHandlers';
// eslint-disable-next-line import/first
import { upsertOnboardingProgress } from '@/services/onboardingProgress';
// eslint-disable-next-line import/first
import { computeStaffingGaps } from '@/utils/staffingGaps';

// ─── Harness ──────────────────────────────────────────────────────────────────

type Handlers = ReturnType<typeof useSchedulerHandlers>;

const render = async () => {
  const state: { current: Handlers | null } = { current: null };
  const Probe = () => {
    state.current = useSchedulerHandlers();
    return null;
  };
  let root!: renderer.ReactTestRenderer;
  await act(async () => {
    root = renderer.create(<Probe />);
  });
  await settle();
  return {
    get h(): Handlers {
      return state.current!;
    },
    rerender: async () => {
      await act(async () => {
        root.update(<Probe />);
      });
      await settle();
    },
    unmount: () => act(() => root.unmount()),
  };
};

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
};

const W1 = { id: 'w1', displayId: 'W-1', name: 'Ana', role: 'Barista', skills: [], availability: [], updatedAt: '2026-11-20T10:00:00.000001+00:00' };
const T1 = { id: 't1', name: 'Morning', role: 'Barista', start: '08:00', end: '14:00', coverage: 3, updatedAt: '2026-11-20T10:00:00+00:00' };
const SUGGESTION: AssignedShift = { date: '2026-12-01', workerId: 'w1', templateId: 't1' } as AssignedShift;

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus = null;
  mockAccountId = 'org_a';
  mockData.workers = [];
  mockData.templates = [];
  mockData.roster = [];
  mockData.targets = [];
  mockData.locations = [];
  mockData.forecastRan = false;
  mockAddShifts.mockResolvedValue({ success: true });
  mockUpdateWorker.mockResolvedValue({ success: true, worker: W1 });
  mockUpdateTemplate.mockResolvedValue({ success: true, template: T1 });
  mockRunAutoAssign.mockResolvedValue({ assignments: [SUGGESTION], unassigned: [] });
});

// ─── D1 ───────────────────────────────────────────────────────────────────────

describe('staffing gaps in the Scheduler (D1)', () => {
  it('match Home and Analytics: published rows, one person each, stored overrides only', async () => {
    mockData.templates = [T1];
    mockData.roster = [
      { id: 's1', date: '2026-12-01', workerId: 'w1', templateId: 't1', location: '', status: 'Published', notified: false },
      { id: 's2', date: '2026-12-01', workerId: 'w2', templateId: 't1', location: '', status: 'Draft', notified: false },
    ];
    mockData.targets = [
      { date: '2026-12-01', role: 'Barista', required: 3, source: 'override' },
      // A forecast still in memory: not demand on Home or Analytics, so not here either.
      { date: '2026-12-02', role: 'Barista', required: 4, source: 'model' },
    ];
    const screen = await render();
    // Hand count: 3 needed, 1 published person (the draft does not count, and
    // template coverage 3 is what the template needs, not what one row gives).
    expect(screen.h.staffingGaps.map(({ date, scheduled, gap }) => ({ date, scheduled, gap }))).toEqual([
      { date: '2026-12-01', scheduled: 1, gap: 2 },
    ]);
    expect(computeStaffingGaps).toHaveBeenCalled();
    screen.unmount();
  });
});

// ─── D5 ───────────────────────────────────────────────────────────────────────

describe('focus reloads (D5)', () => {
  it('reload locations and the usage count on a return, not on the first focus', async () => {
    const screen = await render();
    act(() => mockFocus!());
    expect(mockRefreshLocations).not.toHaveBeenCalled();
    expect(screen.h.focusReloads).toBe(0);
    act(() => mockFocus!());
    expect(mockRefreshLocations).toHaveBeenCalledTimes(1);
    expect(mockRefreshUsage).toHaveBeenCalledTimes(1);
    expect(screen.h.focusReloads).toBe(1);
    screen.unmount();
  });
});

// ─── D7 ───────────────────────────────────────────────────────────────────────

describe('auto-assign suggestions (D7)', () => {
  const twoLocations = [{ id: 'loc-lima' }, { id: 'loc-cusco' }];

  const runFor = async (screen: Awaited<ReturnType<typeof render>>) => {
    act(() => screen.h.updateShiftField('date')('2099-12-01'));
    await act(async () => {
      await screen.h.handleAutoAssign();
    });
  };

  it('are applied under the location they were computed for', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockData.locations = twoLocations;
    const screen = await render();
    act(() => screen.h.selectLocation('loc-cusco'));
    await runFor(screen);
    expect(screen.h.autoAssignSuggestions).toEqual([SUGGESTION]);
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    expect(mockAddShifts).toHaveBeenCalledTimes(1);
    expect(mockAddShifts.mock.calls[0][0].map((s: { location: string }) => s.location)).toEqual(['loc-cusco']);
    expect(screen.h.autoAssignSuggestions).toBeNull();
    screen.unmount();
  });

  it('are cleared when another location is picked, so Apply cannot save them there', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockData.locations = twoLocations;
    const screen = await render();
    act(() => screen.h.selectLocation('loc-cusco'));
    await runFor(screen);
    act(() => screen.h.selectLocation('loc-lima'));
    await settle();
    expect(screen.h.autoAssignSuggestions).toBeNull();
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    expect(mockAddShifts).not.toHaveBeenCalled();
    // Picking the run's location again does not bring them back.
    act(() => screen.h.selectLocation('loc-cusco'));
    await settle();
    expect(screen.h.autoAssignSuggestions).toBeNull();
    screen.unmount();
  });

  it('are cleared when the organization changes', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    const screen = await render();
    await runFor(screen);
    expect(screen.h.autoAssignSuggestions).toEqual([SUGGESTION]);
    mockAccountId = 'org_b';
    await screen.rerender();
    expect(screen.h.autoAssignSuggestions).toBeNull();
    screen.unmount();
  });

  // A run still computing when the location changes was for the old one:
  // no suggestions, no shortfalls and no "found N" banner when it finishes.
  it('drop a run that finishes after another location was picked', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockData.locations = twoLocations;
    let finish!: (r: unknown) => void;
    mockRunAutoAssign.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = await render();
    act(() => screen.h.selectLocation('loc-cusco'));
    act(() => screen.h.updateShiftField('date')('2099-12-01'));
    let running!: Promise<void>;
    await act(async () => {
      running = screen.h.handleAutoAssign();
    });
    await settle();
    expect(mockRunAutoAssign).toHaveBeenCalledTimes(1);
    const signal = (mockRunAutoAssign.mock.calls[0][1] as { signal: AbortSignal }).signal;
    act(() => screen.h.selectLocation('loc-lima'));
    await settle();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish({ assignments: [SUGGESTION], unassigned: [{ templateId: 't1', date: '2099-12-02', missing: 1, reason: 'no one' }] });
      await running;
    });
    // Back on the run's location: still nothing from it.
    act(() => screen.h.selectLocation('loc-cusco'));
    await settle();
    expect(screen.h.autoAssignSuggestions).toBeNull();
    expect(screen.h.autoAssignShortfalls).toBeNull();
    expect(screen.h.actionBanner).toBeNull();
    screen.unmount();
  });

  it('stay dismissed when Dismiss is pressed while a run is computing', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    const screen = await render();
    await runFor(screen);
    let finish!: (r: unknown) => void;
    mockRunAutoAssign.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let running!: Promise<void>;
    await act(async () => {
      running = screen.h.handleAutoAssign();
    });
    await settle();
    const banner = screen.h.actionBanner;
    act(() => screen.h.dismissAutoAssign());
    await act(async () => {
      finish({ assignments: [SUGGESTION], unassigned: [] });
      await running;
    });
    expect(screen.h.autoAssignSuggestions).toBeNull();
    expect(screen.h.actionBanner).toEqual(banner);
    screen.unmount();
  });

  it('can be dismissed without saving', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    const screen = await render();
    await runFor(screen);
    act(() => screen.h.dismissAutoAssign());
    expect(screen.h.autoAssignSuggestions).toBeNull();
    expect(mockAddShifts).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('do not start a new run while Apply is saving', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    let finishSave!: (r: { success: true }) => void;
    mockAddShifts.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const screen = await render();
    await runFor(screen);
    expect(mockRunAutoAssign).toHaveBeenCalledTimes(1);
    let applying!: Promise<void>;
    act(() => {
      applying = screen.h.applyAutoAssign();
    });
    expect(screen.h.autoAssignApplying).toBe(true);
    await act(async () => {
      await screen.h.handleAutoAssign();
    });
    expect(mockRunAutoAssign).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSave({ success: true });
      await applying;
    });
    screen.unmount();
  });

  it('a retry after a failed Apply sends the same client ids, so the server can replay it', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockAddShifts.mockResolvedValueOnce({ success: false, error: 'Bad gateway' });
    const screen = await render();
    await runFor(screen);
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    expect(screen.h.autoAssignSuggestions).toEqual([SUGGESTION]);
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    const idsOf = (call: number) => mockAddShifts.mock.calls[call][0].map((s: { id?: string }) => s.id);
    expect(idsOf(0)).toHaveLength(1);
    expect(typeof idsOf(0)[0]).toBe('string');
    expect(idsOf(1)).toEqual(idsOf(0));
    screen.unmount();
  });

  it('says the shifts were already saved when a retry finds them on the roster', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockAddShifts.mockResolvedValue({ success: true, alreadyStored: true });
    const screen = await render();
    await runFor(screen);
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    expect(screen.h.autoAssignSuggestions).toBeNull();
    expect(screen.h.actionBanner).toEqual({ type: 'success', message: 'scheduler.shifts.autoAssignAlreadySaved' });
    screen.unmount();
  });
});

// ─── D8 ───────────────────────────────────────────────────────────────────────

describe('edit forms keep the updatedAt they read (D8)', () => {
  it('a worker edit sends the updatedAt from when Edit was pressed, not the reloaded one', async () => {
    mockData.workers = [W1];
    const screen = await render();
    act(() => screen.h.handleEditWorker('w1'));
    // Another device saved the worker; the list reloads with its newer row.
    mockData.workers = [{ ...W1, name: 'Ana María', updatedAt: '2026-11-21T08:00:00.123456+00:00' }];
    await screen.rerender();
    await act(async () => {
      await screen.h.handleAddWorker();
    });
    expect(mockUpdateWorker).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorker.mock.calls[0][0]).toBe('w1');
    expect(mockUpdateWorker.mock.calls[0][2]).toBe('2026-11-20T10:00:00.000001+00:00');
    screen.unmount();
  });

  it('a template edit sends the updatedAt from when Edit was pressed', async () => {
    mockData.templates = [T1];
    const screen = await render();
    act(() => screen.h.handleEditTemplate('t1'));
    mockData.templates = [{ ...T1, end: '15:00', updatedAt: '2026-11-21T09:00:00+00:00' }];
    await screen.rerender();
    await act(async () => {
      await screen.h.handleAddTemplate();
    });
    expect(mockUpdateTemplate).toHaveBeenCalledTimes(1);
    expect(mockUpdateTemplate.mock.calls[0][2]).toBe('2026-11-20T10:00:00+00:00');
    screen.unmount();
  });
});

describe('an edit refused because the row changed elsewhere (409)', () => {
  it('keeps the form, says so, and the next save replaces the stored version', async () => {
    mockData.workers = [W1];
    mockUpdateWorker.mockResolvedValueOnce({
      success: false,
      error: 'This worker was changed by someone else. Reload and try again',
      conflictUpdatedAt: '2026-11-21T08:00:00.123456+00:00',
    });
    const screen = await render();
    act(() => screen.h.handleEditWorker('w1'));
    act(() => screen.h.updateWorkerField('name')('Ana Lucía'));
    await act(async () => {
      await screen.h.handleAddWorker();
    });
    expect(screen.h.workerError).toBe('scheduler.edit.conflict');
    expect(screen.h.workerForm.name).toBe('Ana Lucía');
    expect(screen.h.editingWorkerId).toBe('w1');
    await act(async () => {
      await screen.h.handleAddWorker();
    });
    expect(mockUpdateWorker).toHaveBeenCalledTimes(2);
    expect(mockUpdateWorker.mock.calls[1][1]).toMatchObject({ name: 'Ana Lucía' });
    // The version now stored, as the reload gave it: this save may replace it.
    expect(mockUpdateWorker.mock.calls[1][2]).toBe('2026-11-21T08:00:00.123456+00:00');
    expect(screen.h.editingWorkerId).toBeNull();
    screen.unmount();
  });

  it('a template conflict does the same', async () => {
    mockData.templates = [T1];
    mockUpdateTemplate.mockResolvedValueOnce({ success: false, error: 'changed', conflictUpdatedAt: '2026-11-22T00:00:00+00:00' });
    const screen = await render();
    act(() => screen.h.handleEditTemplate('t1'));
    await act(async () => {
      await screen.h.handleAddTemplate();
    });
    expect(screen.h.templateError).toBe('scheduler.edit.conflict');
    await act(async () => {
      await screen.h.handleAddTemplate();
    });
    expect(mockUpdateTemplate.mock.calls[1][2]).toBe('2026-11-22T00:00:00+00:00');
    screen.unmount();
  });

  it('another refusal shows the server message and keeps the updatedAt the form read', async () => {
    mockData.workers = [W1];
    mockUpdateWorker.mockResolvedValueOnce({ success: false, error: 'Only an admin can change the schedule' });
    const screen = await render();
    act(() => screen.h.handleEditWorker('w1'));
    await act(async () => {
      await screen.h.handleAddWorker();
    });
    expect(screen.h.workerError).toBe('Only an admin can change the schedule');
    await act(async () => {
      await screen.h.handleAddWorker();
    });
    expect(mockUpdateWorker.mock.calls[1][2]).toBe('2026-11-20T10:00:00.000001+00:00');
    screen.unmount();
  });
});

// ─── D9 ───────────────────────────────────────────────────────────────────────

describe('onboarding flags come from server-confirmed rows (D9)', () => {
  it('an optimistic worker (no server updatedAt) and a model forecast do not mark a step done', async () => {
    mockData.workers = [{ ...W1, updatedAt: undefined }];
    mockData.templates = [{ ...T1, updatedAt: undefined }];
    mockData.targets = [{ date: '2026-12-02', role: 'Barista', required: 4, source: 'model' }];
    const screen = await render();
    expect(upsertOnboardingProgress).not.toHaveBeenCalled();
    expect(screen.h.onboardingSteps.map((s) => s.completed)).toEqual([false, false, false]);

    // The add was refused: the row goes away and nothing was stored as done.
    mockData.workers = [];
    await screen.rerender();
    expect(upsertOnboardingProgress).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('stored rows and an override do mark the steps done', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockData.targets = [{ date: '2026-12-02', role: 'Barista', required: 4, source: 'override' }];
    const screen = await render();
    expect(upsertOnboardingProgress).toHaveBeenCalledWith('org_a', { workers: true, templates: true, forecast: true }, 'u1');
    screen.unmount();
  });

  // "Run forecast" asks for a run, not for an override: a run that produced
  // forecasts for this tenant marks it done (useDemandForecast.forecastRan).
  it('a forecast run that produced forecasts marks "Run forecast" done', async () => {
    mockData.targets = [{ date: '2026-12-02', role: 'Barista', required: 4, source: 'model' }];
    const screen = await render();
    expect(upsertOnboardingProgress).not.toHaveBeenCalled();
    mockData.forecastRan = true;
    await screen.rerender();
    expect(upsertOnboardingProgress).toHaveBeenCalledWith('org_a', { workers: false, templates: false, forecast: true }, 'u1');
    expect(screen.h.onboardingSteps.map((s) => s.completed)).toEqual([false, false, true]);
    screen.unmount();
  });
});
