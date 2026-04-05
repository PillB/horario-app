/**
 * manuals-research-batch.mjs
 *
 * 2-phase batch to research + rewrite the 5 manual setup guides.
 *
 * Phase 1 (5 parallel): Web research per platform
 *   stripe-research  — Stripe LatAm issues, Expo RN integration, webhook gotchas
 *   culqi-research   — Culqi onboarding, Yape API, RN integration, known issues
 *   clerk-research   — Clerk JWT templates, publicMetadata, Expo hooks gotchas
 *   supabase-research — Supabase RLS migrations, Realtime, SQL editor gotchas
 *   vercel-research  — Vercel env vars + Expo Router API routes, EXPO_PUBLIC_ gotchas
 *
 * Phase 2 (5 parallel): Rewrite each manual with research findings baked in
 *
 * Usage:
 *   node --env-file=.env.local scripts/manuals-research-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

function saveBatchId(tag, id) {
  write(`scripts/manuals-${tag}-batch-id.txt`, id);
}

function loadBatchId(tag) {
  const p = path.join(ROOT, `scripts/manuals-${tag}-batch-id.txt`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}

async function pollBatch(client, batchId, label) {
  let b = await client.messages.batches.retrieve(batchId);
  while (b.processing_status !== 'ended') {
    await new Promise(r => setTimeout(r, 30_000));
    b = await client.messages.batches.retrieve(batchId);
    const c = b.request_counts;
    console.log(`  [${label}] ${new Date().toISOString().slice(11,19)} processing=${c.processing} done=${c.succeeded} err=${c.errored}`);
  }
  return b;
}

async function collectResults(client, batchId) {
  const out = {};
  for await (const result of await client.messages.batches.results(batchId)) {
    if (result.result.type !== 'succeeded') {
      console.error(`  ✗ ${result.custom_id}: ${result.result.type}`);
      continue;
    }
    out[result.custom_id] = result.result.message.content
      .filter(b => b.type === 'text').map(b => b.text).join('');
  }
  return out;
}

// ─── Current manuals ───────────────────────────────────────────────────────────

const CURRENT = {
  stripe:   read('docs/manual-setup/SETUP_STRIPE.md'),
  culqi:    read('docs/manual-setup/SETUP_CULQI.md'),
  clerk:    read('docs/manual-setup/SETUP_CLERK.md'),
  supabase: read('docs/manual-setup/SETUP_SUPABASE.md'),
  vercel:   read('docs/manual-setup/SETUP_VERCEL.md'),
};

const APP_CONTEXT = `
App: Horario — Expo SDK 53 + React Native 0.79 + Expo Router v5 API routes (serverless on Vercel).
Auth: Clerk (@clerk/expo v3). DB: Supabase (PostgreSQL + RLS). Hosting: Vercel (Node.js runtime).
Payments: Stripe (global) + Culqi (Peru, Yape). Secure proxy: app/api/secure-proxy+api.ts (Node.js, NOT Edge runtime).
`;

const WEB = { type: 'web_search_20260209', name: 'web_search' };

const client = new Anthropic();

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 1 — Research
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════\n PHASE 1 — Research\n═══════════════════════════════════════\n');

const p1Requests = [

  // ── Stripe ─────────────────────────────────────────────────────────────────
  {
    custom_id: 'stripe-research',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [WEB],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

Research the following for STRIPE integration with Expo React Native + Vercel serverless, focusing on 2024-2025 issues and gotchas. Run multiple search rounds.

Search for:
1. "Stripe webhook verification Vercel serverless raw body 2024 2025"
2. "stripe.webhooks.constructEvent raw body nextjs vercel issue"
3. "Stripe checkout Expo React Native redirect deep link 2024"
4. "Stripe billing portal Expo React Native open URL"
5. "Stripe Peru Latin America availability 2024 2025"
6. "Stripe supported countries Peru 2025"
7. Browse: https://stripe.com/docs/webhooks/quickstart
8. Browse: https://stripe.com/docs/payments/checkout/custom-success-page
9. "stripe apiVersion 2025 latest version"
10. "Stripe checkout session success_url mobile app deep link"
11. "stripe webhook body parsing express vercel raw"
12. "Stripe test mode Peru cards declined"
13. "Stripe subscription create idempotency key best practice"
14. "Stripe customer portal return_url configuration"
15. "Expo openBrowserAsync Stripe checkout redirect back to app"

For each issue found: describe the exact problem, the root cause, and the exact fix/workaround.
Cite the source URL for every finding.
Format as a structured list of "GOTCHA: [title]" entries with PROBLEM / FIX / SOURCE.`,
      }],
    },
  },

  // ── Culqi ──────────────────────────────────────────────────────────────────
  {
    custom_id: 'culqi-research',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [WEB],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

Research CULQI payment gateway integration for Peru, focusing on real developer experiences, 2024-2025 issues, and gotchas. Run multiple search rounds.

Search for:
1. "Culqi integración API problemas desarrolladores 2024 2025"
2. "Culqi Yape integración API Node.js ejemplo"
3. "Culqi registro cuenta comercio documentos requeridos 2024"
4. Browse: https://apidocs.culqi.com/ (Culqi API docs)
5. Browse: https://culqi.com/docs (if exists)
6. "Culqi webhook verificación firma HMAC"
7. "Culqi sandbox test tarjetas prueba 2024"
8. "Culqi Node SDK culqi-node issues npm 2024"
9. "Culqi cargos recurrentes suscripciones API"
10. "Culqi Yape OTP flujo usuario React Native"
11. "Culqi aprobación cuenta comercio tiempo Peru 2024"
12. "Culqi API v2 charges planes recurrentes"
13. GitHub issues: https://github.com/culqi/culqi-node/issues
14. "Culqi tokenización tarjeta Culqi.js React"
15. "Culqi PagoEfectivo integración API"

For each issue found: GOTCHA title + PROBLEM + FIX + SOURCE.
Also include: exact API endpoints, required headers, test credentials, and any known bugs.`,
      }],
    },
  },

  // ── Clerk ──────────────────────────────────────────────────────────────────
  {
    custom_id: 'clerk-research',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [WEB],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

Research CLERK authentication integration with Expo React Native and JWT templates, focusing on 2024-2025 developer issues.

Search for:
1. "Clerk JWT template claims React Native Expo 2024 2025"
2. "Clerk publicMetadata update Backend SDK Node.js"
3. Browse: https://clerk.com/docs/backend-requests/making/jwt-templates
4. Browse: https://clerk.com/docs/users/metadata
5. "Clerk getToken template Expo React Native"
6. "Clerk webhook svix verification Node.js 2024"
7. "Clerk user.created webhook payload fields"
8. "@clerk/expo useUser publicMetadata not updating 2024"
9. "Clerk JWT template null values publicMetadata not set"
10. "Clerk Backend SDK createClerkClient Node.js serverless"
11. "Clerk Expo SecureStore token cache issue 2024"
12. "@clerk/backend v2 breaking changes 2024 2025"
13. "Clerk webhook signing secret svix validation error"
14. "Clerk JWT claims not reflecting after metadata update cached"
15. "Clerk organizations vs user metadata for SaaS billing"

For each issue found: GOTCHA title + PROBLEM + FIX + SOURCE.`,
      }],
    },
  },

  // ── Supabase ───────────────────────────────────────────────────────────────
  {
    custom_id: 'supabase-research',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [WEB],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

Research SUPABASE migration and RLS issues for Expo React Native apps, focusing on 2024-2025 developer experiences.

Search for:
1. "Supabase RLS policy anon service_role pattern 2024"
2. "Supabase SQL editor migration error duplicate policy"
3. "Supabase realtime enable table subscription React Native 2024"
4. Browse: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
5. "Supabase service role key vs anon key RLS bypass"
6. "Supabase migration run SQL editor steps 2024"
7. "Supabase CREATE POLICY IF NOT EXISTS not supported error"
8. "Supabase upsert onConflict error duplicate key 2024"
9. "Supabase realtime too many connections limit free tier"
10. "Supabase free tier limitations 2024 2025 database size"
11. "Supabase trigger updated_at function already exists error"
12. "Supabase RLS infinite recursion policy error"
13. "Supabase anon key safe to expose client side"
14. "Supabase connection pooler PgBouncer Expo React Native"
15. "Supabase dashboard SQL editor max query size timeout"

For each issue found: GOTCHA title + PROBLEM + FIX + SOURCE.`,
      }],
    },
  },

  // ── Vercel ─────────────────────────────────────────────────────────────────
  {
    custom_id: 'vercel-research',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      tools: [WEB],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

Research VERCEL deployment issues for Expo Router v5 apps (NOT Next.js), focusing on environment variables, serverless API routes, and 2024-2025 developer experiences.

Search for:
1. "Expo Router API routes Vercel deployment 2024 2025"
2. "EXPO_PUBLIC_ environment variables Vercel build time vs runtime"
3. "Vercel environment variables not available in API routes"
4. "Expo Router v5 Vercel serverless function cold start"
5. Browse: https://docs.expo.dev/router/reference/api-routes/
6. "Vercel function timeout 10 seconds API route workaround"
7. "Vercel environment variables EXPO_PUBLIC_ server side available"
8. "process.env undefined Vercel serverless Expo Router"
9. "Vercel preview deployment environment variables"
10. "Stripe webhook raw body Vercel edge vs nodejs runtime"
11. "Vercel serverless function body parsing Buffer issue"
12. "Expo Router API route runtime nodejs edge config"
13. "Vercel deploy Expo web app eas build static"
14. "EXPO_PUBLIC variables baked in bundle build Vercel"
15. "Vercel function logs how to view 2024"

For each issue found: GOTCHA title + PROBLEM + FIX + SOURCE.`,
      }],
    },
  },
];

let p1BatchId = loadBatchId('p1-research');
if (p1BatchId) {
  console.log(`Recovered Phase 1 batch: ${p1BatchId}`);
} else {
  const batch = await client.messages.batches.create({ requests: p1Requests });
  p1BatchId = batch.id;
  saveBatchId('p1-research', p1BatchId);
  console.log(`Phase 1 batch submitted: ${p1BatchId}`);
}

await pollBatch(client, p1BatchId, 'Phase1-Research');
const p1Results = await collectResults(client, p1BatchId);

// Save raw research for reference
Object.entries(p1Results).forEach(([id, content]) => {
  write(`docs/manual-setup/research/${id}.md`, content);
});

console.log('\n✅ Phase 1 research complete\n');

// ══════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Rewrite manuals
// ══════════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════\n PHASE 2 — Rewrite Manuals\n═══════════════════════════════════════\n');

function truncate(s, n = 5000) { return s ? s.slice(0, n) : ''; }

const REWRITE_SYSTEM = `You are a senior developer advocate writing production-quality setup guides.

Rules:
- Cite every gotcha with the source URL (in-line as markdown links)
- Use exact dashboard navigation paths (bold the clickable UI elements)
- Every step must be independently verifiable (tell the developer what success looks like)
- Include "⚠️ GOTCHA:" callouts for known issues with exact fixes
- Include "✅ Verify:" lines after each step showing how to confirm it worked
- Use code blocks for all commands, API calls, and config snippets
- Prefer explicit over implicit — never say "configure as needed", give exact values
- End each section with a troubleshooting table: Symptom → Cause → Fix
- Format: clean GitHub-flavored Markdown`;

const p2Requests = [

  // ── Stripe manual rewrite ──────────────────────────────────────────────────
  {
    custom_id: 'stripe-manual',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Current manual to improve:
${CURRENT.stripe}

## Research findings (known issues + gotchas):
${truncate(p1Results['stripe-research'])}

## Task:
Rewrite SETUP_STRIPE.md as a complete, production-quality guide.

Must include all of these sections:

### Prerequisites
- Stripe account requirements (email verification, bank account for payouts)
- Note: Stripe IS available in Peru but requires a Peruvian or US legal entity — clarify this
- Node.js version requirement for the Stripe SDK

### Step 1 — Create Products & Prices
- Exact navigation path in 2025 Stripe dashboard
- Exact prices: Starter $19/mo + $182.40/yr, Growth $39/mo + $374.40/yr, Pro $79/mo + $758.40/yr
- How to copy Price IDs (exact UI location)
- ⚠️ GOTCHA: Price IDs are environment-specific (test vs live) — use test IDs in dev

### Step 2 — Install and Initialize Stripe SDK
- Exact command: npm install stripe
- Latest supported apiVersion string (research this from npm/docs)
- How to initialize in secure-proxy+api.ts WITHOUT causing issues in the Expo client bundle
- ⚠️ GOTCHA: Stripe SDK must NOT be imported in client-side code (only in API routes)
- How to guard: \`if (typeof window !== 'undefined') throw\` pattern

### Step 3 — Implement createCheckoutSession
- Complete working code for \`stripe.checkout.sessions.create()\`
- Required fields: line_items, mode, success_url, cancel_url, client_reference_id
- success_url must use \`{CHECKOUT_SESSION_ID}\` placeholder
- How to handle mobile app redirects (Expo deep links back to app)
- ⚠️ GOTCHA: Stripe Checkout in a WebView does NOT work — must use expo-web-browser

### Step 4 — Webhook Setup (most critical — common failure point)
- Exact Stripe dashboard path to create webhook endpoint
- All required events to subscribe to
- ⚠️ GOTCHA: Vercel serverless CANNOT read raw body with body-parser — explain exact fix
- Exact code: how to get raw body from Request object in Expo Router API route
- Complete webhook handler code with signature verification
- How to test locally with Stripe CLI

### Step 5 — Billing Portal
- Setup steps in Stripe dashboard
- Code for creating portal session
- ⚠️ GOTCHA: Portal requires Stripe Customer — must create customer on first checkout

### Step 6 — Idempotency & Error Handling
- Using idempotency keys to prevent duplicate subscriptions
- Handling failed payments, declined cards
- Stripe error codes to handle explicitly

### Step 7 — Local Testing
- Stripe CLI commands
- Test card numbers for success, decline, authentication required
- How to simulate subscription lifecycle events

### Troubleshooting Table
| Symptom | Cause | Fix |
|---|---|---|
(at least 10 rows covering the most common issues)

### Go-Live Checklist
(at least 15 checkboxes)

Output the complete rewritten SETUP_STRIPE.md. Start with the title line.`,
      }],
    },
  },

  // ── Culqi manual rewrite ───────────────────────────────────────────────────
  {
    custom_id: 'culqi-manual',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Current manual to improve:
${CURRENT.culqi}

## Research findings (known issues + gotchas):
${truncate(p1Results['culqi-research'])}

## Task:
Rewrite SETUP_CULQI.md as a complete, production-quality guide for Peru payment processing.

Must include:

### Why Culqi for Peru
- Comparison table vs Stripe (with accurate 2025 info)
- Yape statistics: user base, SMB adoption
- Settlement timeline (how fast funds arrive)

### Prerequisites & Account Setup
- Exact documents required for merchant approval (with official source)
- Typical approval timeline
- What "Rubro" category to select for SaaS
- SUNAT RUC lookup URL: https://e-consultaruc.sunat.gob.pe
- ⚠️ GOTCHA: Sole proprietors (persona natural) vs. company (persona jurídica) — different docs

### API Keys & Sandbox
- Exact location in Culqi dashboard
- Key format: pk_test_xxx / sk_test_xxx
- Complete list of Culqi sandbox test cards (multiple scenarios: approved, declined, insufficient funds)
- Sandbox Yape test credentials

### Yape Integration (step by step)
- How Yape payments work (token flow vs OTP flow — Culqi has two approaches)
- Which flow is recommended for SaaS subscriptions
- ⚠️ GOTCHA: Yape does NOT support recurring charges natively — explain workaround
- Complete API call examples with real endpoint URLs
- How to handle the Yape OTP UX in mobile app

### Recurring Subscriptions with Culqi
- Culqi's subscription API (if it exists) vs. manual charge scheduling
- How to implement monthly recurring billing (cron + stored token approach)
- ⚠️ GOTCHA: Culqi stores tokens differently from Stripe — tokenization flow

### Webhook Setup
- Exact dashboard steps
- Signature verification code (HMAC-SHA256 or Culqi-specific method)
- ⚠️ GOTCHA: Any known Culqi webhook reliability issues from community

### React Native / Expo Integration
- Why WebView is not recommended for Culqi
- Recommended: use Culqi's hosted payment page via expo-web-browser
- Deep link back to app after payment
- ⚠️ GOTCHA: Culqi.js does NOT work in React Native — use REST API directly

### Pricing in Centimos Reference Table
(all 6 price points)

### PagoEfectivo Integration (bonus)
- What PagoEfectivo is (cash payments at OXXO/pharmacies)
- How to enable it via Culqi
- Good for users without bank cards

### Troubleshooting Table (10+ rows)

### Go-Live Checklist (12+ items)

Output the complete rewritten SETUP_CULQI.md.`,
      }],
    },
  },

  // ── Clerk manual rewrite ───────────────────────────────────────────────────
  {
    custom_id: 'clerk-manual',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Current manual to improve:
${CURRENT.clerk}

## Research findings (known issues + gotchas):
${truncate(p1Results['clerk-research'])}

## Task:
Rewrite SETUP_CLERK.md as a complete, production-quality guide.

Must include:

### JWT Template Setup
- Exact navigation: Dashboard → Configure → JWT Templates → New template
- Template name must be EXACTLY "horario" (used in getToken({ template: 'horario' }))
- Complete claims JSON with Handlebars syntax
- ⚠️ GOTCHA: publicMetadata values render as \`null\` (not empty string) when unset — clients must handle null
- ⚠️ GOTCHA: JWT is cached by Clerk for up to 60 seconds — tier changes are not instant
- How to set token lifetime and why shorter is better for billing changes
- ✅ Verify: how to test the JWT template using the Clerk dashboard "Test" button

### Updating publicMetadata After Payment
- Install command: npm install @clerk/backend
- Complete working code to update metadata
- ⚠️ GOTCHA: \`updateUserMetadata\` MERGES, does not replace — explain implications
- How to get the Clerk userId from Stripe/Culqi webhook payload
- Must store userId in Stripe customer metadata at checkout creation time
- Error handling: what happens if Clerk API is down during webhook

### Clerk Webhook for user.created
- Exact steps to create webhook in dashboard
- Svix signature verification code (required — Clerk uses Svix)
- ⚠️ GOTCHA: Vercel serverless raw body issue (same as Stripe) — exact fix
- Complete handler code including signature verification
- Payload structure for user.created event (exact field names)
- Where to get CLERK_WEBHOOK_SECRET (Svix signing secret, not Clerk secret key)

### Token Retrieval in Expo (useAuth / getToken)
- Correct hook: useAuth().getToken({ template: 'horario' })
- ⚠️ GOTCHA: getToken returns null if user is not signed in — always null-check
- ⚠️ GOTCHA: Token request is async and adds latency — cache it per request
- How the secure proxy already uses this (reference authToken.ts)

### Allowed Redirect URLs for Billing
- Exact navigation in Clerk dashboard
- All URLs that need to be added for Stripe checkout
- Deep link scheme for Expo: how to configure app scheme

### Testing the Full Flow
- Step-by-step: sign in → checkout → webhook fires → metadata updates → JWT refreshes
- How to force a JWT refresh (sign out/in or useAuth().getToken force refresh)
- Expected timeline: payment → metadata update → fresh JWT → tier visible in app

### Troubleshooting Table (10+ rows)

### Checklist (12+ items)

Output the complete rewritten SETUP_CLERK.md.`,
      }],
    },
  },

  // ── Supabase manual rewrite ────────────────────────────────────────────────
  {
    custom_id: 'supabase-manual',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 12288,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Current manual to improve:
${CURRENT.supabase}

## Research findings (known issues + gotchas):
${truncate(p1Results['supabase-research'])}

## Task:
Rewrite SETUP_SUPABASE.md as a complete, production-quality guide.

Must include:

### Running the Migration
- Exact URL to the SQL editor for this project
- How to open the migration file in VS Code and copy contents
- ⚠️ GOTCHA: "CREATE POLICY does not support IF NOT EXISTS" — migration uses DROP POLICY IF EXISTS + CREATE POLICY pattern to handle this
- ⚠️ GOTCHA: Running migration twice — what happens (idempotent due to CREATE TABLE IF NOT EXISTS and DROP POLICY IF EXISTS)
- ✅ Verify: exact success output to expect

### RLS Policy Verification
- Why RLS matters for billing data
- Exact verification query
- ⚠️ GOTCHA: Tables without RLS are public — list of all tables that must have RLS enabled
- How to check which tables have RLS disabled

### Enabling Realtime
- New 2024 dashboard navigation (Supabase moved this to Database → Replication)
- ⚠️ GOTCHA: Realtime has connection limits on free plan (200 concurrent connections)
- ⚠️ GOTCHA: Realtime requires publication to be enabled — default is only public schema
- How to subscribe to subscription tier changes in React Native (code example)

### Service Role Key Security
- ⚠️ GOTCHA: Service role key bypasses ALL RLS — must NEVER go to client
- How the secure proxy keeps it server-only
- What happens if service role key is leaked (immediate rotation steps)

### Connection Limits & Free Tier
- Free tier limits: database size, MAU, storage, bandwidth (with current 2024/2025 values)
- When to upgrade to Pro ($25/mo)
- ⚠️ GOTCHA: Supabase free projects pause after 1 week of inactivity

### Testing & Verification Queries
(all the SQL queries from current doc, improved)

### Troubleshooting Table (10+ rows)

### Checklist (10+ items)

Output the complete rewritten SETUP_SUPABASE.md.`,
      }],
    },
  },

  // ── Vercel manual rewrite ──────────────────────────────────────────────────
  {
    custom_id: 'vercel-manual',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 12288,
      system: REWRITE_SYSTEM,
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Current manual to improve:
${CURRENT.vercel}

## Research findings (known issues + gotchas):
${truncate(p1Results['vercel-research'])}

## Task:
Rewrite SETUP_VERCEL.md as a complete, production-quality guide.

Must include:

### Critical: How EXPO_PUBLIC_ Variables Work in Vercel
- ⚠️ GOTCHA: EXPO_PUBLIC_ vars are baked into the client bundle at BUILD TIME — changing them in Vercel dashboard requires a redeployment
- ⚠️ GOTCHA: EXPO_PUBLIC_ vars in Vercel serverless API routes (the secure proxy) — they ARE available at runtime on the server but are also exposed to the client — never put secrets in EXPO_PUBLIC_
- Server-only vars (no EXPO_PUBLIC_ prefix) are ONLY available in API routes, not in the client bundle

### Environment Variable Setup (step by step)
- Exact Vercel dashboard path (2024/2025 UI)
- Complete table of all variables with exact env (Production/Preview/Development) for each
- ⚠️ GOTCHA: Variables added after a deployment are not live until redeployment
- How to encrypt sensitive variables (Vercel encrypts all env vars at rest)
- ⚠️ GOTCHA: Vercel preview deployments use different URLs — EXPO_PUBLIC_SECURE_PROXY_URL and EXPO_PUBLIC_APP_ORIGIN must be set per-environment or use relative paths

### Webhook Endpoints for Stripe and Clerk
- ⚠️ GOTCHA: Stripe/Clerk webhooks need raw body — Vercel does NOT buffer the body by default in Edge runtime
- Must use \`export const runtime = 'nodejs'\` (already set in secure-proxy)
- How to read raw body in Node.js runtime Expo Router API route
- ⚠️ GOTCHA: Vercel's 10-second function timeout — webhook handlers must be fast
- Setting VERCEL_MAX_DURATION (Pro plan only)

### Deployment Verification
- How to check function logs in real-time
- How to test the secure-proxy endpoint from curl
- What a healthy cold start looks like in Vercel logs
- ⚠️ GOTCHA: Cold starts add 1-3 seconds on first request after idle

### CORS Configuration
- The proxy already has CORS — but Vercel preview URLs are not in the allowlist
- How to add preview URLs to CORS allowlist
- ⚠️ GOTCHA: CORS preflight (OPTIONS) must respond 204 — already implemented

### Redeployment After Env Var Changes
- Exact steps to trigger redeployment
- How to verify new vars are picked up (check function output)

### Troubleshooting Table (12+ rows with specific error messages)

### Security Checklist (15+ items)

Output the complete rewritten SETUP_VERCEL.md.`,
      }],
    },
  },
];

let p2BatchId = loadBatchId('p2-rewrite');
if (p2BatchId) {
  console.log(`Recovered Phase 2 batch: ${p2BatchId}`);
} else {
  const batch = await client.messages.batches.create({ requests: p2Requests });
  p2BatchId = batch.id;
  saveBatchId('p2-rewrite', p2BatchId);
  console.log(`Phase 2 batch submitted: ${p2BatchId}`);
}

await pollBatch(client, p2BatchId, 'Phase2-Rewrite');
const p2Results = await collectResults(client, p2BatchId);

const OUTPUT_MAP = {
  'stripe-manual':   'docs/manual-setup/SETUP_STRIPE.md',
  'culqi-manual':    'docs/manual-setup/SETUP_CULQI.md',
  'clerk-manual':    'docs/manual-setup/SETUP_CLERK.md',
  'supabase-manual': 'docs/manual-setup/SETUP_SUPABASE.md',
  'vercel-manual':   'docs/manual-setup/SETUP_VERCEL.md',
};

let success = 0, failed = 0;
for (const [id, outPath] of Object.entries(OUTPUT_MAP)) {
  if (p2Results[id]) {
    write(outPath, p2Results[id].trim());
    success++;
  } else {
    console.error(`  ✗ ${id} — no result`);
    failed++;
  }
}

// Update README with completion note
const readme = read('docs/manual-setup/README.md');
if (!readme.includes('Last updated')) {
  const updated = readme + `\n---\n\n*Last updated: ${new Date().toISOString().slice(0,10)} — researched against 2024-2025 platform docs and community issues.*\n`;
  write('docs/manual-setup/README.md', updated);
}

console.log(`\n════════════════════════════════\n ALL DONE: ${success} manuals rewritten, ${failed} failed\n════════════════════════════════`);
console.log('\nOutput files:');
Object.values(OUTPUT_MAP).forEach(f => console.log(`  📄 ${f}`));
console.log('\nNext: git add docs/manual-setup/ && git commit -m "CHG-065: Rewrite setup manuals with research-backed gotchas"');
