#!/usr/bin/env node
/**
 * Drift run (CHG-103): the unit suite under other clocks and time zones.
 *
 * CI runs in UTC on the day of the push. Code and tests that only hold there
 * break later or elsewhere: a fixture "13 days from now" expires, a dated
 * labor rule enters its next phase, a date is parsed in the machine's zone.
 * This runs the suite once per scenario and fails, naming the scenario and
 * the failing tests, if any scenario fails.
 *
 * Scenarios look ahead from today (30 days catches a fixture about to
 * expire; 400 days crosses a year end and the next phase of most dated
 * rules) plus fixed instants on DST changes.
 *
 * Usage: node scripts/testing/drift.js [jest args…]
 */
/* global __dirname */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

function scenarios(now = Date.now()) {
  return [
    { name: 'machine in Lima (UTC-5, no DST)', env: { TZ: 'America/Lima' } },
    { name: 'machine in Kiritimati (UTC+14)', env: { TZ: 'Pacific/Kiritimati' } },
    { name: 'clock +30 days', env: { HORARIO_TEST_NOW: iso(now + 30 * DAY) } },
    { name: 'clock +400 days, machine in Sydney', env: { HORARIO_TEST_NOW: iso(now + 400 * DAY), TZ: 'Australia/Sydney' } },
    // 01:30 local on the US fall-back night of 2027 (the hour happens twice).
    { name: 'clock on a US fall-back night, machine in New York', env: { HORARIO_TEST_NOW: '2027-11-07T05:30:00Z', TZ: 'America/New_York' } },
  ];
}

function run(extraArgs) {
  const jest = require.resolve('jest/bin/jest');
  const results = [];
  for (const s of scenarios()) {
    const started = Date.now();
    process.stdout.write(`\n▶ ${s.name}  (${Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(' ')})\n`);
    const r = spawnSync(process.execPath, [jest, '--ci', '--silent', ...extraArgs], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, ...s.env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    const summary = (out.match(/^Tests:.*$/m) || ['Tests: (no summary; jest did not finish)'])[0];
    const failing = [...new Set(out.split('\n').filter((l) => /^\s+● .+ › /.test(l)).map((l) => l.trim()))];
    results.push({ ...s, ok: r.status === 0, summary, failing, seconds: Math.round((Date.now() - started) / 1000) });
    process.stdout.write(`  ${r.status === 0 ? '✓' : '✗'} ${summary} (${Math.round((Date.now() - started) / 1000)} s)\n`);
    if (r.status !== 0) {
      // Full output of a failing scenario, so the diagnostic is in the log.
      process.stdout.write(out.split('\n').filter((l) => !/^\s+at /.test(l)).join('\n'));
    }
  }
  const bad = results.filter((r) => !r.ok);
  process.stdout.write('\n── Drift summary ──\n');
  for (const r of results) process.stdout.write(`${r.ok ? '✓' : '✗'} ${r.name}: ${r.summary}\n`);
  if (bad.length) {
    process.stdout.write(`\n${bad.length} scenario(s) failed. A test that passes in UTC today and fails here depends on the clock or the machine's zone:\n`);
    for (const r of bad) {
      process.stdout.write(`\n  ${r.name} (${Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join(' ')}):\n`);
      for (const f of r.failing) process.stdout.write(`    ${f}\n`);
    }
    process.stdout.write('\nReproduce one with the same variables, e.g. `HORARIO_TEST_NOW=… TZ=… npx jest <file>`. Fix the code to use the business zone, or pin the test\'s clock (jest.useFakeTimers({ now })) to the date its fixtures are built around.\n');
  }
  return bad.length ? 1 : 0;
}

module.exports = { scenarios };

if (require.main === module) process.exit(run(process.argv.slice(2)));
