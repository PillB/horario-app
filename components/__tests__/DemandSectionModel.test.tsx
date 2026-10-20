/**
 * DemandSection — the chosen forecast model, its backtest accuracy, the
 * planned headcount at the service level and the prediction interval.
 */
// jest.mock below is hoisted above these imports by babel-jest.
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { DemandSection } from '../scheduler/DemandSection';
import { type DemandForecast } from '@/services/demandForecast';
import { type RoleModelSummary } from '@/services/forecasting/statisticalForecast';

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

const noop = () => undefined;
const field = () => noop;

const MODELS: RoleModelSummary[] = [
  {
    role: 'Cook',
    model: 'holtWinters',
    mase: 0.734,
    scores: [],
    historyDays: 400,
    backtestOrigins: 10,
    intervalSource: 'backtest',
    params: {},
  },
  {
    role: 'Host',
    model: 'seasonalNaive',
    mase: null,
    scores: [],
    historyDays: 20,
    backtestOrigins: 0,
    intervalSource: 'in-sample',
    params: {},
  },
];

const TARGETS: DemandForecast[] = [
  {
    date: '2026-10-21',
    role: 'Cook',
    required: 5,
    expected: 3.62,
    serviceLevel: 0.8,
    intervalLevel: 0.8,
    lowerBound: 2.4,
    upperBound: 5.3,
    model: 'holtWinters',
    mase: 0.734,
    source: 'model',
  },
];

const render = (forecastModels?: RoleModelSummary[]): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <DemandSection
        fallbackMode="homogeneous"
        setFallbackMode={noop}
        onBulkSave={noop}
        fallbackForm={{ role: '', startDate: '', days: '7', homogeneousDemand: '', shiftsPerDay: '', workersPerShift: '', notes: '' }}
        updateFallbackField={field}
        handleFallbackSubmit={noop}
        fallbackError={null}
        fallbackMessage={null}
        targetForm={{ date: '', role: '', required: '', notes: '' }}
        updateTargetField={field}
        handleTargetSubmit={noop}
        targetError={null}
        forecastButtonLabel="Run forecast"
        forecastHelperText="Ready"
        forecastActionDisabled={false}
        runForecast={noop}
        baselineTargetsRef={{ current: null }}
        demandTargets={TARGETS}
        roster={[]}
        shiftTemplates={[]}
        forecastError={null}
        forecastModels={forecastModels}
      />,
    );
  });
  return tree;
};

const allText = (tree: ReactTestRenderer): string =>
  tree.root
    .findAll((node) => typeof node.props.children === 'string' || Array.isArray(node.props.children))
    .map((node) => [node.props.children].flat().filter((c: unknown) => typeof c === 'string').join(''))
    .join('\n');

describe('DemandSection forecast model', () => {
  it('shows the model chosen per role and its MASE', () => {
    const text = allText(render(MODELS));
    expect(text).toContain('Forecast model');
    expect(text).toContain('Cook: Holt-Winters (weekly pattern, damped trend)');
    expect(text).toContain('MASE 0.73 over 10 backtests');
    expect(text).toContain('Host: Seasonal naive (same day last week)');
    expect(text).toContain('Only 20 days of history');
  });

  it('shows the planned percentile, the expected value and the interval for a model target', () => {
    const text = allText(render(MODELS));
    expect(text).toContain('Plans for the 80th percentile (expected 3.6)');
    expect(text).toContain('80% range: 2.4 – 5.3');
    expect(text).toContain('5 needed');
  });

  it('shows no model block before a statistical forecast has run', () => {
    expect(allText(render())).not.toContain('Forecast model');
  });
});
