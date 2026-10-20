/* eslint-disable import/first */
// QA U5: the language options are radios; on web only aria-checked reaches the
// DOM (react-native-web 0.20 ignores accessibilityState.checked).

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));

import React from 'react';
import { Pressable } from 'react-native';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { LanguageSelector } from '@/components/LanguageSelector';
import { en } from '@/locales/en';

function renderOpen(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(
      <LanguageSelector currentLang="es" onSelect={jest.fn().mockResolvedValue(undefined)} locale={en} />,
    );
  });
  const root = tree as ReactTestRenderer;
  const trigger = root.root
    .findAllByType(Pressable)
    .find((node) => node.props.accessibilityLabel === en.language.selectorA11y);
  act(() => {
    trigger?.props.onPress();
  });
  return root;
}

describe('LanguageSelector', () => {
  it('marks exactly the current language as checked', () => {
    const tree = renderOpen();
    const radios = tree.root
      .findAllByType(Pressable)
      .filter((node) => node.props.accessibilityRole === 'radio');
    expect(radios.length).toBe(9);
    for (const radio of radios) {
      expect(typeof radio.props['aria-checked']).toBe('boolean');
      expect(radio.props.accessibilityHint).toBeTruthy();
    }
    const checked = radios.filter((r) => r.props['aria-checked']).map((r) => r.props.accessibilityLabel);
    expect(checked).toEqual(['Spanish — Español']);
  });

  it('wraps the options in a labelled radiogroup', () => {
    const tree = renderOpen();
    const groups = tree.root.findAll(
      (node) => node.props.accessibilityRole === 'radiogroup' && typeof node.type === 'string',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].props.accessibilityLabel).toBe(en.language.selectorLabel);
  });
});
