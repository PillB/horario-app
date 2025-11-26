// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View } from 'react-native';

import { StreakCounter } from '../StreakCounter';

describe('StreakCounter', () => {
  it('adds accessibility metadata to the progress track', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <StreakCounter label="Daily focus" streakCount={5} longestStreak={12} progress={0.42} />,
      );
    });

    if (!tree) {
      throw new Error('StreakCounter failed to render');
    }

    const progressTrack = tree.root.find(
      (node) => node.type === View && node.props.accessibilityRole === 'progressbar',
    );

    expect(progressTrack.props.accessibilityLabel).toBe('Daily focus streak progress');
    expect(progressTrack.props.accessibilityValue).toEqual({ now: 42, min: 0, max: 100 });
  });
});
