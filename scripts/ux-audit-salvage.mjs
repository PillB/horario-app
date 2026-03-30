/**
 * ux-audit-salvage.mjs
 *
 * Two-pass recovery:
 * 1. For truncated responses (JSON parse error): extract all COMPLETE finding
 *    objects using a regex scanner. Reconstructs a valid partial result.
 * 2. Re-runs the 12 truncated files as a new batch with max_tokens: 8192.
 *    Merges results into ux-audit-results.json and rebuilds the summary.
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── The 12 truncated files (custom_id → relative path) ──────────────────────
const TRUNCATED = {
  TAB_INDEX:    'app/(tabs)/index.tsx',
  TAB_SCHEDULE: 'app/(tabs)/scheduler.tsx',
  TAB_EXPLORE:  'app/(tabs)/explore.tsx',
  COMP_INFOTOO: 'components/InfoTooltip.tsx',
  COMP_UPGRADE: 'components/UpgradeBanner.tsx',
  COMP_STREAKC: 'components/StreakCounter.tsx',
  COMP_LANGUAG: 'components/LanguageSelector.tsx',
  SCHED_WORKER: 'components/scheduler/WorkerSection.tsx',
  SCHED_SHIFTT: 'components/scheduler/ShiftTemplateSection.tsx',
  SCHED_ROSTER: 'components/scheduler/RosterSection.tsx',
  SCHED_DEMAND: 'components/scheduler/DemandSection.tsx',
  SCHED_CHECKL: 'components/scheduler/Checklist.tsx',
};

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

Respond ONLY with a valid JSON object — no markdown fences, no prose, no explanation. Raw JSON only:

{
  "file": "<relative file path>",
  "severity_summary": { "HIGH": <int>, "MEDIUM": <int>, "LOW": <int> },
  "findings": [
    {
      "id": "<FILE_ABBREV>-<3-digit-seq>",
      "category": "<ACCESSIBILITY|KEYBOARD|TOOLTIP_COPY|BUTTON_CONSISTENCY|EMPTY_STATES|I18N_GAPS|PERFORMANCE>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "line_hint": <int or null>,
      "description": "<one sentence>",
      "current_value": "<snippet or null>",
      "proposed_fix": "<concrete fix>"
    }
  ]
}`;

function readFile(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function buildSummary(findings, batchId) {
  const allFindings = findings.flatMap(f => (f.findings ?? []));
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

  // Tag each finding with its file
  for (const fileResult of findings) {
    for (const f of (fileResult.findings ?? [])) {
      f._file = fileResult.file;
    }
  }

  const highFindings = allFindings
    .filter(f => f.severity === 'HIGH')
    .map(f => `### ${f.id} — \`${f.category}\`
**File:** \`${f._file ?? '?'}\` · **Line:** ${f.line_hint ?? 'n/a'}

${f.description}

- **Current:** \`${(f.current_value ?? 'n/a').toString().slice(0, 120)}\`
- **Fix:** ${f.proposed_fix}`)
    .join('\n\n---\n\n');

  const medRows = allFindings
    .filter(f => f.severity === 'MEDIUM')
    .map(f => `| \`${f.id}\` | \`${f.category}\` | \`${f._file ?? '?'}\` | ${f.description.slice(0, 90)} |`)
    .join('\n');

  return `# Horario App — UX/Accessibility Audit Report
**Batch ID:** \`${batchId}\`
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

## Files by Issue Density

| File | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
${[...findings]
  .sort((a,b) => (b.severity_summary?.HIGH ?? 0) - (a.severity_summary?.HIGH ?? 0))
  .slice(0, 15)
  .map(f => {
    const h = f.severity_summary?.HIGH ?? 0;
    const m = f.severity_summary?.MEDIUM ?? 0;
    const l = f.severity_summary?.LOW ?? 0;
    return `| \`${f.file}\` | ${h} | ${m} | ${l} | ${h+m+l} |`;
  }).join('\n')}

---

## 🔴 HIGH Severity Findings

${highFindings || '_None._'}

---

## 🟡 MEDIUM Severity Findings

| ID | Category | File | Issue |
|----|----------|------|-------|
${medRows || '| — | — | — | None |'}

---

## Next Step: Onboarding Tour Architecture
See Phase 3 proposal. **No code changes until approved.**
`;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load existing partial results (18 good files already parsed)
  const existing = JSON.parse(fs.readFileSync(path.join(__dirname, 'ux-audit-results.json'), 'utf8'));
  const goodFindings = [...existing.findings];

  console.log(`Starting with ${goodFindings.length} already-parsed files.`);
  console.log(`Re-running ${Object.keys(TRUNCATED).length} truncated files with max_tokens: 8192…\n`);

  // Build new batch for the 12 truncated files
  const requests = [];
  for (const [customId, relPath] of Object.entries(TRUNCATED)) {
    const source = readFile(relPath);
    if (!source) { console.warn(`  SKIP (not found): ${relPath}`); continue; }
    requests.push({
      custom_id: customId,
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,          // was 2048 — bumped 4×
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Audit this file: ${relPath}\n\n\`\`\`tsx\n${source}\n\`\`\``,
        }],
      },
    });
  }

  const batch = await client.messages.batches.create({ requests });
  console.log(`✅ Re-run batch submitted: ${batch.id} (${requests.length} requests)`);

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

  console.log(`\n🎉 Re-run complete: ${current.request_counts.succeeded} ok, ${current.request_counts.errored} err`);

  const errors = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text').map(b => b.text).join('');
      const cleaned = stripFences(text);
      try {
        goodFindings.push(JSON.parse(cleaned));
      } catch (e) {
        errors.push({ custom_id: result.custom_id, error: e.message, raw: cleaned.slice(0, 400) });
        console.warn(`  Still failed to parse: ${result.custom_id}`);
      }
    } else {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
    }
  }

  // Sort by HIGH
  goodFindings.sort((a, b) => (b.severity_summary?.HIGH ?? 0) - (a.severity_summary?.HIGH ?? 0));

  // Write merged results
  fs.writeFileSync(
    path.join(__dirname, 'ux-audit-results.json'),
    JSON.stringify({ batchId: batch.id, findings: goodFindings, errors }, null, 2)
  );

  // Rebuild summary
  const md = buildSummary(goodFindings, batch.id);
  fs.writeFileSync(path.join(__dirname, 'ux-audit-summary.md'), md);

  const allF = goodFindings.flatMap(f => f.findings ?? []);
  const h = allF.filter(f => f.severity === 'HIGH').length;
  const m = allF.filter(f => f.severity === 'MEDIUM').length;
  const l = allF.filter(f => f.severity === 'LOW').length;

  console.log(`\n📄 ux-audit-results.json  (${goodFindings.length} files)`);
  console.log(`📋 ux-audit-summary.md`);
  console.log(`\nFinal totals: HIGH=${h}  MED=${m}  LOW=${l}  (${allF.length} total)`);
  if (errors.length) console.log(`⚠  ${errors.length} still errored — see ux-audit-results.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
