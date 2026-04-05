/**
 * manuals-v2-review.mjs
 *
 * 2-phase manual improvement pipeline:
 *
 * PHASE 1 — Real-time web research (claude-opus-4-6, 5 focused queries per manual)
 *   - 1 API call per manual, web_search_20260209 + web_fetch_20260209
 *   - If pause_turn: accept the partial search output (first round is enough)
 *   - Saves raw research to docs/manual-setup/research/v2-*.md
 *
 * PHASE 2 — Batch rewrite (claude-sonnet-4-6, 50% off, no web tools needed)
 *   - Reads existing manual + Phase 1 research
 *   - Writes improved manual back to docs/manual-setup/SETUP_*.md
 *   - Crash-safe: saves batch ID to scripts/manuals-v2-p2-batch-id.txt
 *
 * Usage:
 *   node --env-file=.env.local scripts/manuals-v2-review.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 300_000,
  maxRetries: 2,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
}
function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}
function stripFences(text) {
  return text.replace(/^```(?:markdown)?\n/, '').replace(/\n```\s*$/, '').trim();
}
function extractText(content) {
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Manual Definitions ───────────────────────────────────────────────────────

const MANUALS = [
  {
    id: 'stripe',
    file: 'docs/manual-setup/SETUP_STRIPE.md',
    label: 'Stripe',
    queries: [
      'Stripe Expo React Native 2025 checkout redirect webhook integration guide',
      'Stripe webhooks Vercel serverless raw body constructEvent Node.js 2025',
      'Stripe Peru LatAm entity requirements 2025 persona natural SAC SRL',
      'Stripe CLI local testing mobile app webhook forwarding expo',
      'site:reddit.com OR site:github.com stripe expo react native issues 2025',
    ],
  },
  {
    id: 'culqi',
    file: 'docs/manual-setup/SETUP_CULQI.md',
    label: 'Culqi',
    queries: [
      'Culqi API v2 Node.js integration guide 2025 quickstart',
      'Culqi Yape API token OTP Node.js example charges',
      'Culqi webhook verification HMAC Node.js 2025',
      'Culqi production account approval RUC SUNAT documents Peru',
      'Culqi React Native Expo integration issues known bugs 2025',
    ],
  },
  {
    id: 'clerk',
    file: 'docs/manual-setup/SETUP_CLERK.md',
    label: 'Clerk',
    queries: [
      'Clerk JWT template Supabase RLS 2025 setup guide publicMetadata',
      'Clerk @clerk/expo v3 Expo Router v5 integration hooks 2025',
      'Clerk Svix webhook signature verification raw body Node.js',
      'Clerk Session Token V2 migration breaking changes 2025',
      'site:github.com OR site:reddit.com clerk expo supabase issues 2025',
    ],
  },
  {
    id: 'supabase',
    file: 'docs/manual-setup/SETUP_SUPABASE.md',
    label: 'Supabase',
    queries: [
      'Supabase RLS policy Clerk JWT auth.jwt() 2025 setup',
      'Supabase Realtime enable REPLICA IDENTITY FULL broadcast presence 2025',
      'Supabase migration SQL editor gotchas CREATE POLICY IF NOT EXISTS',
      'Supabase Supavisor connection pooler Vercel serverless 2025 setup',
      'site:github.com OR site:reddit.com supabase clerk RLS integration issues 2025',
    ],
  },
  {
    id: 'vercel',
    file: 'docs/manual-setup/SETUP_VERCEL.md',
    label: 'Vercel',
    queries: [
      'Vercel Expo Router API routes Node.js runtime serverless 2025',
      'Vercel EXPO_PUBLIC environment variables build time vs runtime',
      'Vercel serverless function raw body webhook stripe clerk 2025',
      'Expo Router v5 Vercel deployment issues env vars configuration',
      'Vercel function timeout free tier limits 2025',
    ],
  },
];

// ─── PHASE 1: Real-time Research ─────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are a technical researcher for a developer documentation team.
Your task: perform focused web searches for a specific integration, then write a concise
research summary of key findings.

RULES:
- Run searches for the provided queries using web_search
- Fetch the most relevant results using web_fetch for deeper detail
- Focus on: 2025 changes, known bugs, breaking changes, undocumented gotchas, workarounds
- After searching, write a structured research summary with:
  ## Findings
  Bullet list of key facts, changes, and gotchas — each with a source URL
  ## New Gotchas (not in existing manual)
  Any issues discovered that aren't already documented
  ## Outdated Steps (needs update)
  Steps in the existing manual that may be wrong or outdated
  ## Key URLs
  List of the most useful URLs found
- Be CONCISE — this is a research brief, not a full rewrite
- DO NOT rewrite the manual — just report findings`;

async function researchManual(manual) {
  const existingContent = read(manual.file);
  const queryList = manual.queries.map((q, i) => `${i + 1}. ${q}`).join('\n');

  const userMsg = `Research integration gotchas for this Horario setup manual.

EXISTING MANUAL SUMMARY (for context — know what's already documented):
${existingContent.slice(0, 3000)}
[...truncated for brevity]

SEARCH QUERIES TO RUN (run all of them):
${queryList}

After running all searches, write your research summary following the output format in your instructions.`;

  const tools = [
    { type: 'web_search_20260209', name: 'web_search' },
    { type: 'web_fetch_20260209',  name: 'web_fetch'  },
  ];

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stream = client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 8000,
        system: RESEARCH_SYSTEM,
        tools,
        messages: [{ role: 'user', content: userMsg }],
      });

      let dots = 0;
      stream.on('text', () => { if (++dots % 20 === 0) process.stdout.write('.'); });
      response = await stream.finalMessage();
      process.stdout.write('\n');
      break;
    } catch (err) {
      const retriable = ['terminated', 'ETIMEDOUT', 'ECONNRESET'].some((s) => err.message?.includes(s));
      if (retriable && attempt < 3) {
        console.warn(`  [${manual.label}] network error — retry ${attempt}/3 in 20s…`);
        await sleep(20_000);
        continue;
      }
      throw err;
    }
  }

  const stopReason = response.stop_reason;
  console.log(`  [${manual.label}] stop_reason=${stopReason} tokens=${response.usage.output_tokens}`);

  // Accept partial output on pause_turn — first round of searches is sufficient
  if (stopReason === 'pause_turn') {
    console.log(`  [${manual.label}] pause_turn: using first-round research output`);
  }

  return extractText(response.content);
}

// ─── PHASE 2: Batch Rewrite ───────────────────────────────────────────────────

const REWRITE_SYSTEM = `You are a senior technical writer producing production-quality developer setup guides.

OUTPUT RULES (strictly enforced):
- Output the complete rewritten manual ONLY — no preamble, no closing remarks
- Start immediately with the # heading
- Preserve all correct steps from the existing manual
- Integrate research findings: add ⚠️ GOTCHA: callouts with source URLs, 🔄 UPDATED: for changed steps
- Every ⚠️ GOTCHA must include a source URL in parentheses
- Every ✅ Verify step must be specific and testable
- Troubleshooting table: minimum 12 rows, columns: Symptom | Likely Cause | Fix | Source
- Add ## References section at bottom with all URLs cited
- No placeholder content — if you don't know a value, use <YOUR_VALUE_HERE> format
- Keep all existing code blocks with correct language tags`;

async function runBatchRewrite(researchMap) {
  const savedId = read('scripts/manuals-v2-p2-batch-id.txt').trim();
  if (savedId) {
    console.log(`\nRecovered Phase 2 batch: ${savedId}`);
    return savedId;
  }

  const requests = MANUALS.map((manual) => {
    const existingContent = read(manual.file);
    const research = researchMap[manual.id] || '(no research available)';

    return {
      custom_id: manual.id,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: REWRITE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Rewrite the ${manual.label} setup manual incorporating the research findings below.

## RESEARCH FINDINGS
${research}

## EXISTING MANUAL (preserve all correct content, improve with findings)
${existingContent}

Produce the complete improved manual. Start with # heading.`,
          },
        ],
      },
    };
  });

  const batch = await client.messages.batches.create({ requests });
  write('scripts/manuals-v2-p2-batch-id.txt', batch.id);
  console.log(`\nPhase 2 batch submitted: ${batch.id}`);
  return batch.id;
}

async function pollBatch(batchId, label) {
  let b = await client.messages.batches.retrieve(batchId);
  while (b.processing_status !== 'ended') {
    const c = b.request_counts;
    console.log(`  [${label}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);
    await sleep(30_000);
    b = await client.messages.batches.retrieve(batchId);
  }
  return b;
}

async function collectBatchResults(batchId) {
  const results = {};
  for await (const result of await client.messages.batches.results(batchId)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      results[result.custom_id] = stripFences(text);
    } else {
      console.warn(`  ✗ ${result.custom_id}: ${result.result.type}`);
    }
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(' HORARIO MANUALS v2 — FOCUSED RESEARCH + BATCH REWRITE');
  console.log('═'.repeat(60));

  // ── Phase 1 ──────────────────────────────────────────────────────────────
  console.log('\n═══ PHASE 1 — Real-time Web Research (Opus 4.6) ═══\n');

  const researchMap = {};
  for (const manual of MANUALS) {
    const researchPath = `docs/manual-setup/research/v2-${manual.id}-research.md`;
    const existingResearch = read(researchPath);

    if (existingResearch.length > 500) {
      console.log(`[${manual.label}] using cached research (${existingResearch.length} chars)`);
      researchMap[manual.id] = existingResearch;
      continue;
    }

    console.log(`[${manual.label}] researching…`);
    try {
      const research = await researchManual(manual);
      researchMap[manual.id] = research;

      if (research.length > 200) {
        write(researchPath, `# ${manual.label} — Research Findings (v2)\n\n${research}`);
      } else {
        console.warn(`  [${manual.label}] ⚠ research too short (${research.length} chars)`);
      }
    } catch (err) {
      console.error(`  [${manual.label}] ✗ research failed:`, err.message);
      researchMap[manual.id] = '';
    }

    // Small gap between calls
    await sleep(3_000);
  }

  console.log('\n✅ Phase 1 research complete\n');

  // ── Phase 2 ──────────────────────────────────────────────────────────────
  console.log('═══ PHASE 2 — Batch Rewrite (Sonnet 4.6, 50% off) ═══\n');

  const batchId = await runBatchRewrite(researchMap);
  await pollBatch(batchId, 'Phase2-Rewrite');

  console.log('\nCollecting results…');
  const rewrites = await collectBatchResults(batchId);

  let ok = 0, failed = 0;
  for (const manual of MANUALS) {
    const content = rewrites[manual.id];
    if (content && content.length > 500) {
      write(manual.file, content);
      ok++;
    } else {
      console.warn(`  ✗ ${manual.label}: no output or too short`);
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(` ALL DONE: ${ok} manuals rewritten, ${failed} failed`);
  console.log('═'.repeat(60));
  console.log('\nNext: git add docs/manual-setup/ && git commit -m "CHG-066: ..."');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
