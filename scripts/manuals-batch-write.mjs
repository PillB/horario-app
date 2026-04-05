/**
 * manuals-batch-write.mjs
 *
 * Batch-only rewrite of all 5 Horario setup manuals using accumulated research.
 * Model: claude-sonnet-4-6 (50% off via Batch API)
 * No web search — uses research files already on disk.
 *
 * Usage:
 *   node --env-file=.env.local scripts/manuals-batch-write.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function read(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
}
function write(rel, content) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${rel}`);
}
function stripFences(text) {
  return text.replace(/^```(?:markdown)?\n/, '').replace(/\n```\s*$/, '').trim();
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Research aggregator ──────────────────────────────────────────────────────

function getResearch(id) {
  // Combine v1 batch research + v2 real-time research (whichever exist)
  const v1 = read(`docs/manual-setup/research/${id}-research.md`);
  const v2 = read(`docs/manual-setup/research/v2-${id}-research.md`);
  const parts = [v1, v2].filter(s => s.length > 100);
  if (parts.length === 0) return '(no prior research — use your knowledge of 2025 best practices)';
  return parts.join('\n\n---\n\n');
}

// ─── Manual definitions ───────────────────────────────────────────────────────

const MANUALS = [
  { id: 'stripe',   file: 'docs/manual-setup/SETUP_STRIPE.md'   },
  { id: 'culqi',    file: 'docs/manual-setup/SETUP_CULQI.md'    },
  { id: 'clerk',    file: 'docs/manual-setup/SETUP_CLERK.md'    },
  { id: 'supabase', file: 'docs/manual-setup/SETUP_SUPABASE.md' },
  { id: 'vercel',   file: 'docs/manual-setup/SETUP_VERCEL.md'   },
];

// ─── Batch submit / poll / collect ───────────────────────────────────────────

const SYSTEM = `You are a senior technical writer producing production-quality developer setup guides for Horario — an Expo SDK 53 + React Native 0.79 + Expo Router v5 + Supabase + Clerk + Stripe/Culqi + Vercel app.

OUTPUT RULES (strictly enforced):
- Output the complete rewritten manual ONLY — no preamble, no closing remarks
- Start immediately with the # heading
- Preserve all correct steps from the existing manual; integrate research findings
- Mark updated steps with 🔄 UPDATED: and new gotchas with ⚠️ GOTCHA:
- Every ⚠️ GOTCHA must cite a source URL in parentheses, e.g. (source: https://...)
- Every ✅ Verify step must be specific and independently testable
- Troubleshooting table: minimum 12 rows, columns: Symptom | Likely Cause | Fix | Source
- Add a ## References section at the end listing all URLs cited in the document
- Use <YOUR_VALUE_HERE> for any placeholder values — no made-up credentials
- Keep all existing code blocks with correct language syntax tags`;

async function submitBatch() {
  const saved = read('scripts/manuals-batch-write-id.txt').trim();
  if (saved) { console.log(`Recovered batch: ${saved}`); return saved; }

  const requests = MANUALS.map(m => ({
    custom_id: m.id,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Rewrite the setup manual below. Incorporate all research findings to improve accuracy, add missing gotchas, correct outdated steps, expand the troubleshooting table to 12+ rows, and add a References section.

## RESEARCH FINDINGS (incorporate these into the manual)
${getResearch(m.id)}

## EXISTING MANUAL (preserve all correct content, improve with findings above)
${read(m.file)}

Output the complete improved manual starting with the # heading.`,
      }],
    },
  }));

  const batch = await client.messages.batches.create({ requests });
  write('scripts/manuals-batch-write-id.txt', batch.id);
  console.log(`Batch submitted: ${batch.id}`);
  return batch.id;
}

async function poll(batchId) {
  let b = await client.messages.batches.retrieve(batchId);
  while (b.processing_status !== 'ended') {
    const c = b.request_counts;
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`  [${ts}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);
    await sleep(30_000);
    b = await client.messages.batches.retrieve(batchId);
  }
  return b;
}

async function collect(batchId) {
  const out = {};
  for await (const r of await client.messages.batches.results(batchId)) {
    if (r.result.type === 'succeeded') {
      out[r.custom_id] = r.result.message.content
        .filter(b => b.type === 'text').map(b => b.text).join('').trim();
    } else {
      console.warn(`  ✗ ${r.custom_id}: ${r.result.type}`);
    }
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const batchId = await submitBatch();
await poll(batchId, 'rewrite');

console.log('\nCollecting results…');
const results = await collect(batchId);

let ok = 0, failed = 0;
for (const m of MANUALS) {
  const text = results[m.id];
  if (text && text.length > 500) {
    write(m.file, stripFences(text));
    ok++;
  } else {
    console.warn(`  ✗ ${m.id}: output missing or too short`);
    failed++;
  }
}

console.log(`\n✅ Done — ${ok} rewritten, ${failed} failed`);
console.log('Next: git add docs/manual-setup/ && git commit -m "CHG-066: ..."');
