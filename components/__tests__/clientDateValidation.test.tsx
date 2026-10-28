/**
 * CHG-089: client-side date parsers use `isDateKey`, so a day that does not
 * exist (2026-02-31) is rejected instead of rolling over to March.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { DemandSection } from '../scheduler/DemandSection';
import { parseCsv } from '../scheduler/PosUploadSection';
import { computeSeasonality, computeTrend } from '@/services/forecastEngine';
import { useAvailabilityGrid, type AvailabilityGridHook } from '@/hooks/useAvailabilityGrid';
import { parseIsoDate } from '@/hooks/useDemandAnalysis';
import { normaliseDateInput } from '@/utils/dateKeys';

jest.mock('@/services/logger', () => ({ log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/hooks/useRoster', () => ({ useRoster: jest.fn(() => ({ roster: [], loading: false })) }));
jest.mock('@/hooks/useShiftTemplates', () => ({ useShiftTemplates: jest.fn(() => ({ shiftTemplates: [] })) }));
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

const IMPOSSIBLE = ['2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10'];

describe('normaliseDateInput (POS / demand CSV dates)', () => {
  it.each(IMPOSSIBLE)('rejects %s', (d) => expect(normaliseDateInput(d)).toBeNull());
  it('rejects impossible US dates', () => {
    expect(normaliseDateInput('2/31/2026')).toBeNull();
    expect(normaliseDateInput('13/01/2026')).toBeNull();
  });
  it('keeps real dates', () => {
    expect(normaliseDateInput(' 2028-02-29 ')).toBe('2028-02-29');
    expect(normaliseDateInput('3/5/2026')).toBe('2026-03-05');
    expect(normaliseDateInput('')).toBeNull();
    expect(normaliseDateInput('05.03.2026')).toBeNull();
  });
});

describe('POS upload CSV', () => {
  it('reports an impossible date as an error and keeps the valid rows', () => {
    const result = parseCsv('date,revenue\n2026-02-31,100\n2/30/2026,50\n2026-02-28,200');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.date)).toEqual(['2026-02-28']);
    expect(result.errors.map((e) => e.message)).toEqual(['Invalid date "2026-02-31"', 'Invalid date "2/30/2026"']);
  });
});

describe('DemandSection POS preview', () => {
  const noop = () => undefined;
  it('rejects an impossible date in the pasted CSV', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <DemandSection
          fallbackMode="pos"
          setFallbackMode={noop}
          onBulkSave={noop}
          fallbackForm={{ role: '', startDate: '', days: '7', homogeneousDemand: '', shiftsPerDay: '', workersPerShift: '', notes: '' }}
          updateFallbackField={() => noop}
          handleFallbackSubmit={noop}
          fallbackError={null}
          fallbackMessage={null}
          targetForm={{ date: '', role: '', required: '', notes: '' }}
          updateTargetField={() => noop}
          handleTargetSubmit={noop}
          targetError={null}
          forecastButtonLabel="Run forecast"
          forecastHelperText="Ready"
          forecastActionDisabled={false}
          runForecast={noop}
          baselineTargetsRef={{ current: null }}
          demandTargets={[]}
          roster={[]}
          shiftTemplates={[]}
          forecastError={null}
        />,
      );
    });
    const input = tree.root.findAll((n) => n.props.accessibilityLabel === 'Paste CSV (date,revenue,covers,notes)' && typeof n.props.onChangeText === 'function')[0];
    act(() => input.props.onChangeText('date,revenue\n2026-02-31,100\n2026-02-28,200'));
    const preview = tree.root.findAll((n) => n.props.accessibilityLabel === 'Preview CSV' && typeof n.props.onPress === 'function')[0];
    act(() => preview.props.onPress());
    const texts = tree.root
      .findAll((n) => typeof n.type === 'string')
      .map((n) => [n.props.children].flat().filter((c: unknown) => typeof c === 'string').join(''));
    expect(texts).toContain('Row 1: invalid date');
    expect(texts).toContain('2026-02-28');
    expect(texts).not.toContain('2026-02-31');
  });
});

describe('forecastEngine', () => {
  it('skips rows with impossible dates', () => {
    // 2026-03-02 is a Monday; 2026-02-31 would roll over to Tuesday 2026-03-03.
    const index = computeSeasonality([
      { date: '2026-03-02', revenue: 100, covers: null },
      { date: '2026-02-31', revenue: 300, covers: null },
    ]);
    expect(index[1]).toBe(1);
    expect(index[2]).toBe(1);
    expect(computeTrend([{ date: '2026-02-31', revenue: 1, covers: null }, { date: '2026-02-30', revenue: 2, covers: null }])).toEqual({ slope: 0, intercept: 0, r2: 0, direction: 'flat' });
  });
});

describe('useDemandAnalysis', () => {
  it('parseIsoDate rejects impossible days', () => {
    for (const d of IMPOSSIBLE) expect(parseIsoDate(d)).toBeNull();
    expect(parseIsoDate('2026-03-03')?.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });
});

describe('useAvailabilityGrid.addException', () => {
  it('ignores an impossible date and keeps a real one', async () => {
    let hook!: AvailabilityGridHook;
    const Probe = () => {
      hook = useAvailabilityGrid('w-test');
      return null;
    };
    await act(async () => {
      renderer.create(<Probe />);
    });
    await act(async () => {
      await hook.addException('2026-02-31', 'Holiday');
    });
    expect(hook.exceptions).toEqual([]);
    await act(async () => {
      await hook.addException('2026-02-28', 'Holiday');
    });
    expect(hook.exceptions.map((e) => e.date)).toEqual(['2026-02-28']);
  });
});
