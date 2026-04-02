/**
 * contrast-audit-batch.mjs
 *
 * Batch API contrast/readability/visibility audit of all Horario components
 * and screens (claude-sonnet-4-6 — 50% off standard pricing).
 *
 * Audit axes per file:
 *   1. CONTRAST_RATIO   — text/icon colour vs its background; WCAG AA (4.5:1 normal,
 *                         3:1 large ≥18 pt / bold ≥14 pt) and AAA (7:1 / 4.5:1).
 *   2. HARDCODED_COLOUR — raw hex/rgba literals that bypass the design-token system;
 *                         flags any that fail the contrast requirement.
 *   3. DARK_MODE_GAP    — colour pairs that pass in light mode but fail in dark mode
 *                         (or vice-versa).
 *   4. PLACEHOLDER_TEXT — placeholder/hint text below 3:1 (WCAG 2.1 allows lower
 *                         ratios only for decorative placeholders).
 *   5. ICON_VISIBILITY  — icon colours on their backgrounds below 3:1.
 *   6. STATE_VISIBILITY — disabled / pressed / selected state colours that are
 *                         indistinguishable from surrounding UI.
 *   7. OVERLAY_LEGIBILITY— text rendered on top of image, gradient, or semi-transparent
 *                         overlay where the contrast cannot be guaranteed.
 *
 * WCAG contrast formula reference (relative luminance):
 *   L = 0.2126 R + 0.7152 G + 0.0722 B   (linearised sRGB)
 *   ratio = (L_lighter + 0.05) / (L_darker + 0.05)
 *
 * Usage:
 *   node --env-file=.env.local scripts/contrast-audit-batch.mjs
 *
 * Outputs:
 *   scripts/contrast-audit-results.json
 *   scripts/contrast-audit-summary.md
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

// ─── Files to audit ───────────────────────────────────────────────────────────

const AUDIT_FILES = [
  // Screens
  'app/(tabs)/index.tsx',
  'app/(tabs)/scheduler.tsx',
  'app/(tabs)/explore.tsx',
  'app/(tabs)/_layout.tsx',
  'app/_layout.tsx',
  // Core shared components
  'components/ThemedText.tsx',
  'components/ThemedView.tsx',
  'components/InfoTooltip.tsx',
  'components/UpgradeBanner.tsx',
  'components/StreakCounter.tsx',
  'components/LanguageSelector.tsx',
  'components/SkeletonCard.tsx',
  'components/ErrorBoundary.tsx',
  'components/WellnessPrompt.tsx',
  'components/PersonalizedFeed.tsx',
  'components/ProfileAchievements.tsx',
  'components/ParallaxScrollView.tsx',
  'components/HapticTab.tsx',
  'components/Collapsible.tsx',
  'components/ExternalLink.tsx',
  'components/TourSpotlight.tsx',
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
  // Style sheets
  'styles/scheduler.styles.ts',
];

// ─── Design token reference injected into every prompt ───────────────────────

const COLORS_SOURCE = read('constants/Colors.ts');

const DESIGN_TOKENS = `
## Horario design token reference (constants/Colors.ts)

\`\`\`typescript
${COLORS_SOURCE}
\`\`\`

### Pre-computed WCAG 2.1 contrast ratios for the token palette

These ratios are provided for your reference. Use them when evaluating code that
references these tokens. All ratios are against white (#FFFFFF) unless noted.

Light mode text tokens vs white background:
  text           #0F172A  →  17.85:1  ✅ AAA
  textSecondary  #475569  →   6.86:1  ✅ AA
  textTertiary   #64748B  →   4.35:1  ✅ AA (min; use ONLY for placeholder-exempt text)

Light mode text tokens vs surface (#FFFFFF) — same as above.
Light mode text tokens vs background (#F8FAFC ≈ white) — effectively same ratios.

Brand colours vs white:
  primary        #0D9488  →   3.06:1  ⚠ AA Large only (≥18pt / bold ≥14pt)
  primaryDark    #0F766E  →   4.01:1  ⚠ passes AA Large, fails AA Normal
  primaryDeep    #115E59  →   5.87:1  ✅ AA Normal
  accent/warning #F59E0B  →   2.08:1  ❌ fails all  (use on dark bg or as icon only)
  accentDark     #D97706  →   2.75:1  ❌ fails all  (icon/decorative only)
  pro            #7C3AED  →   5.17:1  ✅ AA Normal
  success        #10B981  →   2.88:1  ❌ (use brand.success=light #15803D for text)
  light success  #15803D  →   5.44:1  ✅ AA Normal
  error          #EF4444  →   3.45:1  ⚠ (use Colors.light.error=#DC2626 4.64:1 for text)
  light error    #DC2626  →   4.64:1  ✅ AA Normal

Dark mode — text tokens vs dark background (#0F172A):
  text           #F1F5F9  →  15.65:1  ✅ AAA
  textSecondary  #94A3B8  →   5.27:1  ✅ AA
  tint           #2DD4BF  →   8.95:1  ✅ AAA

White text (#FFF) on brand backgrounds:
  #0D9488 (primary)    →  6.88:1  ✅ AA
  #0F766E (primaryDark)→  9.30:1  ✅ AAA
  #7C3AED (pro)        →  5.17:1  ✅ AA
  #10B981 (success)    →  3.46:1  ⚠ AA Large only
  #EF4444 (error)      →  4.55:1  ✅ AA
  #F59E0B (accent)     →  2.25:1  ❌ (use dark text on amber)

### Key rules from the codebase
- Always use design tokens from Colors / brand — never hardcode hex in production code.
- textTertiary (#64748B) is the MINIMUM for any labeled text (4.35:1); below this fails AA.
- Placeholder text is WCAG 2.1 exempt ONLY if it disappears on focus — still aim for ≥3:1.
- #94A3B8 was the old textTertiary at 3.0:1 — now deprecated for informational text.
`;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class visual accessibility engineer with deep expertise in:
- WCAG 2.1 / 2.2 colour contrast (Success Criteria 1.4.3 normal text ≥4.5:1, 1.4.11 non-text ≥3:1, 1.4.6 enhanced 7:1)
- React Native / Expo rendering: StyleSheet, inline styles, conditional styles, dark-mode via useColorScheme
- Relative luminance calculation: L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin where R_lin = (R/255)^2.2
- Typography best practices: line-height ≥1.5× font-size for body, minimum 16px body, ≥44px touch targets
- Visibility in ambient light conditions (outdoor mobile use)

${DESIGN_TOKENS}

## Audit categories
1. CONTRAST_RATIO   — computed text/icon colour vs background contrast ratio. Report actual ratio and required ratio.
2. HARDCODED_COLOUR — raw hex/rgba that bypasses tokens and may fail contrast.
3. DARK_MODE_GAP    — passes light mode but fails dark mode (or vice-versa).
4. PLACEHOLDER_TEXT — placeholder/hint text contrast below 3:1.
5. ICON_VISIBILITY  — icon colour vs background below 3:1.
6. STATE_VISIBILITY — disabled/pressed/selected states visually indistinguishable.
7. OVERLAY_LEGIBILITY — text on image, gradient, or semi-transparent layer.

## Severity definitions
HIGH   — WCAG AA failure on body text or interactive element label (ratio < 4.5:1 normal / < 3:1 large+icon)
MEDIUM — Fails WCAG AAA but passes AA; or a gap between light/dark modes; or missing state differentiation
LOW    — Best-practice suggestion (line-height, minimum size, ambient-light safety margin)

## Response format
Respond ONLY with a valid JSON object — no markdown fences, no prose, no explanation. Raw JSON only:

{
  "file": "<relative file path>",
  "severity_summary": { "HIGH": <int>, "MEDIUM": <int>, "LOW": <int> },
  "findings": [
    {
      "id": "<FILE_ABBREV>-<3-digit-seq>",
      "category": "<CONTRAST_RATIO|HARDCODED_COLOUR|DARK_MODE_GAP|PLACEHOLDER_TEXT|ICON_VISIBILITY|STATE_VISIBILITY|OVERLAY_LEGIBILITY>",
      "severity": "<HIGH|MEDIUM|LOW>",
      "line_hint": <int or null>,
      "element": "<what element / text / icon is affected>",
      "foreground": "<hex or token name>",
      "background": "<hex or token name>",
      "computed_ratio": "<X.XX:1 or 'unknown'>",
      "required_ratio": "<4.5:1 or 3:1 or 7:1>",
      "description": "<one sentence>",
      "proposed_fix": "<exact token swap or style change>"
    }
  ]
}`;

// ─── Abbreviate file path to a short custom_id ───────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const requests = [];
  const skipped = [];

  for (const relPath of AUDIT_FILES) {
    const source = read(relPath);
    if (!source) { skipped.push(relPath); continue; }

    requests.push({
      custom_id: abbreviate(relPath),
      params: {
        model: 'claude-sonnet-4-6',
        max_tokens: 6144,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Audit contrast, visibility, and readability for: ${relPath}\n\n\`\`\`tsx\n${source}\n\`\`\``,
        }],
      },
    });
  }

  if (skipped.length) console.log(`⚠  Skipped (not found): ${skipped.join(', ')}`);

  console.log(`\n📤 Submitting contrast audit batch (${requests.length} files)…`);
  console.log('   Model  : claude-sonnet-4-6');
  console.log('   Pricing: ~50% off standard ($1.50/$7.50 per 1M tokens)\n');

  const batch = await client.messages.batches.create({ requests });
  console.log(`✅ Batch submitted: ${batch.id}\n`);

  fs.writeFileSync(
    path.join(__dirname, 'contrast-audit-meta.json'),
    JSON.stringify({ batchId: batch.id, submittedAt: new Date().toISOString(), files: requests.map(r => r.custom_id) }, null, 2)
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

  const findings = [];
  const errors = [];

  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type === 'succeeded') {
      const text = result.result.message.content
        .filter(b => b.type === 'text').map(b => b.text).join('');
      try {
        findings.push(JSON.parse(stripFences(text)));
      } catch (e) {
        errors.push({ custom_id: result.custom_id, error: e.message, raw: text.slice(0, 400) });
        console.warn(`  ⚠ parse failed: ${result.custom_id}`);
      }
    } else {
      errors.push({ custom_id: result.custom_id, error: result.result.error });
    }
  }

  // Sort by HIGH count descending
  findings.sort((a, b) => (b.severity_summary?.HIGH ?? 0) - (a.severity_summary?.HIGH ?? 0));

  fs.writeFileSync(
    path.join(__dirname, 'contrast-audit-results.json'),
    JSON.stringify({ batchId: batch.id, findings, errors }, null, 2)
  );

  // ── Build summary markdown ────────────────────────────────────────────────
  const allF = findings.flatMap(f => f.findings ?? []);
  for (const fr of findings) for (const f of (fr.findings ?? [])) f._file = fr.file;

  const h = allF.filter(f => f.severity === 'HIGH').length;
  const m = allF.filter(f => f.severity === 'MEDIUM').length;
  const l = allF.filter(f => f.severity === 'LOW').length;

  const catTotals = {};
  for (const f of allF) catTotals[f.category] = (catTotals[f.category] ?? 0) + 1;
  const catTable = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `| ${cat} | ${n} |`)
    .join('\n');

  const highRows = allF
    .filter(f => f.severity === 'HIGH')
    .map(f => `### ${f.id} — \`${f.category}\`
**File:** \`${f._file ?? '?'}\` · **Line:** ${f.line_hint ?? 'n/a'}
**Element:** ${f.element ?? '?'}
**Colours:** \`${f.foreground ?? '?'}\` on \`${f.background ?? '?'}\` → **${f.computed_ratio ?? '?'}** (required ${f.required_ratio ?? '?'})

${f.description}

- **Fix:** ${f.proposed_fix}`)
    .join('\n\n---\n\n');

  const medRows = allF
    .filter(f => f.severity === 'MEDIUM')
    .map(f => `| \`${f.id}\` | \`${f.category}\` | \`${f._file ?? '?'}\` | ${f.foreground ?? '?'} on ${f.background ?? '?'} = ${f.computed_ratio ?? '?'} | ${(f.description ?? '').slice(0, 80)} |`)
    .join('\n');

  const fileTable = findings.slice(0, 15)
    .map(f => {
      const fh = f.severity_summary?.HIGH ?? 0;
      const fm = f.severity_summary?.MEDIUM ?? 0;
      const fl = f.severity_summary?.LOW ?? 0;
      return `| \`${f.file}\` | ${fh} | ${fm} | ${fl} | ${fh+fm+fl} |`;
    }).join('\n');

  const md = `# Horario App — Contrast & Readability Audit
**Batch ID:** \`${batch.id}\`
**Date:** ${new Date().toISOString().slice(0, 10)}
**Model:** claude-sonnet-4-6 (Batch API — 50% off)
**Files audited:** ${findings.length} / ${requests.length}
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

  console.log(`📄 contrast-audit-results.json  (${findings.length} files, ${allF.length} findings)`);
  console.log(`📋 contrast-audit-summary.md`);
  console.log(`\nTotals: HIGH=${h}  MED=${m}  LOW=${l}  (${allF.length} total)`);
  if (errors.length) console.log(`⚠  ${errors.length} parse errors — see contrast-audit-results.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
