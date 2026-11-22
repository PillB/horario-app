#!/usr/bin/env node
/**
 * Cyclomatic complexity gate (CHG-103).
 *
 * Every function in the repository must stay at or below CEILING (ESLint's
 * `complexity` rule, classic McCabe count plus `&&`, `||`, `??` and default
 * parameters). Functions that were already above it on 2026-11-21 are listed
 * in complexity-baseline.json with their count at that time. The gate is a
 * ratchet:
 *   - a new function above the ceiling fails;
 *   - a baselined function that grows fails;
 *   - a baselined function that shrank, or is gone, fails until the baseline
 *     is updated (`npm run lint:complexity -- --update`), so the file never
 *     keeps slack that a later change could silently use up.
 *
 * Functions are keyed by file and name, not line, so moving code does not
 * break the gate. Anonymous functions take the name of what holds them
 * (`useEffect callback`, `style prop`) plus an occurrence index.
 *
 * Usage: node scripts/complexity/gate.js [--update] [--json]
 */
/* global __dirname */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(ROOT, 'complexity-baseline.json');
const CEILING = 15;
const PATTERNS = ['**/*.{ts,tsx,js,jsx}'];
const IGNORES = [
  'node_modules/**', 'dist/**', '.claude/**', 'playwright-report/**', 'test-results/**',
  'coverage/**', '.expo/**', 'android/**', 'ios/**',
  // The gate's own test fixtures (scripts/complexity/tmp-fixture-*).
  '**/tmp-fixture-*/**',
];

const keyName = (key) => (key.name || (key.value !== undefined ? String(key.value) : 'computed'));
const isDeclaredAs = (node) => node && node.type === 'VariableDeclarator' && node.id && node.id.name;

function calleeName(call) {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  return c.type === 'MemberExpression' && c.property && c.property.name ? c.property.name : 'call';
}

/** Name of an anonymous function, by the kind of node that holds it. */
const NAME_FROM_PARENT = {
  VariableDeclarator: (p) => (p.id.type === 'Identifier' ? p.id.name : 'destructured'),
  Property: (p) => keyName(p.key),
  MethodDefinition: (p) => keyName(p.key),
  PropertyDefinition: (p) => keyName(p.key),
  AssignmentExpression: (p) => (p.left.type === 'Identifier' ? p.left.name : (p.left.property && p.left.property.name) || 'member'),
  // useCallback(() => …) inside `const onSave = useCallback(…)` is "onSave (useCallback)".
  CallExpression: (p) => (isDeclaredAs(p.parent) ? `${p.parent.id.name} (${calleeName(p)})` : `${calleeName(p)} callback`),
  JSXExpressionContainer: (p) => (p.parent && p.parent.type === 'JSXAttribute' ? `${p.parent.name.name} prop` : 'jsx child'),
  ExportDefaultDeclaration: () => 'default export',
};

/** A readable name for the function `node`, from the node or what holds it. */
function functionName(node) {
  if (node.id && node.id.name) return node.id.name;
  const namer = node.parent && NAME_FROM_PARENT[node.parent.type];
  return namer ? namer(node.parent) : 'anonymous';
}

/** The built-in rule, wrapped so each report carries the function's name. */
function keyedComplexityRule() {
  const { builtinRules } = require('eslint/use-at-your-own-risk');
  const base = builtinRules.get('complexity');
  return {
    meta: base.meta,
    create(context) {
      const proxy = Object.create(context, {
        report: {
          value(descriptor) {
            const count = Number(descriptor.data && descriptor.data.complexity);
            context.report({
              ...descriptor,
              data: { ...descriptor.data, name: functionName(descriptor.node), complexity: count },
              messageId: undefined,
              message: `KEY ${JSON.stringify(functionName(descriptor.node))} ${count}`,
            });
          },
        },
      });
      return base.create(proxy);
    },
  };
}

/**
 * Runs the rule over the repository (or `files`) and returns
 * { 'path/file.ts': { 'name': complexity, 'name#2': … } } for functions above `ceiling`.
 */
