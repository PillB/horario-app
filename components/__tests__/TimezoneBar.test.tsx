/* eslint-disable import/first */
// QA U3: the web HTML is rendered at build time, so the bar's first render
// must not depend on the clock or the time zone (React hydration error #418).

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/useHasMounted', () => ({ useHasMounted: jest.fn(() => true) }));
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key: string) => (key === 'timezone.schedulingIn' ? 'Scheduling in:' : key) }),
}));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { TimezoneBar } from '@/components/scheduler/TimezoneBar';
import { useHasMounted } from '@/hooks/useHasMounted';

const mockUseHasMounted = useHasMounted as jest.Mock;

function renderJson(): string {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(<TimezoneBar />);
  });
  const json = JSON.stringify(tree?.toJSON());
  act(() => tree?.unmount());
  return json;
}

describe('TimezoneBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    mockUseHasMounted.mockReset();
    mockUseHasMounted.mockReturnValue(true);
  });

  it('renders the same first (server) output at any time', () => {
    mockUseHasMounted.mockReturnValue(false);
    jest.setSystemTime(new Date('2026-10-20T16:28:00Z'));
    const first = renderJson();
    jest.setSystemTime(new Date('2026-12-31T23:59:00Z'));
    const second = renderJson();
    expect(first).toBe(second);
    expect(first).toContain('Scheduling in:');
    expect(first).not.toMatch(/\d{2}:\d{2}/);
  });

  it('shows the zone, date and time after mount', () => {
    jest.setSystemTime(new Date(2026, 9, 20, 16, 28));
    const json = renderJson();
    expect(json).toContain('16:28');
    expect(json).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
