/**
 * locale-fill-fritetlswhi.mjs
 * Merges batch1 (101 keys) + batch2 (65 keys) for fr/it/sw/tl/hi,
 * then does a single clean insertion into each locale file.
 *
 * Key fix: insertSubSection checks for existing trailing comma to avoid double-comma bug.
 */
import { readFileSync, writeFileSync } from 'fs';

const batch1 = JSON.parse(readFileSync('./scripts/batch1-results.json', 'utf8'));
const batch2 = JSON.parse(readFileSync('./scripts/batch2-results.json', 'utf8'));

// Merge: batch2 wins on overlap (newer translations)
const translations = {};
for (const locale of ['fr', 'it', 'sw', 'tl', 'hi']) {
  translations[locale] = { ...(batch1[locale] || {}), ...(batch2[locale] || {}) };
  console.log(`${locale}: ${Object.keys(translations[locale]).length} unique translated keys`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function unflatten(flat) {
  const result = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return result;
}

function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  // Replace literal newlines with \n escape, then escape backslashes and quotes
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
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

/** Append an entirely new top-level section before the final `} as const;` */
function appendSection(content, sectionKey, sectionObj) {
  const lines = buildObjectLines(sectionObj, 4);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n\n`;
  const lastIdx = content.lastIndexOf('} as const;');
  if (lastIdx === -1) { console.warn('No "} as const;" found'); return content; }
  return content.slice(0, lastIdx) + sectionStr + content.slice(lastIdx);
}

/**
 * Insert a sub-section object inside an existing parent section.
 * FIXED: checks for trailing comma to avoid double-comma bug.
 */
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
  // pos is now the index of the closing }

  // Find last non-whitespace before the closing }
  let insertAt = pos;
  while (insertAt > match.index && /\s/.test(content[insertAt - 1])) insertAt--;

  // Only add a comma prefix if the previous non-whitespace char is not already a comma
  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';

  const lines = buildObjectLines(subObj, 6);
  const subsectionStr = `${prefix}\n    ${subKey}: {\n${lines}\n    }`;
  return content.slice(0, insertAt) + subsectionStr + content.slice(insertAt);
}

/**
 * Insert a scalar key into an existing section.
 * Finds the last non-whitespace content in the section and appends after it.
 */
function insertScalarKey(content, sectionKey, newKey, newValue) {
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
  const sectionEnd = pos; // position of closing }

  // Find last non-whitespace before sectionEnd
  let insertAt = sectionEnd;
  while (insertAt > sectionStart && /\s/.test(content[insertAt - 1])) insertAt--;

  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';
  const insertion = `${prefix}\n      ${newKey}: ${escapeValue(newValue)}`;
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

function countLeaves(obj) {
  let count = 0;
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object') count += countLeaves(v);
    else count++;
  }
  return count;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const FILES = {
  fr: 'locales/fr.ts',
  it: 'locales/it.ts',
  sw: 'locales/sw.ts',
  tl: 'locales/tl.ts',
  hi: 'locales/hi.ts',
};

for (const [locale, trans] of Object.entries(translations)) {
  if (Object.keys(trans).length === 0) { console.log(`${locale}: no keys, skipping`); continue; }

  let content = readFileSync(FILES[locale], 'utf8');
  const nested = unflatten(trans);
  let inserted = 0;
  const failed = [];

  for (const [topKey, topVal] of Object.entries(nested)) {
    const sectionExists = new RegExp(`\\b${escapeRegex(topKey)}\\s*:`).test(content);

    if (!sectionExists) {
      content = appendSection(content, topKey, topVal);
      inserted += countLeaves(topVal);
      continue;
    }

    if (topVal !== null && typeof topVal === 'object') {
      for (const [subKey, subVal] of Object.entries(topVal)) {
        if (subVal !== null && typeof subVal === 'object') {
          const subExists = new RegExp(`\\b${escapeRegex(subKey)}\\s*:`).test(content);
          if (!subExists) {
            const nc = insertSubSection(content, topKey, subKey, subVal);
            if (nc) { content = nc; inserted += countLeaves(subVal); }
            else failed.push(`${topKey}.${subKey}`);
          } else {
            // Sub-section exists, insert individual leaves
            for (const [leafKey, leafVal] of Object.entries(subVal)) {
              const leafExists = new RegExp(`\\b${escapeRegex(leafKey)}\\s*:`).test(content);
              if (!leafExists) {
                const nc = insertScalarKey(content, subKey, leafKey, String(leafVal));
                if (nc) { content = nc; inserted++; }
                else failed.push(`${topKey}.${subKey}.${leafKey}`);
              } else {
                // Already exists, skip
              }
            }
          }
        } else {
          const leafExists = new RegExp(`\\b${escapeRegex(subKey)}\\s*:`).test(content);
          if (!leafExists) {
            const nc = insertScalarKey(content, topKey, subKey, String(subVal));
            if (nc) { content = nc; inserted++; }
            else failed.push(`${topKey}.${subKey}`);
          }
        }
      }
    }
  }

  writeFileSync(FILES[locale], content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length > 0) console.warn(`  ${locale}: ${failed.length} failed:`, failed);
}

console.log('\nDone! Run locale-audit.mjs to verify.');
