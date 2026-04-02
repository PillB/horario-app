/**
 * ux-audit-batch.mjs
 *
 * Phase 2 — Batch API UX/Accessibility audit of all components and screens.
 *
 * Model   : claude-sonnet-4-6 (Batch API = 50% off standard price)
 * Standard: $3.00/$15.00 per 1M tokens → Batch: $1.50/$7.50 per 1M tokens
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/ux-audit-batch.mjs
 *
 * Outputs:
 *   scripts/ux-audit-results.json   — structured findings per file
 *   scripts/ux-audit-summary.md     — human-readable report
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Files to audit ───────────────────────────────────────────────────────────

const AUDIT_FILES = [
  // Screens
  'app/(tabs)/index.tsx',
  'app/(tabs)/scheduler.tsx',
  'app/(tabs)/explore.tsx',
  'app/(tabs)/_layout.tsx',
  'app/_layout.tsx',
  // Shared components
  'components/InfoTooltip.tsx',
  'components/UpgradeBanner.tsx',
  'components/StreakCounter.tsx',
  'components/SkeletonCard.tsx',
  'components/ErrorBoundary.tsx',
  'components/LanguageSelector.tsx',
  'components/ConfettiBurst.tsx',
  'components/WellnessPrompt.tsx',
  'components/PersonalizedFeed.tsx',
  'components/ProfileAchievements.tsx',
  'components/ThemedText.tsx',
  'components/ThemedView.tsx',
  'components/ParallaxScrollView.tsx',
  'components/HapticTab.tsx',
  'components/Collapsible.tsx',
  'components/ExternalLink.tsx',
  // Scheduler sub-components
  'components/scheduler/SectionCard.tsx',
  'components/scheduler/InputField.tsx',
  'components/scheduler/WorkerSection.tsx',
  'components/scheduler/ShiftTemplateSection.tsx',
  'components/scheduler/RosterSection.tsx',
  'components/scheduler/DemandSection.tsx',
  'components/scheduler/Checklist.tsx',
  'components/scheduler/AvailabilityLabel.tsx',
  'components/scheduler/LostRevenueSummary.tsx',
];

// ─── Audit prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior UX/accessibility engineer specialising in React Native and Expo web apps.
Audit the provided component source for the following categories:

1. ACCESSIBILITY — missing or vague accessibilityRole, accessibilityLabel, accessibilityHint.
   Flag any interactive element missing all three. Rate vague labels (e.g. "Click here", "Button") as HIGH severity.

2. KEYBOARD / FOCUS — missing autofocus on first form field, no onSubmitEditing chaining between inputs,
   no returnKeyType, interactive elements not reachable via keyboard on web.

3. TOOLTIP_COPY — InfoTooltip or title/aria-label strings that are vague, too long (>120 chars),
   or not self-explanatory. Propose a concise replacement (≤ 80 chars).

4. BUTTON_CONSISTENCY — inconsistent Pressable styles (mixing inline styles vs StyleSheet,
   inconsistent padding/borderRadius across siblings), disabled states not visually distinguished.

5. EMPTY_STATES — sections that may render with zero items but have no empty-state message or CTA.

6. I18N_GAPS — hardcoded English strings not wrapped in t() calls.

7. PERFORMANCE — expensive operations in render (array methods, new object literals in JSX props,
   inline functions passed as stable props).

Respond ONLY with a valid JSON object matching this exact schema — no markdown, no prose:

{
  "file": "<relative file path>",
  "severity_summary": { "HIGH": <int>, "MEDIUM": <int>, "LOW": <int> },
  "findings": [
    {
      "id": "<FILE_ABBREV>-<3-digit-seq>",
      "category": "<one of: ACCESSIBILITY|KEYBOARD|TOOLTIP_COPY|BUTTON_CONSISTENCY|EMPTY_STATES|I18N_GAPS|PERFORMANCE>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "line_hint": <approximate line number or null>,
      "description": "<one sentence describing the issue>",
      "current_value": "<the problematic string or code snippet, or null>",
      "proposed_fix": "<concrete replacement or code suggestion>"
    }
  ]
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function abbreviate(relPath) {
  return relPath
    .replace('app/(tabs)/', 'TAB_')
    .replace('app/', 'APP_')
    .replace('components/scheduler/', 'SCHED_')
    .replace('components/', 'COMP_')
    .replace(/\.tsx$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toUpperCase()
    .slice(0, 12);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // Build batch requests — one per file
  const requests = [];
  const skipped = [];

  for (const relPath of AUDIT_FILES) {
    const source = readFile(relPath);
    if (!source) {
      skipped.push(relPath);
      continue;
    }

    const abbrev = abbreviate(relPath);
    requests.push({
      custom_id: abbrev,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Audit this file: ${relPath}\n\n\`\`\`tsx\n${source}\n\`\`\``,
          },
        ],
      },
    });
  }

  if (skipped.length) {
    console.log(`⚠  Skipped (not found): ${skipped.join(', ')}`);
  }

  console.log(`\n📤 Submitting batch with ${requests.length} requests…`);
  console.log(`   Model  : claude-sonnet-4-6`);
  console.log(`   Pricing: ~50% off standard ($1.50/$7.50 per 1M tokens)`);

  // Submit batch
  const batch = await client.messages.batches.create({ requests });

  console.log(`\n✅ Batch submitted`);
  console.log(`   ID     : ${batch.id}`);
  console.log(`   Status : ${batch.processing_status}`);
  console.log(`   Files  : ${requests.length}`);

  // Save batch metadata immediately so it can be resumed if script is interrupted
  const metaPath = path.join(__dirname, 'ux-audit-batch-meta.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    batchId: batch.id,
    submittedAt: new Date().toISOString(),
    requestCount: requests.length,
    files: requests.map(r => r.custom_id),
  }, null, 2));
  console.log(`   Meta   : scripts/ux-audit-batch-meta.json\n`);

  // Poll until complete
  let current = batch;
  let polls = 0;
  while (current.processing_status !== 'ended') {
    const waitSecs = Math.min(30 + polls * 10, 120);
    console.log(`⏳ [${new Date().toLocaleTimeString()}] Status: ${current.processing_status} — waiting ${waitSecs}s…`);
    await new Promise(r => setTimeout(r, waitSecs * 1000));
    current = await client.messages.batches.retrieve(batch.id);
    polls++;
  }

  console.log(`\n🎉 Batch complete!`);
  console.log(`   Succeeded : ${current.request_counts.succeeded}`);
  console.log(`   Errored   : ${current.request_counts.errored}`);
  console.log(`   Expired   : ${current.request_counts.expired}`);

  // Collect results
  const findings = [];
  const errors = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      try {
        const parsed = JSON.parse(text);
        findings.push(parsed);
      } catch {
        errors.push({ custom_id: result.custom_id, error: 'JSON parse failed', raw: text.slice(0, 200) });
      }
    } else if (result.result.type === 'errored') {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
    }
  }

  // Sort by total HIGH findings descending
  findings.sort((a, b) => {
    const aH = a.severity_summary?.HIGH ?? 0;
    const bH = b.severity_summary?.HIGH ?? 0;
    return bH - aH;
  });

  // Write raw results
  const resultsPath = path.join(__dirname, 'ux-audit-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ batchId: batch.id, findings, errors }, null, 2));
  console.log(`\n📄 Raw results → scripts/ux-audit-results.json`);

  // Generate markdown summary
  const allFindings = findings.flatMap(f => f.findings ?? []);
  const highCount = allFindings.filter(f => f.severity === 'HIGH').length;
  const medCount  = allFindings.filter(f => f.severity === 'MEDIUM').length;
  const lowCount  = allFindings.filter(f => f.severity === 'LOW').length;

  const categoryTotals = {};
  for (const f of allFindings) {
    categoryTotals[f.category] = (categoryTotals[f.category] ?? 0) + 1;
  }

  const categoryTable = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `| ${cat} | ${count} |`)
    .join('\n');

  const highFindings = allFindings
    .filter(f => f.severity === 'HIGH')
    .map(f => `### ${f.id} — ${f.category}\n**File:** ${findings.find(r => r.findings?.includes(f))?.file ?? '?'}\n**Line:** ${f.line_hint ?? 'n/a'}\n\n${f.description}\n\n- **Current:** \`${f.current_value ?? 'n/a'}\`\n- **Fix:** ${f.proposed_fix}`)
    .join('\n\n---\n\n');

  const md = `# Horario App — UX/Accessibility Audit Report
**Batch ID:** \`${batch.id}\`
**Date:** ${new Date().toISOString().slice(0, 10)}
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** ${findings.length}

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 HIGH  | ${highCount} |
| 🟡 MEDIUM | ${medCount} |
| 🟢 LOW   | ${lowCount} |
| **Total** | **${allFindings.length}** |

## Findings by Category

| Category | Count |
|----------|-------|
${categoryTable}

---

## 🔴 HIGH Severity Findings (action required)

${highFindings || '_No HIGH severity findings._'}

---

## Files by Issue Density

${findings.slice(0, 10).map(f => `- **${f.file}** — HIGH: ${f.severity_summary?.HIGH ?? 0}, MED: ${f.severity_summary?.MEDIUM ?? 0}, LOW: ${f.severity_summary?.LOW ?? 0}`).join('\n')}

---

## Next Step: Onboarding Tour Architecture

See Phase 3 proposal in the conversation. No code changes until approved.
`;

  const summaryPath = path.join(__dirname, 'ux-audit-summary.md');
  fs.writeFileSync(summaryPath, md);
  console.log(`📋 Summary report → scripts/ux-audit-summary.md`);

  if (errors.length) {
    console.log(`\n⚠  ${errors.length} request(s) errored — see ux-audit-results.json for details`);
  }

  console.log(`\nDone.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
