// @ts-nocheck
/* eslint-disable import/first */

// Mock the hook so no real fetch calls happen.
jest.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: jest.fn(),
}));

// Provide a minimal LocaleContext so components using useT() work without a Provider.
jest.mock('@/contexts/LocaleContext', () => {
  const { en } = require('@/locales/en');
  function resolve(obj, path) {
    return path.split('.').reduce((a, k) => a?.[k], obj) ?? path;
  }
  return {
    useT: () => ({
      t: (key, params) => {
        let val = resolve(en, key);
        if (typeof val !== 'string') val = key;
        if (params) Object.entries(params).forEach(([k, v]) => { val = val.replace(`{${k}}`, v); });
        return val;
      },
      locale: en,
      langCode: 'en',
      setLanguage: () => {},
      isLoading: false,
    }),
    LocaleProvider: ({ children }) => children,
  };
});

// Themed components need useColorScheme.
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// expo-router Link needs a stub.
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import AnalyticsScreen from '../explore';
import { useAnalytics } from '@/hooks/useAnalytics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Finds all host (native) Text nodes that contain exactly the given string.
 * ThemedText creates multiple fiber layers (ThemedText → Text host), each
 * forwarding testID and children. Filtering to typeof node.type === 'string'
 * and node.children[0] === text finds only the actual rendered text nodes.
 */
const findTextNodes = (
  tree: renderer.ReactTestRenderer,
  text: string,
) =>
  tree.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      Array.isArray(node.children) &&
      node.children[0] === text,
  );

/** Finds the first host node bearing the given testID. */
const findHostByTestID = (
  tree: renderer.ReactTestRenderer,
  testID: string,
) =>
  tree.root
    .findAll((node) => node.props.testID === testID && typeof node.type === 'string')
    .at(0);

// ─── Fixture ──────────────────────────────────────────────────────────────────

const baseResult = {
  coverageRate: 75,
  draftShifts: 3,
  publishedShifts: 8,
  workerHours: [
    { workerId: 'w1', workerName: 'Alice', hours: 32, shiftsCount: 4 },
    { workerId: 'w2', workerName: 'Bob', hours: 16, shiftsCount: 2 },
  ],
  fairnessScore: 8.0,
  uncoveredRevenue: 1950,
  loading: false,
  error: null,
  refresh: jest.fn(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnalyticsScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders coverage rate value', () => {
    (useAnalytics as jest.Mock).mockReturnValue(baseResult);

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    // '75%' should appear in the rendered text nodes
    expect(findTextNodes(tree!, '75%').length).toBeGreaterThan(0);

    act(() => { tree!.unmount(); });
  });

  it('renders draft count value', () => {
    (useAnalytics as jest.Mock).mockReturnValue(baseResult);

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    expect(findTextNodes(tree!, '3').length).toBeGreaterThan(0);

    act(() => { tree!.unmount(); });
  });

  it('renders uncovered revenue formatted as currency', () => {
    (useAnalytics as jest.Mock).mockReturnValue(baseResult);

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    // formatCurrency(1950) → '$1,950'
    expect(findTextNodes(tree!, '$1,950').length).toBeGreaterThan(0);

    act(() => { tree!.unmount(); });
  });

  it('renders one HoursBar per worker (host View with worker testID)', () => {
    (useAnalytics as jest.Mock).mockReturnValue(baseResult);

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    expect(findHostByTestID(tree!, 'hours-bar-w1')).toBeTruthy();
    expect(findHostByTestID(tree!, 'hours-bar-w2')).toBeTruthy();

    act(() => { tree!.unmount(); });
  });

  it('shows SkeletonCard and hides KPI cards when loading', () => {
    (useAnalytics as jest.Mock).mockReturnValue({ ...baseResult, loading: true });

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    const skeleton = tree!.root.findAll(
      (node) => node.props.testID === 'skeleton-card' && typeof node.type === 'string',
    );
    expect(skeleton.length).toBeGreaterThan(0);

    // '75%' should NOT appear in the loading state
    expect(findTextNodes(tree!, '75%')).toHaveLength(0);

    act(() => { tree!.unmount(); });
  });

  it('shows error message on error state', () => {
    (useAnalytics as jest.Mock).mockReturnValue({
      ...baseResult,
      loading: false,
      error: 'network failure',
    });

    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<AnalyticsScreen />);
    });

    expect(findTextNodes(tree!, 'network failure').length).toBeGreaterThan(0);

    act(() => { tree!.unmount(); });
  });
});
