/**
 * AGENTS.md and CLAUDE.md point at commands and files (CHG-103). When one
 * is renamed or removed the instructions silently stop working for the next
 * agent, so every `npm run …` they name must be a script and every repository
 * path they name must exist. Paths under qa/, research/, setup/, plan/ and
 * product/ live in the project's shared files, not in the repository.
 *
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;
const SHARED = /^(qa|research|setup|plan|product|handoff|build)\//;

const namedScripts = (doc: string) => [...doc.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
/** Backticked repository paths: a folder and a file with an extension (bare names and routes are skipped). */
const namedPaths = (doc: string) =>
  [...doc.matchAll(/`([\w.()+-]+(?:\/[\w.()+-]+)*\/[\w.()+-]+\.(?:md|json|ts|tsx|js|yml|sql))`/g)]
    .map((m) => m[1])
    .filter((p) => !SHARED.test(p));

describe.each(['AGENTS.md', 'CLAUDE.md'])('%s', (doc) => {
  const text = read(doc);

  it('names only npm scripts that exist', () => {
    expect([...new Set(namedScripts(text))].filter((s) => !(s in scripts)).map((s) => `npm run ${s}: no such script in package.json`)).toEqual([]);
  });

  it('names only repository files that exist', () => {
    // Guard against the matcher itself drifting into checking nothing.
    expect(namedPaths(text).length).toBeGreaterThan(5);
    const exists = (p: string) => fs.existsSync(path.join(ROOT, p)) || fs.existsSync(path.join(ROOT, `${p}.ts`)) || fs.existsSync(path.join(ROOT, `${p}.tsx`));
    expect([...new Set(namedPaths(text))].filter((p) => !exists(p)).map((p) => `${p}: named in ${doc} but not in the repository`)).toEqual([]);
  });
});

it('CLAUDE.md tells every session to read AGENTS.md and gives its path', () => {
  const claude = read('CLAUDE.md');
  expect(claude).toMatch(/\[`AGENTS\.md`\]\(AGENTS\.md\)/);
  expect(claude).toContain('path: `AGENTS.md` at the repository root');
  expect(claude).toMatch(/Always read `CLAUDE\.md` \+ `Claude_changes\.md` \+ `AGENTS\.md`/);
});
