/**
 * locale-fill-batch4.mjs
 * Re-batches the first halves of de and zh that failed, split into thirds.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const missing = JSON.parse(readFileSync('./scripts/missing-values-final.json', 'utf8'));

const LANG_NAMES = { de: 'German', zh: 'Simplified Chinese' };

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
for (const locale of ['de', 'zh']) {
  const entries = Object.entries(missing[locale]);
  const firstHalf = entries.slice(0, Math.ceil(entries.length / 2));
  const third = Math.ceil(firstHalf.length / 3);

  for (let i = 0; i < 3; i++) {
    const chunk = Object.fromEntries(firstHalf.slice(i * third, (i + 1) * third));
    if (Object.keys(chunk).length === 0) continue;
    requests.push({
      custom_id: `fill4-${locale}-${i}`,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: buildPrompt(locale, chunk) }],
      },
    });
    console.log(`${locale} chunk ${i}: ${Object.keys(chunk).length} keys`);
  }
}

console.log(`Submitting ${requests.length} requests…`);
const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}`);
writeFileSync('./scripts/batch4-id.txt', batch.id);
