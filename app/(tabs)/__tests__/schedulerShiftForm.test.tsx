import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable, TextInput } from 'react-native';

import SchedulerScreen from '../scheduler';
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
  useWelcomeTour: () => ({ registerLayout: jest.fn(), recordTourAction: jest.fn() }),
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

const WORKER_ID = '00000000-0000-4000-8000-0000000000a1';
const mockAddShift = jest.fn().mockResolvedValue({ success: true, shift: {} });
const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

jest.mock('@/hooks/useWorkers', () => ({
  useWorkers: () => ({
    workers: [{
      id: '00000000-0000-4000-8000-0000000000a1', displayId: 'W-1', name: 'Ana', role: 'Support', skills: [],
      availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ id: `av-${day}`, day, from: '00:00', to: '23:59' })),
    }],
    loading: false,
    error: null,
    addAvailability: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('@/hooks/useShiftTemplates', () => ({
  useShiftTemplates: () => ({
    shiftTemplates: [{ id: 't-day', name: 'Day', role: 'Support', start: '09:00', end: '17:00', coverage: 1 }],
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
    addShift: (...args: unknown[]) => mockAddShift(...args),
    setShiftStatus: jest.fn(),
    notifyShift: jest.fn(),
    removeShift: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('scheduler shift form (QA 2026-10-28)', () => {
  it('saves a shift for the worker picked from the chips (short id W-1)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    (getSupabaseClient as jest.Mock).mockReturnValue(null);
    expect(ALL_DAYS).toHaveLength(7);

    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(<SchedulerScreen />);
    });
    const root = tree!.root;
    const pressables = () => root.findAllByType(Pressable);

    // The shift form starts empty instead of a made-up "W-01" / "morning".
    expect(root.findAllByType(TextInput).some((input) => input.props.value === 'W-01' || input.props.value === 'morning')).toBe(false);

    // The second "Ana" chip belongs to the shift form (the first is availability).
    const anaChips = pressables().filter((p) => typeof p.props.accessibilityLabel === 'string' && p.props.accessibilityLabel.endsWith(' Ana'));
    const templateChips = pressables().filter((p) => typeof p.props.accessibilityLabel === 'string' && p.props.accessibilityLabel.endsWith(' Day'));
    expect(anaChips.length).toBeGreaterThanOrEqual(2);
    expect(templateChips.length).toBeGreaterThanOrEqual(1);
    await act(async () => { anaChips[anaChips.length - 1].props.onPress(); });
    await act(async () => { templateChips[templateChips.length - 1].props.onPress(); });

    const dateInputs = root.findAllByType(TextInput).filter((input) => input.props.placeholder === 'YYYY-MM-DD');
    await act(async () => { dateInputs[dateInputs.length - 1].props.onChangeText('2026-11-02'); });

    const save = pressables().find((p) => p.props.accessibilityLabel === 'Save and notify team');
    await act(async () => { await save!.props.onPress(); });

    expect(mockAddShift).toHaveBeenCalledWith(expect.objectContaining({ workerId: WORKER_ID, templateId: 't-day', date: '2026-11-02' }));
    act(() => { tree!.unmount(); });
    warnSpy.mockRestore();
  });
});
