/* eslint-disable import/first */
// QA U4: every page needs a <title> (WCAG 2.4.2).

jest.mock('expo-router/head', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

import fs from 'fs';
import path from 'path';
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { NavigationContext } from '@react-navigation/native';

import { formatPageTitle, PageTitle } from '@/components/PageTitle';

const APP_DIR = path.resolve(__dirname, '..', '..', 'app');

/** Route screens: every .tsx under app/ except layouts, API routes and tests. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'api') continue;
      out.push(...routeFiles(full));
    } else if (entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx' && !entry.name.includes('+api')) {
      out.push(full);
    }
  }
  return out;
}

describe('PageTitle', () => {
  it('suffixes the app name', () => {
    expect(formatPageTitle('Scheduler')).toBe('Scheduler · Horario');
  });

  it('falls back to the app name when the screen title is empty', () => {
    expect(formatPageTitle('  ')).toBe('Horario');
  });

  it('renders a single <title> string', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(<PageTitle title="Profile" />);
    });
    expect(tree?.toJSON()).toMatchObject({ type: 'title', children: ['Profile · Horario'] });
  });

  it('is rendered by every route screen', () => {
    const files = routeFiles(APP_DIR);
    expect(files.length).toBeGreaterThanOrEqual(8);
    const missing = files
      .filter((file) => !fs.readFileSync(file, 'utf8').includes('<PageTitle '))
      .map((file) => path.relative(APP_DIR, file));
    expect(missing).toEqual([]);
  });
});

// F-1 (CHG-109): tabs stay mounted, so <Head> alone left the title of the last
// tab mounted when the user went back to a tab already open.
describe('PageTitle on a tab that regains focus (F-1)', () => {
  type Listener = () => void;
  const fakeNavigation = (focused: boolean) => {
    const listeners: Listener[] = [];
    return {
      nav: {
        isFocused: () => focused,
        addListener: (event: string, cb: Listener) => {
          if (event === 'focus') listeners.push(cb);
          return () => {
            listeners.splice(listeners.indexOf(cb), 1);
          };
        },
      },
      focus: () => listeners.forEach((cb) => cb()),
      count: () => listeners.length,
    };
  };
  const g = globalThis as unknown as { document?: { title: string } };
  let savedDocument: { title: string } | undefined;
  beforeEach(() => {
    savedDocument = g.document;
    g.document = savedDocument ?? { title: '' };
    g.document.title = 'Analytics · Horario';
  });
  afterEach(() => {
    g.document = savedDocument;
  });

  it('writes its title when its tab is focused again, not only on mount', () => {
    const scheduler = fakeNavigation(false);
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = renderer.create(
        <NavigationContext.Provider value={scheduler.nav as never}>
          <PageTitle title="Scheduler" />
        </NavigationContext.Provider>,
      );
    });
    // Mounted in the background: the title of the screen in front stays.
    expect(g.document?.title).toBe('Analytics · Horario');
    act(() => scheduler.focus());
    expect(g.document?.title).toBe('Scheduler · Horario');
    act(() => tree?.unmount());
    expect(scheduler.count()).toBe(0);
  });

  it('writes its title at once when mounted focused', () => {
    const home = fakeNavigation(true);
    act(() => {
      renderer.create(
        <NavigationContext.Provider value={home.nav as never}>
          <PageTitle title="Home" />
        </NavigationContext.Provider>,
      );
    });
    expect(g.document?.title).toBe('Home · Horario');
  });
});
