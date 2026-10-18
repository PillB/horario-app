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

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import DiagnosticsRoute from '../diagnostics';

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
});
