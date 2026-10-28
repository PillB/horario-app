import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable, TextInput } from 'react-native';

import SchedulerScreen, { findCoveringAvailability, getWeekdayFromDate, ShiftTemplate, Worker } from '../scheduler';
import { getSupabaseClient } from '@/services/supabaseClient';
import { todayKey } from '@/utils/dateKeys';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/hooks/useSessionWellness', () => ({
  useSessionWellness: () => ({
    acknowledgeBreak: jest.fn(),
    dismissPrompt: jest.fn(),
    minutesActive: 0,
    promptVisible: false,
    recordInteraction: jest.fn(),
  }),
}));

jest.mock('@/services/supabaseClient', () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock('@/services/onboardingProgress', () => ({
  fetchOnboardingProgress: jest.fn().mockResolvedValue(null),
  upsertOnboardingProgress: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/contexts/WelcomeTourContext', () => ({
  useWelcomeTour: () => ({ registerLayout: jest.fn() }),
  TOUR_STEPS: [],
}));

jest.mock('@/contexts/LocaleContext', () => {
  // jest.mock factories cannot reference imports, so require is needed here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en');
  function resolve(obj: Record<string, unknown>, path: string): string {
    const val = path.split('.').reduce((a: unknown, k) => (a as Record<string, unknown>)?.[k], obj);
    return typeof val === 'string' ? val : path;
  }
  return {
    useT: () => ({
      t: (key: string, params?: Record<string, string>) => {
        let val = resolve(en, key);
        if (params) Object.entries(params).forEach(([k, v]) => { val = val.replace(`{${k}}`, v); });
        return val;
      },
      locale: en,
      langCode: 'en',
      setLanguage: () => {},
      isLoading: false,
    }),
    LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock('@/hooks/useWorkers', () => ({
  useWorkers: () => ({
    workers: [],
    loading: false,
    error: null,
    addAvailability: jest.fn().mockResolvedValue({ success: true, availability: {} }),
    refresh: jest.fn(),
  }),
}));

jest.mock('@/hooks/useShiftTemplates', () => ({
  useShiftTemplates: () => ({
    shiftTemplates: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

jest.mock('@/hooks/useRoster', () => ({
  useRoster: () => ({
    roster: [],
    loading: false,
    error: null,
    addShift: jest.fn().mockResolvedValue({ success: true, shift: {} }),
    setShiftStatus: jest.fn().mockResolvedValue({ success: true }),
    notifyShift: jest.fn().mockResolvedValue({ success: true }),
    removeShift: jest.fn().mockResolvedValue({ success: true }),
    refresh: jest.fn(),
  }),
}));

describe('getWeekdayFromDate', () => {
  it('returns the calendar weekday of a business-local date regardless of offset', () => {
    const backwardTimezoneOffsetMinutes = -720; // UTC-12
    expect(getWeekdayFromDate('2024-06-01', backwardTimezoneOffsetMinutes)).toBe('Sat');
  });
});

describe('findCoveringAvailability', () => {
  const template: ShiftTemplate = {
    id: 'morning',
    name: 'Morning Coverage',
    role: 'Support',
    start: '08:00',
    end: '12:00',
    coverage: 1,
  };

  const worker: Worker = {
    id: 'W-UTC12',
    name: 'Pacific Ops',
    role: 'Support',
    skills: [],
    availability: [{ day: 'Fri', from: '07:00', to: '16:00' }],
  };

  it('uses the calendar weekday of the business-local date, not an offset-shifted one', () => {
    // 2024-05-31 is a Friday; the shift date is already business-local, so a
    // UTC-12 offset must not shift it to another weekday.
    const friday = findCoveringAvailability(worker, template, '2024-05-31', -720);
    expect(friday.weekdayLabel).toBe('Fri');
    expect(friday.coveringSlot).toEqual(worker.availability[0]);

    const saturday = findCoveringAvailability(worker, template, '2024-06-01', -720);
    expect(saturday.weekdayLabel).toBe('Sat');
    expect(saturday.coveringSlot).toBeUndefined();
  });
});

describe('scheduler fallback quick setup', () => {
  const mockGetClient = getSupabaseClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows an error when seeding baseline targets fails', async () => {
    const seedError = 'Insert failed';
    const failingResponse = {
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ error: seedError }),
    } as unknown as Response;

    (global as any).fetch = jest.fn().mockResolvedValue(failingResponse);
    mockGetClient.mockReturnValue(null);

    let tree: renderer.ReactTestRenderer | null = null;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      tree = renderer.create(<SchedulerScreen />);
    });

    if (!tree) {
      throw new Error('Failed to render SchedulerScreen');
    }

    const saveButton = tree.root
      .findAllByType(Pressable)
      .find((node) =>
        node
          .findAll(
            (child) => typeof child.props?.children === 'string' && child.props.children.includes('Save baseline targets')
          )
          .length > 0
      );

    if (!saveButton) {
      throw new Error('Save baseline button not found');
    }

    // Fill in the role field so form validation passes and seedBaselineTargets is called
    const roleInput = tree.root
      .findAllByType(TextInput)
      .find((node) => node.props?.placeholder === 'Support');
    if (roleInput) {
      await act(async () => {
        roleInput.props.onChangeText('Support');
      });
    }

    await act(async () => {
      await saveButton.props.onPress();
    });

    const errorNodes = tree.root.findAll((node) => node.props?.children === seedError);
    expect(errorNodes.length).toBeGreaterThan(0);

    const successNodes = tree.root.findAll(
      (node) => typeof node.props?.children === 'string' && node.props.children.includes('Baseline demand targets saved')
    );
    expect(successNodes.length).toBe(0);

    // Unmount to clear the setInterval inside useSessionWellness and prevent
    // the "worker process has failed to exit gracefully" force-exit warning.
    act(() => { tree!.unmount(); });
    warnSpy.mockRestore();
  });
});

describe('scheduler onboarding checklist (QA 2026-10-28)', () => {
  it('does not mark or store the forecast step while targets are still loading', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Every proxy call stays pending, so the demand hook is loading the whole test.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(() => new Promise(() => {}));
    (getSupabaseClient as jest.Mock).mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { upsertOnboardingProgress } = require('@/services/onboardingProgress');
    (upsertOnboardingProgress as jest.Mock).mockClear();

    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(<SchedulerScreen />);
    });

    expect(upsertOnboardingProgress).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forecast: true }),
      expect.anything()
    );
    act(() => { tree!.unmount(); });
    warnSpy.mockRestore();
  });
});

