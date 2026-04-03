import { createRequire } from 'module';
import { writeFileSync } from 'fs';

// Dynamically import TypeScript locale files via tsx
import { createServer } from 'net';

// Use dynamic import with tsx loader
const { en } = await import('../locales/en.ts');
const report = JSON.parse(await (await import('fs')).promises.readFile('./scripts/locale-audit-report.json', 'utf8'));

function flatten(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flatten(v, full));
    } else {
      result[full] = v;
    }
  }
  return result;
}

const flat = flatten(en);
writeFileSync('./scripts/en-flat.json', JSON.stringify(flat, null, 2));

// Build per-locale missing key→value map
const result = {};
for (const [locale, keys] of Object.entries(report.byLocale)) {
  if (!Array.isArray(keys) || keys.length === 0) continue;
  result[locale] = {};
  for (const key of keys) {
    result[locale][key] = flat[key] ?? null;
  }
}
writeFileSync('./scripts/missing-values-final.json', JSON.stringify(result, null, 2));
console.log('Done. Missing values written to scripts/missing-values-final.json');
for (const [locale, keys] of Object.entries(result)) {
  console.log(`  ${locale}: ${Object.keys(keys).length} keys`);
}
