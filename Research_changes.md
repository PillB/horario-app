# Research_changes.md — Horario Pricing Research Log

This file is the single persistent compressed memory for pricing and market-research workstreams.

## Entry format

```markdown
### RES-### – YYYY-MM-DD HH:MM:SS UTC
**Type:** [RESEARCH / ANALYSIS / SUMMARY / TEMP]
**Sources used:** (list URLs or tool results)
**Key findings:** ...
**Quantitative models run:** ...
**Implications for Horario pricing:** ...
**Future considerations:** ...
**References:** RES-###, RES-### | [SUMMARY-XXX]
```

### RES-000 – 2026-04-04 21:49:23 UTC
**Type:** SUMMARY
**Sources used:** `CLAUDE.md`; `README.md`; repository markdown inventory (`rg --files -g '*.md'`)
**Key findings:** Horario is a shift scheduling/optimization app (Expo + Supabase) with current gaps in auth, persistence, optimization engine depth, and enterprise readiness. Pricing research workflow is now explicitly defined in `CLAUDE.md` section 14.
**Quantitative models run:** None yet (phase setup only).
**Implications for Horario pricing:** Research must anchor on freemium-to-paid conversion in price-sensitive LatAm markets, with country-specific evidence and explicit cost-floor modeling before recommendations.
**Future considerations:** Next step is raw 2026 market data collection for customer segments, competitor pricing, and cost inputs.
**References:** None

### [SUMMARY-001] — 2026-04-04 21:49 UTC
**Last RES completed:** RES-000
**Current state:** Project context and pricing-research protocol are grounded; persistent log has been initialized.
**Active decisions:** Maintain strict phase separation (raw data first), source-cited claims, and quantitative modeling only after raw data approval.
**Next action:** Run Phase 1 parallel data collection (competitors, customer economics, SaaS pricing benchmarks, cost components).
**Watch out for:** Do not synthesize recommendations before explicit approval after raw data dump.

### RES-001 – 2026-04-04 22:01:10 UTC
**Type:** RESEARCH
**Sources used:**
- https://www.joinhomebase.com/pricing (captured via `web.open` + `web.find`)
- https://connecteam.com/pricing/
- https://wheniwork.com/pricing
- https://www.7shifts.com/pricing
- https://factorialhr.com/pricing-plans
- https://www.deputy.com/pricing/flexi
- https://www.buk.cl/
- https://supportcenter.buk.cl/hc/es-419/articles/38346824842779--C%C3%B3mo-puedo-conocer-el-costo-del-m%C3%B3dulo-de-Onboarding-y-contratarlo
- https://supportcenter.buk.cl/hc/es-419/articles/36291652448283--C%C3%B3mo-puedo-cotizar-un-nuevo-m%C3%B3dulo-en-Buk
- https://clerk.com/pricing
- https://www.twilio.com/en-us/whatsapp/pricing
- https://datareportal.com/reports/digital-2025-peru
- https://www.gsma.com/solutions-and-impact/connectivity-for-good/mobile-economy/latam/
- https://www.revenuecat.com/state-of-subscription-apps-2026/
- https://www.revenuecat.com/state-of-subscription-apps-2025/
**Key findings:**
- **Homebase (official pricing page):** Basic $0/location/month (1 location, up to 10 employees), Essentials $30/location/month, Plus $70/location/month, All-in-One $120/location/month; annual mode shows discounted values (e.g., Essentials $24, Plus $56, All-in-One $96) and payroll add-on listed as $39 base + $6 per employee paid/month.
- **Connecteam (official pricing page):** Per hub pricing tiers with fixed fee for first 30 users and incremental per-user pricing afterward; examples captured include Basic $29/month (+$0.5/additional user), Advanced $49 (+$1.5), Expert $99 (+$3), plus free options (Small Business for <10 users and Limited plan conditions) and 14-day free trial.
- **When I Work (official pricing page):** Essentials $2.50/user/month, Pro $5/user/month, Premium $8/user/month (as crawled), with free trial CTA.
- **7shifts (official pricing page):** Comp (Free, up to 15 employees), Essentials $39.99/location/month (up to 30), Pro $79.99/location/month, Premium $134.99/location/month; multiple paid add-ons listed.
- **Factorial (official pricing page):** “starts at $8 per month, per user” and quote-tailored packaging.
- **Deputy:** Direct `deputy.com/pricing/flexi` page content captured for weekly-flex model details, but comprehensive standard tier price matrix was not reliably extractable from crawled snapshot in this pass.
- **Buk (LatAm incumbent):** Public site and support-center content emphasize quote-based model and reference pricing by employee count / referential module prices; transparent fixed public list pricing not directly surfaced in retrieved pages.
- **Cost-side inputs:** Clerk official pricing page indicates a free tier up to high user threshold and paid Pro plans; Twilio WhatsApp pricing page confirms cost structure = Twilio per-message fee + Meta template fee passthrough (country/category dependent).
- **Market behavior proxies:** DataReportal Peru 2025 confirms large social-media footprint; GSMA LATAM 2025 report landing confirms mobile-connectivity trend coverage; RevenueCat 2025/2026 reports provide broad subscription monetization benchmark datasets (downloadable long-form reports).
**Quantitative models run:** None in this phase (raw collection only, per workflow).
**Implications for Horario pricing:** Raw evidence now collected for freemium/tier anchors (free cap patterns, per-location vs per-user pricing norms, add-on monetization, quote-led enterprise motion, and low-friction trial mechanics).
**Future considerations:** Need Phase 2 modeling pass to normalize all competitors to comparable units (per user / per location / per account), estimate LatAm affordability bands, and compute cost floors from OpenAI/auth/notifications/support utilization assumptions.
**References:** RES-000 | [SUMMARY-001]
