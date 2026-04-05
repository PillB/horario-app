/**
 * deps-eslint-fix-batch.mjs
 *
 * Batch API — claude-sonnet-4-6 (50% off)
 *
 * Requests:
 *   1. npm-eresolve-analysis    → root-cause + version fix analysis
 *   2. capability-matrix-fix    → CapabilityMatrix.tsx with unused import removed
 *   3. sync-status-bar-fix      → SyncStatusBar.tsx with unused variable resolved
 *   4. changelog-entry          → CHG-063 entry for Claude_changes.md
 *
 * Usage:
 *   node --env-file=.env.local scripts/deps-eslint-fix-batch.mjs
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

const PKG_JSON          = read('package.json');
const CAPABILITY_MATRIX = read('components/CapabilityMatrix.tsx');
const SYNC_STATUS_BAR   = read('components/SyncStatusBar.tsx');

const client = new Anthropic();

// ─── Batch requests ───────────────────────────────────────────────────────────

const requests = [

  // ── 1: npm ERESOLVE root-cause analysis ──────────────────────────────────
  {
    custom_id: '1-npm-eresolve-analysis',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are a senior Node.js/TypeScript engineer. Perform a root-cause analysis of this npm ERESOLVE error and provide a complete fix.

## Error

\`\`\`
npm error ERESOLVE could not resolve

While resolving: @types/react-dom@19.2.3
Found: @types/react@19.0.14
node_modules/@types/react
  dev @types/react@"~19.0.10" from the root project
  peerOptional @types/react@"*" from @radix-ui/react-compose-refs@1.1.2
  ...

Could not resolve dependency:
peer @types/react@"^19.2.0" from @types/react-dom@19.2.3
node_modules/@types/react-dom
  dev @types/react-dom@"^19.2.3" from the root project

Conflicting peer dependency: @types/react@19.2.14
\`\`\`

## Current package.json (devDependencies excerpt)

\`\`\`json
"@types/react": "~19.0.10",
"@types/react-dom": "^19.2.3",
\`\`\`

## Full package.json

\`\`\`json
${PKG_JSON}
\`\`\`

Provide:
1. **Root cause**: Why exactly does this conflict occur? Explain the semver semantics.
2. **Correct fix**: What should \`@types/react\` be changed to, and why (prefer \`~\` or \`^\`, and which minor version)?
3. **Side effects**: Are there any TypeScript breaking changes between @types/react 19.0.x and 19.2.x? Will this affect the runtime (react@19.0.0)?
4. **Verification**: What command confirms the fix?

Format as markdown. Be concise.`,
      }],
    },
  },

  // ── 2: CapabilityMatrix.tsx — remove unused AccessibilityInfo import ────
  {
    custom_id: '2-capability-matrix-fix',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are a senior TypeScript/React Native engineer. Fix the ESLint warning in this file.

## ESLint warning

\`\`\`
/components/CapabilityMatrix.tsx
  16:3  warning  'AccessibilityInfo' is defined but never used  @typescript-eslint/no-unused-vars
\`\`\`

## File: components/CapabilityMatrix.tsx

\`\`\`typescript
${CAPABILITY_MATRIX}
\`\`\`

## Instructions

1. Remove \`AccessibilityInfo\` from the React Native import (it is imported but never used in the component body).
2. Do NOT make any other changes — no refactoring, no reformatting, no adding features.
3. Verify there are no other unused imports or variables to ensure ESLint passes.

Return ONLY the complete fixed file content. No markdown fences. No explanations.`,
      }],
    },
  },

  // ── 3: SyncStatusBar.tsx — resolve unused colors variable ───────────────
  {
    custom_id: '3-sync-status-bar-fix',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      messages: [{
        role: 'user',
        content: `You are a senior TypeScript/React Native engineer. Fix the ESLint warning in this file.

## ESLint warning

\`\`\`
/components/SyncStatusBar.tsx
  34:9  warning  'colors' is assigned a value but never used  @typescript-eslint/no-unused-vars
\`\`\`

## File: components/SyncStatusBar.tsx

\`\`\`typescript
${SYNC_STATUS_BAR}
\`\`\`

## Analysis

Line 34: \`const colors: ThemeColors = Colors[colorScheme ?? 'light'];\`

The \`colors\` variable is computed but never used. The \`styles\` object uses hardcoded color values (\`'#E5E7EB'\`, \`'#15803D'\`, \`'#DC2626'\`, \`'#FFFFFF'\`, \`'#6B7280'\`) and \`brand.*\` constants instead of \`colors.*\` properties.

## Decision

Determine the correct fix:
- Option A: Remove the unused \`colors\` variable (and \`Colors\`, \`ThemeColors\` imports if also unused)
- Option B: Use \`colors\` to replace hardcoded values for proper dark-mode theming

Check if \`Colors\` or \`ThemeColors\` are used elsewhere in the file after removing \`colors\`. Apply the minimal correct fix that eliminates the warning without introducing regressions.

Do NOT make any other changes beyond what is required to fix the warning.

Return ONLY the complete fixed file content. No markdown fences. No explanations.`,
      }],
    },
  },

  // ── 4: CHG-063 changelog entry ───────────────────────────────────────────
  {
    custom_id: '4-changelog-entry',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Write a CHG-063 entry for Claude_changes.md for these two fixes:

1. **npm ERESOLVE fix**: Changed \`@types/react\` from \`~19.0.10\` to \`~19.2.0\` in package.json to satisfy the peer dependency requirement of \`@types/react-dom@^19.2.3\` (which requires \`@types/react@^19.2.0\`).

2. **ESLint pre-commit fix (2 warnings)**:
   - \`components/CapabilityMatrix.tsx\`: Removed unused \`AccessibilityInfo\` import from React Native import block.
   - \`components/SyncStatusBar.tsx\`: Removed unused \`colors\` variable (and associated unused \`Colors\`/\`ThemeColors\` imports) since the component's styles use hardcoded color constants.

Format exactly like this existing entry:

---
### CHG-062 — 2026-04-04 UTC
**Type:** DOCS (...)
**Changes:**
1. ...
**Files changed:**
- ...
**Tests:** N/N passing (no code changes).
---

Use today's date: 2026-04-05 UTC. Use CHG-063. Keep it concise.
Return ONLY the markdown entry (starting with ---). No fences.`,
      }],
    },
  },
];

// ─── Submit batch ─────────────────────────────────────────────────────────────

console.log(`\nSubmitting ${requests.length} requests to Anthropic Batch API (claude-sonnet-4-6)…`);

const batch = await client.messages.batches.create({ requests });
console.log(`Batch ID : ${batch.id}`);
console.log(`Status   : ${batch.processing_status}`);

write('scripts/deps-eslint-fix-batch-id.txt', batch.id);

console.log(`\nPolling every 15 s…\n`);

// ─── Poll ─────────────────────────────────────────────────────────────────────

let current = batch;
while (current.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 15_000));
  current = await client.messages.batches.retrieve(batch.id);
  const c = current.request_counts;
  console.log(
    `[${new Date().toISOString()}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`,
  );
}

console.log('\nBatch complete. Processing results…\n');

// ─── Collect results ──────────────────────────────────────────────────────────

const results = {};
for await (const result of await client.messages.batches.results(batch.id)) {
  if (result.result.type !== 'succeeded') {
    console.error(`  ✗ ${result.custom_id} — ${result.result.type}`);
    if (result.result.type === 'errored') console.error('    ', result.result.error);
    continue;
  }
  results[result.custom_id] = result.result.message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// ─── Apply results ────────────────────────────────────────────────────────────

// 1. Print analysis (informational only — package.json fix is manual)
if (results['1-npm-eresolve-analysis']) {
  console.log('\n═══ npm ERESOLVE Analysis ═══\n');
  console.log(results['1-npm-eresolve-analysis']);
  write('scripts/npm-eresolve-analysis.md', results['1-npm-eresolve-analysis']);
}

// 2. Write fixed component files
if (results['2-capability-matrix-fix']) {
  write('components/CapabilityMatrix.tsx', stripFences(results['2-capability-matrix-fix']));
}

if (results['3-sync-status-bar-fix']) {
  write('components/SyncStatusBar.tsx', stripFences(results['3-sync-status-bar-fix']));
}

// 3. Prepend changelog entry
if (results['4-changelog-entry']) {
  const changelogPath = path.join(ROOT, 'Claude_changes.md');
  const existingChangelog = fs.readFileSync(changelogPath, 'utf8');
  const entry = results['4-changelog-entry'].trim();
  // Insert after the header block (after first ---)
  const insertAfter = '> Never delete old entries — only append.\n\n---';
  const updated = existingChangelog.replace(
    insertAfter,
    `${insertAfter}\n\n${entry}`,
  );
  fs.writeFileSync(changelogPath, updated, 'utf8');
  console.log('  ✓ prepended CHG-063 to Claude_changes.md');
}

// 4. Apply package.json fix programmatically
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVersion = pkg.devDependencies['@types/react'];
pkg.devDependencies['@types/react'] = '~19.2.0';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`  ✓ package.json: @types/react ${oldVersion} → ~19.2.0`);

console.log('\n✅ All fixes applied.');
console.log('\nNext steps:');
console.log('  1. npm install   (regenerates package-lock.json)');
console.log('  2. npm test      (verify 0 regressions)');
console.log('  3. npm run lint  (verify 0 warnings)');
