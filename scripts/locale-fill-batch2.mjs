/**
 * locale-fill-batch2.mjs
 * Submits Anthropic Batch API requests to translate missing locale keys.
 * Uses max_tokens: 8192 to avoid truncation for large locales.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const missing = JSON.parse(readFileSync('./scripts/missing-values-final.json', 'utf8'));

const LANG_NAMES = {
  es: 'Spanish (Spain/Latin America)',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  zh: 'Simplified Chinese',
  sw: 'Swahili',
  tl: 'Filipino/Tagalog',
  hi: 'Hindi',
};

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

function buildPrompt(locale, keys) {
  const langName = LANG_NAMES[locale];
  const pairs = Object.entries(keys)
    .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
    .join(',\n');

  return `You are a professional translator for a mobile scheduling app called Horario.
Translate the following UI strings from English to ${langName}.
Return ONLY a valid JSON object with the same keys, translated values.
Do NOT include any explanation, markdown, or wrapping text.
Keys with {placeholders} must keep the placeholders unchanged.
Use natural, professional tone appropriate for a workplace scheduling app.
Preserve any emoji characters exactly as-is.

English strings to translate:
{
${pairs}
}`;
}

const requests = [];
for (const [locale, keys] of Object.entries(missing)) {
  if (Object.keys(keys).length === 0) continue;
  requests.push({
    custom_id: `fill-${locale}`,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildPrompt(locale, keys) }],
    },
  });
}

console.log(`Submitting ${requests.length} batch requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}`);
writeFileSync('./scripts/batch2-id.txt', batch.id);
console.log('Batch ID saved to scripts/batch2-id.txt');
