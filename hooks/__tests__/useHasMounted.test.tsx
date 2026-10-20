import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { useHasMounted } from '@/hooks/useHasMounted';

function Probe(): React.JSX.Element {
  return React.createElement('span', null, useHasMounted() ? 'mounted' : 'server');
}

describe('useHasMounted', () => {
  it('is false in a server (static) render, where effects never run', () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<span>server</span>');
  });

  it('is true once the component has mounted', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<Probe />);
    });
    expect(tree?.toJSON()).toMatchObject({ children: ['mounted'] });
  });
});
