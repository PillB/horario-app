/**
 * locale-fill-dezh-chunk0-retry.mjs
 * Re-translate the 6 keys from chunk0 that had JSON parse failures.
 * Stricter prompt to avoid unescaped quotes in JSON.
 */
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';

const client = new Anthropic();

const chunk0Keys = {
  'scheduler.jumpToCalendar': 'View Calendar ↓',
  'scheduler.workers.addCardTooltip': "Fill in the worker's name, role (e.g. Barista), and any skills (comma-separated). Their ID is auto-generated. After saving, scroll to Availability intake to set when they can work.",
  'scheduler.templates.addedSuccess': '{name} added — set their availability to enable shift scheduling.',
  'scheduler.templates.addCardTooltip': "Give the template a name (e.g. Morning), select a role, set the time window (24h format), and enter the minimum number of workers needed. Templates are the building blocks of auto-assign.",
  'scheduler.demand.forecastRunning': 'Running…',
  'scheduler.demand.forecastWaiting': 'Waiting for edits…',
};

const LANG_NAMES = { de: 'German', zh: 'Chinese (Simplified)' };

const requests = [];
for (const locale of ['de', 'zh']) {
  const keyValues = Object.entries(chunk0Keys)
    .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
    .join(',\n');
  requests.push({
    custom_id: `dezh-c0retry-${locale}`,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Translate these UI strings from English to ${LANG_NAMES[locale]}. CRITICAL: Return ONLY a valid JSON object. All double-quote characters inside string values MUST be escaped as \\". Do NOT use typographic/curly quotes like " " « » „ " in place of standard double quotes within JSON string values — only use escaped \\". Keep {placeholders} unchanged. No markdown fences.\n\n{\n${keyValues}\n}`,
      }],
    },
  });
}

const batch = await client.messages.batches.create({ requests });
console.log('Batch ID:', batch.id);
writeFileSync('./scripts/dezh-c0retry-batch-id.txt', batch.id);
console.log('Run locale-fill-dezh-chunk0-retrieve.mjs when done.');
