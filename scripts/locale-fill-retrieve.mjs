/**
 * locale-fill-retrieve.mjs — CHG-057 (retrieval + merge)
 *
 * Polls the Batch API, retrieves results, and merges translated keys
 * back into each locale TS file.
 *
 * Usage:
 *   node --env-file=.env.local scripts/locale-fill-retrieve.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const client = new Anthropic();

// ---------------------------------------------------------------------------
// Merge helper — inserts a flat key like "common.copyToClipboard" into a
// TS locale file by finding the right section and inserting before its
// closing brace.
// ---------------------------------------------------------------------------

/**
 * Given locale TS file content and a flat dot-key + translated value,
 * insert the key into the correct section.
 *
 * Strategy:
 *   - Split key into [section, ...rest]
 *   - Find the outermost object key matching `section:` or `  section: {`
 *   - Walk into nested objects for multi-level keys
 *   - Insert the leaf key-value pair before the closing `},` or `}` of its parent
 */
function insertKey(content, dotKey, value) {
  const parts = dotKey.split('.');
  // We need to insert `leaf: 'value',` inside the parent object path
  const leaf = parts[parts.length - 1];
  const parents = parts.slice(0, -1);

  // Escape special regex chars in value for the check
  const escapedValue = value.toString().replace(/'/g, "\\'");
  const leafLine = `    ${leaf}: '${escapedValue}',`;

  // Check if key already exists (avoid duplicates)
  const leafPattern = new RegExp(`\\b${leaf}:\\s*['\`]`);
  if (leafPattern.test(content)) return content; // already present

  // Navigate to the correct nesting location.
  // We'll use a simple line-by-line approach to find the insertion point.
  const lines = content.split('\n');

  // Find the line index where the parent chain terminates (the closing `},`)
  // by walking section by section.
  let depth = 0;
  let inTarget = false;
  let targetDepth = 0;
  let insertAfterLine = -1;
  let currentPath = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect opening of a named object
    const openMatch = line.match(/^\s+([\w]+):\s*\{/);
    if (openMatch) {
      currentPath.push(openMatch[1]);
      depth++;

      // Check if we're at the target parent path
      if (JSON.stringify(currentPath) === JSON.stringify(parents)) {
        targetDepth = depth;
        inTarget = true;
      }
    }

    // Detect closing brace
    const closeMatch = line.match(/^\s+\},?$/);
    if (closeMatch && depth > 0) {
      if (inTarget && depth === targetDepth) {
        // Insert before this closing brace
        insertAfterLine = i;
        inTarget = false;
      }
      currentPath.pop();
      depth--;
    }
  }

  if (insertAfterLine === -1) {
    // Fallback: append before last `},` or `}` at module level
    console.warn(`  ⚠ Could not find insertion point for ${dotKey}, using fallback`);
    // Find last occurrence of the top-level section
    const topSection = parents[0];
    let lastIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith(`${topSection}:`)) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1) return content; // Can't find section, skip
    // Find the closing brace after lastIdx
    for (let i = lastIdx; i < lines.length; i++) {
      if (lines[i].match(/^\s+\},?$/)) {
        insertAfterLine = i;
        break;
      }
    }
  }

  if (insertAfterLine === -1) return content;

  // Build indent: match the section's indentation + 2 spaces
  const indent = '    '; // 4 spaces (inner object member)
  const adjustedLeafLine = `${indent}  ${leaf}: '${escapedValue}',`;

  lines.splice(insertAfterLine, 0, adjustedLeafLine);
  return lines.join('\n');
}

function stripFences(text) {
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

async function main() {
  const metaPath = path.join(__dirname, 'locale-fill-batch-id.json');
  if (!fs.existsSync(metaPath)) {
    console.error('locale-fill-batch-id.json not found. Run locale-fill-batch.mjs first.');
    process.exit(1);
  }

  const { batchId } = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  console.log(`Checking batch ${batchId}...`);

  // Poll until ended
  let batch = await client.messages.batches.retrieve(batchId);
  while (batch.processing_status !== 'ended') {
    console.log(`Status: ${batch.processing_status} — waiting 5s...`);
    await new Promise((r) => setTimeout(r, 5000));
    batch = await client.messages.batches.retrieve(batchId);
  }

  console.log(`Batch ended. Counts: ${JSON.stringify(batch.request_counts)}`);

  // Collect all results
  const results = {};
  for await (const item of await client.messages.batches.results(batchId)) {
    if (item.result.type !== 'succeeded') {
      console.warn(`  ✗ ${item.custom_id}: ${item.result.type}`);
      continue;
    }
    const text = stripFences(item.result.message.content[0].text);
    try {
      results[item.custom_id] = JSON.parse(text);
      const locale = item.custom_id.replace('locale-fill-', '');
      console.log(`  ✓ ${locale}: ${Object.keys(results[item.custom_id]).length} keys translated`);
    } catch (e) {
      console.error(`  ✗ ${item.custom_id}: JSON parse failed\n${text.slice(0, 200)}`);
    }
  }

  // Merge translations into each locale file
  for (const [customId, translations] of Object.entries(results)) {
    const locale = customId.replace('locale-fill-', '');
    const filePath = path.join(root, `locales/${locale}.ts`);
    let content = fs.readFileSync(filePath, 'utf-8');

    let inserted = 0;
    for (const [dotKey, value] of Object.entries(translations)) {
      const before = content;
      content = insertKey(content, dotKey, String(value));
      if (content !== before) inserted++;
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ${locale}: ${inserted}/${Object.keys(translations).length} keys merged`);
  }

  console.log('\nDone. Re-running audit...');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
