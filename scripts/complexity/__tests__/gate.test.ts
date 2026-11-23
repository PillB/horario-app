/**
 * Tests for the complexity gate (CHG-103). The fixtures are real source files
 * run through the real ESLint rule, so a change to ESLint's counting, to the
 * ceiling or to the naming shows up here, not as a surprise in CI.
 *
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../gate.js') as {
  CEILING: number;
  compare: (c: Record<string, Record<string, { complexity: number; line: number }>>, b: Record<string, Record<string, number>>, ceiling?: number) => { failures: string[]; stale: string[] };
};

type Found = Record<string, Record<string, { complexity: number; line: number }>>;

/**
 * Runs `collect` in a plain Node process: ESLint 9 loads its config with a
 * dynamic import, which Jest's VM refuses without --experimental-vm-modules.
 */
const collect = async (opts: { files?: string[]; ignores?: string[] }): Promise<Found> => {
  const script = `require(${JSON.stringify(path.join(__dirname, '..', 'gate.js'))}).collect(${JSON.stringify(opts)})` +
    `.then((r) => process.stdout.write(JSON.stringify(r)), (e) => { process.stderr.write(String(e && e.message)); process.exit(3); })`;
  try {
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    throw new Error(String((e as { stderr?: string }).stderr || e));
  }
};

/** A function whose McCabe count is exactly `n`: 1 + (n − 1) `if`s. */
const fnWithComplexity = (name: string, n: number) => {
  const ifs = Array.from({ length: n - 1 }, (_, i) => `  if (x === ${i}) return ${i};`).join('\n');
  return `export function ${name}(x: number): number {\n${ifs}\n  return -1;\n}\n`;
};

let dir: string;
beforeAll(() => {
  // Inside the repository so its eslint.config.js (and the TypeScript parser)
  // apply; outside __tests__ so Jest never takes a leftover fixture for a test.
  dir = fs.mkdtempSync(path.join(__dirname, '..', 'tmp-fixture-'));
  fs.writeFileSync(path.join(dir, 'atCeiling.ts'), fnWithComplexity('atCeiling', gate.CEILING));
  fs.writeFileSync(path.join(dir, 'overCeiling.ts'), fnWithComplexity('overCeiling', gate.CEILING + 1));
  fs.writeFileSync(
    path.join(dir, 'anonymous.tsx'),
    `import { useCallback, useEffect } from 'react';\n` +
      `export const Thing = ({ a }: { a: number }) => {\n` +
      `  const onSave = useCallback((x: number) => {\n${Array.from({ length: gate.CEILING }, (_, i) => `    if (x === ${i}) return ${i};`).join('\n')}\n    return a;\n  }, [a]);\n` +
      `  useEffect(() => {\n${Array.from({ length: gate.CEILING }, (_, i) => `    if (a === ${i}) console.log(${i});`).join('\n')}\n  }, [a]);\n` +
      `  return onSave(a);\n};\n`,
  );
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const rel = (f: string) => path.relative(repoRoot, path.join(dir, f)).split(path.sep).join('/');

describe('complexity gate: measuring', () => {
  it('passes a function at the ceiling and reports one just above it, with its count', async () => {
    const found = await collect({ files: [path.join(dir, '*.ts')], ignores: [] });
    expect(found[rel('atCeiling.ts')]).toBeUndefined();
    expect(found[rel('overCeiling.ts')]).toEqual({ overCeiling: { complexity: gate.CEILING + 1, line: 1 } });
  }, 30000);

  it('names anonymous functions by what holds them, so the baseline survives moving lines', async () => {
    const found = await collect({ files: [path.join(dir, 'anonymous.tsx')], ignores: [] });
    expect(Object.keys(found[rel('anonymous.tsx')] ?? {}).sort()).toEqual(['onSave (useCallback)', 'useEffect callback']);
  }, 30000);

  it('fails loudly on a file it cannot parse instead of skipping it', async () => {
    const bad = path.join(dir, 'broken.ts');
    fs.writeFileSync(bad, 'export function (');
    await expect(collect({ files: [bad], ignores: [] })).rejects.toThrow(/Could not parse .*broken\.ts/);
    fs.rmSync(bad);
  }, 30000);
});

describe('complexity gate: ratchet', () => {
  const current = { 'a.ts': { big: { complexity: 20, line: 3 } } };

  it('fails a new function above the ceiling and says what to do', () => {
    const { failures } = gate.compare(current, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^a\.ts:3 big: complexity 20 is above the ceiling of 15\. Split it/);
  });

  it('fails a baselined function that grew, naming both numbers', () => {
    const { failures } = gate.compare(current, { 'a.ts': { big: 18 } });
    expect(failures).toEqual([expect.stringContaining('grew from 18 (baseline) to 20')]);
  });

  it('passes a baselined function that did not change', () => {
    expect(gate.compare(current, { 'a.ts': { big: 20 } })).toEqual({ failures: [], stale: [] });
  });

  it('asks to tighten the baseline when a function shrank or is gone', () => {
    const { failures, stale } = gate.compare(current, { 'a.ts': { big: 22 }, 'b.ts': { gone: 30 } });
    expect(failures).toEqual([]);
    expect(stale).toEqual([
      expect.stringContaining('a.ts:3 big: complexity fell from 22 to 20'),
      expect.stringContaining('b.ts gone: no longer above the ceiling'),
    ]);
  });
});

describe('complexity gate: the repository', () => {
  it('has no function above the ceiling that is not in complexity-baseline.json, and no baselined one grew', async () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'complexity-baseline.json'), 'utf8'));
    expect(baseline.ceiling).toBe(gate.CEILING);
    const found = await collect({});
    const { failures, stale } = gate.compare(found, baseline.functions);
    // Printed in full so the failure says which function and what to do.
    expect([...failures, ...stale]).toEqual([]);
  }, 120000);
});

