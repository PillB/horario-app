/**
 * inject-pos-section.mjs
 * Appends scheduler.pos sub-section to fr/it/sw/tl/hi using batch2-results.json translations.
 */
import { readFileSync, writeFileSync } from 'fs';

const batch2 = JSON.parse(readFileSync('./scripts/batch2-results.json', 'utf8'));

function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function buildObjectLines(obj, indent) {
  const lines = [];
  const spaces = ' '.repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const nested = buildObjectLines(v, indent + 2);
      lines.push(`${spaces}${k}: {\n${nested}\n${spaces}},`);
    } else {
      lines.push(`${spaces}${k}: ${escapeValue(v)},`);
    }
  }
  return lines.join('\n');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertSubSection(content, parentKey, subKey, subObj) {
  const parentPattern = new RegExp(`\\b${escapeRegex(parentKey)}\\s*:\\s*\\{`);
  const match = parentPattern.exec(content);
  if (!match) return null;
  let depth = 1, pos = match.index + match[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  // Find last non-whitespace before pos to insert comma after it
  let insertAt = pos;
  while (insertAt > match.index && /\s/.test(content[insertAt - 1])) insertAt--;

  const lines = buildObjectLines(subObj, 6);
  const subsectionStr = `,\n    ${subKey}: {\n${lines}\n    }`;
  return content.slice(0, insertAt) + subsectionStr + content.slice(insertAt);
}

const LOCALES = ['fr', 'it', 'sw', 'tl', 'hi'];

for (const locale of LOCALES) {
  const trans = batch2[locale];
  if (!trans) { console.log(`${locale}: no batch2 results`); continue; }

  // Extract scheduler.pos.* keys
  const posKeys = Object.entries(trans)
    .filter(([k]) => k.startsWith('scheduler.pos.'));

  if (posKeys.length === 0) { console.log(`${locale}: no pos keys in batch2`); continue; }

  // Build pos object
  const posObj = {};
  for (const [k, v] of posKeys) {
    const leafKey = k.replace('scheduler.pos.', '');
    posObj[leafKey] = v;
  }

  const file = `locales/${locale}.ts`;
  let content = readFileSync(file, 'utf8');

  const nc = insertSubSection(content, 'scheduler', 'pos', posObj);
  if (nc) {
    writeFileSync(file, nc);
    console.log(`✓ ${locale}: injected pos section with ${posKeys.length} keys`);
  } else {
    console.warn(`✗ ${locale}: could not find scheduler: section`);
  }
}

console.log('Done.');
