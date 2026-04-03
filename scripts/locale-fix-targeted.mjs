/**
 * locale-fix-targeted.mjs
 * Insert specific missing keys into exact parent sections,
 * bypassing the leafExists check that was causing false-positives.
 */
import { readFileSync, writeFileSync } from 'fs';

const batch1 = JSON.parse(readFileSync('./scripts/batch1-results.json', 'utf8'));
const batch2 = JSON.parse(readFileSync('./scripts/batch2-results.json', 'utf8'));

function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert key:value into the named section, finding the section's closing }
 * and inserting before it (with comma check).
 */
function insertIntoSection(content, sectionKey, newKey, newValue) {
  // Find the section — use word boundary but also handle nested matches
  // We want the FIRST occurrence for top-level sections
  const sectionPattern = new RegExp(`\\b${escapeRegex(sectionKey)}\\s*:\\s*\\{`);
  const match = sectionPattern.exec(content);
  if (!match) return null;

  let depth = 1, pos = match.index + match[0].length;
  const sectionStart = pos;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  const sectionEnd = pos; // closing }

  // Find last non-whitespace inside section
  let insertAt = sectionEnd;
  while (insertAt > sectionStart && /\s/.test(content[insertAt - 1])) insertAt--;

  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';
  // Determine indentation from the section key
  const lineStart = content.lastIndexOf('\n', match.index) + 1;
  const sectionIndent = match.index - lineStart;
  const keyIndent = ' '.repeat(sectionIndent + 2);

  const insertion = `${prefix}\n${keyIndent}${newKey}: ${escapeValue(newValue)}`;
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

// Keys to insert with their exact parent section
const FIXES_FRITETLSWHI = [
  { section: 'workers', key: 'addCardTooltip', enKey: 'scheduler.workers.addCardTooltip' },
  { section: 'templates', key: 'addedSuccess', enKey: 'scheduler.templates.addedSuccess' },
  { section: 'roster', key: 'maximize', enKey: 'scheduler.roster.maximize' },
  { section: 'roster', key: 'closeFullscreen', enKey: 'scheduler.roster.closeFullscreen' },
  { section: 'roster', key: 'prevWeek', enKey: 'scheduler.roster.prevWeek' },
  { section: 'roster', key: 'nextWeek', enKey: 'scheduler.roster.nextWeek' },
  { section: 'roster', key: 'today', enKey: 'scheduler.roster.today' },
];

const FILES_FRITETLSWHI = {
  fr: 'locales/fr.ts',
  it: 'locales/it.ts',
  sw: 'locales/sw.ts',
  tl: 'locales/tl.ts',
  hi: 'locales/hi.ts',
};

for (const [locale, filePath] of Object.entries(FILES_FRITETLSWHI)) {
  const merged = { ...(batch1[locale] || {}), ...(batch2[locale] || {}) };
  let content = readFileSync(filePath, 'utf8');
  let inserted = 0;
  const failed = [];

  for (const { section, key, enKey } of FIXES_FRITETLSWHI) {
    const value = merged[enKey];
    if (!value) { failed.push(enKey + ' (no translation)'); continue; }

    const nc = insertIntoSection(content, section, key, value);
    if (nc) {
      content = nc;
      inserted++;
    } else {
      failed.push(enKey + ' (section not found)');
    }
  }

  writeFileSync(filePath, content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length > 0) console.warn(`  ${locale}: failed:`, failed);
}

console.log('\nDone. Run locale-audit.mjs to verify.');