describe('scheduler accessibility (QA spot check 2026-10-20)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    (getSupabaseClient as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function renderScheduler(): Promise<renderer.ReactTestRenderer> {
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(<SchedulerScreen />);
    });
    if (!tree) throw new Error('Failed to render SchedulerScreen');
    return tree;
  }

  const radiosOf = (tree: renderer.ReactTestRenderer) =>
    tree.root.findAllByType(Pressable).filter((node) => node.props.accessibilityRole === 'radio');

  // U5: role="radio" needs aria-checked; accessibilityState never reaches the DOM on web.
  it('gives every radio a name, a hint and a boolean aria-checked', async () => {
    const tree = await renderScheduler();
    const radios = radiosOf(tree);
    expect(radios.length).toBeGreaterThanOrEqual(5);
    for (const radio of radios) {
      expect(typeof radio.props['aria-checked']).toBe('boolean');
      expect(radio.props.accessibilityLabel).toBeTruthy();
      expect(radio.props.accessibilityHint).toBeTruthy();
    }
    const modes = ['Homogeneous demand', 'Manual worker/shift counts', 'POS Import'];
    const checkedModes = radios
      .filter((r) => modes.includes(r.props.accessibilityLabel) && r.props['aria-checked'])
      .map((r) => r.props.accessibilityLabel);
    expect(checkedModes).toEqual(['Homogeneous demand']);
    act(() => { tree.unmount(); });
  });

  // U6: the roster view toggle rendered two buttons with empty text.
  it('names the roster view toggle and moves the checked state', async () => {
    const tree = await renderScheduler();
    const toggles = () =>
      radiosOf(tree).filter((n) => String(n.props.testID ?? '').startsWith('roster-view-'));
    const before = toggles();
    expect(before.map((n) => n.props.accessibilityLabel)).toEqual(['List', 'Calendar']);
    const checked = before.map((n) => n.props['aria-checked'] as boolean);
    expect(checked.filter(Boolean)).toHaveLength(1);
    const unchecked = before.find((n) => !n.props['aria-checked']);
    await act(async () => {
      unchecked?.props.onPress();
    });
    expect(toggles().map((n) => n.props['aria-checked'])).toEqual(checked.map((c) => !c));
    act(() => { tree.unmount(); });
  });

  // U3: date defaults come from the client clock after mount, not the build.
  it("fills the quick-setup start date with today's date after mount", async () => {
    const tree = await renderScheduler();
    const startDate = tree.root
      .findAllByType(TextInput)
      .find((node) => node.props.accessibilityLabel === 'Start date');
    expect(startDate?.props.value).toBe(todayKey());
    act(() => { tree.unmount(); });
  });
});
