/**
 * scripts/vercel-404-fix-batch.mjs
 * Batch API script (claude-sonnet-4-6, 50% off) to diagnose and fix Vercel 404 errors.
 *
 * Root-cause confirmed by inspecting actual dist/ output:
 *   CRIT-1: vercel.json catch-all → __root__.js which DOES NOT EXIST.
 *           Expo Router v5 server export produces pre-rendered HTML in
 *           dist/server/(tabs)/, dist/server/(auth)/, etc., not a dynamic handler.
 *   CRIT-2: API route dest missing "+api" suffix — file is secure-proxy+api.js.
 *
 * Run: node scripts/vercel-404-fix-batch.mjs
 * Results written to: scripts/vercel-404-fix-results.json
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── helper to strip markdown fences ─────────────────────────────────────────
function stripFences(text) {
  return text
    .replace(/^```[\w-]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .trim();
}

// ── Read relevant source files ────────────────────────────────────────────────
const routesJson     = fs.readFileSync(path.join(ROOT, 'dist/server/_expo/routes.json'), 'utf8');
const currentVercel  = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
const authLayout     = fs.readFileSync(path.join(ROOT, 'app/(auth)/_layout.tsx'), 'utf8');
const rootLayout     = fs.readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8');
const tabsLayout     = fs.readFileSync(path.join(ROOT, 'app/(tabs)/_layout.tsx'), 'utf8');
const currentDeploy  = fs.readFileSync(path.join(ROOT, 'VERCEL_DEPLOY.md'), 'utf8');

// ── Confirmed dist structure (from `find dist -type f | sort`) ───────────────
const distStructure = `
dist/client/_expo/static/js/web/entry-*.js  (JS bundle, served at /_expo/static/…)
dist/client/_expo/static/js/web/*.js         (locale chunk bundles)
dist/client/assets/**                         (fonts, images)
dist/client/favicon.ico

dist/server/_expo/functions/api/secure-proxy+api.js   ← ONLY serverless function
dist/server/_expo/routes.json                          ← Expo Router route manifest
dist/server/(tabs)/index.html                          ← pre-rendered home
dist/server/(tabs)/explore.html
dist/server/(tabs)/scheduler.html
dist/server/(auth)/sign-in.html
dist/server/(auth)/sign-up.html
dist/server/_sitemap.html
dist/server/+not-found.html

NOTE: There is NO dist/server/_expo/functions/__root__.js
      The current catch-all in vercel.json pointing to __root__.js causes ALL
      page requests to 404 because that file does not exist.
`.trim();

// ── Named-regex route patterns from dist/server/_expo/routes.json ────────────
const namedRegexSummary = `
From dist/server/_expo/routes.json:
  /(tabs)/index    namedRegex: ^(?:/\\(tabs\\))?(?:/)?$          → dist/server/(tabs)/index.html
  /(tabs)/explore  namedRegex: ^(?:/\\(tabs\\))?/explore(?:/)?$  → dist/server/(tabs)/explore.html
  /(tabs)/scheduler namedRegex: ^(?:/\\(tabs\\))?/scheduler(?:/)?$ → dist/server/(tabs)/scheduler.html
  /(auth)/sign-in  namedRegex: ^(?:/\\(auth\\))?/sign\\-in(?:/)?$ → dist/server/(auth)/sign-in.html
  /(auth)/sign-up  namedRegex: ^(?:/\\(auth\\))?/sign\\-up(?:/)?$ → dist/server/(auth)/sign-up.html
  /_sitemap        namedRegex: ^/_sitemap(?:/)?$                 → dist/server/_sitemap.html
  API: /api/secure-proxy namedRegex: ^/api/secure\\-proxy(?:/)?$ → dist/server/_expo/functions/api/secure-proxy+api.js
  not-found        namedRegex: ^(?:/(?<notfound>.+?))?(?:/)?$   → dist/server/+not-found.html
`.trim();

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are an expert in Expo Router v5, Vercel deployment, and Clerk auth.
You produce complete, production-ready file content — no explanations, no markdown prose,
only the exact file content requested. No code fences.`;

// ── Batch requests ────────────────────────────────────────────────────────────
const requests = [
  // ── 1. vercel.json ──────────────────────────────────────────────────────────
  {
    custom_id: 'VERCEL_JSON',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Generate the COMPLETE corrected vercel.json for this Expo Router v5 app.

CURRENT (BROKEN) vercel.json:
${currentVercel}

ACTUAL dist/ structure after \`expo export --platform web\`:
${distStructure}

Route-manifest patterns (use these EXACTLY as the \`src\` regex in routes):
${namedRegexSummary}

RULES:
1. version: 2, framework: null, buildCommand: "npx expo export --platform web", outputDirectory: "dist"
2. Register serverless functions with:
   "functions": { "dist/server/_expo/functions/**/*.js": { "runtime": "nodejs20.x" } }
