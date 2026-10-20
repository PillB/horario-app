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
