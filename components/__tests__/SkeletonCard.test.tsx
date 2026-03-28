// @ts-nocheck
/* eslint-disable import/first */

// In React 19's test renderer, Animated.View creates three fiber layers
// (AnimatedComponent → AnimatedProps → View), each of which forwards the
// testID prop.  findAll(testID === 'skeleton-row') therefore returns 3× the
// expected count if we include composite fiber nodes.
//
// Solution:
//   - Wrap renderer.create() / unmount() in act() so the component mounts
//     properly and .root stays accessible (required for React 19).
//   - Use jest.useFakeTimers() so requestAnimationFrame (used by Animated.loop
//     internally) never fires after test teardown → no "Cannot log after tests
//     are done" leaks.
//   - Filter findAll() results to typeof node.type === 'string', which selects
//     only host (native) components (the innermost View) and skips the two
//     composite wrapper layers.

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { SkeletonCard } from '../SkeletonCard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns only the host-level nodes bearing the given testID.
 *  Skips the composite AnimatedComponent / AnimatedProps wrapper layers. */
const findHostsByTestID = (
  tree: renderer.ReactTestRenderer,
  id: string,
) =>
  tree.root.findAll(
    (node) => node.props.testID === id && typeof node.type === 'string',
  );

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('SkeletonCard', () => {
  beforeAll(() => {
    // Fake timers prevent RAF callbacks from firing after test teardown.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('has the correct accessibility attributes on the root element', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<SkeletonCard />);
    });

    const roots = findHostsByTestID(tree!, 'skeleton-card');
    expect(roots).toHaveLength(1);
    expect(roots[0].props.accessibilityLabel).toBe('Loading');
    expect(roots[0].props.accessibilityRole).toBe('progressbar');

    act(() => {
      tree!.unmount();
    });
  });

  it('renders 3 rows by default', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<SkeletonCard />);
    });

    const rows = findHostsByTestID(tree!, 'skeleton-row');
    expect(rows).toHaveLength(3);

    act(() => {
      tree!.unmount();
    });
  });

  it('renders the specified number of rows', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<SkeletonCard rows={5} />);
    });

    const rows = findHostsByTestID(tree!, 'skeleton-row');
    expect(rows).toHaveLength(5);

    act(() => {
      tree!.unmount();
    });
  });

  it('renders a single row when rows=1', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<SkeletonCard rows={1} />);
    });

    const rows = findHostsByTestID(tree!, 'skeleton-row');
    expect(rows).toHaveLength(1);

    act(() => {
      tree!.unmount();
    });
  });

  it('does not throw on unmount', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(<SkeletonCard />);
    });

    expect(() =>
      act(() => {
        tree!.unmount();
      }),
    ).not.toThrow();
  });
});
