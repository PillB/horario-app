import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('@clerk/expo', () => ({
  useAuth: () => {
    throw new Error('useAuth can only be used within ClerkProvider');
  },
}));

describe('auth layout without a Clerk key (dev bypass)', () => {
  it('redirects to the app instead of rendering screens that need Clerk', () => {
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AuthLayout = require('../_layout').default as React.ComponentType;
    act(() => { renderer.create(<AuthLayout />); });
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/' });
  });
});
