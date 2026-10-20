/* eslint-disable import/first */

// Record Redirect targets instead of navigating.
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => `redirect:${href}`,
}));

// The real screen is not under test here; stub its heavy dependencies.
jest.mock('@/components/DiagnosticsPanel', () => ({
  DiagnosticsPanel: () => 'diagnostics-panel',
}));
jest.mock('@/hooks/useAuditLog', () => ({
  useAuditLog: () => ({ copyToClipboard: jest.fn().mockResolvedValue(true) }),
}));
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/useHasMounted', () => ({ useHasMounted: jest.fn(() => true) }));
jest.mock('@/contexts/LocaleContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en');
  const resolve = (path: string): string => {
    const val = path
      .split('.')
      .reduce((a: unknown, k) => (a as Record<string, unknown> | undefined)?.[k], en);
    return typeof val === 'string' ? val : '';
  };
  return { useT: () => ({ t: resolve }) };
});

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useHasMounted } from '@/hooks/useHasMounted';
import { todayKey } from '@/utils/dateKeys';
import DiagnosticsRoute from '../diagnostics';

const mockUseHasMounted = useHasMounted as jest.Mock;

function render(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(<DiagnosticsRoute />);
  });
  return tree as ReactTestRenderer;
}

describe('DiagnosticsRoute', () => {
  const original = process.env.EXPO_PUBLIC_APP_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = original;
  });

  it('redirects home in production builds', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'production';
    expect(render().toJSON()).toBe('redirect:/');
  });

  it('renders the diagnostics screen outside production', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    const json = JSON.stringify(render().toJSON());
    expect(json).not.toContain('redirect:');
    expect(json).toContain('diagnostics-panel');
  });

  // QA U3: the static HTML is rendered at build time, so today's date must
  // not be part of the first render or hydration fails (React error #418).
  it("renders today's date only after mount", () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'preview';
    mockUseHasMounted.mockReturnValueOnce(false);
    expect(JSON.stringify(render().toJSON())).not.toContain(todayKey());
    expect(JSON.stringify(render().toJSON())).toContain(todayKey());
  });
});
