// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key,
  }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';

import { ProfileAchievements } from '../ProfileAchievements';

const render = (items) => {
  let tree: renderer.ReactTestRenderer | null = null;
  act(() => { tree = renderer.create(<ProfileAchievements items={items} />); });
  return tree as renderer.ReactTestRenderer;
};
const texts = (tree) => tree.root.findAll((n) => n.type === Text).map((n) => [].concat(n.props.children).join(''));

describe('ProfileAchievements (milestones)', () => {
  it('renders nothing without items', () => {
    expect(render([]).toJSON()).toBeNull();
  });

  it('marks a done milestone with a check and the word, not only colour', () => {
    const tree = render([{ id: 'a', title: 'Set up', description: 'd', progress: 3, goal: 3 }]);
    expect(texts(tree)).toEqual(expect.arrayContaining(['✓', 'home.achievements.done']));
    expect(tree.root.findAll((n) => n.type === View && n.props.accessibilityRole === 'progressbar')).toHaveLength(0);
  });

  it('shows counted progress with a labelled progress bar', () => {
    const tree = render([{ id: 'b', title: 'Four weeks', description: 'd', progress: 2, goal: 4 }]);
    expect(texts(tree)).toEqual(expect.arrayContaining(['50%', 'home.achievements.progressOf(n=2,m=4)']));
    const bar = tree.root.find((n) => n.type === View && n.props.accessibilityRole === 'progressbar');
    expect(bar.props.accessibilityValue).toEqual({ now: 2, min: 0, max: 4 });
  });

  it('a yes/no milestone not reached yet has no percentage', () => {
    const tree = render([{ id: 'c', title: 'Staffed', description: 'd', progress: 0, goal: 1 }]);
    expect(texts(tree)).toEqual(expect.arrayContaining(['○', 'home.achievements.notStarted']));
    expect(texts(tree).some((s) => s.endsWith('%'))).toBe(false);
  });

  it('handles non-positive and missing goals safely', () => {
    const tree = render([
      { id: 'z', title: 'Zero', description: 'd', progress: 2, goal: 0 },
      { id: 'm', title: 'Missing', description: 'd', progress: 0 },
    ]);
    expect(texts(tree)).toEqual(expect.arrayContaining(['✓', '○']));
  });
});
