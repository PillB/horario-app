// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { PersonalizedFeed } from '../PersonalizedFeed';

const baseItem = {
  summary: 'Summary',
  category: 'availability',
};

describe('PersonalizedFeed', () => {
  it('clamps displayed scores to between 0% and 100%', () => {
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(
        <PersonalizedFeed
          items={[
            { id: 'low', title: 'Low', impactScore: -0.4, score: -0.2, ...baseItem },
            { id: 'high', title: 'High', impactScore: 1.5, score: 1.25, ...baseItem },
          ]}
        />,
      );
    });

    if (!tree) {
      throw new Error('Tree failed to render');
    }

    const badgeValues = tree.root
      .findAll((node) => {
        const styles = Array.isArray(node.props?.style) ? node.props.style : [node.props?.style];
        return styles.some((style) => style?.fontWeight === '700');
      })
      .map((node) => {
        const children = node.props.children;
        return Array.isArray(children) ? children.join('') : children;
      });

    expect(badgeValues).toContain('0%');
    expect(badgeValues).toContain('100%');
  });
});
