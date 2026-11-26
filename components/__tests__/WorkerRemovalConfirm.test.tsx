/**
 * WorkerRemovalConfirm (F-11, CHG-109): the question asked before a person with
 * shifts is removed. It must say how many shifts go, say that earlier shifts are
 * the record of who worked (only when there are any), and show under one row only.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { WorkerRemovalConfirm } from '../scheduler/WorkerRemovalConfirm';

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

const textOf = (tree: ReactTestRenderer): string =>
  tree.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string).join(' | ');

const mount = (pending: { workerId: string; name: string; upcoming: number; past: number } | null, workerId = 'w1') => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<WorkerRemovalConfirm pending={pending} workerId={workerId} onConfirm={onConfirm} onCancel={onCancel} />);
  });
  return { tree, onConfirm, onCancel };
};

describe('WorkerRemovalConfirm', () => {
  it('names the person and the number of shifts that go with them', () => {
    const { tree, onConfirm, onCancel } = mount({ workerId: 'w1', name: 'Ana', upcoming: 3, past: 2 });
    const text = textOf(tree);
    expect(text).toContain('Remove Ana and their shifts?');
    expect(text).toContain('Ana has 3 shift(s) from today on and 2 earlier shift(s) on the roster.');
    expect(text).toContain('Earlier shifts are your record of who worked');
    expect(text).toContain('Remove Ana and 5 shift(s)');
    act(() => tree.root.findByProps({ testID: 'confirm-remove-worker-w1' }).props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    act(() => tree.root.findByProps({ testID: 'cancel-remove-worker-w1' }).props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves out the note on earlier shifts when there are none', () => {
    const { tree } = mount({ workerId: 'w1', name: 'Ana', upcoming: 1, past: 0 });
    expect(textOf(tree)).not.toContain('Earlier shifts are your record');
  });

  it('shows nothing under another person\'s row, or with nothing pending', () => {
    expect(mount({ workerId: 'w1', name: 'Ana', upcoming: 1, past: 0 }, 'w2').tree.toJSON()).toBeNull();
    expect(mount(null).tree.toJSON()).toBeNull();
  });
});
