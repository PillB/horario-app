import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable } from 'react-native';

import SchedulerScreen, { findCoveringAvailability, getWeekdayFromDate, ShiftTemplate, Worker } from '../scheduler';
import { getSupabaseClient } from '@/services/supabaseClient';

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
  it('derives weekday using a supplied timezone offset to account for local boundaries', () => {
    const backwardTimezoneOffsetMinutes = -720; // UTC-12
    expect(getWeekdayFromDate('2024-06-01', backwardTimezoneOffsetMinutes)).toBe('Fri');
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

  it('acknowledges coverage when the timezone-adjusted weekday matches availability', () => {
    const { coveringSlot, weekdayLabel } = findCoveringAvailability(
      worker,
      template,
      '2024-06-01',
      -720 // UTC-12 pushes the label to the prior weekday
    );

    expect(weekdayLabel).toBe('Fri');
    expect(coveringSlot).toEqual(worker.availability[0]);
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
