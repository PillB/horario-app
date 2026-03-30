/**
 * vercel-deploy-batch.mjs
 *
 * Uses the Anthropic Batch API (claude-sonnet-4-6, ~50% off) to analyse
 * the codebase for Vercel deployment readiness and generate all fixes.
 *
 * Produces:
 *   scripts/vercel-deploy-result.json  — raw batch results
 *   VERCEL_DEPLOY.md                   — step-by-step deployment checklist
 *   (patch files described inline for manual application)
 *
 * Usage:
 *   node --env-file=.env.local scripts/vercel-deploy-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function stripFences(text) {
  return text
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/\n?```\s*$/gm, '')
    .trim();
}

// ── Read project files for context ──────────────────────────────────────────

const APP_JSON = fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8');
const VERCEL_JSON = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
const PACKAGE_JSON = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const LAYOUT_TSX = fs.readFileSync(path.join(ROOT, 'app/_layout.tsx'), 'utf8');

// ── Batch requests ───────────────────────────────────────────────────────────

const SYSTEM = `You are a senior DevOps / full-stack engineer expert in Expo Router v5, React Native Web, Clerk authentication, and Vercel deployments.
You write production-ready configuration and code. Be precise and complete — no placeholders, no "TODO: fill in" unless explicitly for secrets.
Output only what is requested: file contents, code snippets, or structured text. No prose preamble or trailing summary unless asked.`;

const requests = [
  // ── 1. Vercel config fix ──────────────────────────────────────────────────
  {
    custom_id: 'VERCEL_JSON',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `## Task
Analyse the current vercel.json and app.json for an Expo Router v5 app with SSR output, then produce a corrected vercel.json.

## Current vercel.json
${VERCEL_JSON}

## app.json (relevant excerpt)
${APP_JSON}

## Key facts
- app.json sets \`"web": { "output": "server" }\` — this is Expo Router SSR mode.
- SSR mode generates: \`dist/server/\` (Node.js handler) + \`dist/client/\` (static assets).
- Expo Router SSR on Vercel requires the \`@expo/server\` adapter or the Vercel output format.
- The correct build command for SSR is: \`npx expo export --platform web\`
- For Vercel SSR with Expo Router, we need:
  - \`framework: null\` (Vercel auto-detect interferes)
  - The Node.js server entry is \`dist/server/_expo/functions/__root__.js\` or similar
  - API routes (\`app/api/**\`) are file-based and must be rewritten correctly
  - Static assets from \`dist/client/\` must be served directly
- Alternatively, we can switch to static export: change app.json \`"output": "static"\` — then vercel.json is simpler but we lose SSR API routes.

## Decision
Keep SSR mode (\`"output": "server"\`) so API routes (\`app/api/secure-proxy+api.ts\`) work as Vercel serverless functions.

## Output
Produce the complete corrected \`vercel.json\` as a JSON file. Also produce as a separate section the exact change needed in \`app.json\` if any is required, and the exact change needed in \`package.json\` scripts (add a \`"build"\` script if missing).

Format your response as three sections clearly delimited:
### vercel.json
<file content>
### app.json changes
<describe exactly what line to change, or "no changes needed">
### package.json build script
<the exact "build" script line to add, or "no changes needed">`,
        },
      ],
    },
  },

  // ── 2. Token cache web fix ────────────────────────────────────────────────
  {
    custom_id: 'TOKEN_CACHE_FIX',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `## Task
Fix the web-incompatible token cache import in the Expo Root Layout.

## Problem
The file \`app/_layout.tsx\` imports:
\`\`\`typescript
import { tokenCache } from '@clerk/expo/token-cache';
\`\`\`

\`@clerk/expo/token-cache\` internally uses \`expo-secure-store\` which is a native-only module.
On Vercel (Node.js / web bundle), this causes a build or runtime crash.

## Current _layout.tsx
${LAYOUT_TSX}

## Requirements
1. On native (iOS/Android), use \`@clerk/expo/token-cache\` (uses expo-secure-store — correct).
2. On web, pass \`tokenCache={undefined}\` to ClerkProvider — Clerk handles web auth via cookies automatically, no token cache needed.
3. Use Platform.OS or \`Platform.select\` to branch, OR use a conditional import pattern.
4. Do NOT add new npm packages.
5. The fix must be TypeScript-compatible with the existing \`ClerkProvider\` type from \`@clerk/expo\`.

## Output
Produce the complete updated \`app/_layout.tsx\` file contents. No fences, no preamble — start at line 1 of the file.`,
        },
      ],
    },
  },

  // ── 3. Env vars for Vercel dashboard ────────────────────────────────────
  {
    custom_id: 'VERCEL_ENV_VARS',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `## Task
Produce the complete list of environment variables that must be set in the Vercel dashboard for this app to work in production.

## Current .env.local (all values are real — mask secrets in output)
\`\`\`
ANTHROPIC_API_KEY=<batch-scripts-only-not-needed-in-vercel>
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_cGxlYXNlZC1mYWxjb24tNjMuY2xlcmsuYWNjb3VudHMuZGV2JA
EXPO_PUBLIC_CLERK_FRONTEND_API=https://pleased-falcon-63.clerk.accounts.dev
CLERK_JWKS_URL=https://pleased-falcon-63.clerk.accounts.dev/.well-known/jwks.json
CLERK_SECRET_KEY=sk_test_YcVPhc5WmSmJBeMe2jWqziTkGONc2jXX2Ae1O1yDVP
EXPO_PUBLIC_SUPABASE_URL=https://rfmdlzaqvmhbzbgjwhqn.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_taFOoD4Vm60m5TJb40w7mw_9CiMY2at
EXPO_PUBLIC_SECURE_PROXY_URL=http://localhost:8081/api/secure-proxy   <-- MUST change for prod
EXPO_PUBLIC_ACCOUNT_ID=demo-account
EXPO_PUBLIC_USER_ID=local-user
SUPABASE_SERVICE_ROLE_KEY=sb_secret_Gk6VLpOpx6cWk46LzqBl_g_ajYz1FSP
EXPO_PUBLIC_FORECAST_API_URL=  (empty — AI forecasting disabled)
\`\`\`

## Key rules
- EXPO_PUBLIC_* vars are bundled into the client — safe to set in Vercel as "plain text" env vars.
- CLERK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, CLERK_JWKS_URL are server-only secrets — set as "secret" in Vercel.
- ANTHROPIC_API_KEY is for local batch scripts only — do NOT add to Vercel.
- EXPO_PUBLIC_SECURE_PROXY_URL must be changed to the production URL: \`https://<your-vercel-domain>/api/secure-proxy\`
  Use placeholder \`https://YOUR_VERCEL_DOMAIN/api/secure-proxy\` since the domain isn't known yet.
- EXPO_PUBLIC_ACCOUNT_ID and EXPO_PUBLIC_USER_ID are pre-auth placeholders — include them but note they'll be replaced once real auth is wired end-to-end.

## Output
Produce a markdown table with columns: Variable | Value | Type (plain/secret) | Notes
Then below it, the exact \`vercel env add\` CLI commands to set each variable (one command per line, using placeholder values for secrets).`,
        },
      ],
    },
  },

  // ── 4. .env.example update ───────────────────────────────────────────────
  {
    custom_id: 'ENV_EXAMPLE_UPDATE',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `## Task
Produce the complete updated \`.env.example\` file that documents all current env vars.

## Missing from .env.example (added in recent auth wiring)
- EXPO_PUBLIC_CLERK_FRONTEND_API
- CLERK_JWKS_URL
- CLERK_SECRET_KEY

## Rules
- Use FILL_ME_IN as placeholder for all secrets
- Use safe defaults (non-secret) where applicable
- Group by section with comment headers
- Include all variables currently used in the app
- NEVER include real values

## Variables to include (all of them)
1. ANTHROPIC_API_KEY — batch scripts only, not needed by app
2. EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY — leave blank for dev-bypass, set pk_* for Clerk auth
3. EXPO_PUBLIC_CLERK_FRONTEND_API — e.g. https://YOUR-INSTANCE.clerk.accounts.dev
4. CLERK_JWKS_URL — e.g. https://YOUR-INSTANCE.clerk.accounts.dev/.well-known/jwks.json
5. CLERK_SECRET_KEY — SERVER-ONLY, never expose to client
6. EXPO_PUBLIC_SUPABASE_URL — e.g. https://YOUR-PROJECT-ID.supabase.co
7. EXPO_PUBLIC_SUPABASE_ANON_KEY — Supabase publishable key (sb_publishable_* or anon key)
8. EXPO_PUBLIC_SECURE_PROXY_URL — http://localhost:8081/api/secure-proxy for local dev
9. EXPO_PUBLIC_FORECAST_API_URL — optional, leave blank to disable AI forecasting
10. EXPO_PUBLIC_ACCOUNT_ID — demo-account (pre-auth placeholder)
11. EXPO_PUBLIC_USER_ID — local-user (pre-auth placeholder)
12. SUPABASE_SERVICE_ROLE_KEY — SERVER-ONLY, Supabase secret key (sb_secret_* or service_role)

## Output
Complete .env.example file content. Start at line 1 with first # comment. No fences.`,
        },
      ],
    },
  },

  // ── 5. Deployment checklist ──────────────────────────────────────────────
  {
    custom_id: 'DEPLOY_CHECKLIST',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `## Task
Write a step-by-step Vercel deployment checklist for this Expo Router v5 + Clerk + Supabase app.

## Tech stack
- Expo SDK 53, React Native Web, Expo Router v5
- web.output: "server" (SSR mode, generates dist/server + dist/client)
- Clerk auth (pk_test_* publishable key, sk_test_* secret key)
- Supabase (sb_publishable_* anon key, sb_secret_* service role key)
- API route: app/api/secure-proxy+api.ts (runs as Vercel serverless function)
- No EAS — deploying web only to Vercel

## Known issues to address in checklist
1. @clerk/expo/token-cache is native-only — must use Platform.OS conditional on web
2. EXPO_PUBLIC_SECURE_PROXY_URL must be production URL, not localhost
3. All .env.local vars (except ANTHROPIC_API_KEY) must be in Vercel dashboard
4. Vercel project must be configured with framework = "Other" (not Next.js auto-detect)
5. Build command: npx expo export --platform web
6. Output directory: dist
7. Supabase CORS must allow the Vercel domain
8. Clerk dashboard must have the Vercel domain in allowed origins
9. After deploy, test: sign-up flow, data persistence per-account, API proxy

## Output
A markdown checklist (VERCEL_DEPLOY.md) with:
- Pre-deployment steps (code fixes, env setup)
- Vercel dashboard configuration
- DNS / domain steps
- Post-deployment verification
- Rollback instructions if needed

Be specific: include exact Vercel dashboard menu paths, exact env var names, exact URLs to configure in Supabase and Clerk.`,
        },
      ],
    },
  },
];

// ── Poll helper ──────────────────────────────────────────────────────────────

async function poll(batchId) {
  process.stdout.write('Polling');
  while (true) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status === 'ended') {
      console.log(' done.');
      return batch;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Creating Vercel deploy analysis batch (${requests.length} requests, claude-sonnet-4-6)…`);

  const batch = await client.messages.batches.create({ requests });
  console.log(`Batch ID: ${batch.id}`);

  await poll(batch.id);

  // Collect results
  const results = {};
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      results[result.custom_id] = stripFences(text);
    } else {
      console.error(`Request ${result.custom_id} failed:`, result.result);
    }
  }

  // Write raw results
  const resultPath = path.join(__dirname, 'vercel-deploy-result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ batchId: batch.id, results }, null, 2));
  console.log(`\nRaw results → ${resultPath}`);

  // ── Apply results ──────────────────────────────────────────────────────────

  // 1. Parse vercel.json from VERCEL_JSON result
  if (results.VERCEL_JSON) {
    console.log('\n─── VERCEL_JSON ───────────────────────────────────────');
    console.log(results.VERCEL_JSON);

    // Extract vercel.json section
    const vercelMatch = results.VERCEL_JSON.match(/### vercel\.json\s*([\s\S]*?)(?=### |$)/);
    if (vercelMatch) {
      const vercelContent = stripFences(vercelMatch[1].trim());
      try {
        JSON.parse(vercelContent); // validate JSON
        fs.writeFileSync(path.join(ROOT, 'vercel.json'), vercelContent + '\n');
        console.log('\n✓ vercel.json updated');
      } catch {
        console.warn('⚠  Could not auto-apply vercel.json — review output above and apply manually');
      }
    }

    // Print app.json and package.json sections for manual review
    const appJsonMatch = results.VERCEL_JSON.match(/### app\.json changes\s*([\s\S]*?)(?=### |$)/);
    if (appJsonMatch) {
      console.log('\n─── app.json changes needed ───────────────────────────');
      console.log(appJsonMatch[1].trim());
    }
    const pkgMatch = results.VERCEL_JSON.match(/### package\.json build script\s*([\s\S]*?)(?=### |$)/);
    if (pkgMatch) {
      console.log('\n─── package.json build script ─────────────────────────');
      console.log(pkgMatch[1].trim());
    }
  }

  // 2. Write TOKEN_CACHE_FIX to app/_layout.tsx
  if (results.TOKEN_CACHE_FIX) {
    const layoutPath = path.join(ROOT, 'app/_layout.tsx');
    fs.writeFileSync(layoutPath, results.TOKEN_CACHE_FIX + '\n');
    console.log('\n✓ app/_layout.tsx updated (token cache web fix)');
  }

  // 3. Print Vercel env vars table
  if (results.VERCEL_ENV_VARS) {
    console.log('\n─── VERCEL ENV VARS ───────────────────────────────────');
    console.log(results.VERCEL_ENV_VARS);
  }

  // 4. Write .env.example
  if (results.ENV_EXAMPLE_UPDATE) {
    const envExamplePath = path.join(ROOT, '.env.example');
    fs.writeFileSync(envExamplePath, results.ENV_EXAMPLE_UPDATE + '\n');
    console.log('\n✓ .env.example updated');
  }

  // 5. Write VERCEL_DEPLOY.md
  if (results.DEPLOY_CHECKLIST) {
    const checklistPath = path.join(ROOT, 'VERCEL_DEPLOY.md');
    fs.writeFileSync(checklistPath, results.DEPLOY_CHECKLIST + '\n');
    console.log(`✓ VERCEL_DEPLOY.md written → ${checklistPath}`);
    console.log('\n─── DEPLOY CHECKLIST PREVIEW (first 40 lines) ─────────');
    console.log(results.DEPLOY_CHECKLIST.split('\n').slice(0, 40).join('\n'));
    console.log('...\n(see VERCEL_DEPLOY.md for full checklist)');
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('Batch complete. Review the changes above before committing.');
  console.log('Next: run  npm test && npm run lint  then commit as CHG-034');
  console.log('──────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
