/**
 * Load state of the stored scheduling data and the two-tap remove button
 * (CHG-088): a failed load is shown with a retry, never as an empty account.
 */
// jest.mock below is hoisted above these imports by babel-jest.
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { ConfirmRemoveButton } from '../scheduler/ConfirmRemoveButton';
import { SyncNotice } from '../scheduler/SyncNotice';
import { ThemedText } from '../ThemedText';

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

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(ThemedText).map((n) => [n.props.children].flat().join(''));

const render = (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
};

describe('SyncNotice', () => {
  it('shows the first load error with an accessible retry button', () => {
    const onRetry = jest.fn();
    const tree = render(<SyncNotice loading={false} errors={['Database request failed', 'Other']} truncated={false} onRetry={onRetry} />);
    expect(texts(tree)).toEqual([
      'Could not load your saved schedule. What you see may be out of date.',
      'Details: Database request failed',
      'Retry loading',
    ]);
    const alert = tree.root.findByProps({ testID: 'sync-notice-error' });
    expect(alert.props.accessibilityRole).toBe('alert');
    const retry = tree.root.findByProps({ testID: 'sync-notice-retry' });
    expect(retry.props.accessibilityRole).toBe('button');
    expect(retry.props.accessibilityLabel).toBe('Retry loading');
    expect(retry.props.accessibilityHint).toMatch(/workers, shift templates, the roster and demand overrides/);
    act(() => retry.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a loading line while the first load runs, and nothing once loaded', () => {
    const loading = render(<SyncNotice loading errors={[]} truncated={false} onRetry={jest.fn()} />);
    expect(texts(loading)).toEqual(['Loading your saved schedule…']);
    const done = render(<SyncNotice loading={false} errors={[]} truncated={false} onRetry={jest.fn()} />);
    expect(done.toJSON()).toBeNull();
  });

  it('says when a list was cut at the page limit', () => {
    const tree = render(<SyncNotice loading={false} errors={[]} truncated onRetry={jest.fn()} />);
    expect(texts(tree)[0]).toMatch(/first 10,000 rows/);
  });
});

describe('ConfirmRemoveButton', () => {
  it('needs a second tap to remove', () => {
    jest.useFakeTimers();
    const onConfirm = jest.fn();
    const tree = render(
      <ConfirmRemoveButton onConfirm={onConfirm} accessibilityLabel="Remove worker Ana" accessibilityHint="Tap twice" testID="rm" />,
    );
    const button = () => tree.root.findAll((n) => n.props.testID === 'rm' && typeof n.props.onPress === 'function')[0];
    expect(button().props.accessibilityLabel).toBe('Remove worker Ana');
    act(() => button().props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button().props.accessibilityLabel).toBe('Tap again to remove');
    act(() => button().props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // An armed button disarms after a few seconds.
    act(() => button().props.onPress());
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    act(() => button().props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
