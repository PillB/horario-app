/**
 * locale-fill-batch3.mjs
 * Splits de and zh 130-key batches into two halves (~65 keys each).
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const missing = JSON.parse(readFileSync('./scripts/missing-values-final.json', 'utf8'));

const LANG_NAMES = {
  de: 'German',
  zh: 'Simplified Chinese',
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
  if (!['de', 'zh'].includes(locale)) continue;
  const entries = Object.entries(keys);
  const half = Math.ceil(entries.length / 2);
  const firstHalf = Object.fromEntries(entries.slice(0, half));
  const secondHalf = Object.fromEntries(entries.slice(half));

  requests.push({
    custom_id: `fill-${locale}-a`,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildPrompt(locale, firstHalf) }],
    },
  });
  requests.push({
    custom_id: `fill-${locale}-b`,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildPrompt(locale, secondHalf) }],
    },
  });

  console.log(`${locale}: ${entries.length} keys → split into ${half} + ${entries.length - half}`);
}

console.log(`Submitting ${requests.length} batch requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}`);
writeFileSync('./scripts/batch3-id.txt', batch.id);
console.log('Batch ID saved to scripts/batch3-id.txt');
