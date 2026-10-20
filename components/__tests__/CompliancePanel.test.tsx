/* eslint-disable import/first */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/contexts/LocaleContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en');
  const resolve = (obj: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], obj);
  const t = (key: string, params?: Record<string, string>) => {
    let out = resolve(en, key);
    if (typeof out !== 'string') out = key;
    let text = out as string;
    if (params) Object.entries(params).forEach(([k, v]) => { text = text.replace(`{${k}}`, v); });
    return text;
  };
  return { useT: () => ({ t, langCode: 'en', locale: en, setLanguage: () => {}, isLoading: false }) };
});

import React from 'react';
import { Pressable, Switch } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { CompliancePanel } from '@/components/scheduler/CompliancePanel';
import { WorkerLaborFields } from '@/components/scheduler/WorkerLaborFields';
import { evaluateCompliance, type ComplianceShift } from '@/hooks/useCompliance';
import type { WorkerFormState } from '@/hooks/useSchedulerHandlers';
import type { BusinessLocation } from '@/utils/locationValidation';

const MADRID: BusinessLocation = {
  id: '00000000-0000-0000-0000-0000000000e1', name: 'Madrid Centro', countryCode: 'ES', regionCode: null, cityCode: null,
  jurisdictionCode: 'ES', timeZone: 'Europe/Madrid', industry: 'retail', employerHeadcount: null, locationsCount: null,
  detectedHint: null, overrides: [], confirmedBy: 'u', confirmedAt: '2026-10-20T00:00:00Z',
};

const worker = { id: 'w-ana', displayId: 'W-1', name: 'Ana', role: 'Clerk', skills: [], availability: [] };
const shift = (id: string, date: string, start: string, end: string): ComplianceShift => ({
  id, date, workerId: 'w-ana', templateId: id, location: '', status: 'Draft', worker,
  template: { id, name: id, role: 'Clerk', start, end, coverage: 1 },
});

const allText = (tree: renderer.ReactTestRenderer): string =>
  tree.root
    .findAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join('\n');

describe('CompliancePanel', () => {
  it('shows one set-up prompt without a location and links to the profile', async () => {
    const result = evaluateCompliance({ shifts: [], locations: [], locationsLoaded: true, weekStart: '2026-11-01' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CompliancePanel result={result} weekStart="2026-11-01" />);
    });
    expect(tree.root.findAll((n) => n.props.testID === 'compliance-setup-prompt' && typeof n.type === 'string')).toHaveLength(1);
    expect(allText(tree)).toContain('Set up a location to check labor rules');
    const link = tree.root.findAll((n) => n.type === Pressable)[0];
    expect(link.props.accessibilityRole).toBe('link');
    await act(async () => link.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('renders nothing while locations load', async () => {
    const result = evaluateCompliance({ shifts: [], locations: [], locationsLoaded: false, weekStart: '2026-11-01' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CompliancePanel result={result} weekStart="2026-11-01" />);
    });
    expect(tree.toJSON()).toBeNull();
  });

  it('groups findings by verdict with message and citation', async () => {
    const result = evaluateCompliance({
      shifts: [shift('mon-close', '2026-11-02', '15:00', '23:00'), shift('tue-open', '2026-11-03', '07:00', '15:00')],
      locations: [MADRID],
      locationsLoaded: true,
      weekStart: '2026-11-01',
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CompliancePanel result={result} weekStart="2026-11-01" />);
    });
    const text = allText(tree);
    expect(text).toContain('Labor rules, week of 2026-11-01');
    expect(text).toMatch(/Violations \(\d+\)/);
    expect(text).toContain('Estatuto de los Trabajadores art. 34.3');
    expect(text).toContain('Ana · Madrid Centro');
    const groups = tree.root
      .findAll((n) => typeof n.type === 'string' && String(n.props.testID ?? '').startsWith('compliance-group-'))
      .map((n) => n.props.testID);
    expect(groups[0]).toBe('compliance-group-violation');
  });

  it('says so when the week has no findings', async () => {
    const result = evaluateCompliance({ shifts: [], locations: [MADRID], locationsLoaded: true, weekStart: '2026-11-01' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<CompliancePanel result={result} weekStart="2026-11-01" />);
    });
    expect(allText(tree)).toContain('No labor-rule findings for this week.');
  });
});

describe('WorkerLaborFields', () => {
  it('has an accessible switch for each flag and reports changes', async () => {
    const form: WorkerFormState = {
      name: '', role: '', skills: '', birthDate: '', nightWorker: false, weeklyLimitOptOut: true, noFixedHours: false,
    };
    const changes: [string, unknown][] = [];
    const update = <K extends keyof WorkerFormState>(key: K) => (value: WorkerFormState[K]) => { changes.push([key, value]); };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WorkerLaborFields workerForm={form} updateWorkerField={update} />);
    });
    const switches = tree.root.findAllByType(Switch);
    expect(switches).toHaveLength(3);
    for (const s of switches) {
      expect(s.props.accessibilityRole).toBe('switch');
      expect(s.props.accessibilityLabel).toBeTruthy();
      expect(s.props.accessibilityHint).toBeTruthy();
    }
    expect(switches[1].props.value).toBe(true);
    await act(async () => switches[0].props.onValueChange(true));
    expect(changes).toEqual([['nightWorker', true]]);
  });
});
