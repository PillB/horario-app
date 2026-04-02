/**
 * contrast-audit-salvage.mjs
 * Re-runs the 3 truncated files at max_tokens: 8192 and merges into results.
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
function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

const TRUNCATED = {
  SCHED_DEMANDSECT: 'components/scheduler/DemandSection.tsx',
  SCHED_CHECKLIST:  'components/scheduler/Checklist.tsx',
  SCHED_LOSTREVENU: 'components/scheduler/LostRevenueSummary.tsx',
};

const COLORS_SOURCE = read('constants/Colors.ts');

const SYSTEM_PROMPT = `You are a world-class visual accessibility engineer with deep expertise in WCAG 2.1/2.2 colour contrast, React Native rendering, and typography best practices.

## Design token reference (constants/Colors.ts)
\`\`\`typescript
${COLORS_SOURCE}
\`\`\`

## Pre-computed contrast ratios vs white (#FFF)
text #0F172A → 17.85:1 AAA | textSecondary #475569 → 6.86:1 AA | textTertiary #64748B → 4.35:1 AA
primary #0D9488 → 3.06:1 AA-Large-only | primaryDark #0F766E → 4.01:1 AA-Large | primaryDeep #115E59 → 5.87:1 AA
accent #F59E0B → 2.08:1 FAIL | pro #7C3AED → 5.17:1 AA | lightSuccess #15803D → 5.44:1 AA | lightError #DC2626 → 4.64:1 AA
White on primary #0D9488 → 6.88:1 AA | white on pro #7C3AED → 5.17:1 AA | white on error #EF4444 → 4.55:1 AA

## Categories
CONTRAST_RATIO | HARDCODED_COLOUR | DARK_MODE_GAP | PLACEHOLDER_TEXT | ICON_VISIBILITY | STATE_VISIBILITY | OVERLAY_LEGIBILITY

## Severity
HIGH — WCAG AA failure (ratio < 4.5:1 normal / < 3:1 large+icon)
MEDIUM — Fails AAA but passes AA; or light/dark gap; or missing state differentiation
LOW — Best-practice suggestion

Respond ONLY with raw JSON — no markdown fences, no prose:
{
  "file": "<relative path>",
  "severity_summary": { "HIGH": <int>, "MEDIUM": <int>, "LOW": <int> },
  "findings": [
    {
      "id": "<ABBREV>-<3-digit-seq>",
      "category": "<category>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "line_hint": <int or null>,
      "element": "<element description>",
      "foreground": "<hex or token>",
      "background": "<hex or token>",
      "computed_ratio": "<X.XX:1 or unknown>",
      "required_ratio": "<4.5:1 or 3:1 or 7:1>",
      "description": "<one sentence>",
      "proposed_fix": "<exact fix>"
    }
  ]
}`;

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const existing = JSON.parse(fs.readFileSync(path.join(__dirname, 'contrast-audit-results.json'), 'utf8'));
  const goodFindings = [...existing.findings];
  console.log(`Starting with ${goodFindings.length} parsed files. Re-running ${Object.keys(TRUNCATED).length} truncated…\n`);

  const requests = Object.entries(TRUNCATED).map(([customId, relPath]) => ({
    custom_id: customId,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Audit contrast, visibility, and readability for: ${relPath}\n\n\`\`\`tsx\n${read(relPath)}\n\`\`\`` }],
    },
  }));

  const batch = await client.messages.batches.create({ requests });
  console.log(`✅ Salvage batch: ${batch.id}\n`);

  let current = batch;
  let polls = 0;
  while (current.processing_status !== 'ended') {
    const wait = Math.min(20 + polls * 10, 60);
    console.log(`⏳ [${new Date().toLocaleTimeString()}] ${current.processing_status} — waiting ${wait}s…`);
    await new Promise(r => setTimeout(r, wait * 1000));
    current = await client.messages.batches.retrieve(batch.id);
    polls++;
  }
  console.log(`\n🎉 ${current.request_counts.succeeded} ok, ${current.request_counts.errored} err\n`);

  const errors = [];
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
      try {
        goodFindings.push(JSON.parse(stripFences(text)));
        console.log(`  ✅ ${result.custom_id}`);
      } catch (e) {
        errors.push({ custom_id: result.custom_id, error: e.message, raw: text.slice(0, 400) });
        console.warn(`  ❌ still failed: ${result.custom_id}`);
      }
    } else {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
    }
  }

  goodFindings.sort((a, b) => (b.severity_summary?.HIGH ?? 0) - (a.severity_summary?.HIGH ?? 0));

  const allF = goodFindings.flatMap(f => f.findings ?? []);
  for (const fr of goodFindings) for (const f of (fr.findings ?? [])) f._file = fr.file;

  fs.writeFileSync(path.join(__dirname, 'contrast-audit-results.json'), JSON.stringify({ batchId: batch.id, findings: goodFindings, errors }, null, 2));

  const h = allF.filter(f => f.severity === 'HIGH').length;
  const m = allF.filter(f => f.severity === 'MEDIUM').length;
  const l = allF.filter(f => f.severity === 'LOW').length;

  const catTotals = {};
  for (const f of allF) catTotals[f.category] = (catTotals[f.category] ?? 0) + 1;
  const catTable = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`| ${c} | ${n} |`).join('\n');

  const highRows = allF.filter(f => f.severity === 'HIGH').map(f => `### ${f.id} — \`${f.category}\`
**File:** \`${f._file ?? '?'}\` · **Line:** ${f.line_hint ?? 'n/a'}
**Element:** ${f.element ?? '?'}
**Colours:** \`${f.foreground ?? '?'}\` on \`${f.background ?? '?'}\` → **${f.computed_ratio ?? '?'}** (required ${f.required_ratio ?? '?'})

${f.description}

- **Fix:** ${f.proposed_fix}`).join('\n\n---\n\n');

  const medRows = allF.filter(f => f.severity === 'MEDIUM').map(f =>
    `| \`${f.id}\` | \`${f.category}\` | \`${f._file ?? '?'}\` | ${f.foreground ?? '?'} on ${f.background ?? '?'} = ${f.computed_ratio ?? '?'} | ${(f.description ?? '').slice(0, 80)} |`
  ).join('\n');

  const fileTable = goodFindings.slice(0, 15).map(f => {
    const fh = f.severity_summary?.HIGH ?? 0, fm = f.severity_summary?.MEDIUM ?? 0, fl = f.severity_summary?.LOW ?? 0;
    return `| \`${f.file}\` | ${fh} | ${fm} | ${fl} | ${fh+fm+fl} |`;
  }).join('\n');

  const md = `# Horario App — Contrast & Readability Audit
**Batch ID:** \`${batch.id}\`
**Date:** ${new Date().toISOString().slice(0, 10)}
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** ${goodFindings.length}
**Standard:** WCAG 2.1 AA (4.5:1 normal text · 3:1 large text & non-text)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 HIGH  | ${h} |
| 🟡 MEDIUM | ${m} |
| 🟢 LOW   | ${l} |
| **Total** | **${allF.length}** |

## Findings by Category

| Category | Count |
|----------|-------|
${catTable}

---

## Files by Issue Density

| File | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
${fileTable}

---

## 🔴 HIGH Severity — WCAG AA Failures

${highRows || '_None._'}

---

## 🟡 MEDIUM Severity

| ID | Category | File | Colours | Issue |
|----|----------|------|---------|-------|
${medRows || '| — | — | — | — | None |'}

---

## WCAG Reference

| Criterion | Ratio | Applies to |
|-----------|-------|-----------|
| AA Normal text | 4.5:1 | Body copy, labels, captions |
| AA Large text | 3.0:1 | ≥18 pt regular or ≥14 pt bold |
| AA Non-text | 3.0:1 | Icons, borders, UI components |
| AAA Normal | 7.0:1 | Enhanced — aspirational target |
| AAA Large | 4.5:1 | Enhanced large text |
`;
  fs.writeFileSync(path.join(__dirname, 'contrast-audit-summary.md'), md);

  console.log(`\n📄 contrast-audit-results.json (${goodFindings.length} files)`);
  console.log(`📋 contrast-audit-summary.md`);
  console.log(`\nFinal totals: HIGH=${h}  MED=${m}  LOW=${l}  (${allF.length} total)`);
  if (errors.length) console.log(`⚠  ${errors.length} still errored`);
}

main().catch(e => { console.error(e); process.exit(1); });
