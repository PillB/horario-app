// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key) => key }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { PersonalizedFeed } from '../PersonalizedFeed';

const baseItem = {
  summary: 'Summary',
  category: 'availability',
};

describe('PersonalizedFeed', () => {
  it('does not show the ranking score as a percentage (QA 2026-10-28)', () => {
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
    const texts = tree!.root
      .findAll((node) => typeof node.props?.children === 'string' || Array.isArray(node.props?.children))
      .map((node) => [].concat(node.props.children).filter((c) => typeof c === 'string' || typeof c === 'number').join(''));
    expect(texts.some((text) => /%/.test(text))).toBe(false);
    expect(texts).toContain('Low');
    expect(texts).toContain('High');
  });
});
