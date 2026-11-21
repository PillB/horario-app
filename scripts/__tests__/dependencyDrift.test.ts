/**
 * Dependency and platform drift (CHG-103). Past breakages here came from
 * packages and platforms moving under the code: a lockfile out of sync with
 * package.json (CI never green, baseline B1), Playwright without a browser
 * for a newer runner image (CHG-098), the `highs` ES module build breaking
 * the classic Web Worker (CHG-085). These tests pin the assumptions the code
 * makes about its dependencies and say which one moved.
 *
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

const declared = (name: string): string | undefined => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
const locked = (name: string): string | undefined => lock.packages?.[`node_modules/${name}`]?.version;
const major = (v: string | undefined) => (v ? Number(v.replace(/^[^\d]*/, '').split('.')[0]) : NaN);

describe('dependency drift', () => {
  it('the lockfile matches package.json at the root (npm ci refuses otherwise, and so does CI)', () => {
    const root = lock.packages?.[''] ?? {};
    expect({ dependencies: root.dependencies, devDependencies: root.devDependencies }).toEqual({
      dependencies: pkg.dependencies,
      devDependencies: pkg.devDependencies,
    });
  });

  it('react, react-dom and react-test-renderer are one exact version (the renderer refuses any other React)', () => {
    const want = declared('react');
    expect(want).toMatch(/^\d+\.\d+\.\d+$/);
    const names = ['react', 'react-dom', 'react-test-renderer'];
    const actual = Object.fromEntries(names.map((n) => [n, { declared: declared(n), locked: locked(n) }]));
    expect(actual).toEqual(Object.fromEntries(names.map((n) => [n, { declared: want, locked: want }])));
  });

  it('expo and jest-expo are on the same SDK, and CLAUDE.md names that SDK and the React Native version', () => {
    const sdk = major(locked('expo'));
    expect({ expo: sdk, 'jest-expo': major(locked('jest-expo')) }).toEqual({ expo: sdk, 'jest-expo': sdk });
    expect(claudeMd).toContain(`Expo SDK ${sdk}`);
    expect(claudeMd).toContain(`React Native ${locked('react-native')}`);
  });

  it('highs is pinned exactly, matches the lockfile and CLAUDE.md, and still ships the builds the solver worker loads', () => {
    expect(declared('highs')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(locked('highs')).toBe(declared('highs'));
    expect(claudeMd).toContain(`\`highs\` ${declared('highs')}`);
    // solverWorker.ts: require('highs') must be the CommonJS build (the ES one
    // uses import.meta, which breaks a classic worker script) and
    // require('highs/runtime') the WebAssembly file Metro serves as an asset.
    expect(path.extname(require.resolve('highs'))).toBe('.js');
    expect(path.extname(require.resolve('highs/runtime'))).toBe('.wasm');
  });

  it('@playwright/test and playwright are the same version (the browser build is chosen by it)', () => {
    expect(locked('playwright')).toBe(locked('@playwright/test'));
  });

  it('the Node version CI uses satisfies engines.node', () => {
    const ciMajors = [...ci.matchAll(/node-version:\s*(\d+)/g)].map((m) => Number(m[1]));
    const min = major(pkg.engines?.node);
    expect(ciMajors.length).toBeGreaterThan(0);
    expect(ciMajors.filter((m) => m < min)).toEqual([]);
  });
});
