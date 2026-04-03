/**
 * retrieve-batch1-fritetlswhi.mjs
 * Retrieve batch1 results (101-key translations for fr/it/sw/tl/hi)
 * and save to scripts/batch1-results.json
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = 'msgbatch_017jDn9PLKec93kvJGg3qmQ5';

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

const localeResults = { fr: {}, it: {}, sw: {}, tl: {}, hi: {} };

for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`${result.custom_id} failed: ${result.result.type}`);
    continue;
  }
  // Custom IDs are like "fill-fr-0" or "fill-fr"
  const match = result.custom_id.match(/^fill-(\w+)(?:-\d+)?$/);
  if (!match) {
    console.warn(`Unexpected custom_id: ${result.custom_id}`);
    continue;
  }
  const locale = match[1];
  if (!localeResults[locale]) {
    console.warn(`Unknown locale in custom_id: ${result.custom_id}`);
    continue;
  }
  const text = result.result.message.content[0].text;
  try {
    const parsed = JSON.parse(stripFences(text));
    Object.assign(localeResults[locale], parsed);
    console.log(`✓ ${result.custom_id}: ${Object.keys(parsed).length} keys`);
  } catch (e) {
    console.error(`✗ ${result.custom_id}: parse failed — ${e.message}`);
    console.error('Raw (first 300):', text.slice(0, 300));
  }
}

for (const [locale, keys] of Object.entries(localeResults)) {
  console.log(`  ${locale}: ${Object.keys(keys).length} total keys`);
}

writeFileSync('./scripts/batch1-results.json', JSON.stringify(localeResults, null, 2));
console.log('\nSaved to scripts/batch1-results.json');
