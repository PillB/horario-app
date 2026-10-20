/**
 * ShiftTemplateSection — auto-assign shortfall banner (QA finding A2).
 * Partial coverage must be visible, not only templates with zero assignments.
 */
// jest.mock below is hoisted above these imports by babel-jest.
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { ShiftTemplateSection } from '../scheduler/ShiftTemplateSection';
import { type CoverageShortfall } from '@/services/shiftAssigner';

jest.mock('@/contexts/LocaleContext', () => {
  // Resolve keys against the real English strings so interpolation is exercised.
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

const noop = () => undefined;
const field = () => noop;

const renderSection = (shortfalls: CoverageShortfall[] | null): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ShiftTemplateSection
        shiftTemplates={[{ id: 'ward', name: 'Ward day', role: 'Nurse', start: '08:00', end: '16:00', coverage: 3 }]}
        templateForm={{ name: '', role: '', start: '', end: '', coverage: '' }}
        updateTemplateField={field}
        handleAddTemplate={noop}
        templateError={null}
        templateSuccessMessage={null}
        shiftForm={{ workerId: '', templateId: '', date: '2026-03-30' }}
        updateShiftField={field}
        handleShiftSubmit={noop}
        shiftError={null}
        handleAutoAssign={noop}
        applyAutoAssign={noop}
        autoAssignSuggestions={[{ date: '2026-03-30', templateId: 'ward', workerId: 'ana' }]}
        autoAssignShortfalls={shortfalls}
        autoAssignApplying={false}
        workers={[]}
      />
    );
  });
  return tree;
};

const allText = (tree: ReactTestRenderer): string =>
  tree.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .join('\n');

describe('ShiftTemplateSection — auto-assign shortfalls', () => {
  it('shows partial coverage with counts and a localised reason', () => {
    const tree = renderSection([
      { templateId: 'ward', date: '2026-03-30', required: 3, assigned: 1, missing: 2, reasonCode: 'overlap', reason: 'x' },
    ]);
    expect(tree.root.findAllByProps({ testID: 'auto-assign-shortfalls' }).length).toBeGreaterThan(0);
    const text = allText(tree);
    expect(text).toContain('1 shift(s) not fully covered');
    expect(text).toContain(
      'Ward day on 2026-03-30: 1/3 assigned, 2 missing — all eligible workers already have an overlapping shift'
    );
  });

  it('renders no shortfall banner when coverage is complete', () => {
    const tree = renderSection(null);
    expect(tree.root.findAllByProps({ testID: 'auto-assign-shortfalls' })).toHaveLength(0);
  });
});
