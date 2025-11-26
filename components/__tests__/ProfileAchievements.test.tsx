// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';

import { ProfileAchievements } from '../ProfileAchievements';

const isProgressFill = (node: renderer.ReactTestInstance) =>
  node.type === View &&
  Array.isArray(node.props.style) &&
  node.props.style.some((style: unknown) => style && style.backgroundColor === '#2563EB');

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
      const widthStyle = fill.props.style.find(
        (style: unknown) => style && typeof style === 'object' && 'width' in style,
      );
      return widthStyle?.width;
    });

    expect(widths).toEqual(['100%', '0%']);

    const fallbackGoalHelper = tree.root.find(
      (node) =>
        node.type === Text &&
        Array.isArray(node.props.children) &&
        node.props.children[0] === 2 &&
        node.props.children.includes(' of ') &&
        node.props.children.includes(1),
    );

    expect(fallbackGoalHelper).toBeDefined();
  });
});
