/**
 * locale-fill-retrieve3.mjs
 * Retrieves de/zh split batch results, merges them, then appends complete sections to locale files.
 * Strategy: Since de/zh have large gaps, we append ALL missing sections as new top-level objects.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = readFileSync('./scripts/batch3-id.txt', 'utf8').trim();

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

// Retrieve and merge the split results
const localeResults = { de: {}, zh: {} };
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`Request ${result.custom_id} failed`);
    continue;
  }
  const [, locale] = result.custom_id.match(/^fill-(\w+)-[ab]$/);
  const text = result.result.message.content[0].text;
  try {
    const parsed = JSON.parse(stripFences(text));
    Object.assign(localeResults[locale], parsed);
    console.log(`✓ ${result.custom_id}: ${Object.keys(parsed).length} keys`);
  } catch (e) {
    console.error(`✗ ${result.custom_id}: JSON parse failed — ${e.message}`);
    console.error('Raw (first 300 chars):', text.slice(0, 300));
  }
}

writeFileSync('./scripts/batch3-results.json', JSON.stringify(localeResults, null, 2));

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

// Strategy: For each missing key in de/zh, either insert into existing section or append new section
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertIntoExistingSection(content, sectionKey, subKey, value) {
  // Find the section and insert subKey into it
  const sectionPattern = new RegExp(`\\b${escapeRegex(sectionKey)}\\s*:\\s*\\{`);
  const match = sectionPattern.exec(content);
  if (!match) return null;

  let depth = 1;
  let pos = match.index + match[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }

  const insertion = `, ${subKey}: ${escapeValue(value)}`;
  return content.slice(0, pos) + insertion + content.slice(pos);
}

function appendSection(content, sectionKey, sectionObj) {
  const lines = buildObjectLines(sectionObj, 4);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n\n`;
  const marker = '} as const;';
  const lastIdx = content.lastIndexOf(marker);
  if (lastIdx === -1) { console.warn(`No "} as const;" found`); return content; }
  return content.slice(0, lastIdx) + sectionStr + content.slice(lastIdx);
}

function insertSubSection(content, parentKey, subKey, subObj) {
  // Insert a sub-object into an existing parent section
  const parentPattern = new RegExp(`\\b${escapeRegex(parentKey)}\\s*:\\s*\\{`);
  const match = parentPattern.exec(content);
  if (!match) return null;

  let depth = 1;
  let pos = match.index + match[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }

  const lines = buildObjectLines(subObj, 6);
  const insertion = `,\n    ${subKey}: {\n${lines}\n    }`;
  return content.slice(0, pos) + insertion + content.slice(pos);
}

const FILES = { de: 'locales/de.ts', zh: 'locales/zh.ts' };

for (const [locale, translations] of Object.entries(localeResults)) {
  if (Object.keys(translations).length === 0) {
    console.log(`${locale}: no translations`);
    continue;
  }

  let content = readFileSync(FILES[locale], 'utf8');
  const nested = unflatten(translations);
  let inserted = 0;
  let failed = [];

  for (const [topKey, topVal] of Object.entries(nested)) {
    const sectionExists = new RegExp(`\\b${escapeRegex(topKey)}\\s*:`).test(content);

    if (!sectionExists) {
      // Append entire section
      content = appendSection(content, topKey, topVal);
      inserted += countLeaves(topVal);
      continue;
    }

    if (topVal !== null && typeof topVal === 'object') {
      for (const [subKey, subVal] of Object.entries(topVal)) {
        if (subVal !== null && typeof subVal === 'object') {
          // Sub-section (e.g. errors.validation, scheduler.pos)
          const subSectionPattern = new RegExp(`\\b${escapeRegex(subKey)}\\s*:`);
          if (!subSectionPattern.test(content)) {
            // Append sub-section into parent
            const newContent = insertSubSection(content, topKey, subKey, subVal);
            if (newContent) {
              content = newContent;
              inserted += countLeaves(subVal);
            } else {
              failed.push(`${topKey}.${subKey}`);
            }
          } else {
            // Sub-section exists, insert leaf keys
            for (const [leafKey, leafVal] of Object.entries(subVal)) {
              const newContent = insertIntoExistingSection(content, subKey, leafKey, String(leafVal));
              if (newContent) {
                content = newContent;
                inserted++;
              } else {
                failed.push(`${topKey}.${subKey}.${leafKey}`);
              }
            }
          }
        } else {
          // Scalar key in existing section
          const newContent = insertIntoExistingSection(content, topKey, subKey, String(subVal));
          if (newContent) {
            content = newContent;
            inserted++;
          } else {
            failed.push(`${topKey}.${subKey}`);
          }
        }
      }
    }
  }

  writeFileSync(FILES[locale], content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length > 0) {
    console.warn(`  ${locale}: ${failed.length} failed:`, failed.slice(0, 5));
  }
}

function countLeaves(obj) {
  let count = 0;
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object') count += countLeaves(v);
    else count++;
  }
  return count;
}

console.log('\nDone! Run fix-stray-commas.mjs and then locale-audit.mjs to verify.');
