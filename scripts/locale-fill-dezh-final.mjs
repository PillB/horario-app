/**
 * locale-fill-dezh-final.mjs
 * Submit batch for de/zh 22 missing keys, split into small chunks.
 * Keys are split into 4 chunks per locale to avoid truncation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';

const client = new Anthropic();

// The 22 missing keys with their English values
const missingKeys = {
  'scheduler.jumpToCalendar': 'View Calendar ↓',
  'scheduler.workers.addCardTooltip': 'Fill in the worker\'s name, role (e.g. "Barista"), and any skills (comma-separated). Their ID is auto-generated. After saving, scroll to "Availability intake" to set when they can work.',
  'scheduler.templates.addedSuccess': '{name} added — set their availability to enable shift scheduling.',
  'scheduler.templates.addCardTooltip': 'Give the template a name (e.g. "Morning"), select a role, set the time window (24h format), and enter the minimum number of workers needed. Templates are the building blocks of auto-assign.',
  'scheduler.demand.forecastRunning': 'Running…',
  'scheduler.demand.forecastWaiting': 'Waiting for edits…',
  'scheduler.demand.forecastNeedInput': 'Add date & role to forecast',
  'scheduler.demand.forecastHelperInvalid': 'Enter a valid YYYY-MM-DD date and role to generate a forecast.',
  'scheduler.demand.forecastHelperNoData': 'No historical shifts or external signals found. Use quick setup to seed demand targets.',
  'scheduler.demand.forecastHelperApiDown': 'Forecast API unavailable. Use quick setup or manual targets to proceed.',
  'scheduler.demand.forecastHelperPending': 'Waiting for input to settle before forecasting…',
  'scheduler.demand.forecastHelperRunning': 'Running forecast...',
  'scheduler.demand.forecastHelperReady': 'Ready to run forecast with today\'s signals.',
  'scheduler.demand.beforeForecast': 'Before forecast',
  'scheduler.demand.afterForecast': 'After forecast',
  'scheduler.demand.sourceLabelModel': 'AI forecast',
  'scheduler.demand.sourceLabelOverride': 'Manual entry',
  'scheduler.demand.sourceLabelPos': 'POS import',
  'scheduler.demand.sourceLabelFallback': 'Quick setup',
  'scheduler.demand.posTargetsSaved': '{n} demand targets saved from POS data.',
  'scheduler.demand.posTab': 'POS Import',
  'scheduler.demand.posRole': 'Assign to role',
};

const allKeys = Object.keys(missingKeys);
// Split into 4 chunks of ~5-6 keys each
const CHUNK_SIZE = 6;
const chunks = [];
for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
  chunks.push(allKeys.slice(i, i + CHUNK_SIZE));
}

console.log(`Submitting ${chunks.length} chunks × 2 locales = ${chunks.length * 2} requests`);

const LANG_NAMES = { de: 'German', zh: 'Chinese (Simplified)' };
const requests = [];

for (const locale of ['de', 'zh']) {
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const keyValues = chunk.map(k => `  "${k}": ${JSON.stringify(missingKeys[k])}`).join(',\n');
    requests.push({
      custom_id: `dezh-final-${locale}-${ci}`,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Translate these UI strings from English to ${LANG_NAMES[locale]}. Return ONLY a JSON object with the same keys, natural ${LANG_NAMES[locale]} translations. Keep {placeholders} unchanged. No markdown fences.\n\n{\n${keyValues}\n}`,
        }],
      },
    });
  }
}

const batch = await client.messages.batches.create({ requests });
console.log('Batch ID:', batch.id);
console.log('Status:', batch.processing_status);
writeFileSync('./scripts/dezh-final-batch-id.txt', batch.id);
console.log('\nRun locale-fill-dezh-final-retrieve.mjs when done.');