async function collect({ ceiling = CEILING, files = PATTERNS, cwd = ROOT, ignores = IGNORES } = {}) {
  const { ESLint } = require('eslint');
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: path.join(ROOT, 'eslint.config.js'),
    overrideConfig: [
      { ignores },
      {
        plugins: { gate: { rules: { complexity: keyedComplexityRule() } } },
        // Only this rule: other findings belong to `npm run lint`.
        rules: { 'gate/complexity': ['error', { max: ceiling }] },
      },
    ],
    ruleFilter: ({ ruleId }) => ruleId === 'gate/complexity',
    errorOnUnmatchedPattern: false,
  });
  const results = await eslint.lintFiles(files);
  const out = {};
  for (const r of results) {
    const fatal = r.messages.find((m) => m.fatal);
    if (fatal) throw new Error(`Could not parse ${path.relative(cwd, r.filePath)}:${fatal.line}: ${fatal.message}`);
    const rel = path.relative(cwd, r.filePath).split(path.sep).join('/');
    const seen = {};
    for (const m of r.messages) {
      if (m.ruleId !== 'gate/complexity') continue;
      const match = /^KEY (".*") (\d+)$/.exec(m.message);
      if (!match) throw new Error(`Unexpected complexity message in ${rel}:${m.line}: ${m.message}`);
      const name = JSON.parse(match[1]);
      seen[name] = (seen[name] || 0) + 1;
      const key = seen[name] === 1 ? name : `${name}#${seen[name]}`;
      (out[rel] = out[rel] || {})[key] = { complexity: Number(match[2]), line: m.line };
    }
  }
  return out;
}

/**
 * Compares measured functions with the baseline. Pure, so it is unit-tested.
 * Returns { failures: string[], stale: string[] }; both must be empty to pass.
 */
function compare(current, baseline, ceiling = CEILING) {
  const failures = [];
  const stale = [];
  for (const [file, fns] of Object.entries(current)) {
    for (const [name, { complexity, line }] of Object.entries(fns)) {
      const allowed = baseline[file] && baseline[file][name];
      const where = `${file}:${line} ${name}`;
      if (allowed === undefined) {
        failures.push(`${where}: complexity ${complexity} is above the ceiling of ${ceiling}. Split it (extract a pure helper, a lookup table or an early return) and add a test for the extracted part.`);
      } else if (complexity > allowed) {
        failures.push(`${where}: complexity grew from ${allowed} (baseline) to ${complexity}. A baselined function may only shrink; take the new branch out into a helper.`);
      } else if (complexity < allowed) {
        stale.push(`${where}: complexity fell from ${allowed} to ${complexity}. Good. Run \`npm run lint:complexity -- --update\` to lock in the lower number.`);
      }
    }
  }
  for (const [file, fns] of Object.entries(baseline)) {
    for (const name of Object.keys(fns)) {
      if (!(current[file] && current[file][name])) {
        stale.push(`${file} ${name}: no longer above the ceiling (or renamed / moved). Run \`npm run lint:complexity -- --update\` to remove it from the baseline.`);
      }
    }
  }
  return { failures, stale };
}

function toBaseline(current) {
  const out = {};
  for (const file of Object.keys(current).sort()) {
    out[file] = {};
    for (const name of Object.keys(current[file]).sort()) out[file][name] = current[file][name].complexity;
  }
  return out;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return raw.functions || {};
}

async function main(argv) {
  const update = argv.includes('--update');
  const current = await collect();
  const baseline = readBaseline();
  if (update) {
    const { failures } = compare(current, baseline);
    const next = {
      ceiling: CEILING,
      note: 'Functions above the ceiling when the gate was added (CHG-103). Entries may only go down or disappear; see scripts/complexity/gate.js.',
      functions: toBaseline(current),
    };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
    const total = Object.values(next.functions).reduce((n, f) => n + Object.keys(f).length, 0);
    console.log(`Wrote ${path.relative(ROOT, BASELINE_FILE)}: ${total} functions above ${CEILING}.`);
    if (failures.length) {
      console.log(`\nThis update ADDED or RAISED ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'}. Say why in the PR, or split the function instead:`);
      for (const f of failures) console.log(`  - ${f}`);
    }
    return 0;
  }
  const { failures, stale } = compare(current, baseline);
  if (!failures.length && !stale.length) {
    const total = Object.values(baseline).reduce((n, f) => n + Object.keys(f).length, 0);
    console.log(`Complexity gate passed: no new function above ${CEILING}; ${total} baselined functions did not grow.`);
    return 0;
  }
  if (failures.length) {
    console.error(`Complexity gate FAILED: ${failures.length} function(s) over the ceiling of ${CEILING}.\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
  }
  if (stale.length) {
    console.error(`\nComplexity baseline is STALE: ${stale.length} entr${stale.length === 1 ? 'y' : 'ies'} can be tightened.\n`);
    for (const s of stale) console.error(`  ↓ ${s}`);
  }
  return 1;
}

module.exports = { CEILING, collect, compare, toBaseline, functionName };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`Complexity gate could not run: ${err && err.stack ? err.stack : err}`);
    process.exit(2);
  });
}
