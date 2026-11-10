// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';

import { ProfileAchievements } from '../ProfileAchievements';

// Matches both progressFill (array style) and progressFillEmpty (single style),
// both of which use colors.tint (#0D9488 in light mode) as backgroundColor.
const isProgressFill = (node: renderer.ReactTestInstance) => {
  if (node.type !== View) return false;
  const style = node.props.style;
  const hasTint = (s: unknown) =>
    s !== null && typeof s === 'object' && (s as Record<string, unknown>).backgroundColor === '#0D9488';
  if (Array.isArray(style)) return style.some(hasTint);
  return hasTint(style);
};

describe('ProfileAchievements', () => {
  it('handles non-positive and missing goals safely', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <ProfileAchievements
          items={[
            {
              id: 'zero-goal',
              title: 'Zero goal',
              description: 'Handles zero safely',
              progress: 2,
              goal: 0,
            },
            {
              id: 'missing-goal',
              title: 'Missing goal',
              description: 'Falls back to default',
              progress: 0,
            },
          ]}
        />,
      );
    });

    if (!tree) {
      throw new Error('ProfileAchievements failed to render');
    }

    const getTextContent = (node: renderer.ReactTestInstance) => {
      const content = node.props.children;
      if (Array.isArray(content)) {
        return content.join('');
      }
      return `${content}`;
    };

    const percentBadges = tree.root.findAll(
      (node) =>
        node.type === Text &&
        (Array.isArray(node.props.children) || typeof node.props.children !== 'undefined') &&
        getTextContent(node).endsWith('%'),
    );

    expect(percentBadges.map(getTextContent)).toEqual(['100%', '0%']);

    const progressFills = tree.root.findAll(isProgressFill);
    const widths = progressFills.map((fill) => {
      const style = fill.props.style;
      if (Array.isArray(style)) {
        const widthStyle = style.find(
          (s: unknown) => s && typeof s === 'object' && 'width' in s,
        );
        return widthStyle?.width;
      }
      // progressFillEmpty uses a single style object with fixed width
      return (style as Record<string, unknown>).width;
    });

    // First item (goal=0 → safeGoal=1, progress=2 → 100%): progressFill with width '100%'
    // Second item (missing goal, progress=0 → 0%): progressFillEmpty with fixed width 4
    expect(widths).toEqual(['100%', 4]);

    // When goal is missing/zero, safeGoal falls back to 1.
    // The component renders the helper as a template string "2 of 1".
    const fallbackGoalHelper = tree.root.find(
      (node) =>
        node.type === Text &&
        typeof node.props.children === 'string' &&
        node.props.children === '2 of 1',
    );

    expect(fallbackGoalHelper).toBeDefined();
  });
});
