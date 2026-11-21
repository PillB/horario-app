import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { en } from '@/locales/en';
import { es } from '@/locales/es';

jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
const mockRegion = { code: null as string | null };
jest.mock('expo-localization', () => ({
  getLocales: () => [{ regionCode: mockRegion.code }],
}));

function mockLookup(locale: unknown, key: string): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    locale,
  );
  return typeof value === 'string' ? value : '';
}
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, string>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, value),
        mockLookup(jest.requireActual('@/locales/en').en, key),
      ),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WelcomeScreen = require('../welcome').default as React.ComponentType;

function textOf(tree: renderer.ReactTestRenderer): string {
  return tree.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .join('\n');
}

describe('welcome (public landing page)', () => {
  it('states what it does, for whom, and the free plan', () => {
    mockRegion.code = null;
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<WelcomeScreen />); });
    const text = textOf(tree);
    expect(text).toContain(en.landing.hero.title);
    expect(text).toContain(en.landing.hero.eyebrow);
    expect(text).toContain('Up to 10 people');
    expect(text).toContain('US$19 a month per location');
    expect(text).toContain(en.landing.notYet.title);
  });

  it('shows soles to a visitor in Peru once mounted', () => {
    mockRegion.code = 'PE';
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<WelcomeScreen />); });
    expect(textOf(tree)).toContain('S/ 59 a month per location');
  });

  it('every link and button has a label and a hint', () => {
    mockRegion.code = null;
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<WelcomeScreen />); });
    const pressables = tree.root.findAll((node) => node.props.accessibilityRole === 'link' && typeof node.type !== 'string');
    expect(pressables.length).toBeGreaterThanOrEqual(3);
    for (const node of pressables) {
      expect(node.props.accessibilityLabel).toBeTruthy();
      expect(node.props.accessibilityHint).toBeTruthy();
    }
  });
});

/**
 * Marketing claims must be true today (Peru DL 1044 art. 8, US FTC Act §5,
 * FTC 16 CFR 465). These phrases promise something the product does not do,
 * or imply customers or rankings we do not have.
 */
describe('marketing copy makes no unbacked claims', () => {
  const BANNED = [
    /cancel anytime/i,
    /cancela cuando quieras/i,
    /most (popular|chosen)/i,
    /m[aá]s (popular|elegido)/i,
    /#\s?1\b/,
    /thousands of/i,
    /miles de/i,
    /guarantee/i,
    /garantiza/i,
    /notif(ies|ica) (your|a tu)/i,
  ];
  const surfaces = {
    'en.landing': en.landing,
    'es.landing': es.landing,
    'en.auth': en.auth,
    'es.auth': es.auth,
    'en.upgrade': en.upgrade,
    'es.upgrade': es.upgrade,
  };
  const strings = (node: unknown): string[] =>
    typeof node === 'string' ? [node] : node && typeof node === 'object' ? Object.values(node).flatMap(strings) : [];

  it.each(Object.entries(surfaces))('%s', (_name, surface) => {
    for (const text of strings(surface)) {
      for (const pattern of BANNED) expect(text).not.toMatch(pattern);
    }
  });

  it('Spanish has every landing key English has', () => {
    const keys = (node: unknown, prefix = ''): string[] =>
      node && typeof node === 'object'
        ? Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
        : [prefix];
    expect(keys(es.landing).sort()).toEqual(keys(en.landing).sort());
  });
});
