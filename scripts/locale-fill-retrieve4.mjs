/**
 * locale-fill-retrieve4.mjs - Retrieve batch4, merge into de/zh
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = readFileSync('./scripts/batch4-id.txt', 'utf8').trim();

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

// Merge all chunk results per locale
const localeResults = { de: {}, zh: {} };
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`${result.custom_id} failed`);
    continue;
  }
  const match = result.custom_id.match(/^fill4-(\w+)-(\d)$/);
  if (!match) continue;
  const locale = match[1];
  const text = result.result.message.content[0].text;
  try {
    const parsed = JSON.parse(stripFences(text));
    Object.assign(localeResults[locale], parsed);
    console.log(`✓ ${result.custom_id}: ${Object.keys(parsed).length} keys`);
  } catch (e) {
    console.error(`✗ ${result.custom_id}: parse failed — ${e.message}`);
    console.error('Raw (first 200):', text.slice(0, 200));
  }
}

writeFileSync('./scripts/batch4-results.json', JSON.stringify(localeResults, null, 2));

// Also load batch3 results (second halves that succeeded)
const batch3 = JSON.parse(readFileSync('./scripts/batch3-results.json', 'utf8'));
// Merge batch3 second halves into localeResults
for (const locale of ['de', 'zh']) {
  if (batch3[locale]) Object.assign(localeResults[locale], batch3[locale]);
}

console.log(`\nTotal keys: de=${Object.keys(localeResults.de).length}, zh=${Object.keys(localeResults.zh).length}`);

// Build nested object from flat dot-notation keys
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

function insertIntoExistingSection(content, sectionKey, subKey, value) {
  const sectionPattern = new RegExp(`\\b${escapeRegex(sectionKey)}\\s*:\\s*\\{`);
  const match = sectionPattern.exec(content);
  if (!match) return null;
  let depth = 1, pos = match.index + match[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  return content.slice(0, pos) + `, ${subKey}: ${escapeValue(value)}` + content.slice(pos);
}

function appendSection(content, sectionKey, sectionObj) {
  const lines = buildObjectLines(sectionObj, 4);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n\n`;
  const lastIdx = content.lastIndexOf('} as const;');
  if (lastIdx === -1) { console.warn('No "} as const;" found'); return content; }
  return content.slice(0, lastIdx) + sectionStr + content.slice(lastIdx);
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
  const lines = buildObjectLines(subObj, 6);
  return content.slice(0, pos) + `,\n    ${subKey}: {\n${lines}\n    }` + content.slice(pos);
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

for (const [locale, translations] of Object.entries(localeResults)) {
  if (Object.keys(translations).length === 0) continue;
  let content = readFileSync(FILES[locale], 'utf8');
  const nested = unflatten(translations);
  let inserted = 0, failed = [];

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
            for (const [leafKey, leafVal] of Object.entries(subVal)) {
              const nc = insertIntoExistingSection(content, subKey, leafKey, String(leafVal));
              if (nc) { content = nc; inserted++; }
              else failed.push(`${topKey}.${subKey}.${leafKey}`);
            }
          }
        } else {
          const nc = insertIntoExistingSection(content, topKey, subKey, String(subVal));
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

console.log('\nDone! Run fix-stray-commas.mjs and locale-audit.mjs to verify.');
