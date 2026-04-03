/**
 * locale-fill-batch.mjs — CHG-057
 *
 * Uses Anthropic Batch API (claude-sonnet-4-6, 50% off) to translate all
 * missing locale keys for 8 non-English locales.
 *
 * Input:  scripts/missing-en-values.json   (produced by locale-audit.mjs)
 * Output: scripts/locale-fill-batch-id.json  (batch ID for retrieval)
 *
 * Usage:
 *   node --env-file=.env.local scripts/locale-fill-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const client = new Anthropic();

const LOCALE_NAMES = {
  es: 'Spanish (Latin American, informal tú register)',
  de: 'German (formal Sie register, B2B scheduling context)',
  fr: 'French (formal vous register)',
  it: 'Italian (formal Lei register)',
  zh: 'Simplified Chinese (Mainland China, professional context)',
  sw: 'Swahili (East African — Kenya/Tanzania register)',
  tl: 'Tagalog / Filipino (formal register)',
  hi: 'Hindi (formal आप register, Indian professional context)',
};

const missing = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'missing-en-values.json'), 'utf-8')
);

function buildPrompt(locale, missingPairs) {
  const langName = LOCALE_NAMES[locale];
  const pairsJson = JSON.stringify(missingPairs, null, 2);

  return `You are translating UI strings for a scheduling/shift-management app called Horario into ${langName}.

## Context
- App domain: employee scheduling, shift management, demand forecasting, team management
- Audience: small-to-medium business managers and hourly workers
- Tone: professional but approachable, clear, action-oriented
- Technical terms to keep in English as-is: "POS", "CSV", "roster", "AI", "QSR"
- Preserve ALL {variable} placeholders exactly as-is (e.g. {name}, {n}, {from}, {to}, {date})
- Preserve emojis exactly as-is

## English source keys to translate

${pairsJson}

## Instructions

Return ONLY a valid JSON object where:
- Keys are the exact dot-notation strings from above (unchanged)
- Values are your ${langName} translations

Example shape:
{
  "common.copyToClipboard": "translated string",
  "scheduler.demand.forecastRunning": "translated string"
}

Important:
- "POS" stays as "POS"
- "CSV" stays as "CSV"
- Day abbreviations in DAY_INVALID error: use the locale's own 3-letter day abbreviations (Mon→Lun/Lun/Lun/周一/Jua/Lun/Lun etc.)
- Time format in time errors: keep "HH:MM" pattern and example "09:00"
- ${locale === 'de' ? 'Use formal Sie throughout (e.g., "Ihrer" not "deiner")' : ''}
- ${locale === 'es' ? 'Use informal tú throughout (e.g., "tu" not "su")' : ''}
- Return ONLY the JSON object, no markdown fences, no explanation`;
}

async function main() {
  const requests = [];

  for (const [locale, pairs] of Object.entries(missing)) {
    if (Object.keys(pairs).length === 0) continue;

    requests.push({
      custom_id: `locale-fill-${locale}`,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: buildPrompt(locale, pairs),
          },
        ],
      },
    });
  }

  console.log(`Submitting ${requests.length} batch requests...`);
  for (const r of requests) {
    const keyCount = Object.keys(missing[r.custom_id.replace('locale-fill-', '')]).length;
    console.log(`  ${r.custom_id}: ${keyCount} keys`);
  }

  const batch = await client.messages.batches.create({ requests });
  console.log(`\nBatch created: ${batch.id}`);
  console.log(`Status: ${batch.processing_status}`);
  console.log(`Expires: ${batch.expires_at}`);

  const metaPath = path.join(__dirname, 'locale-fill-batch-id.json');
  fs.writeFileSync(metaPath, JSON.stringify({ batchId: batch.id, createdAt: new Date().toISOString() }, null, 2));
  console.log(`\nBatch ID saved to scripts/locale-fill-batch-id.json`);
  console.log(`Run: node --env-file=.env.local scripts/locale-fill-retrieve.mjs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
