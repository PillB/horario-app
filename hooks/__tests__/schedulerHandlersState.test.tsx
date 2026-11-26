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
import { Alert } from 'react-native';

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
const mockAddShift = jest.fn();
const mockAddAvailabilityDays = jest.fn();
const mockRemoveWorker = jest.fn();
const mockSetShiftStatus = jest.fn();
const mockRefreshRoster = jest.fn();
const mockRefreshLocations = jest.fn();
const mockRefreshUsage = jest.fn();

jest.mock('@/hooks/useWorkers', () => ({
  useWorkers: () => ({
    workers: mockData.workers, loading: false, loaded: true, error: null, truncated: false,
    addWorker: jest.fn(), updateWorker: mockUpdateWorker, addAvailability: jest.fn(), addAvailabilityDays: mockAddAvailabilityDays,
    removeWorker: mockRemoveWorker, removeAvailability: jest.fn(), refresh: jest.fn(),
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
    addShift: mockAddShift, addShifts: mockAddShifts, setShiftStatus: mockSetShiftStatus, notifyShift: jest.fn(),
    removeShift: jest.fn(), refresh: mockRefreshRoster, getRoster: () => mockData.roster,
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
  mockAddShift.mockResolvedValue({ success: true });
  mockSetShiftStatus.mockResolvedValue({ success: true });
  mockRefreshRoster.mockResolvedValue(true);
});

// ─── F-9 ──────────────────────────────────────────────────────────────────────

describe('night shifts over touching availability (F-9)', () => {
  // 2099-12-03 is a Thursday. Thu and Fri all day cover Thu 22:00–06:00 when the two
  // days are joined at midnight, as auto-assign joins them.
  const NIGHT = { id: 'tn', name: 'Night', role: 'Barista', start: '22:00', end: '06:00', coverage: 1, updatedAt: 'x' };
  const allDay = (day: string) => ({ id: `a-${day}`, day, from: '00:00', to: '23:59' });
  const NIGHT_SHIFT = { id: 's-night', date: '2099-12-03', workerId: 'w1', templateId: 'tn', location: '', status: 'Draft' as const, notified: false };

  beforeEach(() => {
    // Native confirms with Alert; press its Publish button.
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { text: string; onPress?: () => void }[];
      buttons.find((b) => b.text === 'Publish')?.onPress?.();
    });
  });

  it('can be published', async () => {
    mockData.workers = [{ ...W1, availability: [allDay('Thu'), allDay('Fri')] }];
    mockData.templates = [NIGHT];
    mockData.roster = [NIGHT_SHIFT];
    const screen = await render();
    await act(async () => {
      screen.h.handlePublishShift('s-night');
    });
    await settle();
    expect(screen.h.shiftRowNotice).toBeNull();
    expect(mockSetShiftStatus).toHaveBeenCalledWith('s-night', 'Published');
    screen.unmount();
  });

  it('can be added by hand', async () => {
    mockData.workers = [{ ...W1, availability: [allDay('Thu'), allDay('Fri')] }];
    mockData.templates = [NIGHT];
    const screen = await render();
    act(() => screen.h.updateShiftField('workerId')('W-1'));
    act(() => screen.h.updateShiftField('templateId')('tn'));
    act(() => screen.h.updateShiftField('date')('2099-12-03'));
    await act(async () => {
      await screen.h.handleShiftSubmit();
    });
    expect(screen.h.shiftError).toBeNull();
    expect(mockAddShift).toHaveBeenCalledTimes(1);
    expect(mockAddShift.mock.calls[0][0]).toMatchObject({ date: '2099-12-03', workerId: 'w1', templateId: 'tn' });
    screen.unmount();
  });

  it('a refused publish says why next to the shift, and sends nothing', async () => {
    // Thursday only: the night's Friday hours are not covered.
    mockData.workers = [{ ...W1, availability: [allDay('Thu')] }];
    mockData.templates = [NIGHT];
    mockData.roster = [NIGHT_SHIFT];
    const screen = await render();
    await act(async () => {
      screen.h.handlePublishShift('s-night');
    });
    expect(mockSetShiftStatus).not.toHaveBeenCalled();
    expect(screen.h.shiftRowNotice).toEqual({
      shiftId: 's-night',
      message: 'Worker availability on Thu must cover the template window 22:00 - 06:00.',
    });
    expect(screen.h.actionBanner).toEqual({ type: 'error', message: screen.h.shiftRowNotice?.message });
    screen.unmount();
  });

  it('a publish the server refuses is said next to the shift too', async () => {
    mockData.workers = [{ ...W1, availability: [allDay('Thu'), allDay('Fri')] }];
    mockData.templates = [NIGHT];
    mockData.roster = [NIGHT_SHIFT];
    mockSetShiftStatus.mockResolvedValueOnce({ success: false, error: 'The Gratis plan covers up to 10 people' });
    const screen = await render();
    await act(async () => {
      screen.h.handlePublishShift('s-night');
    });
    await settle();
    expect(screen.h.shiftRowNotice).toEqual({ shiftId: 's-night', message: 'The Gratis plan covers up to 10 people' });
    screen.unmount();
  });
});

// ─── F-5 ──────────────────────────────────────────────────────────────────────

describe('availability for several days (F-5)', () => {
  const W2 = { ...W1, id: 'w2', displayId: 'W-2', name: 'Bea' };

  it('is one request, and its answer keeps the next person\'s picked days', async () => {
    mockData.workers = [W1, W2];
    let finish!: (r: { success: boolean; error?: string }) => void;
    mockAddAvailabilityDays.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = await render();
    act(() => screen.h.updateAvailabilityField('workerId')('W-1'));
    act(() => screen.h.updateAvailabilityField('day')('Mon,Tue,Wed'));
    let saving!: Promise<void>;
    await act(async () => {
      saving = screen.h.handleAvailabilitySubmit();
    });
    // While the save runs, the manager moves on to the next person and their days.
    act(() => screen.h.updateAvailabilityField('workerId')('W-2'));
    act(() => screen.h.updateAvailabilityField('day')('Thu,Fri'));
    await act(async () => {
      finish({ success: true });
      await saving;
    });
    expect(mockAddAvailabilityDays).toHaveBeenCalledTimes(1);
    expect(mockAddAvailabilityDays).toHaveBeenCalledWith('w1', ['Mon', 'Tue', 'Wed'], '09:00', '17:00');
    expect(screen.h.availabilityForm).toMatchObject({ workerId: 'W-2', day: 'Thu,Fri' });
    screen.unmount();
  });

  it('clears the saved days when the form still shows that entry, and keeps them when refused', async () => {
    mockData.workers = [W1];
    mockAddAvailabilityDays.mockResolvedValueOnce({ success: false, error: 'Nothing was saved' });
    const screen = await render();
    act(() => screen.h.updateAvailabilityField('workerId')('W-1'));
    act(() => screen.h.updateAvailabilityField('day')('Mon,Tue'));
    await act(async () => {
      await screen.h.handleAvailabilitySubmit();
    });
    expect(screen.h.availabilityForm.day).toBe('Mon,Tue');
    expect(screen.h.availabilityError).toBe('Nothing was saved');
    mockAddAvailabilityDays.mockResolvedValueOnce({ success: true });
    await act(async () => {
      await screen.h.handleAvailabilitySubmit();
    });
    expect(screen.h.availabilityForm).toMatchObject({ workerId: 'W-1', day: '' });
    screen.unmount();
  });
});

// ─── F-11 ─────────────────────────────────────────────────────────────────────

describe('removing a person with shifts (F-11)', () => {
  const shift = (id: string, date: string, workerId = 'w1') => ({ id, date, workerId, templateId: 't1', location: '', status: 'Draft' as const, notified: false });

  it('asks first, counting shifts before and from today, and sends nothing yet', async () => {
    mockData.workers = [W1];
    mockData.templates = [T1];
    mockData.roster = [shift('s1', '2020-01-06'), shift('s2', '2099-01-05'), shift('s3', '2099-01-06'), shift('s4', '2099-01-06', 'w2')];
    const screen = await render();
    await act(async () => {
      await screen.h.handleRemoveWorker('w1');
    });
    expect(mockRemoveWorker).not.toHaveBeenCalled();
    expect(screen.h.workerRemoval).toEqual({ workerId: 'w1', name: 'Ana', upcoming: 2, past: 1 });
    screen.unmount();
  });

  it('on confirm removes the person with their shifts in one request and reloads the roster', async () => {
    mockData.workers = [W1];
    mockData.roster = [shift('s2', '2099-01-05')];
    mockRemoveWorker.mockResolvedValue({ success: true });
    const screen = await render();
    await act(async () => {
      await screen.h.handleRemoveWorker('w1');
    });
    await act(async () => {
      await screen.h.confirmWorkerRemoval();
    });
    expect(mockRemoveWorker).toHaveBeenCalledTimes(1);
    expect(mockRemoveWorker).toHaveBeenCalledWith('w1', { withShifts: true });
    expect(mockRefreshRoster).toHaveBeenCalled();
    expect(screen.h.workerRemoval).toBeNull();
    expect(screen.h.actionBanner).toEqual({ type: 'success', message: 'scheduler.remove.removed' });
    screen.unmount();
  });

  it('Keep closes the question and removes nothing', async () => {
    mockData.workers = [W1];
    mockData.roster = [shift('s2', '2099-01-05')];
    const screen = await render();
    await act(async () => {
      await screen.h.handleRemoveWorker('w1');
    });
    act(() => screen.h.cancelWorkerRemoval());
    expect(screen.h.workerRemoval).toBeNull();
    expect(mockRemoveWorker).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('a person without shifts is removed at once', async () => {
    mockData.workers = [W1];
    mockRemoveWorker.mockResolvedValue({ success: true });
    const screen = await render();
    await act(async () => {
      await screen.h.handleRemoveWorker('w1');
    });
    expect(mockRemoveWorker).toHaveBeenCalledWith('w1');
    expect(screen.h.workerRemoval).toBeNull();
    screen.unmount();
  });

  it('a shift added elsewhere meanwhile (409) reloads the roster and asks', async () => {
    mockData.workers = [W1];
    mockRemoveWorker.mockResolvedValueOnce({ success: false, status: 409, error: 'This person still has shifts on the roster.' });
    mockRefreshRoster.mockImplementationOnce(async () => {
      mockData.roster = [shift('elsewhere', '2099-02-02')];
      return true;
    });
    const screen = await render();
    await act(async () => {
      await screen.h.handleRemoveWorker('w1');
    });
    expect(screen.h.workerRemoval).toEqual({ workerId: 'w1', name: 'Ana', upcoming: 1, past: 0 });
    screen.unmount();
  });
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

  // F-6 (CHG-109): another tab took a suggested slot; Apply got 409 and the roster reloaded,
  // but the old suggestions stayed and were applied again, refused again.
  it('a 409 on Apply drops the suggestions and makes new ones from the reloaded roster', async () => {
    mockData.workers = [W1, { ...W1, id: 'w2', displayId: 'W-2', name: 'Bea' }];
    mockData.templates = [T1];
    const taken = { id: 'other-tab', date: '2026-12-01', workerId: 'w1', templateId: 't1', location: '', status: 'Draft' as const, notified: false };
    const SECOND: AssignedShift = { date: '2026-12-01', workerId: 'w2', templateId: 't1' } as AssignedShift;
    const screen = await render();
    await runFor(screen);
    expect(screen.h.autoAssignSuggestions).toEqual([SUGGESTION]);
    // The refused Apply reloads the roster (useRoster.addShifts): the other tab's shift is in it now.
    mockAddShifts.mockImplementationOnce(async () => {
      mockData.roster = [taken];
      return { success: false, status: 409, error: 'One of these shifts is already on the roster. Nothing was added. Reload and try again' };
    });
    mockRunAutoAssign.mockResolvedValueOnce({ assignments: [SECOND], unassigned: [] });
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    await settle();
    expect(mockRunAutoAssign).toHaveBeenCalledTimes(2);
    // The new run saw the reloaded roster, not the one of the render that pressed Apply.
    expect((mockRunAutoAssign.mock.calls[1][0] as { existingRoster: unknown[] }).existingRoster).toEqual([taken]);
    expect(screen.h.autoAssignSuggestions).toEqual([SECOND]);
    expect(screen.h.actionBanner?.message.startsWith('scheduler.shifts.autoAssignConflictRerun')).toBe(true);
    // Applying now sends the new suggestion with new ids, not the refused one.
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    const sent = mockAddShifts.mock.calls[1][0] as { workerId: string; id: string }[];
    expect(sent.map((s) => s.workerId)).toEqual(['w2']);
    expect(sent[0].id).not.toBe((mockAddShifts.mock.calls[0][0] as { id: string }[])[0].id);
    screen.unmount();
  });

  it('a new run clears the old suggestions while it computes, so Apply cannot save them', async () => {
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
    expect(screen.h.autoAssignSuggestions).toBeNull();
    await act(async () => {
      await screen.h.applyAutoAssign();
    });
    expect(mockAddShifts).not.toHaveBeenCalled();
    await act(async () => {
      finish({ assignments: [SUGGESTION], unassigned: [] });
      await running;
    });
    expect(screen.h.autoAssignSuggestions).toEqual([SUGGESTION]);
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
