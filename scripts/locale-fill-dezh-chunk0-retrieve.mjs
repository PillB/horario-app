/**
 * locale-fill-dezh-chunk0-retrieve.mjs
 * Retrieve chunk0 retry batch and apply to de.ts/zh.ts.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';

const client = new Anthropic();
const batchId = readFileSync('./scripts/dezh-c0retry-batch-id.txt', 'utf8').trim();

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

const localeResults = { de: {}, zh: {} };
for await (const result of await client.messages.batches.results(batchId)) {
  if (result.result.type !== 'succeeded') {
    console.error(`${result.custom_id} failed`);
    continue;
  }
  const match = result.custom_id.match(/^dezh-c0retry-(\w+)$/);
  if (!match) continue;
  const locale = match[1];
  const text = result.result.message.content[0].text;
  try {
    const parsed = JSON.parse(stripFences(text));
    Object.assign(localeResults[locale], parsed);
    console.log(`✓ ${result.custom_id}: ${Object.keys(parsed).length} keys`);
  } catch (e) {
    console.error(`✗ ${result.custom_id}: parse failed — ${e.message}`);
    console.error('Raw:', text.slice(0, 400));
  }
}

for (const [l, k] of Object.entries(localeResults)) {
  console.log(`  ${l}: ${Object.keys(k).length} keys`);
}

// ── Apply ─────────────────────────────────────────────────────────────────────
function escapeValue(v) {
  if (v === null || v === undefined) return "''";
  const s = String(v);
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
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
  let insertAt = pos;
  while (insertAt > sectionStart && /\s/.test(content[insertAt - 1])) insertAt--;
  const needsComma = content[insertAt - 1] !== ',';
  const prefix = needsComma ? ',' : '';
  const lineStart = content.lastIndexOf('\n', match.index) + 1;
  const sectionIndent = match.index - lineStart;
  const keyIndent = ' '.repeat(sectionIndent + 2);
  return content.slice(0, insertAt) + `${prefix}\n${keyIndent}${newKey}: ${escapeValue(newValue)}` + content.slice(insertAt);
}

const TARGETS = [
  { dotKey: 'scheduler.jumpToCalendar', section: 'scheduler', key: 'jumpToCalendar' },
  { dotKey: 'scheduler.workers.addCardTooltip', section: 'workers', key: 'addCardTooltip' },
  { dotKey: 'scheduler.templates.addedSuccess', section: 'templates', key: 'addedSuccess' },
  { dotKey: 'scheduler.templates.addCardTooltip', section: 'templates', key: 'addCardTooltip' },
  { dotKey: 'scheduler.demand.forecastRunning', section: 'demand', key: 'forecastRunning' },
  { dotKey: 'scheduler.demand.forecastWaiting', section: 'demand', key: 'forecastWaiting' },
];

const FILES = { de: 'locales/de.ts', zh: 'locales/zh.ts' };
for (const [locale, filePath] of Object.entries(FILES)) {
  const trans = localeResults[locale];
  if (!Object.keys(trans).length) { console.warn(`${locale}: no keys`); continue; }
  let content = readFileSync(filePath, 'utf8');
  let inserted = 0;
  const failed = [];
  for (const { dotKey, section, key } of TARGETS) {
    const value = trans[dotKey];
    if (!value) { console.warn(`${locale}: no translation for ${dotKey}`); continue; }
    const nc = insertIntoSection(content, section, key, value);
    if (nc) { content = nc; inserted++; }
    else failed.push(dotKey);
  }
  writeFileSync(filePath, content);
  console.log(`✓ ${locale}: ${inserted} keys inserted`);
  if (failed.length) console.warn(`  ${locale}: failed:`, failed);
}

console.log('\nDone! Run locale-audit.mjs to verify.');
