/**
 * Every literal t('a.b.c') key used in the app must exist in the English
 * master locale. t() returns '' for a missing key (useLocale.ts), so a missing
 * key renders as an empty, unnamed control instead of failing loudly (QA U1:
 * the Profile tab had no label because nav.profile was missing).
 */
import fs from 'fs';
import path from 'path';

import { de } from '@/locales/de';
import { en } from '@/locales/en';
import { es } from '@/locales/es';
import { fr } from '@/locales/fr';
import { hi } from '@/locales/hi';
import { it as itLocale } from '@/locales/it';
import { sw } from '@/locales/sw';
import { tl } from '@/locales/tl';
import { zh } from '@/locales/zh';

const TRANSLATIONS: Record<string, unknown> = { es, de, fr, it: itLocale, zh, sw, tl, hi };
const TAB_LABEL_KEYS = ['nav.home', 'nav.scheduler', 'nav.analytics', 'nav.profile', 'nav.diagnostics'];

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_DIRS = ['app', 'components', 'hooks', 'contexts', 'utils', 'services'];
const KEY_PATTERN = /\bt\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g;

function listSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function resolve(obj: unknown, keyPath: string): unknown {
  let current: unknown = obj;
  for (const part of keyPath.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const dir of SOURCE_DIRS) {
    for (const file of listSources(path.join(ROOT, dir))) {
      // Skip comment lines: doc comments quote example keys that do not exist.
      const text = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n');
      for (const match of text.matchAll(KEY_PATTERN)) {
        if (!keys.has(match[1])) keys.set(match[1], path.relative(ROOT, file));
      }
    }
  }
  return keys;
}

describe('locale keys', () => {
  it('finds the t() calls it is meant to check', () => {
    const keys = usedKeys();
    expect(keys.has('nav.profile')).toBe(true);
    expect(keys.size).toBeGreaterThan(50);
  });

  it('every literal t() key exists as a string in the English locale', () => {
    const missing = [...usedKeys()]
      .filter(([key]) => typeof resolve(en, key) !== 'string')
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(TRANSLATIONS))('%s translates the tab bar labels', (code) => {
    for (const key of TAB_LABEL_KEYS) {
      const value = resolve(TRANSLATIONS[code], key);
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
