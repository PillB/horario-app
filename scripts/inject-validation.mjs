/**
 * inject-validation.mjs
 * Injects errors.validation sub-object into locale files where it's missing.
 * Also handles de/zh by submitting a split batch for their remaining keys.
 */
import { readFileSync, writeFileSync } from 'fs';

const results = JSON.parse(readFileSync('./scripts/batch2-results.json', 'utf8'));

const LOCALES = ['fr', 'it', 'sw', 'tl', 'hi'];
const FILES = {
  fr: 'locales/fr.ts',
  it: 'locales/it.ts',
  sw: 'locales/sw.ts',
  tl: 'locales/tl.ts',
  hi: 'locales/hi.ts',
};

function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

for (const locale of LOCALES) {
  const translations = results[locale];
  if (!translations) { console.log(`Skipping ${locale} — no results`); continue; }

  const validationKeys = Object.entries(translations)
    .filter(([k]) => k.startsWith('errors.validation.'));

  if (validationKeys.length === 0) { console.log(`${locale}: no validation keys`); continue; }

  let content = readFileSync(FILES[locale], 'utf8');

  // Build the validation sub-object string
  const pairs = validationKeys
    .map(([k, v]) => {
      const leafKey = k.replace('errors.validation.', '');
      return `      ${leafKey}: ${escapeValue(v)}`;
    })
    .join(',\n');

  const validationBlock = `    validation: {\n${pairs},\n    }`;

  // Find the errors: { section and insert validation: before the closing }
  // Find the closing of the errors: object
  const errorsMatch = /\berrors\s*:\s*\{/.exec(content);
  if (!errorsMatch) {
    console.warn(`${locale}: could not find errors: section`);
    continue;
  }

  let depth = 1;
  let pos = errorsMatch.index + errorsMatch[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  // pos now points to the closing } of errors:
  // Insert the validation block just before the closing }
  content = content.slice(0, pos) + ',\n' + validationBlock + ',\n  ' + content.slice(pos);

  writeFileSync(FILES[locale], content);
  console.log(`✓ ${locale}: injected ${validationKeys.length} validation keys`);
}

console.log('Done.');
