import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Pressable } from 'react-native';

import { Checklist } from '../scheduler/Checklist';

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key: string, p?: Record<string, string>) => (key === 'scheduler.onboarding.completedA11y' ? `${p?.step} completed` : key) }),
}));

describe('Checklist (QA 2026-10-28)', () => {
  it('only announces finished steps as completed', () => {
    const step = (key: 'workers' | 'forecast', completed: boolean) => ({
      key, title: key === 'workers' ? 'Add workers' : 'Run forecast', description: '', completed, actionLabel: 'Go', onPress: jest.fn(),
    });
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => { tree = renderer.create(<Checklist steps={[step('workers', true), step('forecast', false)]} progress={0.5} />); });
    const labels = tree!.root.findAllByType(Pressable).map((p) => p.props.accessibilityLabel);
    expect(labels).toContain('Add workers completed');
    expect(labels).toContain('Run forecast');
    expect(labels).not.toContain('Run forecast completed');
  });
});
