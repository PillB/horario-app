/**
 * locale-fill-dezh-final-retrieve.mjs
 * Retrieve the dezh-final batch, merge translations, and apply to de.ts/zh.ts.
 * Uses targeted section insertion to avoid false-positive leafExists issues.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = readFileSync('./scripts/dezh-final-batch-id.txt', 'utf8').trim();

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

// Collect results per locale
const localeResults = { de: {}, zh: {} };
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`${result.custom_id} failed`);
    continue;
  }
  const match = result.custom_id.match(/^dezh-final-(\w+)-(\d+)$/);
  if (!match) { console.warn('Unknown custom_id:', result.custom_id); continue; }
  const locale = match[1];
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
  console.log(`  ${locale}: ${Object.keys(keys).length} keys total`);
}

writeFileSync('./scripts/dezh-final-results.json', JSON.stringify(localeResults, null, 2));

// ── Apply to locale files ─────────────────────────────────────────────────────

function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  const escaped = s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Insert key into a named section. Returns new content or null if section not found. */
function insertIntoSection(content, sectionKey, newKey, newValue) {
  const sectionPattern = new RegExp(`\\b${escapeRegex(sectionKey)}\\s*:\\s*\\{`);
  const match = sectionPattern.exec(content);
  if (!match) return null;

  let depth = 1, pos = match.index + match[0].length;
  const sectionStart = pos;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }
  const sectionEnd = pos;

  let insertAt = sectionEnd;
  while (insertAt > sectionStart && /\s/.test(content[insertAt - 1])) insertAt--;

  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';

  const lineStart = content.lastIndexOf('\n', match.index) + 1;
  const sectionIndent = match.index - lineStart;
  const keyIndent = ' '.repeat(sectionIndent + 2);

  const insertion = `${prefix}\n${keyIndent}${newKey}: ${escapeValue(newValue)}`;
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

/** Insert a sub-section object into a parent section. Fixed double-comma. */
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

function insertSubSection(content, parentKey, subKey, subObj) {
  const parentPattern = new RegExp(`\\b${escapeRegex(parentKey)}\\s*:\\s*\\{`);
  const match = parentPattern.exec(content);
  if (!match) return null;

  let depth = 1, pos = match.index + match[0].length;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    if (depth > 0) pos++;
  }

  let insertAt = pos;
  while (insertAt > match.index && /\s/.test(content[insertAt - 1])) insertAt--;

  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';
  const lines = buildObjectLines(subObj, 6);
  const subsectionStr = `${prefix}\n    ${subKey}: {\n${lines}\n    }`;
  return content.slice(0, insertAt) + subsectionStr + content.slice(insertAt);
}

function appendSection(content, sectionKey, sectionObj) {
  const lines = buildObjectLines(sectionObj, 4);
  const sectionStr = `  ${sectionKey}: {\n${lines}\n  },\n\n`;
  const lastIdx = content.lastIndexOf('} as const;');
  if (lastIdx === -1) { console.warn('No "} as const;" found'); return content; }
  return content.slice(0, lastIdx) + sectionStr + content.slice(lastIdx);
}

// Mapping of dot-key to {parentSection, key} for targeted insertion
const TARGETED_INSERTS = [
  { dotKey: 'scheduler.jumpToCalendar', section: 'scheduler', key: 'jumpToCalendar' },
  { dotKey: 'scheduler.workers.addCardTooltip', section: 'workers', key: 'addCardTooltip' },
  { dotKey: 'scheduler.templates.addedSuccess', section: 'templates', key: 'addedSuccess' },
  { dotKey: 'scheduler.templates.addCardTooltip', section: 'templates', key: 'addCardTooltip' },
  { dotKey: 'scheduler.demand.forecastRunning', section: 'demand', key: 'forecastRunning' },
  { dotKey: 'scheduler.demand.forecastWaiting', section: 'demand', key: 'forecastWaiting' },
  { dotKey: 'scheduler.demand.forecastNeedInput', section: 'demand', key: 'forecastNeedInput' },
  { dotKey: 'scheduler.demand.forecastHelperInvalid', section: 'demand', key: 'forecastHelperInvalid' },
  { dotKey: 'scheduler.demand.forecastHelperNoData', section: 'demand', key: 'forecastHelperNoData' },
  { dotKey: 'scheduler.demand.forecastHelperApiDown', section: 'demand', key: 'forecastHelperApiDown' },
  { dotKey: 'scheduler.demand.forecastHelperPending', section: 'demand', key: 'forecastHelperPending' },
  { dotKey: 'scheduler.demand.forecastHelperRunning', section: 'demand', key: 'forecastHelperRunning' },
  { dotKey: 'scheduler.demand.forecastHelperReady', section: 'demand', key: 'forecastHelperReady' },
  { dotKey: 'scheduler.demand.beforeForecast', section: 'demand', key: 'beforeForecast' },
  { dotKey: 'scheduler.demand.afterForecast', section: 'demand', key: 'afterForecast' },
  { dotKey: 'scheduler.demand.sourceLabelModel', section: 'demand', key: 'sourceLabelModel' },
  { dotKey: 'scheduler.demand.sourceLabelOverride', section: 'demand', key: 'sourceLabelOverride' },
  { dotKey: 'scheduler.demand.sourceLabelPos', section: 'demand', key: 'sourceLabelPos' },
  { dotKey: 'scheduler.demand.sourceLabelFallback', section: 'demand', key: 'sourceLabelFallback' },
  { dotKey: 'scheduler.demand.posTargetsSaved', section: 'demand', key: 'posTargetsSaved' },
  { dotKey: 'scheduler.demand.posTab', section: 'demand', key: 'posTab' },
  { dotKey: 'scheduler.demand.posRole', section: 'demand', key: 'posRole' },
];

const FILES = { de: 'locales/de.ts', zh: 'locales/zh.ts' };

for (const [locale, filePath] of Object.entries(FILES)) {
  const trans = localeResults[locale];
  if (Object.keys(trans).length === 0) { console.log(`${locale}: no keys`); continue; }

  let content = readFileSync(filePath, 'utf8');
  let inserted = 0;
  const failed = [];

  for (const { dotKey, section, key } of TARGETED_INSERTS) {
    const value = trans[dotKey];
    if (!value) { console.warn(`${locale}: no translation for ${dotKey}`); continue; }

    // Check if key already exists in the specific section context
    // We do a targeted insert regardless - the function won't double-insert if the key is already there
    // (the audit already tells us it's missing)
    const nc = insertIntoSection(content, section, key, value);
    if (nc) {
      content = nc;
      inserted++;
    } else {
      failed.push(dotKey + ' (section ' + section + ' not found)');
    }
  }

  writeFileSync(filePath, content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length > 0) console.warn(`  ${locale}: failed:`, failed);
}

console.log('\nDone! Run locale-audit.mjs to verify.');
