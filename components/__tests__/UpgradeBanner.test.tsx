/**
 * CHG-109: the banner quoted US$19 to a business in Peru, while the plans screen it
 * opens shows soles. It now quotes the price list of the account's first location.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

let mockTrialing = true;
jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ tier: mockTrialing ? 'pro' : 'gratis', isTrialing: mockTrialing, isSubscribed: false, refresh: jest.fn() }),
}));
jest.mock('@/components/PricingModal', () => ({ PricingModal: () => null }));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn(async () => undefined) }));
jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/contexts/LocaleContext', () => {
  const { en } = jest.requireActual('@/locales/en');
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en);
  return {
    useT: () => ({
      t: (path: string, params?: Record<string, string>) => {
        const value = resolve(path);
        if (typeof value !== 'string') return path;
        return value.replace(/\{(\w+)\}/g, (_: string, k: string) => params?.[k] ?? `{${k}}`);
      },
    }),
  };
});

// eslint-disable-next-line import/first
import { UpgradeBanner } from '@/components/UpgradeBanner';

const textOf = (tree: ReactTestRenderer): string =>
  tree.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string).join(' | ');

const render = (countryCode: string | null): string => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<UpgradeBanner autoAssignUsesLeft={1} countryCode={countryCode} />);
  });
  return textOf(tree);
};

describe('UpgradeBanner price', () => {
  it('quotes soles on the trial for a location in Peru, and US$ elsewhere', () => {
    mockTrialing = true;
    expect(render('PE')).toContain('plans start at S/ 59 per location a month');
    expect(render('US')).toContain('plans start at US$19 per location a month');
    expect(render(null)).toContain('US$19');
  });

  it('quotes soles on the free plan for a location in Peru', () => {
    mockTrialing = false;
    const text = render('PE');
    expect(text).toContain('From S/ 59 per location a month');
    expect(text).not.toContain('US$');
  });
});
