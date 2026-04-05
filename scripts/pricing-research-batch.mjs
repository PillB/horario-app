/**
 * pricing-research-batch.mjs
 *
 * 3-phase exhaustive pricing research for Horario App
 * Batch API — claude-sonnet-4-6 (50% off)
 *
 * Phase 0 (direct): Initialize Research_changes.md + output dirs
 * Phase 1 (batch):  8 parallel research tasks (web_search enabled)
 *   p1-customer-segments  — Personas, pain points, WTP (Peru/MX/CO/BR/CL)
 *   p1-competitor-pricing — Real 2025-2026 competitor pricing pages
 *   p1-latam-market       — LatAm SaaS/WFM market size & growth
 *   p1-global-wfm         — Global WFM benchmarks (US, EU, Asia)
 *   p1-methodologies      — Exact pricing formulas (ProfitWell/Paddle/Baremetrics)
 *   p1-freemium           — Freemium conversion tactics & benchmarks
 *   p1-app-costs          — Infrastructure costs (Clerk, Supabase, Vercel, etc.)
 *   p1-buying-behavior    — LatAm SMB buying patterns, WhatsApp, informal economy
 *
 * Phase 2 (batch):  4 parallel analysis tasks (code_execution + context from P1)
 *   p2-pricing-model      — Optimal tiers, price points, freemium cutoff
 *   p2-country-adjust     — Country-specific pricing adjustments
 *   p2-quant-models       — Elasticity, LTV/CAC, break-even calculations
 *   p2-positioning        — Feature/positioning recommendations
 *
 * Phase 3 (batch):  1 synthesis task → docs/pricing/pricing-strategy.md
 *
 * Usage:
 *   node --env-file=.env.local scripts/pricing-research-batch.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NOW_UTC = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const TODAY = new Date().toISOString().slice(0, 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : `// FILE NOT FOUND: ${relPath}`;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function append(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, content, 'utf8');
  console.log(`  ✓ appended → ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:markdown|md|json|js|ts|javascript|typescript|python)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

function saveBatchId(phase, batchId) {
  write(`scripts/pricing-research-p${phase}-batch-id.txt`, batchId);
}

function loadBatchId(phase) {
  const p = path.join(ROOT, `scripts/pricing-research-p${phase}-batch-id.txt`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}

async function pollBatch(client, batchId) {
  let current = await client.messages.batches.retrieve(batchId);
  while (current.processing_status !== 'ended') {
    await new Promise((r) => setTimeout(r, 30_000));
    current = await client.messages.batches.retrieve(batchId);
    const c = current.request_counts;
    console.log(
      `  [${new Date().toISOString()}] processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`,
    );
  }
  return current;
}

async function collectResults(client, batchId, outputMap, markdownIds = new Set()) {
  const summary = { succeeded: 0, failed: 0, results: {} };
  for await (const result of await client.messages.batches.results(batchId)) {
    const id = result.custom_id;
    if (result.result.type !== 'succeeded') {
      console.error(`  ✗ ${id} — ${result.result.type}`);
      if (result.result.type === 'errored') console.error('    ', result.result.error);
      summary.failed++;
      continue;
    }
    const raw = result.result.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const content = markdownIds.has(id) ? raw.trim() : stripFences(raw);
    summary.results[id] = content;
    const outPath = outputMap[id];
    if (outPath) {
      write(outPath, content);
    }
    summary.succeeded++;
  }
  console.log(`  Batch complete: ${summary.succeeded} succeeded, ${summary.failed} failed`);
  return summary;
}

// ─── App context (condensed from CLAUDE.md) ───────────────────────────────────

const APP_CONTEXT = `
## Horario App — Project Context

**Product:** Horario (Spanish: "schedule") — production-ready web/mobile shift-scheduling and workforce-optimization SaaS.
**Target Market:** SMBs with 5–50 employees in Peru (primary) and LatAm (Mexico, Colombia, Brazil, Chile as expansion markets).
**Industries:** Restaurants, retail, hospitality, healthcare clinics, services.

**Core Value Proposition:**
- Fair, AI-optimized shift assignment considering worker availability, skills, preferences, and labor-law constraints.
- Real-time staffing gap visibility and revenue-exposure tracking (uncovered shifts = lost revenue metric).
- Demand forecasting integration to align staffing with predicted demand.
- Multi-worker, multi-shift, multi-location scheduling in one view.

**Freemium Model (Planned):**
- Free tier: 1 free AI-optimized schedule per user/IP per month.
- Paid tiers: Unlimited schedules, advanced features, multi-location, analytics, integrations.

**Infrastructure Stack (informs COGS):**
- Auth: Clerk (user auth + JWT verification)
- Database/Backend: Supabase (PostgreSQL + RLS + realtime)
- Hosting: Vercel (serverless API routes + static web)
- Mobile: Expo (React Native — iOS + Android)
- AI: Anthropic API (demand forecasting + optimization)
- Push notifications: Expo Push Notification Service (planned)

**Current Feature Status (working):**
- Core scheduling UI (shift templates, workers, roster assignment)
- Demand forecasting (AI proxy)
- Demand target overrides
- Uncovered-loss metric (pure function)
- Onboarding checklist
- Streak counter
- Auth (Clerk)

**Missing / Roadmap:**
- Real-time updates (Supabase realtime)
- Push notifications
- Analytics screen
- AI shift optimization algorithm
- Multi-tenant support
- Labor-law constraint engine

**Positioning:** "The smart scheduling co-pilot for Latin American SMBs — reduce scheduling chaos, cut staffing gaps, stay labor-law compliant."
`;

// ─── Shared system prompt ─────────────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are an elite SaaS market research, pricing strategy, customer psychology, and competitive intelligence expert with 15+ years specializing in US, Europe, Asia and LatAm SMB workforce-management tools.

You combine deep quantitative analysis (elasticity modeling, propensity-to-buy, cost-plus markup, LTV/CAC) with qualitative customer insights and locale-specific nuances (price sensitivity, WhatsApp-driven buying, local labor laws, informal economy, currency volatility).

You strictly follow data-first, source-cited, zero-hallucination practices.

RULES:
- Every major claim must cite a source (URL, report name, or publication).
- Use web_search aggressively — run multiple searches per topic, refine queries, and iterate.
- Prefer 2024–2026 data. If older, explicitly note it.
- Use Spanish and Portuguese search terms where relevant.
- Format output as clean Markdown with tables, headers, and bullet points.
- Include explicit source citations inline or as footnotes.
- Do NOT synthesize without evidence — if data is missing, search again.`;

const ANALYSIS_SYSTEM = `You are an elite SaaS pricing strategist and quantitative analyst with 15+ years in SMB SaaS for LatAm markets.

You implement rigorous quantitative models using the exact formulas from ProfitWell, Paddle, Baremetrics, and ChartMogul:
- Price Elasticity of Demand (Midpoint/Arc method): %ΔQ / %ΔP
- LTV: ARPU / Churn Rate  OR  ARPU × Average Customer Lifetime
- LTV:CAC ratio (target ≥3:1)
- Break-even Point: Fixed Costs / (ARPA − Variable Cost per User)
- Payback Period: CAC / (ARPA − Variable Cost)
- MRR, ARR, and expansion revenue modeling

RULES:
- Use code blocks (Python/JavaScript) for all quantitative calculations — show formulas + results.
- Every recommendation must be grounded in the research data provided.
- Apply LatAm-specific adjustments: currency volatility, informal economy, WhatsApp purchasing, lower disposable income, and higher price sensitivity vs US/EU.
- Format as clean Markdown with tables, code blocks, and actionable recommendations.
- Country-specific sections for: Peru, Mexico, Colombia, Brazil, Chile.`;

// ─── Phase 0: Initialize Research_changes.md ──────────────────────────────────

console.log('\n══════════════════════════════════════════');
console.log(' PHASE 0 — Setup & Grounding (direct)');
console.log('══════════════════════════════════════════\n');

const RESEARCH_CHANGES_HEADER = `# Research Changes Log — Horario App Pricing Strategy

> **Single source of truth for all pricing research sessions.**
> Read in full at the start of every session (focus on latest [SUMMARY] + last 3 entries).
> Append entries — never delete. Use RES-### numbering.

---

`;

const RES_000 = `### RES-000 — ${NOW_UTC}
**Type:** SUMMARY (Initial State)
**Context:** Pricing research initialized for Horario App — a shift-scheduling SaaS targeting SMBs (5–50 employees) in Peru and LatAm.
**Current model:** Freemium (1 free AI-optimized schedule per user/IP). Goal: strong freemium-to-paid conversion.
**Research scope:** Customer personas, competitor pricing, LatAm market data, pricing methodologies (elasticity/LTV/CAC/break-even), freemium best practices, infrastructure costs.
**Markets:** Peru (primary), Mexico, Colombia, Brazil, Chile (expansion).
**Batch workflow:** Phase 1 = raw data (web_search), Phase 2 = analysis (code_execution), Phase 3 = synthesis.
**Next action:** Run Phase 1 batch — 8 parallel research requests.

---

`;

const resChangesPath = 'Research_changes.md';
const resChangesAbs = path.join(ROOT, resChangesPath);
if (!fs.existsSync(resChangesAbs)) {
  write(resChangesPath, RESEARCH_CHANGES_HEADER + RES_000);
} else {
  append(resChangesPath, RES_000);
  console.log('  ✓ Research_changes.md already exists — appended RES-000');
}

// Create output directories
['docs/pricing/research', 'docs/pricing/analysis'].forEach((dir) => {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  console.log(`  ✓ ensured ${dir}/`);
});

console.log('\n✅ Phase 0 complete\n');

// ─── Phase 1: Research Batch ───────────────────────────────────────────────────

console.log('══════════════════════════════════════════');
console.log(' PHASE 1 — Exhaustive Data Collection');
console.log('══════════════════════════════════════════\n');

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search' };

const phase1Requests = [

  // ── 1: Customer Segments & Personas ─────────────────────────────────────
  {
    custom_id: 'p1-customer-segments',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: Customer Segments & Personas for LatAm Workforce Management SaaS

Perform exhaustive research on SMB customer segments for scheduling/workforce management tools in Peru, Mexico, Colombia, Brazil, and Chile.

**Run at least 3 iterative rounds of searches.** Start broad, then get very specific.

Required findings (cite all sources):

### 1. Customer Personas (per market)
- Primary buyer profile (owner vs HR manager vs ops manager)
- Business size sweet spot (5–20 vs 20–50 employees)
- Industries with highest scheduling pain (restaurants, retail, healthcare, hospitality)
- Tech adoption level (smartphone penetration, WhatsApp usage, existing tools)
- Real customer quotes/reviews from G2, Capterra, Trustpilot, App Store (search in Spanish/Portuguese)

### 2. Pain Points & Purchase Triggers
- Top 3 scheduling pain points for LatAm SMBs
- What triggers the decision to buy scheduling software
- Common objections to paying (cost, trust, complexity)
- How purchase decisions are made (owner authority, WhatsApp demos, referrals)

### 3. Willingness to Pay (WTP)
- Monthly spend on software tools per SMB in Peru, Mexico, Colombia, Brazil, Chile (search for survey data)
- Price sensitivity indices for these markets vs US/EU (search ProfitWell, Paddle, Baremetrics LatAm reports)
- What features justify premium pricing for LatAm SMBs

### 4. Churn Drivers
- Why SMBs cancel scheduling software subscriptions
- Engagement metrics that predict churn

Search terms to use (run all):
- "scheduling software SMB Latin America reviews"
- "software de turnos pymes Peru opiniones"
- "software de horarios pymes Mexico precio"
- "gestión de turnos Colombia pequeñas empresas"
- "shift scheduling app Brazil small business"
- "SMB software adoption rate Latin America 2024 2025"
- "workforce management LatAm market research"
- Capterra/G2 reviews for 7shifts, Deputy, Homebase in Spanish

Output a comprehensive report with all findings, sources cited inline.`,
      }],
    },
  },

  // ── 2: Competitor Pricing ────────────────────────────────────────────────
  {
    custom_id: 'p1-competitor-pricing',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: Competitor Pricing — Real 2025-2026 Data

Research and verify CURRENT pricing for ALL major competitors in the SMB shift-scheduling space. Browse their actual pricing pages.

**Run multiple search rounds. Browse each competitor's pricing page directly.**

### Tier-1 Competitors (browse pricing pages):
1. **7shifts** — https://www.7shifts.com/pricing
2. **Deputy** — https://www.deputy.com/pricing
3. **Homebase** — https://joinhomebase.com/pricing
4. **When I Work** — https://wheniwork.com/pricing
5. **Sling** — https://getsling.com/pricing
6. **Connecteam** — https://connecteam.com/pricing
7. **Clockify** — https://clockify.me/pricing
8. **Toggl Track** — https://toggl.com/track/pricing
9. **BambooHR** (workforce module) — https://www.bamboohr.com/pricing
10. **Workstream** — https://www.workstream.us/pricing

### LatAm-Local / Emerging Competitors:
- Search: "software de turnos Peru precios 2024 2025"
- Search: "aplicacion horarios empleados Mexico precio"
- Search: "gestión de turnos SaaS Colombia precios"
- Search: "workforce management app Brazil pricing"
- Search: "scheduling software LatAm local startups"
- Check: Factorial HR (Spain/LatAm presence), Runa (Mexico payroll/HR)

### For EACH competitor, extract:
- Free tier: features + limits
- Paid tiers: exact price per user/month, minimum seats, feature gates
- Annual vs monthly discount %
- Freemium conversion rate (if published)
- Any LatAm-specific pricing or regional plans
- Recent pricing changes (2024-2025)

### Competitive Gaps:
- Which competitors are NOT in Peru/LatAm market
- Which have Spanish/Portuguese localization
- Which support local labor laws (Peru Sunafil, etc.)

Output a full competitor pricing matrix table + narrative analysis with all sources cited.`,
      }],
    },
  },

  // ── 3: LatAm SaaS Market ────────────────────────────────────────────────
  {
    custom_id: 'p1-latam-market',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: LatAm SaaS & Workforce Management Market Data

Research the Latin American SaaS market with focus on workforce management and HR tech for SMBs.

**Run at least 3 iterative rounds of searches.**

### 1. Market Size & Growth
- Total addressable market (TAM) for workforce management / scheduling SaaS in LatAm
- SMB SaaS market size in Peru, Mexico, Colombia, Brazil, Chile (2023-2026)
- CAGR for HR tech / workforce management software in LatAm
- Sources: IDC, Gartner, Statista, IUPAC, local chambers of commerce

Search terms:
- "Latin America SaaS market size 2024 2025"
- "HR tech workforce management LatAm market size"
- "mercado software RRHH America Latina tamaño 2024"
- "Peru software empresarial mercado crecimiento"
- "Mexico HR software market size SMB"

### 2. SMB Digital Adoption
- % of LatAm SMBs using workforce/scheduling software
- Rate of WhatsApp Business adoption for SMB operations
- Digital payment penetration (Yape, Plin in Peru; Mercado Pago in Mexico/Brazil)
- Smartphone penetration rates by country

### 3. LatAm SaaS Pricing Benchmarks
- Average SaaS ARPU for SMB tools in LatAm vs US (discount factor)
- Currency volatility impact on SaaS pricing (PEN, MXN, COP, BRL, CLP)
- PPP (Purchasing Power Parity) adjustment factors for Peru, Mexico, Colombia, Brazil, Chile
- Common pricing strategies used by LatAm SaaS companies (dollarized vs local currency)

Search: "SaaS pricing Latin America PPP adjustment"
Search: "LatAm SaaS benchmarks ARPU churn 2024 2025"
Search: "OpenView partners LatAm SaaS report"

### 4. Regulatory Environment
- Key labor laws affecting scheduling in Peru (Sunafil), Mexico (IMSS), Colombia, Brazil (CLT), Chile
- Required compliance features that create switching costs

Output a comprehensive market analysis report with all data sources cited.`,
      }],
    },
  },

  // ── 4: Global WFM SaaS Benchmarks ───────────────────────────────────────
  {
    custom_id: 'p1-global-wfm',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: Global Workforce Management SaaS Pricing Benchmarks

Research global pricing benchmarks for workforce management, scheduling, and HR SaaS tools.

**Run multiple iterative rounds — browse reports from OpenView, Bessemer, Revenera, Paddle, ProfitWell.**

### 1. Global WFM SaaS Pricing Trends (US, EU, Asia, LatAm)
Browse and extract data from:
- Search: "OpenView SaaS pricing report 2024 2025 workforce management"
- Search: "Bessemer venture state of cloud report 2024 workforce"
- Search: "Revenera monetization monitor SaaS pricing 2024"
- Search: "Paddle ProfitWell SaaS pricing trends 2024 2025"
- Search: "workforce management software pricing per user 2024"
- Search: "scheduling software SaaS pricing models per seat usage"

### 2. Freemium SaaS Benchmarks
- Average freemium-to-paid conversion rates for B2B SaaS (overall + WFM-specific)
- Free-to-paid conversion timeline (median days)
- Best-performing freemium feature gates for workforce tools
- "Product-led growth" (PLG) benchmarks for SMB SaaS
Search: "freemium conversion rate B2B SaaS 2024 benchmarks"
Search: "product led growth PLG conversion rate SMB SaaS 2024"
Search: "ProfitWell freemium conversion rate benchmarks"

### 3. Pricing Model Comparison for WFM SaaS
- Per-user/seat pricing: typical ranges, pros/cons
- Per-location pricing: when used, typical ranges
- Flat-fee (SMB-friendly): typical ranges
- Usage-based pricing: emerging for WFM tools?
- Value-based pricing: how applied to scheduling tools
Search: "SaaS pricing models workforce management per seat vs flat"
Search: "SMB SaaS pricing strategy 2024 per user vs per location"

### 4. Geographic Price Differentiation
- US vs EU vs Asia vs LatAm pricing ratios for SaaS tools
- PPP-adjusted pricing adoption rate among global SaaS companies
- Currency risk management: USD-denominated vs local currency
Search: "SaaS geographic pricing LatAm discount 2024"
Search: "SaaS purchasing power parity pricing strategy"

### 5. Key SaaS Metrics Benchmarks (WFM category)
- Median net revenue retention (NRR) for SMB WFM SaaS
- Median gross churn for SMB SaaS
- Median CAC for SMB SaaS tools
- LTV:CAC ratios for successful SMB SaaS
Search: "SMB SaaS benchmarks LTV CAC churn 2024 Baremetrics ChartMogul"
Search: "SaaS metrics workforce management NRR churn 2024"

Output a comprehensive global benchmarks report with all data sources cited.`,
      }],
    },
  },

  // ── 5: Pricing Methodologies & Formulas ──────────────────────────────────
  {
    custom_id: 'p1-methodologies',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: SaaS Pricing Calculation Methodologies & Exact Formulas

Extract the EXACT formulas, methodologies, and worked examples from authoritative SaaS pricing sources.

**Browse the actual pages — extract exact formulas with variable definitions.**

### Sources to Browse Directly:
1. ProfitWell / Paddle pricing guides — search: "ProfitWell price elasticity formula SaaS"
2. Baremetrics SaaS metrics — search: "Baremetrics LTV formula SaaS churn"
3. ChartMogul LTV/CAC — search: "ChartMogul LTV CAC ratio calculation"
4. OpenView PLG benchmarks — search: "OpenView product led growth pricing strategy"
5. Spendflo break-even — search: "Spendflo SaaS break-even calculation"
6. GetMonetizely elasticity — search: "price elasticity demand SaaS calculation formula"
7. MomentumNexus pricing — search: "SaaS value-based pricing methodology"

### Required Formulas (extract exact definitions):

**1. Price Elasticity of Demand**
- Midpoint/Arc method formula
- How to measure for SaaS products
- Typical elasticity ranges for SMB SaaS tools
- How elasticity differs by market (US vs LatAm)
Search: "price elasticity of demand SaaS midpoint arc formula example"
Search: "how to measure price elasticity SaaS product"

**2. Lifetime Value (LTV) Formulas**
- LTV = ARPU / Churn Rate
- LTV = ARPU × Average Customer Lifetime
- LTV with expansion revenue
- Discount rate adjustments
- LTV for freemium vs paid cohorts
Search: "SaaS LTV formula ARPU churn rate Baremetrics 2024"
Search: "lifetime value calculation SaaS freemium paid cohort"

**3. LTV:CAC Ratio**
- Target ratio (≥3:1)
- How to calculate CAC for inbound vs outbound
- CAC for SMB SaaS with freemium (CAC includes free users)
Search: "LTV CAC ratio SaaS target 3:1 calculation 2024"

**4. Break-Even Analysis**
- Break-even point: Fixed Costs / (ARPA − Variable Cost per User)
- Variable costs for SaaS (infrastructure, support, payment processing)
- Fixed costs breakdown
- Payback period: CAC / (ARPA − Variable Cost)
Search: "SaaS break-even point formula fixed variable costs"

**5. Price Markup & Safety Margins**
- Cost-plus markup for SaaS
- Gross margin targets for SMB SaaS (typically 70-85%)
- Safety margin calculation
Search: "SaaS gross margin target SMB 2024"
Search: "SaaS cost-plus pricing markup calculation"

**6. Freemium Conversion Models**
- Free-to-paid conversion rate formula
- Freemium CAC calculation
- Value metric identification
Search: "freemium to paid conversion model formula PLG"

For each formula: provide exact variables, worked numeric example, and source citation.

Output a methodologies handbook with all formulas, definitions, worked examples, and sources.`,
      }],
    },
  },

  // ── 6: Freemium Conversion Strategies ───────────────────────────────────
  {
    custom_id: 'p1-freemium',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: Freemium Conversion Strategies for SMB SaaS

Research best practices and real data on freemium-to-paid conversion for B2B/SMB SaaS tools.

**Run at least 3 iterative rounds of searches.**

### 1. Freemium Model Design
- Optimal freemium feature gate design for scheduling/WFM tools
- "Time-bomb" vs "feature-gate" vs "usage-cap" freemium models
- What free features drive conversion vs kill conversion
- Anti-patterns in freemium (too generous vs too restrictive)
Search: "freemium feature gate design SaaS B2B best practices 2024"
Search: "freemium model time bomb usage cap feature gate SaaS"
Search: "scheduling software freemium model 7shifts homebase freemium"

### 2. Conversion Rate Benchmarks
- Industry-average freemium-to-paid conversion rates for B2B SaaS
- Conversion rates specifically for HR/WFM/scheduling tools
- Time-to-convert (days from signup to paid)
- Conversion rate by acquisition channel (organic vs paid vs referral)
Search: "B2B SaaS freemium conversion rate benchmark 2024 2025"
Search: "product led growth conversion rate HR software 2024"
Search: "Baremetrics ProfitWell freemium conversion benchmark"

### 3. Upgrade Triggers & In-App Messaging
- Best upgrade triggers (hitting limits, manager request, feature discovery)
- Optimal timing for upgrade prompts
- Trial-to-paid vs freemium-to-paid conversion tactics
- In-app upgrade nudge best practices
Search: "SaaS upgrade trigger freemium conversion in-app message"
Search: "how to convert free users to paid SaaS tactics 2024"

### 4. LatAm-Specific Freemium Considerations
- How LatAm SMBs respond to freemium models (WhatsApp-based onboarding)
- Trust-building before payment in LatAm markets
- Payment friction (card penetration, Yape/Mercado Pago adoption)
- Price anchoring strategies for price-sensitive markets
Search: "SaaS freemium LatAm Latin America conversion 2024"
Search: "payment methods Peru Yape Plin pymes software"
Search: "Mexico Mercado Pago SaaS payment SMB 2024"

### 5. Competitor Freemium Analysis
- 7shifts freemium model: what's free, what's paid
- Homebase freemium model: what's free, what's paid
- Connecteam freemium model
- Clockify freemium model
- Which freemium features drive the highest conversion
Search: "7shifts free plan features 2024 2025"
Search: "homebase free plan what's included 2024"
Search: "connecteam free plan features limitations"

Output a comprehensive freemium strategy report with benchmarks, best practices, and LatAm-specific considerations.`,
      }],
    },
  },

  // ── 7: App Infrastructure Costs ─────────────────────────────────────────
  {
    custom_id: 'p1-app-costs',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 6144,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: Infrastructure & Operational Costs for Horario App

Research and extract CURRENT (2024-2026) pricing for all infrastructure components used by Horario.

**Browse actual pricing pages for each service.**

### 1. Authentication: Clerk
- Browse: https://clerk.com/pricing
- Free tier limits (MAUs)
- Pro tier cost per MAU
- Estimate cost for 100, 500, 1000, 5000 MAU
Search: "Clerk auth pricing 2024 2025 MAU cost"

### 2. Database/Backend: Supabase
- Browse: https://supabase.com/pricing
- Free tier limits (database size, MAU, storage, bandwidth)
- Pro tier: flat fee + overage costs
- Estimate cost for 100, 500, 1000, 5000 active users
Search: "Supabase pricing 2024 2025 SMB SaaS cost"

### 3. Hosting: Vercel
- Browse: https://vercel.com/pricing
- Free tier limits
- Pro tier cost
- Estimate for moderate API traffic
Search: "Vercel pricing 2024 2025 serverless API cost"

### 4. AI/LLM: Anthropic API
- Browse: https://www.anthropic.com/pricing
- claude-sonnet-4-6 cost per 1M input/output tokens
- Estimate for demand forecasting (calls per user per month)
Search: "Anthropic API pricing 2025 Claude Sonnet cost per token"

### 5. Push Notifications: Expo Push
- Browse: https://expo.dev/pricing
- Expo EAS cost for push notifications
Search: "Expo push notification service cost 2024 2025"

### 6. Payment Processing
- Stripe fees for LatAm (Peru, Mexico, Colombia, Brazil, Chile)
- Mercado Pago fees
- Local payment processor options
Search: "Stripe fees Latin America Peru 2024 2025"
Search: "Mercado Pago API fees Mexico Colombia Brazil 2024"

### 7. Customer Support Costs
- Cost per support ticket for SMB SaaS
- WhatsApp Business API costs for support
- Intercom/Crisp/Zendesk pricing for SMB
Search: "WhatsApp Business API pricing 2024 LatAm"
Search: "customer support cost per ticket SaaS SMB"

### Summary Table Required:
Create a cost model showing:
- Fixed monthly costs (infrastructure floor)
- Variable costs per active user
- Variable costs per paying customer
- Target gross margin calculation

Output a detailed cost analysis with all current pricing data and sources.`,
      }],
    },
  },

  // ── 8: LatAm Buying Behavior ─────────────────────────────────────────────
  {
    custom_id: 'p1-buying-behavior',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: RESEARCH_SYSTEM,
      tools: [WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Research Task: LatAm SMB Buying Behavior, Price Sensitivity & Purchase Psychology

Research how LatAm small business owners make software purchase decisions.

**Run at least 3 iterative search rounds — include Spanish/Portuguese terms.**

### 1. LatAm SMB Software Buying Process
- Who makes the decision (owner, manager, accountant)?
- How do they discover software (WhatsApp groups, Facebook, Google, referrals)?
- Role of free trials vs freemium vs direct demos
- Typical sales cycle length for SMB SaaS in LatAm
- Importance of WhatsApp for sales/support in LatAm
Search: "comportamiento compra software pymes America Latina 2024"
Search: "SMB software buying process Latin America WhatsApp sales"
Search: "Peru small business software adoption research 2024"
Search: "Mexico pymes software decision making process"

### 2. Price Sensitivity by Country
- Relative price sensitivity: Peru vs Mexico vs Colombia vs Brazil vs Chile
- Average monthly software spend per SMB in each country
- Price anchoring effects in LatAm markets
- Impact of currency volatility on SaaS pricing decisions
Search: "price sensitivity SMB software Latin America 2024"
Search: "software spend per employee LatAm SMB survey"
Search: "sensibilidad precios software pymes Peru Mexico Colombia"
Search: "Paddle ProfitWell price sensitivity index LatAm"

### 3. Informal Economy & Trust Issues
- % of LatAm SMBs in informal economy (affects card penetration)
- Trust barriers for cloud SaaS in LatAm
- Data privacy concerns (GDPR-like laws: LPDP in Peru, LGPD in Brazil)
- How to build trust with LatAm SMB buyers
Search: "economia informal Peru porcentaje empresas 2024"
Search: "cloud adoption barriers Latin America SMB trust"
Search: "LGPD LPDP data privacy LatAm SaaS compliance"

### 4. Payment Methods & Infrastructure
- Credit card penetration by country (Peru, Mexico, Colombia, Brazil, Chile)
- Digital wallet adoption: Yape/Plin (Peru), Mercado Pago, Nequi, Daviplata
- Monthly recurring payment willingness vs annual upfront
- Invoice/transfer payment preference for B2B
Search: "tarjeta de credito penetracion Peru Mexico Colombia 2024"
Search: "Yape Plin adoption Peru businesses 2024"
Search: "B2B SaaS payment methods preference Latin America"

### 5. Competitive Pricing Perception
- What price range feels "cheap" vs "reasonable" vs "expensive" for SMB software in Peru/LatAm
- Impact of anchoring (showing higher tiers first)
- Bundle vs à la carte preference
- Annual discount sensitivity in LatAm
Search: "precio justo software pymes Peru Colombia Mexico survey"
Search: "SaaS pricing perception LatAm SMB willingness to pay"

Output a comprehensive buying behavior report with market-specific insights and all sources cited.`,
      }],
    },
  },
];

// Submit or recover Phase 1 batch
let phase1BatchId = loadBatchId(1);
if (phase1BatchId) {
  console.log(`Recovered Phase 1 batch ID: ${phase1BatchId}`);
} else {
  const client = new Anthropic();
  console.log(`Submitting ${phase1Requests.length} Phase 1 requests (web_search enabled)…`);
  const batch1 = await client.messages.batches.create({ requests: phase1Requests });
  phase1BatchId = batch1.id;
  saveBatchId(1, phase1BatchId);
  console.log(`Phase 1 Batch ID: ${phase1BatchId}`);
}

const client = new Anthropic();

console.log('\nPolling Phase 1 batch…\n');
await pollBatch(client, phase1BatchId);

const P1_OUTPUT_MAP = {
  'p1-customer-segments': 'docs/pricing/research/p1-customer-segments.md',
  'p1-competitor-pricing': 'docs/pricing/research/p1-competitor-pricing.md',
  'p1-latam-market':       'docs/pricing/research/p1-latam-market.md',
  'p1-global-wfm':         'docs/pricing/research/p1-global-wfm.md',
  'p1-methodologies':      'docs/pricing/research/p1-methodologies.md',
  'p1-freemium':           'docs/pricing/research/p1-freemium.md',
  'p1-app-costs':          'docs/pricing/research/p1-app-costs.md',
  'p1-buying-behavior':    'docs/pricing/research/p1-buying-behavior.md',
};

const p1Summary = await collectResults(client, phase1BatchId, P1_OUTPUT_MAP, new Set(Object.keys(P1_OUTPUT_MAP)));

// Append Phase 1 entry to Research_changes.md
append(resChangesPath, `
### RES-001 — ${NOW_UTC}
**Type:** RESEARCH (Phase 1 — Raw Data Collection)
**Batch ID:** ${phase1BatchId}
**Requests:** ${phase1Requests.length} parallel (web_search enabled)
**Results:** ${p1Summary.succeeded} succeeded / ${p1Summary.failed} failed
**Output files:**
${Object.values(P1_OUTPUT_MAP).map((f) => `  - ${f}`).join('\n')}
**Next action:** Run Phase 2 batch — quantitative analysis using P1 data.

---

`);

console.log('\n✅ Phase 1 complete\n');

// ─── Phase 2: Analysis Batch ───────────────────────────────────────────────────

console.log('══════════════════════════════════════════');
console.log(' PHASE 2 — Analysis & Quantitative Models');
console.log('══════════════════════════════════════════\n');

// Load Phase 1 outputs for context
function p1(key) {
  const p = P1_OUTPUT_MAP[key];
  const content = p1Summary.results[key] || read(p);
  return content.slice(0, 6000); // limit per request to avoid context overflow
}

const CODE_EXEC_TOOL = { type: 'code_execution_20260120', name: 'code_execution' };

const phase2Requests = [

  // ── P2-1: Pricing Model Design ───────────────────────────────────────────
  {
    custom_id: 'p2-pricing-model',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: ANALYSIS_SYSTEM,
      tools: [CODE_EXEC_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Analysis Task: Optimal Pricing Tiers & Price Points for Horario

Using the research data below, design the optimal pricing strategy for Horario App.

### Research Data: Competitor Pricing
${p1('p1-competitor-pricing')}

### Research Data: Freemium Strategies
${p1('p1-freemium')}

### Research Data: LatAm Buying Behavior
${p1('p1-buying-behavior')}

---

## Required Deliverables:

### 1. Freemium Tier Design
- Define exactly what is FREE (features + usage limits)
- Justify each limit based on competitor benchmarks and conversion research
- Explain the "aha moment" that drives upgrade

### 2. Paid Tier Architecture (2-3 tiers recommended)
For each tier:
- Tier name + positioning tagline
- Price per user/month (monthly + annual)
- Feature set
- Minimum seat requirement (if any)
- Target customer profile
- Upgrade trigger from lower tier

### 3. Value Metric Analysis
- What is Horario's best value metric? (per user, per location, per schedule, per employee managed)
- Use code_execution to model revenue under each value metric scenario

### 4. Price Point Justification
Using code_execution, implement:
\`\`\`python
# Price sensitivity analysis
# Based on competitor pricing matrix and LatAm WTP data
# Show: at price X, expected conversion rate Y, expected ARPU Z
\`\`\`

### 5. Annual vs Monthly Discount
- Recommended annual discount % (justify with churn reduction math)
- Use code_execution to show NPV of annual vs monthly customer

### 6. Peru Launch Pricing vs LatAm Expansion Pricing
- Should prices differ by country? How?
- Should pricing be in USD (stable) or local currency (accessible)?

Output a structured pricing tier recommendation with code-execution models showing the math.`,
      }],
    },
  },

  // ── P2-2: Country-Specific Adjustments ──────────────────────────────────
  {
    custom_id: 'p2-country-adjust',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: ANALYSIS_SYSTEM,
      tools: [CODE_EXEC_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Analysis Task: Country-Specific Pricing Adjustments

Using the research data below, determine how pricing should be adjusted per market.

### Research Data: LatAm Market
${p1('p1-latam-market')}

### Research Data: Buying Behavior
${p1('p1-buying-behavior')}

### Research Data: Global WFM Benchmarks
${p1('p1-global-wfm')}

---

## Required Deliverables:

### 1. PPP-Adjusted Pricing Model
Use code_execution to calculate PPP-adjusted prices:
\`\`\`python
# PPP adjustment factors (use World Bank / IMF data from research)
# Base: USD prices
# Adjust for: Peru, Mexico, Colombia, Brazil, Chile
# Show: local currency equivalent + USD equivalent per market
\`\`\`

### 2. Currency Strategy
- USD-denominated (stability, dollarized mindset in Peru/MX)
- vs Local currency (accessibility, lower friction)
- Recommendation with rationale

### 3. Price Localization Matrix
Create a table showing recommended prices per tier per country:
| Country | Free | Starter $/mo | Growth $/mo | Pro $/mo |
|---------|------|-------------|------------|---------|

### 4. Market Entry Sequencing
- Which LatAm market should Horario enter first (beyond Peru)?
- Pricing strategy for each expansion market
- Key differentiators needed per market

### 5. Payment Method Requirements by Country
- Which payment methods must be supported before launch in each country
- Implementation priority (Yape/Plin for Peru, Mercado Pago, Stripe LatAm)
- Impact on conversion rates

### 6. Elasticity by Country
Use code_execution to model:
\`\`\`python
# Price elasticity of demand by country
# Higher elasticity (more price-sensitive) → lower price points
# Estimate conversion rate impact of +/- 20% price change per market
\`\`\`

Output a structured country-by-country pricing guide with all calculations shown.`,
      }],
    },
  },

  // ── P2-3: Quantitative Models ────────────────────────────────────────────
  {
    custom_id: 'p2-quant-models',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: ANALYSIS_SYSTEM,
      tools: [CODE_EXEC_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Analysis Task: Quantitative Pricing Models — Elasticity, LTV/CAC, Break-Even

Using the formulas and data below, build complete quantitative models for Horario's pricing strategy.

### Research Data: Pricing Methodologies & Formulas
${p1('p1-methodologies')}

### Research Data: Infrastructure Costs
${p1('p1-app-costs')}

### Research Data: Global WFM Benchmarks (LTV/CAC/churn)
${p1('p1-global-wfm')}

---

## Required Models (all implemented via code_execution):

### 1. Infrastructure Cost Model
\`\`\`python
# Monthly cost breakdown per active user and per paying customer
# Fixed costs: Supabase, Vercel, Clerk (base), etc.
# Variable costs: per-MAU (Clerk), per-API-call (Anthropic), per-push-notification
# Target: calculate Cost of Goods Sold (COGS) per user tier
\`\`\`

### 2. Break-Even Analysis
\`\`\`python
# Break-even point: Fixed Costs / (ARPA - Variable Cost per User)
# Model scenarios: 100, 250, 500, 1000 paying users
# Show: monthly revenue needed to cover costs at each scale
# Show: break-even user count for each pricing tier
\`\`\`

### 3. LTV Calculation
\`\`\`python
# LTV = ARPU / Monthly Churn Rate
# Use churn benchmarks from research (SMB SaaS ~5-8% monthly)
# Model: Starter tier LTV, Growth tier LTV, Pro tier LTV
# Apply LatAm churn adjustment (higher churn expected vs US)
\`\`\`

### 4. CAC & LTV:CAC Ratio
\`\`\`python
# CAC scenarios:
#   - Organic/SEO CAC: $5-15 for LatAm SMB SaaS
#   - Paid social CAC: $20-50 for LatAm
#   - Referral CAC: $10-25
#   - Freemium CAC (including free users): CAC / conversion_rate
# LTV:CAC ratio per scenario
# Payback period: CAC / (ARPA - variable_cost)
\`\`\`

### 5. Freemium Unit Economics
\`\`\`python
# Cost to serve 1 free user per month
# Cost to serve 1 paid user per month
# Subsidy ratio: free_users / paid_users breakeven
# At what free:paid ratio does freemium become unprofitable?
\`\`\`

### 6. Revenue Projection Model
\`\`\`python
# 12-month revenue projection
# Assumptions:
#   - Monthly signups: 50 → 200 (growth)
#   - Freemium conversion: 3-8% (LatAm benchmark)
#   - Churn: 6% monthly (SMB SaaS LatAm)
#   - ARPU: weighted avg across tiers
# Show: MRR, ARR, paying users by month
\`\`\`

### 7. Gross Margin Analysis
\`\`\`python
# Target gross margin: 70-85% for SaaS
# Calculate actual gross margin at different scale points
# Identify when margins improve due to fixed cost leverage
\`\`\`

Run ALL models. Show formulas, inputs, and outputs clearly. Summarize key numbers for the final report.`,
      }],
    },
  },

  // ── P2-4: Positioning & Feature Recommendations ──────────────────────────
  {
    custom_id: 'p2-positioning',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: ANALYSIS_SYSTEM,
      tools: [CODE_EXEC_TOOL, WEB_SEARCH_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Analysis Task: Feature Prioritization & Positioning to Support Pricing Strategy

Using the research data below, recommend which features to build (and in what order) to justify the pricing tiers.

### Research Data: Customer Segments & Pain Points
${p1('p1-customer-segments')}

### Research Data: Competitor Pricing & Features
${p1('p1-competitor-pricing')}

### Research Data: LatAm Market
${p1('p1-latam-market')}

---

## Required Deliverables:

### 1. Feature-to-Tier Mapping
Create a complete feature matrix showing what goes in each tier (Free / Starter / Growth / Pro):
- Must include ALL current Horario features
- Must include roadmap features that are high-value for paid conversion
- Mark which features are "conversion anchors" (drive upgrade)

### 2. Feature Priority Matrix
Using code_execution, score features by:
\`\`\`python
# Priority score = (WTP_impact × 0.4) + (conversion_rate_impact × 0.3) + (build_effort_inverse × 0.3)
# Rank features: build first vs defer
\`\`\`

### 3. Competitive Differentiation for LatAm
Based on competitor analysis, which features give Horario UNIQUE positioning in LatAm:
- WhatsApp notification for shift changes (competitors lack this)
- Local labor law compliance engine (Sunafil/Peru, IMSS/Mexico)
- Offline-capable mobile app (low connectivity areas)
- Spanish/Portuguese-first UX
- Yape/Mercado Pago payment integration

### 4. Messaging & Positioning
- Primary tagline for each market
- Key value proposition per customer persona
- How to communicate pricing in LatAm context (avoid sticker shock)
- Trust signals needed before asking for payment

### 5. Onboarding-to-Conversion Funnel Design
- Key activation events that predict paid conversion
- Recommended onboarding checklist items
- Upgrade prompts: timing, message, offer

### 6. Referral & Viral Loop Design
- Referral program mechanics for LatAm (WhatsApp-native sharing)
- Estimated viral coefficient and impact on CAC
Use code_execution to model referral loop impact on growth.

Output structured recommendations with priority rankings and justification.`,
      }],
    },
  },
];

// Submit or recover Phase 2 batch
let phase2BatchId = loadBatchId(2);
if (phase2BatchId) {
  console.log(`Recovered Phase 2 batch ID: ${phase2BatchId}`);
} else {
  console.log(`Submitting ${phase2Requests.length} Phase 2 requests (code_execution enabled)…`);
  const batch2 = await client.messages.batches.create({ requests: phase2Requests });
  phase2BatchId = batch2.id;
  saveBatchId(2, phase2BatchId);
  console.log(`Phase 2 Batch ID: ${phase2BatchId}`);
}

console.log('\nPolling Phase 2 batch…\n');
await pollBatch(client, phase2BatchId);

const P2_OUTPUT_MAP = {
  'p2-pricing-model':   'docs/pricing/analysis/p2-pricing-model.md',
  'p2-country-adjust':  'docs/pricing/analysis/p2-country-adjustments.md',
  'p2-quant-models':    'docs/pricing/analysis/p2-quantitative-models.md',
  'p2-positioning':     'docs/pricing/analysis/p2-positioning.md',
};

const p2Summary = await collectResults(client, phase2BatchId, P2_OUTPUT_MAP, new Set(Object.keys(P2_OUTPUT_MAP)));

append(resChangesPath, `
### RES-002 — ${NOW_UTC}
**Type:** ANALYSIS (Phase 2 — Quantitative Models & Recommendations)
**Batch ID:** ${phase2BatchId}
**Requests:** ${phase2Requests.length} parallel (code_execution enabled)
**Results:** ${p2Summary.succeeded} succeeded / ${p2Summary.failed} failed
**Output files:**
${Object.values(P2_OUTPUT_MAP).map((f) => `  - ${f}`).join('\n')}
**Next action:** Run Phase 3 — synthesis into final pricing-strategy.md.

---

`);

console.log('\n✅ Phase 2 complete\n');

// ─── Phase 3: Synthesis Batch ──────────────────────────────────────────────────

console.log('══════════════════════════════════════════');
console.log(' PHASE 3 — Synthesis & Final Report');
console.log('══════════════════════════════════════════\n');

function p2(key) {
  const p = P2_OUTPUT_MAP[key];
  const content = p2Summary.results[key] || read(p);
  return content.slice(0, 5000);
}

const phase3Requests = [
  {
    custom_id: 'p3-final-report',
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      system: ANALYSIS_SYSTEM,
      tools: [CODE_EXEC_TOOL],
      messages: [{
        role: 'user',
        content: `${APP_CONTEXT}

## Synthesis Task: Final Pricing Strategy for Horario App

You have all the research and analysis. Synthesize everything into a single, definitive, actionable pricing strategy document.

### Analysis: Pricing Model
${p2('p2-pricing-model')}

### Analysis: Country Adjustments
${p2('p2-country-adjust')}

### Analysis: Quantitative Models
${p2('p2-quant-models')}

### Analysis: Positioning
${p2('p2-positioning')}

---

## Produce the FINAL pricing-strategy.md with these sections:

# Horario App — Pricing Strategy 2026

## Executive Summary (3 bullets max)

## 1. Market Context
- LatAm SMB opportunity (TAM, market dynamics)
- Competitive landscape summary (top 5 competitor positions)
- Key differentiators vs competitors

## 2. Customer Segments & Personas
- Persona 1: [Name] — [Profile] — WTP: $X/mo
- Persona 2: [Name] — [Profile] — WTP: $X/mo
- Persona 3: [Name] — [Profile] — WTP: $X/mo

## 3. Recommended Pricing Tiers

### Free Tier
| Feature | Limit |
...

### Starter — $X/user/month
| Feature | Included |
...

### Growth — $X/user/month (most popular)
| Feature | Included |
...

### Pro — $X/user/month
| Feature | Included |
...

Annual discount: XX% (billed annually)

## 4. Country-Specific Pricing
| Country | Currency | Free | Starter | Growth | Pro | Notes |
...

## 5. Quantitative Model Summary
(Include key numbers from code_execution: break-even users, LTV, CAC, gross margin, 12-month MRR projection)

## 6. Launch Roadmap
Phase 1 (Peru, Month 1-3): ...
Phase 2 (LatAm expansion, Month 4-12): ...

## 7. Feature Roadmap to Support Pricing
Priority 1 (Month 1-2): [features that unlock paid conversion]
Priority 2 (Month 3-6): [features that justify Growth tier]
Priority 3 (Month 7-12): [features that justify Pro tier]

## 8. Payment & Conversion Strategy
- Payment methods per market
- Freemium upgrade funnel
- WhatsApp sales playbook

## 9. Risks & Mitigations
| Risk | Probability | Impact | Mitigation |
...

## 10. Key Performance Indicators
| KPI | Target Month 3 | Target Month 6 | Target Month 12 |
...

---

Use code_execution to produce a final summary table of all key numbers.

This document will be committed to the repo and used by the product team immediately. Make it complete, specific, and immediately actionable.`,
      }],
    },
  },
];

// Submit or recover Phase 3 batch
let phase3BatchId = loadBatchId(3);
if (phase3BatchId) {
  console.log(`Recovered Phase 3 batch ID: ${phase3BatchId}`);
} else {
  console.log(`Submitting Phase 3 synthesis request…`);
  const batch3 = await client.messages.batches.create({ requests: phase3Requests });
  phase3BatchId = batch3.id;
  saveBatchId(3, phase3BatchId);
  console.log(`Phase 3 Batch ID: ${phase3BatchId}`);
}

console.log('\nPolling Phase 3 batch…\n');
await pollBatch(client, phase3BatchId);

const P3_OUTPUT_MAP = {
  'p3-final-report': 'docs/pricing/pricing-strategy.md',
};

const p3Summary = await collectResults(client, phase3BatchId, P3_OUTPUT_MAP, new Set(['p3-final-report']));

// Final Research_changes.md entry
append(resChangesPath, `
### RES-003 — ${NOW_UTC}
**Type:** SUMMARY (Phase 3 — Final Pricing Strategy)
**Batch ID:** ${phase3BatchId}
**Results:** ${p3Summary.succeeded} succeeded / ${p3Summary.failed} failed
**Final output:** docs/pricing/pricing-strategy.md
**Research complete.** All phases done:
  - Phase 1 (8 research tasks): docs/pricing/research/
  - Phase 2 (4 analysis tasks): docs/pricing/analysis/
  - Phase 3 (synthesis): docs/pricing/pricing-strategy.md
**Next steps:**
  1. Review docs/pricing/pricing-strategy.md
  2. Apply pricing tier design to app UI
  3. Update CLAUDE.md freemium model section
  4. Implement payment integration (Stripe + Yape/Mercado Pago)

---

`);

console.log('\n══════════════════════════════════════════');
console.log(' ALL PHASES COMPLETE');
console.log('══════════════════════════════════════════\n');
console.log('Output files:');
console.log('  📁 docs/pricing/research/    — 8 raw research reports');
console.log('  📁 docs/pricing/analysis/    — 4 quantitative analyses');
console.log('  📄 docs/pricing/pricing-strategy.md — FINAL REPORT');
console.log('  📄 Research_changes.md       — changelog (RES-000 → RES-003)');
console.log('\nNext steps:');
console.log('  1. Review docs/pricing/pricing-strategy.md');
console.log('  2. Commit: git add docs/pricing/ Research_changes.md');
console.log('  3. git commit -m "RES-003: Complete pricing strategy research"');