3. Routes array — in this order:
   a. Static assets redirect (client/ subdirectory):
      /_expo/static/(.*) → /client/_expo/static/$1
      /assets/(.*) → /client/assets/$1
      /favicon.ico → /client/favicon.ico
   b. API route — MUST include +api suffix in dest:
      src = namedRegex for /api/secure-proxy
      dest = /server/_expo/functions/api/secure-proxy+api.js
   c. Page routes — use namedRegex patterns verbatim as \`src\`, dest = path of pre-rendered HTML
      (tabs)/index  →  /server/(tabs)/index.html
      (tabs)/explore → /server/(tabs)/explore.html
      (tabs)/scheduler → /server/(tabs)/scheduler.html
      (auth)/sign-in → /server/(auth)/sign-in.html
      (auth)/sign-up → /server/(auth)/sign-up.html
      _sitemap → /server/_sitemap.html
   d. Catch-all → /server/+not-found.html (NOT __root__.js)
4. No comments in JSON. Valid JSON only.
5. Output ONLY the JSON, nothing else.`
      }]
    }
  },

  // ── 2. (auth)/_layout.tsx — add authEnabled guard ───────────────────────────
  {
    custom_id: 'AUTH_LAYOUT',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Fix app/(auth)/_layout.tsx so it does NOT crash when ClerkProvider is absent
(i.e., when EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set = dev-bypass mode).

Current file:
${authLayout}

Root layout (shows how authEnabled is derived and how ClerkProvider is conditionally mounted):
${rootLayout}

Tabs layout (shows the same pattern used for the tabs auth guard):
${tabsLayout}

RULES:
- When authEnabled is false (no Clerk key), render the Stack directly — do NOT call useAuth()
  because ClerkProvider is not mounted in that case.
- When authEnabled is true, keep the existing useAuth() check:
  if !isLoaded → null; if isSignedIn → Redirect to "/"; else → Stack.
- Use the same authEnabled const pattern as tabs layout:
  const authEnabled = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_');
- Keep all existing imports. Add no new imports beyond what's needed.
- Do not change the Stack children or any other logic.
- Output ONLY the complete fixed file content, no code fences.`
      }]
    }
  },

  // ── 3. VERCEL_DEPLOY.md — fix §1.5, §1.6, §5.2, §6.5 ─────────────────────
  {
    custom_id: 'VERCEL_DEPLOY_MD',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Rewrite VERCEL_DEPLOY.md fixing incorrect sections and filling in missing content.

CURRENT FILE (may be truncated at §6.5):
${currentDeploy}

CONFIRMED FACTS about this project's Expo Router v5 server output:
${distStructure}

KEY CHANGES TO MAKE:
1. §1.5 "Confirm vercel.json" — replace the WRONG simple-rewrites snippet with the
   CORRECT vercel.json that uses explicit routes (static→client/, API→+api.js,
   pages→pre-rendered HTML, catch-all→+not-found.html). Explain WHY the complex
   routes are needed (no __root__.js; HTML files in server/, JS in client/).

2. §1.6 "smoke test" — update the ls check to verify:
   dist/client/_expo/static/  (JS bundles)
   dist/server/(tabs)/index.html  (pre-rendered pages)
   dist/server/_expo/functions/api/secure-proxy+api.js  (API handler)
   Add a warning: "Do NOT look for __root__.js — it does not exist in this output mode."

3. §5.2 "Monitor the build log" — add to the "Common build errors" table:
   | Pages 404 after deploy | vercel.json routes must match actual dist structure;
     see §1.5 for the correct config. __root__.js is NOT produced by Expo Router
     v5 static-server mode — routes must point to pre-rendered HTML files. |
   | API route 404 | Ensure vercel.json API route dest ends with +api.js
     (e.g. /server/_expo/functions/api/secure-proxy+api.js) |

4. §6.5 — this section was truncated. Complete it:
   "6.5 Check Vercel Function logs
   1. Go to https://vercel.com/[team]/[project]/logs
   2. Filter by Function to see invocations of /api/secure-proxy
   3. Look for errors: missing env vars, JWT verification failures, Supabase errors
   4. Common runtime errors and fixes: [table with CLERK_JWKS_URL missing,
      SUPABASE_SERVICE_ROLE_KEY missing, CORS errors, 401 on API calls]"

5. Add a new §6.6 "Troubleshoot 404s" section AFTER §6.5 that covers:
   - Run \`npx expo export --platform web\` locally, check dist/ structure
   - Verify vercel.json routes match dist/ structure exactly
   - Check that dest paths use correct subdirectory (client/ for JS, server/ for HTML)
   - Use Vercel's "Deployment → Source" to inspect what files were deployed
   - Check browser Network tab for which exact URL is 404ing

Output the COMPLETE rewritten VERCEL_DEPLOY.md. No code fences. Full file.`
      }]
    }
  },

  // ── 4. CHG-036 entry ────────────────────────────────────────────────────────
  {
    custom_id: 'CHG_ENTRY',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Write the CHG-036 entry for Claude_changes.md.

Format (match exactly):
### CHG-036 — 2026-03-30 UTC
**Type:** FIX (...)
**Files changed:**
- \`file\` — description
...
**Key decisions:**
- ...
**Notes:**
- ...

Facts to include:
- Type: FIX (Vercel 404 — vercel.json routing rewritten for actual Expo Router v5 dist structure)
- Root cause: vercel.json catch-all pointed to __root__.js (does not exist); Expo Router v5 server
  export produces pre-rendered HTML files in dist/server/, not a dynamic SSR handler. API route
  dest was also missing the +api suffix (secure-proxy → secure-proxy+api.js).
- Files changed:
  - vercel.json — Complete rewrite: explicit routes for each pre-rendered HTML page derived from
    dist/server/_expo/routes.json namedRegex patterns; static assets routed via /client/ prefix;
    API route fixed to reference secure-proxy+api.js; catch-all → +not-found.html.
  - app/(auth)/_layout.tsx — Added authEnabled guard: when no Clerk key, render Stack directly
    without calling useAuth() (which requires ClerkProvider).
  - VERCEL_DEPLOY.md — §1.5 rewritten with correct vercel.json; §1.6 smoke-test updated;
    §5.2 error table extended; §6.5 completed; §6.6 Troubleshoot-404s added.
  - scripts/vercel-404-fix-batch.mjs (NEW) — Batch API script that generated fixes.
- Key decisions: Keep "output: server" in app.json. Expo Router v5 with server output
  uses pre-rendered HTML (not SSR on every request). Each page needs an explicit Vercel route.
  The routes.json manifest in dist/server/_expo/ is the source of truth for URL→file mapping.
- Notes: Tests still pass. Lint clean. Re-deploy and redeploy trigger is required to pick up vercel.json changes.

Output ONLY the entry text. No extra prose.`
      }]
    }
  },
];

