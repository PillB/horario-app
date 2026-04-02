/**
 * env-setup-batch.mjs
 *
 * Uses the Anthropic Batch API (claude-sonnet-4-6, ~50% off) to:
 *   1. Analyse every env-var usage across the codebase
 *   2. Determine which vars are required / optional / server-only
 *   3. Output a complete, annotated .env.local template
 *      with safe defaults pre-filled and clear FILL_ME_IN placeholders
 *      for secrets that must be supplied by the operator.
 *
 * Usage:
 *   node --env-file=.env.local scripts/env-setup-batch.mjs
 *
 * Output:
 *   scripts/env-setup-result.json   — raw batch result
 *   .env.local.template             — annotated template (review before use)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Gather context ──────────────────────────────────────────────────────────

const ENV_EXAMPLE = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

const ENV_USAGES = `
# Env var usages found across the codebase (file:line → expression):

contexts/IdentityContext.tsx:42   → process.env.EXPO_PUBLIC_ACCOUNT_ID ?? 'demo-account'
contexts/IdentityContext.tsx:43   → process.env.EXPO_PUBLIC_USER_ID ?? 'local-user'
contexts/IdentityContext.tsx:45   → (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_')
                                    Auth-wall toggle: if key starts with 'pk_', Clerk auth is active.
                                    Leave blank or set to a non-pk_ string → dev-bypass mode (no auth).

app/_layout.tsx:18                → process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''
app/(tabs)/_layout.tsx:17         → (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_')

app/api/secure-proxy+api.ts:11   → process.env.EXPO_PUBLIC_FORECAST_API_URL   (optional external AI)
app/api/secure-proxy+api.ts:12   → process.env.EXPO_PUBLIC_SUPABASE_URL        (REQUIRED — server side)
app/api/secure-proxy+api.ts:13   → process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
                                    Falls back from SUPABASE_SERVICE_ROLE_KEY → SUPABASE_SERVICE_KEY.
                                    Set SUPABASE_SERVICE_ROLE_KEY. NEVER prefix with EXPO_PUBLIC_.

services/supabaseClient.ts:8-9   → process.env.EXPO_PUBLIC_SUPABASE_URL
                                    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY   (REQUIRED — client side)

services/demandForecast.ts:42    → process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy'
services/usageService.ts:2       → process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? 'http://localhost:8081/api/secure-proxy'
services/onboardingProgress.ts:69 → process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy'
services/rosterService.ts:12     → process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy'
                                    Local dev default: http://localhost:8081/api/secure-proxy
                                    Production: https://<your-domain>/api/secure-proxy

hooks/useDemandForecast.ts:32    → Boolean(process.env.EXPO_PUBLIC_FORECAST_API_URL)
hooks/useSubscription.ts:12      → (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_')

# Clerk telemetry (optional, set in CI or locally to silence telemetry):
# CLERK_TELEMETRY_DISABLED=1
# CLERK_TELEMETRY_DEBUG=0
`;

const SYSTEM_PROMPT = `You are a DevOps / security expert writing environment configuration for a React Native / Expo app.

Rules you MUST follow:
1. NEVER output real API keys, tokens, or secrets — use FILL_ME_IN as placeholder for any secret.
2. NEVER prefix server-only secrets with EXPO_PUBLIC_.
3. Mark each variable with one of: [REQUIRED] [OPTIONAL] [SERVER-ONLY] [ALREADY_SET].
4. Safe defaults (non-secret, cannot cause security issues) may be pre-filled.
5. Output ONLY the .env.local file content — no markdown, no prose, no fences.
6. Use # comment lines liberally to explain every variable.
7. Group variables logically with section headers.
8. For the ANTHROPIC_API_KEY: mark it ALREADY_SET and leave the value as a placeholder — do NOT output the real key.`;

const USER_PROMPT = `Analyse the env vars below and produce a complete, deployment-ready .env.local template.

## .env.example (canonical reference):
${ENV_EXAMPLE}

## Env var usages in source code:
${ENV_USAGES}

## Rules for this project:
- EXPO_PUBLIC_* vars are safe to expose to the Expo client runtime.
- SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY are SERVER-ONLY (used only in app/api/secure-proxy+api.ts).
- ANTHROPIC_API_KEY is used only by offline batch scripts (not the app), mark ALREADY_SET.
- EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: leave blank for dev-bypass mode; set a real pk_* key to enable Clerk auth.
- EXPO_PUBLIC_ACCOUNT_ID and EXPO_PUBLIC_USER_ID: safe to pre-fill with 'demo-account' / 'local-user' for dev.
- EXPO_PUBLIC_SECURE_PROXY_URL: pre-fill with http://localhost:8081/api/secure-proxy for local dev.
- EXPO_PUBLIC_FORECAST_API_URL: optional — leave blank to disable AI forecasting.
- CLERK_TELEMETRY_DISABLED and CLERK_TELEMETRY_DEBUG: optional dev-comfort vars.

Output only the file content — start with the first # comment line, no preamble.`;

// ── Create batch ────────────────────────────────────────────────────────────

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

function stripFences(text) {
  return text
    .replace(/^```[^\n]*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
}

async function main() {
  console.log('Creating env-setup batch (claude-sonnet-4-6)…');

  const batch = await client.messages.batches.create({
    requests: [
      {
        custom_id: 'ENV_SETUP',
        params: {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: USER_PROMPT }],
        },
      },
    ],
  });

  console.log(`Batch ID: ${batch.id}`);
  await poll(batch.id);

  // ── Collect results ───────────────────────────────────────────────────────
  let template = '';
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const raw = result.result.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      template = stripFences(raw);
    } else {
      console.error('Batch request failed:', result.result);
      process.exit(1);
    }
  }

  // ── Write raw result ──────────────────────────────────────────────────────
  const resultPath = path.join(__dirname, 'env-setup-result.json');
  fs.writeFileSync(resultPath, JSON.stringify({ batchId: batch.id, template }, null, 2));
  console.log(`Raw result → ${resultPath}`);

  // ── Write template ────────────────────────────────────────────────────────
  const templatePath = path.join(ROOT, '.env.local.template');

  // Inject the ALREADY_SET marker for ANTHROPIC_API_KEY without revealing the value
  const finalTemplate = template.replace(
    /^(ANTHROPIC_API_KEY=).*$/m,
    '$1[ALREADY_SET — value preserved in .env.local, do not overwrite]',
  );

  fs.writeFileSync(templatePath, finalTemplate + '\n');
  console.log(`\nTemplate written → .env.local.template`);
  console.log('\n──────────────────────────────────────────────────');
  console.log(finalTemplate);
  console.log('──────────────────────────────────────────────────\n');

  // ── Security audit: list what still needs real values ────────────────────
  const needsValues = [];
  for (const line of finalTemplate.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (line.includes('FILL_ME_IN')) {
      const key = line.split('=')[0].trim();
      needsValues.push(key);
    }
  }

  if (needsValues.length > 0) {
    console.log('⚠  The following variables still need real values:');
    needsValues.forEach((k) => console.log(`   • ${k}`));
    console.log('\nProvide these values and then run:');
    console.log('  node scripts/apply-env-secrets.mjs   (or edit .env.local manually)');
  } else {
    console.log('✓ All variables have values — review .env.local.template then copy to .env.local');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
