/**
 * manuals-realtime-review.mjs
 *
 * Real-time (non-batch) Claude API research + rewrite of the 5 Horario setup manuals.
 * Uses web_search_20260209 + web_fetch_20260209 in a proper server-side tool loop
 * (handles pause_turn so Claude can do multiple search rounds).
 *
 * Why NOT batch: The Batch API runs each request independently and does NOT support
 * the server-side tool continuation loop — it processes one request at a time without
 * re-invoking itself. For multi-round web search this script is required.
 *
 * Usage:
 *   node --env-file=.env.local scripts/manuals-realtime-review.mjs
 *
 * Manuals processed (sequential to avoid rate-limit issues):
 *   1. SETUP_STRIPE.md
 *   2. SETUP_CULQI.md
 *   3. SETUP_CLERK.md
 *   4. SETUP_SUPABASE.md
 *   5. SETUP_VERCEL.md
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MANUALS_DIR = path.join(ROOT, 'docs/manual-setup');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 600_000,   // 10 min — server-side tool loops can be slow
  maxRetries: 3,
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
  // Remove leading/trailing ```markdown ... ``` or ``` ... ``` wrappers
  return text
    .replace(/^```(?:markdown)?\n/, '')
    .replace(/\n```\s*$/, '')
    .trim();
}

/** Extract the final text from a completed message content array */
function extractText(content) {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// ─── Server-Side Tool Loop ─────────────────────────────────────────────────────

/** Sleep for ms milliseconds */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Claude API call with server-side web_search + web_fetch tools.
 * Handles pause_turn continuation — including passing container_id back when
 * web_search_20260209 uses dynamic filtering (internal code execution container).
 *
 * Returns the final text output from Claude.
 */
async function runWithWebSearch(systemPrompt, userMessage, label, maxContinuations = 8) {
  const tools = [
    { type: 'web_search_20260209', name: 'web_search' },
    { type: 'web_fetch_20260209',  name: 'web_fetch'  },
  ];

  let messages = [{ role: 'user', content: userMessage }];
  let continuations = 0;
  let containerId = undefined;  // tracks internal container from dynamic filtering

  console.log(`\n  [${label}] Starting real-time search…`);

  while (true) {
    // Build request params — include container_id on resume if we have one
    const requestParams = {
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      tools,
      messages,
    };
    if (containerId) {
      requestParams.container = containerId;
    }

    let response;
    // Retry on transient network errors (terminated / ETIMEDOUT)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const stream = client.messages.stream(requestParams);

        let tokenCount = 0;
        stream.on('text', (delta) => {
          tokenCount += delta.length;
          if (tokenCount % 500 < delta.length) process.stdout.write('.');
        });

        response = await stream.finalMessage();
        process.stdout.write('\n');
        break; // success
      } catch (err) {
        const retriable = err.message?.includes('terminated') ||
                          err.message?.includes('ETIMEDOUT') ||
                          err.message?.includes('ECONNRESET') ||
                          err.code === 'ECONNRESET';
        if (retriable && attempt < 3) {
          const wait = attempt * 15_000;
          console.warn(`  [${label}] network error (attempt ${attempt}) — retrying in ${wait/1000}s…`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }

    console.log(`  [${label}] stop_reason=${response.stop_reason} tokens=${response.usage.output_tokens}`);

    // Track container_id for dynamic filtering continuation
    if (response.container?.id) {
      containerId = response.container.id;
      console.log(`  [${label}] container_id=${containerId}`);
    }

    if (response.stop_reason === 'end_turn') {
      return extractText(response.content);
    }

    if (response.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its 10-iteration limit.
      // Append assistant turn (DO NOT add extra user message) and re-send.
      if (continuations >= maxContinuations) {
        console.warn(`  [${label}] ⚠ max continuations reached — using partial output`);
        return extractText(response.content);
      }
      messages = [
        ...messages,
        { role: 'assistant', content: response.content },
      ];
      continuations++;
      console.log(`  [${label}] Resuming (continuation ${continuations}/${maxContinuations})…`);
      continue;
    }

    // max_tokens or unexpected stop_reason
    console.warn(`  [${label}] ⚠ stop_reason=${response.stop_reason} — returning partial output`);
    return extractText(response.content);
  }
}

// ─── Manual Definitions ───────────────────────────────────────────────────────

const MANUALS = [
  {
    id: 'stripe',
    file: 'docs/manual-setup/SETUP_STRIPE.md',
    label: 'Stripe',
    searchFocus: `
Search for: Stripe Expo React Native integration 2025, Stripe webhooks Vercel serverless raw body,
Stripe Peru LatAm entity requirements 2025, Stripe checkout mobile redirect Expo Router,
Stripe price IDs environment variables best practices, stripe.webhooks.constructEvent raw body
Node.js, Stripe CLI local testing with Expo, common Stripe integration mistakes 2025.
Also search: site:reddit.com/r/stripe "expo" OR "react native", site:github.com/stripe issues "expo"`,
  },
  {
    id: 'culqi',
    file: 'docs/manual-setup/SETUP_CULQI.md',
    label: 'Culqi',
    searchFocus: `
Search for: Culqi API v2 Node.js integration 2025, Culqi Yape API Node.js example,
Culqi webhook verification Node.js, Culqi sandbox testing 2025, Culqi RUC SUNAT requirements,
Culqi React Native Expo integration, Culqi PagoEfectivo API, Culqi recurring subscriptions API,
Culqi production account approval process Peru 2025, Culqi API errors common issues.
Also search: site:github.com "culqi" OR "yape api", culqi developers forum issues 2025`,
  },
  {
    id: 'clerk',
    file: 'docs/manual-setup/SETUP_CLERK.md',
    label: 'Clerk',
    searchFocus: `
Search for: Clerk JWT templates Supabase 2025, Clerk @clerk/expo v3 Expo Router v5 2025,
Clerk publicMetadata update Node.js @clerk/backend, Clerk Svix webhook verification raw body,
Clerk CAPTCHA Expo Go issues 2025, Clerk Session Token V2 migration 2025,
Clerk Supabase RLS integration gotchas, clerk getToken template Expo.
Also search: site:reddit.com "clerk" "expo" OR "supabase", site:github.com/clerkinc issues "expo" 2025,
clerk.com/docs changes 2025`,
  },
  {
    id: 'supabase',
    file: 'docs/manual-setup/SETUP_SUPABASE.md',
    label: 'Supabase',
    searchFocus: `
Search for: Supabase RLS policy Clerk JWT 2025, Supabase Realtime REPLICA IDENTITY FULL,
Supabase migrations Expo Node.js 2025, Supabase CREATE POLICY IF NOT EXISTS workaround,
Supabase service_role security bypass RLS, Supabase connection pooler Supavisor Vercel serverless 2025,
Supabase free tier limits 2025, Supabase Realtime enable broadcast presence 2025.
Also search: site:reddit.com "supabase" "clerk" RLS, supabase github issues RLS Clerk 2025`,
  },
  {
    id: 'vercel',
    file: 'docs/manual-setup/SETUP_VERCEL.md',
    label: 'Vercel',
    searchFocus: `
Search for: Vercel Expo Router API routes Node.js runtime 2025, Vercel EXPO_PUBLIC env vars build time,
Vercel serverless functions raw body webhook 2025, Vercel environment variables scoping best practices,
Vercel Node.js runtime export runtime nodejs Expo Router, Vercel preview deployments Clerk redirect URLs,
Vercel function timeout limits free tier 2025, Expo Router v5 Vercel deployment issues 2025.
Also search: site:reddit.com "vercel" "expo router" API routes, vercel community forum expo 2025`,
  },
];

// ─── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior full-stack engineer and technical writer specializing in:
- Expo SDK 53 + React Native 0.79 + Expo Router v5 (file-based, +api.ts routes)
- Supabase (PostgreSQL, RLS, Realtime, service_role key)
- Clerk (@clerk/expo v3, JWT templates, webhooks via Svix)
- Stripe (Node.js SDK, webhooks, Checkout Sessions, Billing Portal)
- Culqi (Peruvian payment gateway — Yape, PagoEfectivo, REST API v2)
- Vercel serverless (Node.js runtime, environment variable scoping, raw body)

Your task: Research then rewrite a setup manual to be maximally reliable for a developer
following it step-by-step in 2025.

RESEARCH PHASE:
1. Use web_search to find current (2025) documentation, changelogs, and known issues
2. Use web_fetch to read relevant docs pages, GitHub issues, and forum threads
3. Search specifically for: common integration failures, undocumented gotchas,
   version-specific bugs, breaking changes in 2025, community workarounds

OUTPUT RULES (strictly enforced):
- Output ONLY the final rewritten manual — no preamble, no "here is the rewritten..."
- Start immediately with the # heading
- Preserve ALL existing steps and structure; only add/improve content
- Every ⚠️ GOTCHA must cite a source URL in parentheses or footnote
- Every ✅ Verify step must be concrete and testable (not "make sure it works")
- Add a ## References section at the bottom with URLs for every claim
- Troubleshooting table: minimum 12 rows, columns: Symptom | Likely Cause | Fix | Source
- Do NOT use placeholder URLs — only cite URLs you actually fetched
- Preserve markdown code blocks with correct language tags
- If a step has changed since the existing manual was written, flag it with 🔄 UPDATED:`;

// ─── Per-manual prompt ─────────────────────────────────────────────────────────

function buildPrompt(manual, currentContent) {
  return `You are improving the Horario app's ${manual.label} setup manual.

EXISTING MANUAL (read carefully — preserve all correct content):
\`\`\`
${currentContent}
\`\`\`

RESEARCH INSTRUCTIONS:
${manual.searchFocus}

TASK:
1. First, use web_search and web_fetch to research the topics above
2. Search for real developer experiences: Reddit, GitHub Issues, Stack Overflow, official changelogs
3. Verify that all steps in the existing manual still work in 2025
4. Then rewrite the complete manual incorporating:
   - Corrections for any outdated steps (mark with 🔄 UPDATED:)
   - New gotchas discovered from research (mark with ⚠️ GOTCHA:)
   - Source citations for every warning and gotcha
   - Expanded troubleshooting table (minimum 12 rows)
   - References section with all URLs

Output the complete rewritten manual only. Start with # heading.`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function processManual(manual) {
  const currentContent = read(manual.file);
  if (!currentContent) {
    console.warn(`  ⚠ ${manual.file} not found — skipping`);
    return;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(` ${manual.label.toUpperCase()} — ${manual.file}`);
  console.log('═'.repeat(60));

  const userMessage = buildPrompt(manual, currentContent);

  let result;
  try {
    result = await runWithWebSearch(SYSTEM_PROMPT, userMessage, manual.label);
  } catch (err) {
    console.error(`  ✗ ${manual.label} failed:`, err.message);
    return;
  }

  if (!result || result.length < 500) {
    console.warn(`  ⚠ ${manual.label}: output too short (${result?.length ?? 0} chars) — skipping write`);
    return;
  }

  const cleaned = stripFences(result);
  write(manual.file, cleaned);
  console.log(`  ✓ ${manual.label} rewritten (${cleaned.length} chars)`);
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(' HORARIO MANUALS — REAL-TIME REVIEW WITH WEB SEARCH');
  console.log(' Model: claude-opus-4-6  Tools: web_search + web_fetch');
  console.log('═'.repeat(60));

  const results = { ok: [], failed: [] };

  // Process sequentially to avoid hammering rate limits
  for (const manual of MANUALS) {
    try {
      await processManual(manual);
      results.ok.push(manual.label);
    } catch (err) {
      console.error(`\n✗ ${manual.label} threw:`, err.message);
      results.failed.push(manual.label);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(' DONE');
  console.log('═'.repeat(60));
  console.log(`  ✓ Succeeded: ${results.ok.join(', ') || 'none'}`);
  if (results.failed.length) {
    console.log(`  ✗ Failed:    ${results.failed.join(', ')}`);
  }
  console.log('\nNext: review diffs, then git add docs/manual-setup/ && git commit -m "CHG-066: ..."');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
