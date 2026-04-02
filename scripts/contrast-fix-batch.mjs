/**
 * contrast-fix-batch.mjs
 *
 * Phase: Contrast/Readability fixes — Batch API code generation.
 * Model: claude-sonnet-4-6  (50% off standard pricing)
 *
 * For every file that has contrast/readability findings, submits one batch
 * request containing:
 *   - The original file source
 *   - The exact audit findings for that file
 *   - The design token reference
 *   - Instructions to return the COMPLETE corrected file
 *
 * After the batch completes, writes all fixed files back to disk.
 *
 * Usage:
 *   node --env-file=.env.local scripts/contrast-fix-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|css)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

function abbreviate(relPath) {
  return relPath
    .replace('app/(tabs)/', 'TAB_')
    .replace('app/', 'APP_')
    .replace('components/scheduler/', 'SCHED_')
    .replace('components/ui/', 'UI_')
    .replace('components/', 'COMP_')
    .replace('styles/', 'STY_')
    .replace(/\.tsx?$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toUpperCase()
    .slice(0, 16);
}

// ─── Design token reference ───────────────────────────────────────────────────

const COLORS_SOURCE = read('constants/Colors.ts');

const TOKEN_GUIDE = `
## Horario Design Token Reference (constants/Colors.ts)
\`\`\`typescript
${COLORS_SOURCE}
\`\`\`

## WCAG-safe token substitutions — apply these everywhere

### Text colour on light backgrounds (Colors.light.background / surface)
| Use case               | Token                     | Ratio vs white |
|------------------------|---------------------------|----------------|
| Primary body text      | Colors[scheme].text       | ≥17.85:1 AAA  |
| Secondary / captions   | Colors[scheme].textSecondary | ≥6.86:1 AA  |
| Hint / placeholder     | Colors[scheme].textTertiary  | ≥4.35:1 AA  |
| NEVER use for text     | brand.accent (#F59E0B)    | 2.08:1 FAIL   |
| NEVER use for body txt | brand.primary (#0D9488)   | 3.06:1 FAIL   |
| OK for large/bold text | brand.primaryDark (#0F766E) | 4.01:1 AA-L  |
| OK for all text        | brand.primaryDeep (#115E59) | 5.87:1 AA    |

### White text on coloured backgrounds
| Background             | White contrast |
|------------------------|----------------|
| brand.primary #0D9488  | 6.88:1 ✅ AA  |
| brand.primaryDark      | 9.30:1 ✅ AAA |
| brand.pro #7C3AED      | 5.17:1 ✅ AA  |
| brand.error #EF4444    | 4.55:1 ✅ AA  |
| brand.accent #F59E0B   | 2.25:1 ❌ use dark text |

### Dark text (#0F172A) on coloured backgrounds
| Background             | Dark text contrast |
|------------------------|-------------------|
| brand.accent #F59E0B   | 12.60:1 ✅ AAA   |
| brand.primaryLight     | 11.40:1 ✅ AAA   |

### Dark mode: use colorScheme-aware tokens
Always derive colours from \`Colors[colorScheme ?? 'light']\` or use \`useColorScheme()\`.
Hardcoded hex like \`#ffffff\`, \`#000000\`, \`#111827\`, \`#E5E7EB\` must become tokens.

### Import pattern (already used throughout the codebase)
\`\`\`typescript
import { Colors, brand } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
// Inside component:
const colorScheme = useColorScheme();
const colors = Colors[colorScheme ?? 'light'];
// In StyleSheet.create — pass colors in:
const makeStyles = (colors: ThemeColors) => StyleSheet.create({ ... });
// OR access inline via Colors.light / Colors.dark for static sheets
\`\`\`
`;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert React Native / Expo TypeScript engineer specialising in WCAG 2.1 colour contrast and dark-mode theming.

${TOKEN_GUIDE}

## Your task
You will receive:
1. A source file from the Horario app
2. A list of contrast/visibility/readability findings from an audit

Apply ALL findings as fixes to produce a corrected version of the file.

## Fix rules
1. Replace every hardcoded hex colour with the appropriate design token from the reference table above.
2. For StyleSheet.create() in files that use useColorScheme(), convert the static sheet to a function \`makeStyles(colors: ThemeColors)\` called inside the component, so styles access live theme values. If the file already does this, extend the pattern consistently.
3. For files that cannot call hooks (e.g. pure style files like scheduler.styles.ts), export a factory function \`makeSchedulerStyles(colors: ThemeColors)\` and update the import in scheduler.tsx to call it with the live colors.
4. Fix brand.primary (#0D9488) used as body text colour → use brand.primaryDark or Colors[scheme].text depending on context.
5. Fix brand.accent (#F59E0B) used as text → replace with brand.accentDark (#D97706) for large/bold text, or Colors[scheme].text for body.
6. Fix disabled-state styles to have visually distinct opacity (0.4–0.5) or colour.
7. Fix pressed-state styles to have a clearly visible colour change.
8. Fix placeholder/hint text to use Colors[scheme].textTertiary minimum.
9. Do NOT change logic, component APIs, prop types, or test behaviour.
10. Do NOT add new features, components, or abstractions.
11. Do NOT change anything unrelated to contrast/visibility/readability.
12. Preserve ALL existing comments, file header, and non-style code exactly.

## Response format
Return ONLY the complete corrected file source code.
No markdown fences, no explanation, no prose. Raw source code only.
Start your response with the first character of the file (usually '/' for the comment block or 'import').`;

// ─── Load audit results ───────────────────────────────────────────────────────

const auditResults = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'contrast-audit-results.json'), 'utf8')
);

// ─── Build batch requests ─────────────────────────────────────────────────────

const requests = [];
const skipped = [];

for (const fileResult of auditResults.findings) {
  const relPath = fileResult.file;
  if (!relPath) continue;

  const source = read(relPath);
  if (!source) { skipped.push(relPath); continue; }

  const findings = (fileResult.findings ?? []);
  if (findings.length === 0) continue;

  // Format findings as a concise checklist for the prompt
  const findingsList = findings.map((f, i) =>
    `[${i + 1}] ${f.severity} | ${f.category} | line ${f.line_hint ?? '?'} | ${f.element ?? '?'}\n    Problem: ${f.description}\n    Foreground: ${f.foreground ?? '?'}  Background: ${f.background ?? '?'}  Ratio: ${f.computed_ratio ?? '?'} (need ${f.required_ratio ?? '?'})\n    Fix: ${f.proposed_fix}`
  ).join('\n\n');

  const customId = abbreviate(relPath);

  // Larger token budget for bigger files
  const lineCount = source.split('\n').length;
  const maxTokens = lineCount > 400 ? 8192 : lineCount > 200 ? 6144 : 4096;

  requests.push({
    custom_id: customId,
    _relPath: relPath,   // kept locally, not sent to API
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Fix all contrast/visibility/readability issues in: ${relPath}

## Findings to fix (${findings.length} total)

${findingsList}

## Original source

\`\`\`tsx
${source}
\`\`\`

Return the complete corrected file. No fences, no explanation.`,
      }],
    },
  });
}

if (skipped.length) console.warn(`⚠  Skipped (not found): ${skipped.join(', ')}`);

// ─── Submit batch ─────────────────────────────────────────────────────────────

// Build the map before stripping _relPath from params
const idToPath = Object.fromEntries(requests.map(r => [r.custom_id, r._relPath]));
// Strip our internal field before sending
const apiRequests = requests.map(({ _relPath: _, ...r }) => r);

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`\n📤 Submitting contrast fix batch (${apiRequests.length} files)…`);
  console.log('   Model  : claude-sonnet-4-6');
  console.log('   Pricing: ~50% off standard ($1.50/$7.50 per 1M tokens)\n');

  const batch = await client.messages.batches.create({ requests: apiRequests });
  console.log(`✅ Batch submitted: ${batch.id}\n`);

  fs.writeFileSync(
    path.join(__dirname, 'contrast-fix-meta.json'),
    JSON.stringify({
      batchId: batch.id,
      submittedAt: new Date().toISOString(),
      files: Object.entries(idToPath).map(([id, p]) => ({ id, path: p })),
    }, null, 2)
  );

  // Poll
  let current = batch;
  let polls = 0;
  while (current.processing_status !== 'ended') {
    const wait = Math.min(30 + polls * 10, 90);
    console.log(`⏳ [${new Date().toLocaleTimeString()}] ${current.processing_status} — waiting ${wait}s…`);
    await new Promise(r => setTimeout(r, wait * 1000));
    current = await client.messages.batches.retrieve(batch.id);
    polls++;
  }
  console.log(`\n🎉 Complete: ${current.request_counts.succeeded} ok, ${current.request_counts.errored} err\n`);

  // Collect & write results
  const written = [];
  const errors = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    const relPath = idToPath[result.custom_id];
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text').map(b => b.text).join('');
      const code = stripFences(text);
      if (relPath && code.length > 50) {
        write(relPath, code);
        console.log(`  ✅ ${relPath}  (${code.split('\n').length} lines)`);
        written.push(relPath);
      } else {
        errors.push({ custom_id: result.custom_id, relPath, error: 'empty or too short response', preview: code.slice(0, 200) });
        console.warn(`  ⚠ empty response: ${result.custom_id}`);
      }
    } else {
      errors.push({ custom_id: result.custom_id, relPath, error: result.result.error });
      console.error(`  ❌ ${result.custom_id}:`, result.result.error);
    }
  }

  fs.writeFileSync(
    path.join(__dirname, 'contrast-fix-results.json'),
    JSON.stringify({ batchId: batch.id, written, errors }, null, 2)
  );

  console.log(`\n📄 contrast-fix-results.json`);
  console.log(`✅ Files written: ${written.length}`);
  if (errors.length) {
    console.log(`⚠  Errors: ${errors.length} — see contrast-fix-results.json`);
    process.exit(errors.length > 3 ? 1 : 0);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
