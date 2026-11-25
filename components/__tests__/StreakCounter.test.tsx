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
import { Pressable, Text, View } from 'react-native';

import { StreakCounter } from '../StreakCounter';
import { computePostingHabit } from '@/utils/postingHabit';

const GOAL = { days: 7, lawDays: null, ifCoveredDays: null };
const published = (date: string, on: string) => ({ date, status: 'Published', publishedAt: `${on}T12:00:00.000Z` });

const render = (el: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | null = null;
  act(() => { tree = renderer.create(el); });
  if (!tree) throw new Error('render failed');
  return tree as renderer.ReactTestRenderer;
};
const texts = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === Text).map((n) => [].concat(n.props.children).join(''));

describe('StreakCounter (weekly posting habit)', () => {
  const habit = computePostingHabit([
    published('2026-11-09', '2026-11-01'),
    published('2026-11-16', '2026-11-12'),
  ], { today: '2026-11-18', noticeDays: 7, timeZone: 'UTC' });

  it('labels every week with its date and verdict, not by colour alone', () => {
    const tree = render(<StreakCounter habit={habit} goal={GOAL} />);
    const weeks = tree.root.findAll((n) => n.type === View && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('home.habit.weekA11y'));
    expect(weeks).toHaveLength(habit.weeks.length);
    expect(weeks.map((w) => w.props.accessibilityLabel)).toContain('home.habit.weekA11y(date=2026-11-09,verdict=home.habit.verdict.ahead)');
    expect(weeks.map((w) => w.props.accessibilityLabel)).toContain('home.habit.weekA11y(date=2026-11-16,verdict=home.habit.verdict.late)');
    expect(texts(tree)).toContain('✓');
  });

  it('shows the steady count next to the run, and has no button to log progress', () => {
    const tree = render(<StreakCounter habit={habit} goal={GOAL} />);
    expect(texts(tree)).toContain('home.habit.ofWeeks(n=1,m=2)');
    expect(texts(tree)).toContain('0');
    expect(texts(tree).some((s) => /log/i.test(s))).toBe(false);
  });

  it('offers the next week to post and opens the roster', () => {
    const onOpenRoster = jest.fn();
    const tree = render(<StreakCounter habit={habit} goal={GOAL} onOpenRoster={onOpenRoster} />);
    expect(texts(tree)).toContain('home.habit.next(week=2026-11-30,deadline=2026-11-23)');
    const button = tree.root.find((n) => n.type === Pressable && n.props.accessibilityLabel === 'home.habit.openRosterA11y');
    expect(button.props.accessibilityHint).toBe('home.habit.openRosterHint');
    act(() => button.props.onPress());
    expect(onOpenRoster).toHaveBeenCalled();
  });

  it('names a legal notice and a fair-workweek notice when they apply', () => {
    const tree = render(<StreakCounter habit={habit} goal={{ days: 7, lawDays: 7, ifCoveredDays: 14 }} />);
    expect(texts(tree)).toContain('home.habit.lawNotice(n=7)');
    expect(texts(tree)).toContain('home.habit.fairWorkweek(n=14)');
  });

  it('shows a load error with a retry instead of an empty habit', () => {
    const onRetry = jest.fn();
    const tree = render(<StreakCounter habit={null} goal={GOAL} error="boom" onRetry={onRetry} />);
    expect(texts(tree)).toContain('home.habit.loadError');
    const retry = tree.root.find((n) => n.type === Pressable && n.props.accessibilityLabel === 'common.tryAgain');
    act(() => retry.props.onPress());
    expect(onRetry).toHaveBeenCalled();
  });

  it('recognises a run with informational copy', () => {
    const run = computePostingHabit([
      published('2026-10-26', '2026-10-01'), published('2026-11-02', '2026-10-01'),
      published('2026-11-09', '2026-10-01'), published('2026-11-16', '2026-10-01'),
    ], { today: '2026-11-18', noticeDays: 7, timeZone: 'UTC' });
    const tree = render(<StreakCounter habit={run} goal={GOAL} />);
    expect(texts(tree)).toContain('home.habit.tiers.monthTitle');
  });
});
