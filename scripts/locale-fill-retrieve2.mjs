/**
 * locale-fill-retrieve2.mjs
 * Polls batch, retrieves translations, writes them directly into locale TS files.
 * Strategy: for each key, find the correct parent object in the locale file and insert there.
 * If the parent section doesn't exist yet, append it as a new top-level section.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = readFileSync('./scripts/batch2-id.txt', 'utf8').trim();

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

// Poll until complete
async function waitForBatch() {
  while (true) {
    const batch = await client.messages.batches.retrieve(batchId);
    console.log(`Status: ${batch.processing_status} (${batch.request_counts.succeeded} succeeded, ${batch.request_counts.processing} processing, ${batch.request_counts.errored} errored)`);
    if (batch.processing_status === 'ended') break;
    await new Promise(r => setTimeout(r, 5000));
  }
}

await waitForBatch();

// Retrieve results
const results = {};
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`Request ${result.custom_id} failed:`, result.result);
    continue;
  }
  const locale = result.custom_id.replace('fill-', '');
  const text = result.result.message.content[0].text;
  try {
    const parsed = JSON.parse(stripFences(text));
    results[locale] = parsed;
    console.log(`✓ ${locale}: ${Object.keys(parsed).length} keys parsed`);
  } catch (e) {
    console.error(`✗ ${locale}: JSON parse failed — ${e.message}`);
    console.error('Raw response (first 500 chars):', text.slice(0, 500));
  }
}

writeFileSync('./scripts/batch2-results.json', JSON.stringify(results, null, 2));
console.log('\nResults saved to scripts/batch2-results.json');

// Now merge into locale files
// The merge strategy: inject each key at the right nesting level using string manipulation
const LOCALE_FILES = {
  es: 'locales/es.ts',
  de: 'locales/de.ts',
  fr: 'locales/fr.ts',
  it: 'locales/it.ts',
  zh: 'locales/zh.ts',
  sw: 'locales/sw.ts',
  tl: 'locales/tl.ts',
  hi: 'locales/hi.ts',
};

// Build a nested object from flat dot-notation keys
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

// Escape a value for inline TS object literal insertion
function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  // Use single quotes, escaping any single quotes in the string
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// Insert a single key=value into a parent object in the TS file content
// parentPath: e.g. ['scheduler', 'demand'] — the path of object keys to navigate
// key: the final key name
// value: string value
function insertKey(content, parentPath, key, value) {
  // Find the opening of the parent object by walking the path
  // Strategy: find each key in the path sequentially, then find a good insertion point

  let searchPos = 0;
  for (const pathKey of parentPath) {
    // Find "pathKey: {" or "pathKey:{" at some position after searchPos
    const pattern = new RegExp(`\\b${escapeRegex(pathKey)}\\s*:\\s*\\{`, 'g');
    pattern.lastIndex = searchPos;
    const match = pattern.exec(content);
    if (!match) {
      return null; // path not found
    }
    searchPos = match.index + match[0].length;
  }

  // Now searchPos is right after the opening brace of the parent object
  // Find a good insertion point: just before the closing } of this object
  // We need to find the matching closing brace
  let depth = 1;
  let pos = searchPos;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  // pos now points to the closing } of parent object
  // Find the last non-whitespace character before pos
  let insertAt = pos;
  // We'll insert ", key: 'value'" before the closing }
  const insertion = `, ${key}: ${escapeValue(value)}`;
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Append a new top-level section to the locale file
function appendSection(content, sectionKey, sectionObj) {
  // Build the section as a TS object literal
  const lines = buildObjectLines(sectionObj, 2);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n`;
  // Insert before the last "} as const;"
  const marker = '} as const;';
  const lastIdx = content.lastIndexOf(marker);
  if (lastIdx === -1) {
    console.warn(`Could not find "} as const;" in file`);
    return content;
  }
  return content.slice(0, lastIdx) + sectionStr + '\n' + content.slice(lastIdx);
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

// Merge results into each locale file
for (const [locale, translations] of Object.entries(results)) {
  const filePath = LOCALE_FILES[locale];
  if (!filePath) continue;

  let content = readFileSync(filePath, 'utf8');
  const nested = unflatten(translations);

  let insertedCount = 0;
  let failedKeys = [];

  // Process each top-level section in the translations
  for (const [topKey, topVal] of Object.entries(nested)) {
    if (topVal !== null && typeof topVal === 'object') {
      // Check if this top-level section already exists in the file
      const sectionPattern = new RegExp(`\\b${escapeRegex(topKey)}\\s*:\\s*\\{`);
      if (!sectionPattern.test(content)) {
        // Section doesn't exist — append the entire section
        content = appendSection(content, topKey, topVal);
        insertedCount += countLeaves(topVal);
        console.log(`  ${locale}: appended new section '${topKey}'`);
      } else {
        // Section exists — insert each key individually
        for (const [subKey, subVal] of Object.entries(topVal)) {
          if (subVal !== null && typeof subVal === 'object') {
            // nested sub-object (e.g. errors.validation.*)
            for (const [leafKey, leafVal] of Object.entries(subVal)) {
              const newContent = insertKey(content, [topKey, subKey], leafKey, leafVal);
              if (newContent) {
                content = newContent;
                insertedCount++;
              } else {
                // Sub-section doesn't exist — need to add it
                // Find parent section and append sub-object
                failedKeys.push(`${topKey}.${subKey}.${leafKey}`);
              }
            }
          } else {
            const newContent = insertKey(content, [topKey], subKey, subVal);
            if (newContent) {
              content = newContent;
              insertedCount++;
            } else {
              failedKeys.push(`${topKey}.${subKey}`);
            }
          }
        }
      }
    } else {
      // Top-level scalar key
      const newContent = insertKey(content, [], topKey, topVal);
      if (newContent) {
        content = newContent;
        insertedCount++;
      } else {
        failedKeys.push(topKey);
      }
    }
  }

  writeFileSync(filePath, content);
  console.log(`✓ ${locale}: ${insertedCount} keys inserted`);
  if (failedKeys.length > 0) {
    console.warn(`  ${locale}: ${failedKeys.length} keys failed:`, failedKeys.slice(0, 10));
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

console.log('\nDone! Run locale-audit.mjs to verify.');
