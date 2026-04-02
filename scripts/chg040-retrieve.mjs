/**
 * CHG-040 Retrieve & Write Script
 * Polls for batch completion, then writes all generated files to disk.
 *
 * Run: node scripts/chg040-retrieve.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

config({ path: resolve(ROOT, '.env.local') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripFences(text) {
  // Remove leading ```lang or ``` fence
  let s = text.replace(/^```[a-zA-Z]*\r?\n/, '').replace(/^```\r?\n/, '');
  // Remove trailing ```
  s = s.replace(/\r?\n```\s*$/, '').replace(/```\s*$/, '');
  return s.trim();
}

// ── load meta ─────────────────────────────────────────────────────────────────

const metaPath = resolve(ROOT, 'scripts/chg040-batch-meta.json');
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const batchId = meta.batchId;

console.log(`Polling batch ${batchId}...`);

// ── poll until done ───────────────────────────────────────────────────────────

let batch;
while (true) {
  batch = await client.messages.batches.retrieve(batchId);
  console.log(`Status: ${batch.processing_status} | processing: ${batch.request_counts.processing} | succeeded: ${batch.request_counts.succeeded} | errored: ${batch.request_counts.errored}`);
  if (batch.processing_status === 'ended') break;
  await new Promise(r => setTimeout(r, 15_000));
}

console.log('\nBatch complete. Writing files...\n');

// ── collect results ───────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type === 'succeeded') {
    const textBlock = result.result.message.content.find(b => b.type === 'text');
    results[result.custom_id] = textBlock?.text ?? '';
  } else {
    console.error(`FAILED: ${result.custom_id} — ${JSON.stringify(result.result)}`);
  }
}

// Save raw results for debugging
writeFileSync(resolve(ROOT, 'scripts/chg040-results.json'), JSON.stringify(results, null, 2));

// ── write files ───────────────────────────────────────────────────────────────

function write(relPath, customId) {
  const raw = results[customId];
  if (!raw) { console.error(`No result for ${customId}`); return; }
  const content = stripFences(raw);
  const absPath = resolve(ROOT, relPath);
  writeFileSync(absPath, content, 'utf8');
  console.log(`  wrote: ${relPath} (${content.length} chars)`);
}

mkdirSync(resolve(ROOT, 'utils'), { recursive: true });

write('utils/posForecasting.ts',                  'change1-posForecasting');
write('components/scheduler/DemandSection.tsx',   'change2-demandSection');
write('components/scheduler/WeekCalendar.tsx',    'change3-weekCalendar');
write('app/(tabs)/scheduler.tsx',                 'change4-scheduler');
write('hooks/useSchedulerHandlers.ts',            'change5-handlers');
write('locales/en.ts',                            'change6-en');
write('locales/es.ts',                            'change7-es');

console.log('\nAll files written. Run npm test && npm run lint to validate.');