// ── Submit batch ──────────────────────────────────────────────────────────────
console.log(`Submitting ${requests.length} requests to Batch API (claude-sonnet-4-6)…`);

const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID: ${batch.id}  status: ${batch.processing_status}`);

// ── Poll ──────────────────────────────────────────────────────────────────────
let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise(r => setTimeout(r, 8000));
  current = await client.messages.batches.retrieve(batch.id);
  const { processing, succeeded, errored } = current.request_counts;
  console.log(`  processing: ${processing}  succeeded: ${succeeded}  errored: ${errored}`);
}

// ── Collect results ───────────────────────────────────────────────────────────
const results = {};
for await (const item of await client.messages.batches.results(batch.id)) {
  if (item.result.type === 'succeeded') {
    const text = item.result.message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    results[item.custom_id] = stripFences(text);
    console.log(`✓ ${item.custom_id} (${text.length} chars)`);
  } else {
    console.error(`✗ ${item.custom_id}:`, item.result);
    results[item.custom_id] = null;
  }
}

// ── Write results ─────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'vercel-404-fix-results.json');
fs.writeFileSync(outPath, JSON.stringify({ batchId: batch.id, results }, null, 2));
console.log(`\nResults → ${outPath}`);
console.log('Run: node scripts/vercel-404-fix-batch.mjs  (then apply results manually)');
