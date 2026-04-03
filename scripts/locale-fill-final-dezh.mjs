/**
 * locale-fill-final-dezh.mjs
 * Builds the complete translation set for de and zh from all batch results,
 * then does a single clean insertion into each locale file.
 */
import { readFileSync, writeFileSync } from 'fs';

// Collect all successful batch results for de and zh
const batch3 = JSON.parse(readFileSync('./scripts/batch3-results.json', 'utf8'));
const batch4 = JSON.parse(readFileSync('./scripts/batch4-results.json', 'utf8'));

// Merge batch3 (second halves) + batch4 (from chunks 0 and 2 of first half)
const translations = {
  de: { ...batch3.de, ...batch4.de },
  zh: { ...batch3.zh, ...batch4.zh },
};

for (const [locale, t] of Object.entries(translations)) {
  console.log(`${locale}: ${Object.keys(t).length} unique translated keys`);
}

// Also check what's still missing after these translations
const missing = JSON.parse(readFileSync('./scripts/missing-values-final.json', 'utf8'));
for (const locale of ['de', 'zh']) {
  const still = Object.keys(missing[locale]).filter(k => !translations[locale][k]);
  console.log(`${locale}: ${still.length} keys still missing after merge:`, still.slice(0, 5));
}

// ── Merge functions ──────────────────────────────────────────────────────────

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
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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

function appendSection(content, sectionKey, sectionObj) {
  const lines = buildObjectLines(sectionObj, 4);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n\n`;
  const lastIdx = content.lastIndexOf('} as const;');
  if (lastIdx === -1) { console.warn('No "} as const;" found'); return content; }
  return content.slice(0, lastIdx) + sectionStr + content.slice(lastIdx);
}

// Insert a sub-section (object) into an existing parent section
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
  const lines = buildObjectLines(subObj, 6);
  const insertion = `,\n    ${subKey}: {\n${lines}\n    }`;
  return content.slice(0, pos) + insertion + content.slice(pos);
}

// Insert a scalar key into an existing section
// The insertion is done by finding the section's closing } and adding before it,
// but we need to avoid the whitespace-before-brace stray comma problem.
// Instead, we find a good insertion point: the LAST property in the section.
function insertScalarKey(content, sectionKey, newKey, newValue) {
  const sectionPattern = new RegExp(`\\b${escapeRegex(sectionKey)}\\s*:\\s*\\{`);
  const match = sectionPattern.exec(content);
  if (!match) return null;

  // Find the end of the section
  let depth = 1, pos = match.index + match[0].length;
  const sectionStart = pos;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  const sectionEnd = pos; // position of closing }

  // Insert after the last non-whitespace content in the section
  // Find last non-whitespace before sectionEnd
  let insertAt = sectionEnd;
  while (insertAt > sectionStart && /\s/.test(content[insertAt - 1])) {
    insertAt--;
  }

  // Check if we need a comma (if the char before insertAt is not ',')
  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';
  const insertion = `${prefix} ${newKey}: ${escapeValue(newValue)}`;
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

const FILES = { de: 'locales/de.ts', zh: 'locales/zh.ts' };

for (const [locale, trans] of Object.entries(translations)) {
  if (Object.keys(trans).length === 0) continue;

  let content = readFileSync(FILES[locale], 'utf8');
  const nested = unflatten(trans);
  let inserted = 0, failed = [];

  for (const [topKey, topVal] of Object.entries(nested)) {
    const sectionExists = new RegExp(`\\b${escapeRegex(topKey)}\\s*:`).test(content);

    if (!sectionExists) {
      // Append entire section as new block
      content = appendSection(content, topKey, topVal);
      inserted += countLeaves(topVal);
      continue;
    }

    if (topVal !== null && typeof topVal === 'object') {
      for (const [subKey, subVal] of Object.entries(topVal)) {
        if (subVal !== null && typeof subVal === 'object') {
          // Sub-section: check if it exists
          const subExists = new RegExp(`\\b${escapeRegex(subKey)}\\s*:`).test(content);
          if (!subExists) {
            const nc = insertSubSection(content, topKey, subKey, subVal);
            if (nc) { content = nc; inserted += countLeaves(subVal); }
            else failed.push(`${topKey}.${subKey}`);
          } else {
            // Sub-section exists, insert individual leaves
            for (const [leafKey, leafVal] of Object.entries(subVal)) {
              const nc = insertScalarKey(content, subKey, leafKey, String(leafVal));
              if (nc) { content = nc; inserted++; }
              else failed.push(`${topKey}.${subKey}.${leafKey}`);
            }
          }
        } else {
          // Scalar key in existing section
          const nc = insertScalarKey(content, topKey, subKey, String(subVal));
          if (nc) { content = nc; inserted++; }
          else failed.push(`${topKey}.${subKey}`);
        }
      }
    }
  }

  writeFileSync(FILES[locale], content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length > 0) console.warn(`  ${locale}: ${failed.length} failed:`, failed.slice(0, 5));
}

console.log('\nDone! Verify with locale-audit.mjs.');
