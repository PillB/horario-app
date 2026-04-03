/**
 * locale-audit.mjs
 *
 * Recursively diffs all locale files against en.ts (master).
 * Outputs:
 *   scripts/locale-audit-report.json  — missing keys per locale + section summary
 *
 * Usage:
 *   npx tsx scripts/locale-audit.mjs
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Load locales via tsx dynamic import
// ---------------------------------------------------------------------------

const LOCALES = ['en', 'es', 'de', 'fr', 'it', 'zh', 'sw', 'tl', 'hi'];

async function loadLocale(code) {
  const mod = await import(path.join(root, `locales/${code}.ts`));
  // locale files export: export const en = { ... }
  return mod[code] ?? mod.default;
}

// ---------------------------------------------------------------------------
// Flatten a nested object to dot-notation keys
// ---------------------------------------------------------------------------

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const locales = {};
  for (const code of LOCALES) {
    locales[code] = await loadLocale(code);
  }

  const enKeys = new Set(flattenKeys(locales.en));
  console.log(`✓ English master: ${enKeys.size} keys`);

  const report = {
    generated: new Date().toISOString(),
    summary: {},
    byLocale: {},
    bySectionMissingFrom: {},
  };

  for (const code of LOCALES.filter((c) => c !== 'en')) {
    const localeKeys = new Set(flattenKeys(locales[code]));
    const missing = [...enKeys].filter((k) => !localeKeys.has(k));
    report.summary[code] = missing.length;
    report.byLocale[code] = missing;
    console.log(`  ${code}: ${localeKeys.size} keys present, ${missing.length} missing`);
  }

  // Group missing keys by top-level section
  const allMissing = Object.values(report.byLocale).flat();
  const sectionCount = {};
  for (const key of allMissing) {
    const section = key.split('.').slice(0, 2).join('.');
    sectionCount[section] = (sectionCount[section] || []);
    // track which locales miss it
    for (const [code, missing] of Object.entries(report.byLocale)) {
      if (missing.includes(key)) {
        if (!report.bySectionMissingFrom[section]) report.bySectionMissingFrom[section] = new Set();
        report.bySectionMissingFrom[section].add(code);
      }
    }
  }

  // Convert Sets to arrays for JSON serialization
  for (const s of Object.keys(report.bySectionMissingFrom)) {
    report.bySectionMissingFrom[s] = [...report.bySectionMissingFrom[s]];
  }

  const outPath = path.join(__dirname, 'locale-audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to scripts/locale-audit-report.json`);

  // Print section summary
  console.log('\nMissing keys by section (which locales):');
  for (const [section, locales] of Object.entries(report.bySectionMissingFrom)) {
    console.log(`  ${section}: missing from [${locales.join(', ')}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
