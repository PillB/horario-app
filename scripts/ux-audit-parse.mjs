/**
 * ux-audit-parse.mjs
 * Re-fetches the completed batch results, strips markdown fences,
 * and regenerates ux-audit-results.json + ux-audit-summary.md
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'ux-audit-batch-meta.json'), 'utf8'));
const BATCH_ID = meta.batchId;

function stripFences(text) {
  // Remove ```json ... ``` or ``` ... ``` wrappers
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`Re-fetching results for batch: ${BATCH_ID}`);

  const findings = [];
  const errors = [];
  let total = 0;

  for await (const result of await client.messages.batches.results(BATCH_ID)) {
    total++;
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const cleaned = stripFences(text);
      try {
        const parsed = JSON.parse(cleaned);
        findings.push(parsed);
      } catch (e) {
        errors.push({ custom_id: result.custom_id, error: e.message, raw_preview: cleaned.slice(0, 300) });
      }
    } else if (result.result.type === 'errored') {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
    }
  }

  console.log(`Processed ${total} results: ${findings.length} parsed, ${errors.length} errors`);
  if (errors.length) console.log('Parse errors:', JSON.stringify(errors, null, 2));

  // Sort by HIGH count descending
  findings.sort((a, b) => (b.severity_summary?.HIGH ?? 0) - (a.severity_summary?.HIGH ?? 0));

  // Save raw results
  fs.writeFileSync(
    path.join(__dirname, 'ux-audit-results.json'),
    JSON.stringify({ batchId: BATCH_ID, findings, errors }, null, 2)
  );
  console.log('✅ Wrote ux-audit-results.json');

  // Build summary
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

  // Map custom_id → file path for cross-referencing
  const idToFile = {};
  for (const f of findings) {
    const abbrev = f.file
      ?.replace('app/(tabs)/', 'TAB_')
      .replace('app/', 'APP_')
      .replace('components/scheduler/', 'SCHED_')
      .replace('components/', 'COMP_')
      .replace(/\.tsx$/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .toUpperCase()
      .slice(0, 12);
    if (abbrev) idToFile[abbrev] = f.file;
    // Also index by finding IDs
    for (const finding of (f.findings ?? [])) {
      finding._file = f.file;
    }
  }

  const highFindings = allFindings
    .filter(f => f.severity === 'HIGH')
    .map(f => {
      const file = f._file ?? '?';
      return `### ${f.id} — \`${f.category}\`
**File:** \`${file}\` · **Line:** ${f.line_hint ?? 'n/a'}

${f.description}

- **Current:** \`${(f.current_value ?? 'n/a').toString().slice(0, 120)}\`
- **Fix:** ${f.proposed_fix}`;
    })
    .join('\n\n---\n\n');

  const medFindings = allFindings
    .filter(f => f.severity === 'MEDIUM')
    .map(f => `| \`${f.id}\` | \`${f.category}\` | \`${f._file ?? '?'}\` | ${f.description.slice(0, 90)} |`)
    .join('\n');

  const md = `# Horario App — UX/Accessibility Audit Report
**Batch ID:** \`${BATCH_ID}\`
**Date:** ${new Date().toISOString().slice(0, 10)}
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** ${findings.length} / ${total}

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

## Files by Issue Density (top 10)

| File | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
${findings.slice(0, 10).map(f => {
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
${medFindings || '| — | — | — | None |'}

---

## Next Step: Onboarding Tour Architecture
See Phase 3 proposal. **No code changes until approved.**
`;

  fs.writeFileSync(path.join(__dirname, 'ux-audit-summary.md'), md);
  console.log('✅ Wrote ux-audit-summary.md');
  console.log(`\nTotals: HIGH=${highCount} MED=${medCount} LOW=${lowCount} (${allFindings.length} total across ${findings.length} files)`);
}

main().catch(e => { console.error(e); process.exit(1); });
