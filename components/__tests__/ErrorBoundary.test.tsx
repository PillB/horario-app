// @ts-nocheck
/* eslint-disable import/first */

// DefaultFallback renders ThemedText/ThemedView which depend on useColorScheme.
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import React from 'react';
import { View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { ErrorBoundary } from '../ErrorBoundary';

// ─── Throwing component ────────────────────────────────────────────────────────

const Bomb = ({ explode }: { explode: boolean }) => {
  if (explode) throw new Error('test explosion');
  return <View testID="safe-content" />;
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // React logs uncaught errors to console.error even when caught by a boundary.
    // In React 19 dev mode it may log twice. Suppress to keep test output clean.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders children when no error is thrown', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ErrorBoundary>
          <Bomb explode={false} />
        </ErrorBoundary>,
      );
    });

    expect(tree!.root.findByProps({ testID: 'safe-content' })).toBeTruthy();
  });

  it('renders the default fallback when a child throws', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ErrorBoundary>
          <Bomb explode={true} />
        </ErrorBoundary>,
      );
    });

    // Default fallback title and retry button must be present
    expect(tree!.root.findByProps({ testID: 'error-boundary-fallback' })).toBeTruthy();
    expect(tree!.root.findByProps({ testID: 'error-boundary-title' })).toBeTruthy();
    expect(tree!.root.findByProps({ testID: 'error-boundary-retry' })).toBeTruthy();
  });

  it('displays the error message in the fallback', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ErrorBoundary>
          <Bomb explode={true} />
        </ErrorBoundary>,
      );
    });

    const messageNode = tree!.root.findByProps({ testID: 'error-boundary-message' });
    expect(messageNode.props.children).toBe('test explosion');
  });

  it('calls onRetry and resets boundary state when Try again is pressed', () => {
    const onRetry = jest.fn();
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ErrorBoundary onRetry={onRetry}>
          <Bomb explode={true} />
        </ErrorBoundary>,
      );
    });

    const retryButton = tree!.root.findByProps({ testID: 'error-boundary-retry' });

    act(() => {
      retryButton.props.onPress();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a custom fallback prop instead of the default', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ErrorBoundary fallback={<View testID="custom-fallback" />}>
          <Bomb explode={true} />
        </ErrorBoundary>,
      );
    });

    expect(tree!.root.findByProps({ testID: 'custom-fallback' })).toBeTruthy();
    // Default fallback must NOT appear
    expect(
      tree!.root.findAll((node) => node.props.testID === 'error-boundary-fallback'),
    ).toHaveLength(0);
  });
});
