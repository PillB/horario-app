// @ts-nocheck
/* eslint-disable import/first */
jest.mock('@/hooks/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

import { Collapsible } from '../Collapsible';

describe('Collapsible', () => {
  it('exposes accessibility attributes on the toggle', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <Collapsible title="Details">
          <Text>Hidden content</Text>
        </Collapsible>,
      );
    });

    if (!tree) {
      throw new Error('Tree failed to render');
    }

    const toggle = tree.root.findByType(TouchableOpacity);

    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityLabel).toBe('Details');
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });
    expect(toggle.props.focusable).toBe(true);
  });

  it('toggles content visibility and accessibility state when pressed', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <Collapsible title="More info">
          <Text>Child content</Text>
        </Collapsible>,
      );
    });

    if (!tree) {
      throw new Error('Tree failed to render');
    }

    const toggle = tree.root.findByType(TouchableOpacity);

    const initialContent = tree.root.findAll(
      (node) => node.type === Text && node.props.children === 'Child content',
    );
    expect(initialContent).toHaveLength(0);

    act(() => toggle.props.onPress());

    const updatedToggle = tree.root.findByType(TouchableOpacity);
    expect(updatedToggle.props.accessibilityState).toEqual({ expanded: true });

    const visibleContent = tree.root.findAll(
      (node) => node.type === Text && node.props.children === 'Child content',
    );
    expect(visibleContent).not.toHaveLength(0);
  });
});
