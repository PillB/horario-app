/**
 * security-precommit-batch.mjs
 *
 * Batch API — claude-sonnet-4-6 (50% off)
 *
 * Requests:
 *   1. precommit-secretlintrc     → .secretlintrc.json
 *   2. precommit-husky            → .husky/pre-commit (shell script)
 *   3. precommit-gitleaks         → .gitleaks.toml
 *   4. security-proxy-analysis    → scripts/security-proxy-report.md
 *   5. security-services-analysis → scripts/security-services-report.md
 *   6. hooks-bugs-analysis        → scripts/hooks-bugs-report.md
 *   7. validation-analysis        → scripts/validation-report.md
 *   8. auth-flow-analysis         → scripts/auth-flow-report.md
 *   9. tests-security             → services/__tests__/secureProxy.test.ts
 *  10. tests-validation           → utils/__tests__/schedulerValidators.test.ts
 *
 * Usage:
 *   node --env-file=.env.local scripts/security-precommit-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs)
    ? fs.readFileSync(abs, 'utf8')
    : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|mjs|json|toml|sh|bash|shell|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

// ─── Read source files ────────────────────────────────────────────────────────

const SECURE_PROXY       = read('app/api/secure-proxy+api.ts');
const REFERRALS_API      = read('app/api/referrals+api.ts');
const SUPABASE_CLIENT    = read('services/supabaseClient.ts');
const DEMAND_FORECAST    = read('services/demandForecast.ts');
const ONBOARDING_SVC     = read('services/onboardingProgress.ts');
const AUTH_TOKEN_SVC     = read('services/authToken.ts');
const SCHEDULER_HANDLERS = read('hooks/useSchedulerHandlers.ts');
const USE_WORKERS        = read('hooks/useWorkers.ts');
const USE_ROSTER         = read('hooks/useRoster.ts');
const USE_SHIFT_TEMPLATES= read('hooks/useShiftTemplates.ts');
const SCHEDULER_VALIDATORS = read('utils/schedulerValidators.ts');
const SCHEDULER_UTILS    = read('utils/schedulerUtils.ts');
const SCHEDULER_METRICS  = read('utils/schedulerMetrics.ts');
const APP_LAYOUT         = read('app/_layout.tsx');
const TABS_LAYOUT        = read('app/(tabs)/_layout.tsx');
const SIGN_IN            = read('app/(auth)/sign-in.tsx');
const SIGN_UP            = read('app/(auth)/sign-up.tsx');
const GITIGNORE          = read('.gitignore');
const ENV_EXAMPLE        = read('.env.example');
const PKG_JSON           = read('package.json');

// Existing test for style reference
const USE_ROSTER_TEST    = read('hooks/__tests__/useRoster.test.tsx');
const SCHEDULER_VALIDATORS_EXISTING = read('hooks/__tests__/useDemandForecast.test.tsx');

// ─── System prompts ───────────────────────────────────────────────────────────

const SECURITY_SYSTEM = `You are a senior application security engineer specialising in Node.js, TypeScript, and React Native / Expo.

Rules:
- Perform thorough root-cause analysis for every issue
- Include CVSS-level severity (Critical / High / Medium / Low / Info)
- Provide exact, copy-paste-ready code fixes
- Consider OWASP Top 10 (injection, broken auth, sensitive data, XXE, broken access, security misconfig, XSS, insecure deserialization, known-vuln components, insufficient logging)
- Consider secrets management, SSRF, rate-limiting, input validation, error information leakage
- Format output as markdown with ## headings for each finding
- After findings, include a ## Summary section with a prioritised fix list`;

const TEST_SYSTEM = `You are a senior TypeScript/React Native test engineer.
Rules:
- Use jest + react-test-renderer + act (NO @testing-library/react-native)
- Import style: import React from 'react'; import renderer, { act } from 'react-test-renderer';
- Mock fetch via: (global as unknown as { fetch: jest.Mock }).fetch = jest.fn()
- Mock modules with jest.mock() at the top level, before imports
- TypeScript strict mode — no 'any' unless absolutely necessary, use proper types
- Spy on console.warn / console.error and restore in afterEach
- Use jest.clearAllMocks() in beforeEach
- Each test must have a descriptive name and test ONE behaviour
- Export nothing — test files are scripts
- Return ONLY the complete file content. No markdown fences. No explanations.`;

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── 1: .secretlintrc.json ──────────────────────────────────────────────────
  {
    custom_id: '1-precommit-secretlintrc',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generate a production-quality .secretlintrc.json for this Expo React Native TypeScript project.

Project details:
- Uses: Supabase (anon key + service role key), Clerk (publishable key + secret key), Anthropic API key, Expo/Vercel env vars
- All secrets live in .env.local (gitignored via .env*.local)
- Public env vars prefixed with EXPO_PUBLIC_ (safe to commit)
- Private: SUPABASE_SERVICE_ROLE_KEY, CLERK_SECRET_KEY, ANTHROPIC_API_KEY

Existing .gitignore includes:
${GITIGNORE}

Existing .env.example (safe template — NO real values):
${ENV_EXAMPLE}

Requirements for .secretlintrc.json:
1. Use @secretlint/secretlint-rule-preset-recommend
2. Add specific rules for: AWS keys, GitHub tokens, Slack tokens, GCP keys, Anthropic API keys (sk-ant-*), Supabase service role keys (sb_secret_*), Clerk secret keys (sk_test_* / sk_live_*)
3. Add allowlist patterns for: EXPO_PUBLIC_ prefixed vars (safe), placeholder values (FILL_ME_IN, YOUR_KEY_HERE, xxx, sk-ant-api-PLACEHOLDER), test/example values in .env.example and .env.local.template
4. Ignore paths: node_modules/, dist/, .expo/, scripts/*.json (batch result files that may contain model outputs), playwright-report/, test-results/

Return ONLY valid JSON. No markdown fences. No explanations.`,
      }],
    },
  },

  // ── 2: .husky/pre-commit ──────────────────────────────────────────────────
  {
    custom_id: '2-precommit-husky',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Generate a .husky/pre-commit shell script for this Node.js/TypeScript project.

The hook must:
1. Run lint-staged (handles secretlint + ESLint on staged files)
2. Run TypeScript typecheck (npx tsc --noEmit) — but only if there are staged .ts or .tsx files (for speed)
3. Be POSIX-compatible (#!/bin/sh)
4. Exit with non-zero on failure

The lint-staged config (already in package.json) handles:
- Secretlint on all staged files
- ESLint --fix on staged .ts/.tsx files

Return ONLY the shell script content starting with #!/bin/sh. No markdown fences. No explanations.`,
      }],
    },
  },

  // ── 3: .gitleaks.toml ────────────────────────────────────────────────────
  {
    custom_id: '3-precommit-gitleaks',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generate a .gitleaks.toml configuration for this Expo React Native TypeScript project.

Requirements:
1. Use gitleaks v8 TOML format
2. Extend from the default ruleset
3. Add custom rules for:
   - Anthropic API keys: pattern sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{93}
   - Supabase service role keys: pattern sb_secret_[A-Za-z0-9_-]+
   - Clerk secret keys: pattern sk_(test|live)_[A-Za-z0-9]+
   - Supabase publishable (anon) keys: pattern sb_publishable_[A-Za-z0-9_-]+
4. Add allowlist for:
   - .env.example and .env.local.template (template files)
   - scripts/*.json (batch result files)
   - node_modules/
   - dist/, .expo/, web-build/
   - playwright-report/, test-results/
   - Any line containing FILL_ME_IN or YOUR_KEY_HERE
5. Title: "Horario App — gitleaks config"

Return ONLY valid TOML. No markdown fences. No explanations.`,
      }],
    },
  },

  // ── 4: Security analysis — secure-proxy+api.ts ───────────────────────────
  {
    custom_id: '4-security-proxy',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SECURITY_SYSTEM,
      messages: [{
        role: 'user',
        content: `Perform a comprehensive security analysis of this Expo Router API route that acts as a secure proxy to Supabase (using the service-role key). This runs server-side on Vercel.

## File: app/api/secure-proxy+api.ts

\`\`\`typescript
${SECURE_PROXY}
\`\`\`

## Supporting files

### services/authToken.ts
\`\`\`typescript
${AUTH_TOKEN_SVC}
\`\`\`

### .env.example (shows env vars in use)
\`\`\`
${ENV_EXAMPLE}
\`\`\`

Analyse for:
1. Authentication bypass vulnerabilities
2. Authorization/privilege escalation risks
3. Injection attacks (SQL injection via Supabase query params, header injection)
4. SSRF risks (outbound requests to FORECAST_API_URL, CLERK_JWKS_URL)
5. Rate limiting (absent? needs adding?)
6. Input validation gaps (user-controlled params passed to DB queries)
7. Error information leakage (stack traces, internal details in 4xx/5xx responses)
8. CORS misconfiguration
9. Missing security headers (CSP, X-Frame-Options, etc.)
10. JWT verification correctness (algorithm confusion, missing claims validation, clock skew)
11. Supabase service-role key exposure risks
12. Request size limits (missing body size validation?)
13. Secrets in logs

For each finding: describe root cause, impact, exploitation scenario, and provide exact TypeScript code fix.`,
      }],
    },
  },

  // ── 5: Security + bug analysis — services ────────────────────────────────
  {
    custom_id: '5-security-services',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: SECURITY_SYSTEM,
      messages: [{
        role: 'user',
        content: `Perform a security and bug analysis of these client-side service files for a React Native Expo app.

## services/supabaseClient.ts
\`\`\`typescript
${SUPABASE_CLIENT}
\`\`\`

## services/demandForecast.ts
\`\`\`typescript
${DEMAND_FORECAST}
\`\`\`

## services/onboardingProgress.ts
\`\`\`typescript
${ONBOARDING_SVC}
\`\`\`

## services/authToken.ts
\`\`\`typescript
${AUTH_TOKEN_SVC}
\`\`\`

Analyse for:
1. Exposed secrets / env var misuse (any server-only secret used client-side?)
2. Missing authentication on mutating operations
3. Unvalidated inputs passed to Supabase/proxy requests
4. Race conditions in async flows
5. Stale closures or missing cleanup
6. Error handling gaps (swallowed errors, no user feedback)
7. Type safety gaps (any casts, missing null checks)
8. Fetch error handling (network errors vs HTTP errors vs JSON parse errors)
9. Missing request timeout handling
10. Missing sanitization of user-supplied strings before use in requests

For each finding: root cause, severity, exact code fix.`,
      }],
    },
  },

  // ── 6: Bug analysis — hooks ───────────────────────────────────────────────
  {
    custom_id: '6-hooks-bugs',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are a senior React/React Native engineer specialising in hooks, async state management, and TypeScript.

Rules:
- Identify actual bugs (not style preferences)
- Include root-cause analysis for each finding
- Provide exact, copy-paste-ready TypeScript code fixes
- Rate severity: Critical (data loss/crash) / High (incorrect behaviour) / Medium (edge case) / Low (cosmetic/minor)
- Format as markdown with ## headings`,
      messages: [{
        role: 'user',
        content: `Analyse these React Native hooks for bugs, race conditions, and incorrect implementations.

## hooks/useSchedulerHandlers.ts
\`\`\`typescript
${SCHEDULER_HANDLERS}
\`\`\`

## hooks/useWorkers.ts
\`\`\`typescript
${USE_WORKERS}
\`\`\`

## hooks/useRoster.ts
\`\`\`typescript
${USE_ROSTER}
\`\`\`

## hooks/useShiftTemplates.ts
\`\`\`typescript
${USE_SHIFT_TEMPLATES}
\`\`\`

Look for:
1. Missing useEffect cleanup (timer leaks, subscription leaks, request cancellation)
2. Race conditions (concurrent fetches, stale closures)
3. Missing or incorrect dependency arrays
4. State updates on unmounted components
5. Mutations of objects/arrays stored in state (reference equality bugs)
6. Missing error boundaries or error state management
7. Incorrect optimistic update rollbacks
8. TypeScript type gaps (any, missing null checks, incorrect types)
9. Logic errors in computed/derived values
10. Missing input validation before service calls

For each: describe exact bug, root cause, severity, and fix.`,
      }],
    },
  },

  // ── 7: Input validation analysis ─────────────────────────────────────────
  {
    custom_id: '7-validation-analysis',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: `You are a senior TypeScript engineer specialising in form validation and user input security.

Rules:
- Identify all user-controlled inputs and trace them to their usage
- Check for missing validation, incorrect validation, and missing sanitization
- Provide root-cause analysis and exact TypeScript code fixes
- Format as markdown`,
      messages: [{
        role: 'user',
        content: `Analyse the input validation in this scheduling application.

## utils/schedulerValidators.ts (validation logic)
\`\`\`typescript
${SCHEDULER_VALIDATORS}
\`\`\`

## utils/schedulerUtils.ts (utilities)
\`\`\`typescript
${SCHEDULER_UTILS}
\`\`\`

## hooks/useSchedulerHandlers.ts (handlers that call validators)
\`\`\`typescript
${SCHEDULER_HANDLERS}
\`\`\`

Check for:
1. User inputs passed to Supabase/proxy without validation
2. Time format validation gaps (e.g. "25:99" accepted as valid time)
3. Date validation gaps (e.g. past dates, invalid dates, timezone edge cases)
4. String length limits missing (worker names, shift template names)
5. Special character sanitization (names with quotes, HTML-like content)
6. Role name validation (whitespace-only, very long strings)
7. Coverage number validation (negative numbers, non-integer, Infinity, NaN)
8. Availability overlap detection edge cases
9. Missing required field validation
10. Error messages that don't help users fix the problem

For each finding: root cause, where the gap is, exact fix.`,
      }],
    },
  },

  // ── 8: Auth/navigation flow analysis ─────────────────────────────────────
  {
    custom_id: '8-auth-flow',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SECURITY_SYSTEM,
      messages: [{
        role: 'user',
        content: `Analyse the authentication and navigation flow of this Expo Router React Native app.

## app/_layout.tsx (root layout — Clerk provider, auth gate)
\`\`\`typescript
${APP_LAYOUT}
\`\`\`

## app/(tabs)/_layout.tsx (tab layout — auth guard redirect)
\`\`\`typescript
${TABS_LAYOUT}
\`\`\`

## app/(auth)/sign-in.tsx
\`\`\`typescript
${SIGN_IN}
\`\`\`

## app/(auth)/sign-up.tsx
\`\`\`typescript
${SIGN_UP}
\`\`\`

Analyse for:
1. Auth bypass vulnerabilities (can unauthenticated users access protected routes?)
2. Race conditions in auth state transitions (flash of protected content)
3. Missing loading states (content shown before auth check completes)
4. Session token leakage (stored insecurely, logged, exposed to client)
5. CSRF risks
6. Missing CAPTCHA/bot protection on sign-up/sign-in
7. Missing account lockout / brute force protection
8. Navigation security (can deep links bypass auth?)
9. Dev bypass mode (authEnabled=false) — is it safe? Could it leak to production?
10. Input validation on sign-in/sign-up forms (email format, password strength, XSS)

For each finding: severity, root cause, exact fix.`,
      }],
    },
  },

  // ── 9: Security tests — secure-proxy ─────────────────────────────────────
  {
    custom_id: '9-tests-security',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: TEST_SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for the secure-proxy API route's auth/security logic.

## Source under test: app/api/secure-proxy+api.ts
\`\`\`typescript
${SECURE_PROXY.slice(0, 8000)}
\`\`\`

## Key types and helpers to know:
- The file exports no functions directly — it handles GET/POST/OPTIONS via named exports
- verifyClerkToken is internal but can be tested via POST requests
- AUTH_ENABLED is controlled by EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY env var

## Style reference:
\`\`\`typescript
${USE_ROSTER_TEST.slice(0, 600)}
\`\`\`

## Test cases to cover:
1. OPTIONS request returns CORS headers (200 OK)
2. POST without Authorization header when AUTH_ENABLED=true → 401
3. POST with invalid JWT (malformed, not 3 parts) → 401
4. POST with expired JWT → 401
5. POST with valid-looking JWT but wrong signature → 401
6. POST with missing action field → 400
7. POST with unknown action → 400
8. POST with valid JWT but Supabase credentials missing → 500
9. verifyClerkToken: token with correct kid selects right JWK key
10. verifyClerkToken: token without kid falls back to first key
11. JWKS cache: second call within TTL does not refetch (fetch called once)
12. JWKS cache: expired TTL refetches (fetch called twice)
13. POST onboarding/get — returns onboarding data when auth passes
14. POST onboarding/upsert with invalid body → 400
15. Rate limiting absent: document and assert that rapid repeated requests all succeed (no 429) — this documents the gap

Note: mock crypto module for verifyClerkToken tests. Mock fetch globally.
Output file path: services/__tests__/secureProxy.test.ts`,
      }],
    },
  },

  // ── 10: Validation unit tests ─────────────────────────────────────────────
  {
    custom_id: '10-tests-validation',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: TEST_SYSTEM,
      messages: [{
        role: 'user',
        content: `Write a complete Jest test file for utils/schedulerValidators.ts.

## Source under test:
\`\`\`typescript
${SCHEDULER_VALIDATORS}
\`\`\`

## Supporting utils (used by validators):
\`\`\`typescript
${SCHEDULER_UTILS.slice(0, 3000)}
\`\`\`

## Test cases to cover:

### findCoveringAvailability
1. Worker has exact coverage (08:00-16:00 covers 09:00-17:00 → false, not covering)
2. Worker has overage coverage (07:00-18:00 covers 09:00-17:00 → coveringSlot set)
3. Worker has no availability → coveringSlot is null
4. Worker availability on wrong day → coveringSlot null
5. Timezone offset pushes date to different weekday → correct weekday used
6. Worker role doesn't match template role → slot returned but role mismatch visible (validator handles mismatch separately)

### validateAvailabilitySubmission
7. Valid submission → no errors
8. Invalid day (not a weekday abbreviation) → error with code 'INVALID_DAY'
9. Invalid from time format (e.g. "25:00", "abc", "9:00am") → error code 'INVALID_TIME_FORMAT'
10. Invalid to time format → error code 'INVALID_TIME_FORMAT'
11. to <= from → error code 'INVALID_TIME_RANGE'
12. Overlaps existing availability on same day → error code 'AVAILABILITY_OVERLAP'
13. Duplicate exact slot → error code 'AVAILABILITY_OVERLAP'
14. Worker has no existing availability → no overlap errors

### validateShiftReadiness
15. Template not found → error 'TEMPLATE_NOT_FOUND'
16. Worker not found → error 'WORKER_NOT_FOUND'
17. Role mismatch (worker.role !== template.role) → error 'ROLE_MISMATCH'
18. Availability does not cover shift window → error 'AVAILABILITY_GAP'
19. Shift overlaps another shift on same date → error 'SHIFT_OVERLAP'
20. Valid shift → empty errors array, isValid=true

Output file path: utils/__tests__/schedulerValidators.test.ts`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`\nSubmitting ${requests.length} requests to Anthropic Batch API (claude-sonnet-4-6)…`);

const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID : ${batch.id}`);
console.log(`Status   : ${batch.processing_status}`);

// Save batch ID for recovery
write('scripts/security-precommit-batch-id.txt', batch.id);

console.log(`\nPolling every 30 s…\n`);

// ─── Poll ─────────────────────────────────────────────────────────────────────

let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 30_000));
  current = await client.messages.batches.retrieve(batch.id);
  const c = current.request_counts;
  console.log(
    `[${new Date().toISOString()}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`,
  );
}

console.log('\nBatch complete. Writing results…\n');

// ─── Output map ───────────────────────────────────────────────────────────────

const OUTPUT_MAP = {
  '1-precommit-secretlintrc': '.secretlintrc.json',
  '2-precommit-husky':        '.husky/pre-commit',
  '3-precommit-gitleaks':     '.gitleaks.toml',
  '4-security-proxy':         'scripts/security-proxy-report.md',
  '5-security-services':      'scripts/security-services-report.md',
  '6-hooks-bugs':             'scripts/hooks-bugs-report.md',
  '7-validation-analysis':    'scripts/validation-report.md',
  '8-auth-flow':              'scripts/auth-flow-report.md',
  '9-tests-security':         'services/__tests__/secureProxy.test.ts',
  '10-tests-validation':      'utils/__tests__/schedulerValidators.test.ts',
};

// IDs that should NOT have fences stripped (markdown reports)
const MARKDOWN_IDS = new Set([
  '4-security-proxy',
  '5-security-services',
  '6-hooks-bugs',
  '7-validation-analysis',
  '8-auth-flow',
]);

// ─── Collect results ──────────────────────────────────────────────────────────

const summary = { succeeded: 0, failed: 0 };

for await (const result of await client.messages.batches.results(batch.id)) {
  const id = result.custom_id;
  const outPath = OUTPUT_MAP[id];

  if (!outPath) {
    console.warn(`  ! Unknown custom_id: ${id}`);
    continue;
  }

  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${id} — ${result.result.type}`);
    if (result.result.type === 'errored') console.error('    ', result.result.error);
    summary.failed++;
    continue;
  }

  const content = result.result.message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const finalContent = MARKDOWN_IDS.has(id) ? content.trim() : stripFences(content);
  write(outPath, finalContent);
  summary.succeeded++;
}

console.log(`\n✅ Done: ${summary.succeeded} succeeded, ${summary.failed} failed`);
console.log('\nNext steps:');
console.log('  1. Review security reports in scripts/*.md');
console.log('  2. Run: npm install (to get husky + secretlint + lint-staged)');
console.log('  3. Run: npx husky install');
console.log('  4. Run: chmod +x .husky/pre-commit');
console.log('  5. Run: npm test');
console.log('  6. Apply fixes from security reports');
