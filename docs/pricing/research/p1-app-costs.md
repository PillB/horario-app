Now I have all the data I need. Let me compile the comprehensive cost analysis.Now I have everything needed to write the full, cited research report.

---

# 🏗️ Horario App — Infrastructure & Operational Cost Analysis
### Current Pricing Intelligence Report (2025–2026)

---

## Executive Summary

Based on verified 2025–2026 pricing from all service providers, Horario's infrastructure cost structure is **exceptionally favorable for a LatAm SMB SaaS**. Fixed monthly infrastructure costs at launch are **~$115–$135/month** regardless of user count (up to ~10K MAU). The AI component (Anthropic) is the primary variable cost driver, but with model selection and prompt caching, it remains well below 2% of revenue at scale. Target **gross margins of 88–95%** are achievable from 500 MAU onward — above the SaaS median benchmark of 75%.

---

## 1. 🔐 Authentication — Clerk

### Verified Pricing (2025)

Clerk's Pro plan includes the first **10,000 MAUs free** and starts at **$25/month**. Additional MAUs are only **$0.02 each**.

The Pro plan has a base cost of **$25/month** and charges **$0.02 per MAU** after the initial 10,000 MAUs. The B2B SaaS suite costs **$1 per monthly active organization (MAO)** after the first 100 free, with unlimited members per organization.

Once you exceed 100 monthly retained organizations, you will be required to upgrade to the B2B Authentication add-on. Each user or organization beyond the free tier allowance will be added to your monthly bill.

**Horario-specific note:** Since Horario is a **B2B product** (each restaurant/business = 1 organization), you'll need to track monthly active **organizations** (MAO), not just users. The first 100 MAO are free — meaning your first ~100 business clients are covered with no B2B add-on cost.

### Clerk Cost at Scale

| MAU | Monthly Active Orgs | Base Fee | MAU Overage | MAO Overage | **Total/mo** |
|-----|---------------------|----------|-------------|-------------|-------------|
| 100 | ~10–20 | $25 | $0 | $0 | **$25** |
| 500 | ~50–75 | $25 | $0 | $0 | **$25** |
| 1,000 | ~100–150 | $25 | $0 | $0–$50 | **$25–$75** |
| 5,000 | ~500 | $25 | $0 | $400 | **$425** |
| 10,000 | ~1,000 | $25 | $0 | $900 | **$925** |
| 20,000 | ~2,000 | $25 | $200 | $1,900 | **$2,125** |

> ⚠️ **Critical Planning Note:** The $1/MAO B2B add-on activates at >100 organizations. At 5,000 MAU with ~1 org per 10 users, this could dominate Clerk costs. **Consider switching to Supabase Auth** (bundled free with Supabase) once you exceed ~150 client organizations to avoid this charge.

**Source:** [clerk.com/pricing](https://clerk.com/pricing), [clerk.com/blog/new-pricing-plans](https://clerk.com/blog/new-pricing-plans), [workos.com/blog/clerk-pricing](https://workos.com/blog/clerk-pricing)

---

## 2. 🗄️ Database/Backend — Supabase

### Verified Pricing (2025–2026)

**Free Plan:** $0/month — 500MB DB, 50K MAUs, 1GB storage. **Pro Plan:** $25/month + usage — 8GB DB, 100K MAUs, 100GB storage. Most small-to-medium production apps pay **$35–75/month** once usage fees are included.

The Free plan's main limits are 500 MB database size (shared CPU), 1 GB file storage, 5 GB database egress, 5 GB cached egress, and 50,000 monthly active users. **Free projects pause after one week of inactivity**, and you're limited to two active projects.

**Overage rates (Pro plan):**
Estimate monthly Supabase costs by calculating: (1) base plan fee ($25 for Pro), (2) expected database size beyond 8 GB × $0.125/GB, (3) expected monthly active users beyond 100K × $0.00325, (4) file storage beyond 100 GB × $0.021/GB, and (5) egress costs if you exceed 50 GB database or 250 GB storage transfer.

### Supabase Cost at Scale (Horario)

| User Scale | DB Size Est. | Storage | Egress | Base | Overage | **Total/mo** |
|------------|-------------|---------|--------|------|---------|-------------|
| 100 MAU | ~50 MB | ~100 MB | <1 GB | $25 | $0 | **$25** |
| 500 MAU | ~250 MB | ~500 MB | ~3 GB | $25 | $0 | **$25** |
| 1,000 MAU | ~500 MB | ~1 GB | ~8 GB | $25 | $0 | **$25** |
| 5,000 MAU | ~2.5 GB | ~5 GB | ~25 GB | $25 | $0 | **$25** |
| 20,000 MAU | ~10 GB | ~20 GB | ~80 GB | $25 | ~$3 | **~$28** |

> ✅ **Verdict:** Supabase Pro at $25/month covers Horario comfortably through ~50,000 MAU for scheduling data (shift records are small). Realtime subscriptions (for live schedule updates) are included in Pro. **Highly cost-efficient for this workload.**

**Source:** [supabase.com/pricing](https://supabase.com/pricing), [metacto.com/blogs/the-true-cost-of-supabase](https://www.metacto.com/blogs/the-true-cost-of-supabase-a-comprehensive-guide-to-pricing-integration-and-maintenance), [uibakery.io/blog/supabase-pricing](https://uibakery.io/blog/supabase-pricing)

---

## 3. 🚀 Hosting — Vercel

### Verified Pricing (2025, Post-September 2025 Restructuring)

At $20/month per deploying seat, Pro represents Vercel's primary commercial tier. A September 2025 restructuring converted the plan from fixed resource allocations to a **flexible credit-based model**: you get **1 TB Fast Data Transfer/month** and **10 million Edge Requests/month**, plus **$20 in monthly credits** applicable to any overage.

Monthly credit: Every Pro plan has $20 in monthly credit. Included infrastructure usage: Each month, you have **1 TB Fast Data Transfer** and **10,000,000 Edge Requests** included. Once you exceed these included allocations, Vercel will charge usage against your monthly credit before switching to on-demand billing.

Serverless Functions: **1M invocations included**, 16 CPU-hours, 1,440 GB-hours memory. Max Function Duration: 800 seconds with Fluid Compute enabled.

> ⚠️ **Important:** Vercel's Hobby (free) plan prohibits commercial use. For Horario as a production SaaS, **Pro at $20/month is mandatory**.

### Vercel Cost at Scale (Horario)

| Scenario | API Calls Est. | Bandwidth Est. | Plan | Overage | **Total/mo** |
|----------|---------------|---------------|------|---------|-------------|
| 100 MAU (early) | ~50K/mo | ~10 GB | Pro | $0 | **$20** |
| 500 MAU | ~250K/mo | ~50 GB | Pro | $0 | **$20** |
| 1,000 MAU | ~500K/mo | ~100 GB | Pro | $0 | **$20** |
| 5,000 MAU | ~2.5M/mo | ~500 GB | Pro | $0 | **$20–$30** |
| 20,000 MAU | ~10M/mo | ~1.5 TB | Pro | ~$15 | **$35–$45** |

**Source:** [vercel.com/pricing](https://vercel.com/pricing), [vercel.com/docs/plans/pro-plan](https://vercel.com/docs/plans/pro-plan), [checkthat.ai/brands/vercel/pricing](https://checkthat.ai/brands/vercel/pricing)

---

## 4. 🤖 AI/LLM — Anthropic Claude API

### Verified Pricing (2025–2026)

Pricing for **Sonnet 4.6** starts at **$3 per million input tokens** and **$15 per million output tokens**, with up to 90% cost savings with prompt caching and 50% cost savings with batch processing.

Anthropic offers three recommended tiers in 2026: **Haiku 4.5** ($1/$5), **Sonnet 4.6** ($3/$15), and **Opus 4.6** ($5/$25) per million input/output tokens. Both 4.6 models include 1M context at standard pricing.

### Model Selection for Horario

| Model | Input ($/MTok) | Output ($/MTok) | Best Use Case |
|-------|---------------|-----------------|---------------|
| **Claude Haiku 4.5** | $1.00 | $5.00 | ✅ Demand forecasting, shift optimization (recommended) |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | Complex constraint reasoning, labor law engine |
| **Claude Opus 4.6** | $5.00 | $25.00 | Enterprise edge cases only |

### AI Cost Estimation for Horario

**Assumptions per API call:**
- Demand forecast: ~2,000 input tokens (historical data + system prompt) + ~500 output tokens (forecast JSON)
- Shift optimization: ~3,500 input tokens (roster + constraints) + ~800 output tokens

**With Prompt Caching** (system prompt ~1,500 tokens, 80% cache hit rate):
With up to 90% cost savings with prompt caching — effectively reduces the static system prompt cost by ~90%.

| MAU | Free Calls (1/user) | Paid User Calls (8/user avg) | **Haiku Cost/mo** | **Sonnet Cost/mo** |
|-----|--------------------|-----------------------------|-------------------|-------------------|
| 100 MAU (10 paying) | 90 calls | 80 calls | **~$0.38** | **~$1.13** |
| 500 MAU (50 paying) | 450 calls | 400 calls | **~$1.91** | **~$5.74** |
| 1,000 MAU (100 paying) | 900 calls | 800 calls | **~$3.83** | **~$11.48** |
| 5,000 MAU (500 paying) | 4,500 calls | 4,000 calls | **~$19.13** | **~$57.38** |
| 20,000 MAU (2K paying) | 18,000 calls | 16,000 calls | **~$76.50** | **~$229.50** |

> 🎯 **Recommendation:** Use **Haiku 4.5** for demand forecasting (pattern recognition on simple time-series data) and **Sonnet 4.6 only** for the complex AI shift-optimization algorithm (constraint solving with labor laws). Batch API (50% discount) for background forecast jobs processed overnight.

**Source:** [anthropic.com/claude/sonnet](https://www.anthropic.com/claude/sonnet), [platform.claude.com/docs/pricing](https://platform.claude.com/docs/en/about-claude/pricing), [metacto.com/blogs/anthropic-api-pricing](https://www.metacto.com/blogs/anthropic-api-pricing-a-full-breakdown-of-costs-and-integration)

---

## 5. 📱 Push Notifications — Expo

### Verified Pricing (2025)

Every Expo project comes with a solid foundation for developing apps. The push notification service infrastructure is included across plan tiers.

**Key finding:** Expo's Push Notification Service (the actual message delivery via FCM/APNs) is **completely free** at all plan tiers. EAS (Expo Application Services) costs relate to **builds, OTA updates, and CI/CD** — not push message delivery.

The Production plan is designed for professional developers and small businesses. If you exceed the limits or use up your monthly credits, any further usage will be charged at usage-based prices.

### Expo Cost Model for Horario

| Service | Free Tier | Production ($99/mo) | Relevance to Horario |
|---------|-----------|---------------------|----------------------|
| **Push Notifications** | ✅ **Free, unlimited** | ✅ Free | Primary need — $0 COGS |
| EAS Build | 30 builds/mo | 200+ builds/mo | Only during development sprints |
| OTA Updates | 1,000 MAU | Unlimited | Needed at scale |
| CI/CD | Limited | Full | Optional |

> ✅ **Verdict:** Push notification delivery = **$0 ongoing COGS**. Budget **$0–$99/mo** for EAS depending on build frequency. For the cost model, amortize build costs as R&D (CapEx), not monthly COGS.

**Source:** [expo.dev/pricing](https://expo.dev/pricing), [docs.expo.dev/billing/plans](https://docs.expo.dev/billing/plans/)

---

## 6. 💳 Payment Processing — LatAm Options

### The Critical Challenge: Stripe's LatAm Coverage Gap

Registrarse en Stripe desde Perú no es posible en vista de que no se trata de un país aceptado. No obstante, una solución es crear una Limited [Liability Company in the US]. Similarly, personas y empresas de Colombia no pueden registrarse directamente en Stripe. Tampoco es posible registrarse en Stripe desde Chile salvo que el registro se realice como una empresa de un país admitido.

This means **Stripe is not a direct option for a Peru-registered entity**. You need local payment processors.

### 🇵🇪 Peru — Recommended: Culqi

Culqi commissions: **National debit and credit cards: 3.44% + $0.20 + VAT**. International cards: 3.99% + $0.20 + VAT. Deposit time: 1–2 business days. Integration channels: Shopify, WhatsApp, social networks, POS.

Culqi is a modern gateway focused on startups and digital businesses. It offers tools to customize the payment flow and generate links, QR payments, and more. For digital wallets like **Yape and Plin** (dominant in Peru), the rate is 3.44% + IGV.

### LatAm Payment Processor Comparison

| Country | Processor | Fee Structure | Notes |
|---------|-----------|--------------|-------|
| 🇵🇪 **Peru** | **Culqi** (primary) | 3.44% + $0.20 + IGV (local cards) | Supports Yape, Plin, Visa, MC |
| 🇵🇪 Peru | Izipay (Niubiz) | ~2.5–3.5% | Bank-backed, high trust |
| 🇲🇽 **Mexico** | **Mercado Pago** | 3.49% + $4 MXN + IVA (instant) / 2.95% (30-day) | Si tu cuenta de Mercado Pago está registrada en México, la tasa es **3.49% + $4 + IVA** (cobro inmediato) o **2.95% + $4 + IVA** en 30 días. |
| 🇨🇴 **Colombia** | Mercado Pago / PayU | ~3.49% | Stripe not available directly |
| 🇧🇷 **Brazil** | Mercado Pago | ~3.49% + R$0.40 | PIX payments available |
| 🇨🇱 **Chile** | Mercado Pago / Transbank | ~3.49% | Transbank dominant locally |

### Payment Fee Impact on ARPU

Assuming a $29 USD equivalent subscription price:

| Processor | Rate | Fixed Fee | Fee on $29 | Net Revenue |
|-----------|------|-----------|-----------|-------------|
| Culqi (Peru) | 3.44% + IGV | $0.20 + IGV | ~$1.40 | **~$27.60** |
| Mercado Pago (MX) | 3.49% | $0.32 (MXN equiv) | ~$1.33 | **~$27.67** |
| Stripe (via US LLC) | 2.9% + $0.30 | — | ~$1.14 | **~$27.86** |

> 💡 **Strategic Recommendation:** Register a US LLC (Wyoming or Delaware) to gain access to Stripe — this unlocks cards from all 5 LatAm target markets under one gateway at 2.9% + $0.30, avoiding the complexity of 5 local integrations. Many LatAm SaaS founders take this approach.

**Source:** [rebill.com/en/blog/payment-gateways-peru](https://www.rebill.com/en/blog/payment-gateways-peru), [yavendio.com/en/blog/pasarelas-pago-peru-ecommerce](https://www.yavendio.com/en/blog/pasarelas-pago-peru-ecommerce), [ezfrontiers.com/llc/como-usar-stripe-en-latinoamerica](https://ezfrontiers.com/llc/como-usar-stripe-en-latinoamerica)

---

## 7. 💬 Customer Support Costs

### Industry Benchmarks

The SaaS industry benchmark is **$25–$35 per ticket** (SaaS Capital, 2024). SaaS companies allocate about **8% of annual recurring revenue** to support.

Cost per ticket varies from **$6 to $40+ in North America**, while SaaS companies average **$25–$35 per ticket**. Self-service resolves issues at **$1–$4 per ticket** versus $17–$25 for phone support.

### WhatsApp Business API (Post-July 2025 Pricing)

Effective **July 1, 2025**, WhatsApp dropped the conversation-based pricing model. You'll now be charged **per message**, not per 24-hour conversation window. Big cost reductions for OTPs and login codes in LATAM & APAC, up to 78% cheaper in some regions.

**Marketing messages** cost **$0.025–$0.1365 per message**, **utility messages** range from **$0.004–$0.0456**, and **authentication messages** cost $0.004–$0.0456, while **service messages (customer-initiated responses within 24 hours) remain free**.

When users message a business, this opens a 24-hour customer service window during which businesses can respond with service messages, **at no charge**.

**Horario WhatsApp cost model:**
- **Inbound support** (user messages you): $0.00 — all replies free within 24h window
- **Shift reminders** (utility template): ~$0.004–$0.006/message (Peru tier)
- **Onboarding campaigns** (marketing): ~$0.025/message (Peru tier)
- **OTP/Auth messages**: ~$0.004–$0.008/message

### Chat Support Tool — Crisp

As of late 2025, Crisp pricing: **Free plan**, **Mini plan at $45/workspace/month**, **Essentials plan at $95/workspace/month**, and **Plus plan at $295/workspace/month**, with custom Enterprise pricing available on request.

Crisp Mini at **$45/month** includes live chat, shared inbox, basic automations — sufficient for Horario's early-stage support.

### Customer Support Cost Model

| MAU | Est. Tickets/mo | Self-Service Rate | Handled Tickets | Cost @ $8/ticket | WhatsApp | **Total Support** |
|-----|----------------|-------------------|----------------|-----------------|----------|------------------|
| 100 | ~5 | 40% | 3 | $24 | $0.25 | **~$70 (incl. Crisp)** |
| 500 | ~25 | 50% | 13 | $104 | $1.25 | **~$150** |
| 1,000 | ~50 | 60% | 20 | $160 | $2.50 | **~$208** |
| 5,000 | ~200 | 70% | 60 | $480 | $12.50 | **~$538** |

> 💡 **LatAm Optimization:** Build a WhatsApp chatbot for Level-1 support (schedule share, password reset, billing questions). At $0.00 for inbound-triggered utility messages, this dramatically reduces cost per ticket. Target <$3/ticket with automation.

**Source:** [business.whatsapp.com/products/platform-pricing](https://business.whatsapp.com/products/platform-pricing), [ycloud.com/blog/whatsapp-api-pricing-update](https://www.ycloud.com/blog/whatsapp-api-pricing-update), [saleshive.com/vendors/crisp](https://saleshive.com/vendors/crisp/), [livechatai.com/blog/customer-support-cost-benchmarks](https://livechatai.com/blog/customer-support-cost-benchmarks)

---

## 8. 📊 Full Cost Model & Gross Margin Analysis

### Infrastructure Cost Summary (Monthly Fixed Floor)

| Component | Free Tier | Paid (Launch) | Notes |
|-----------|-----------|--------------|-------|
| Clerk Auth | $0 (up to 10K MAU) | **$25/mo** (Pro required for features) | +$0.02/MAU >10K; +$1/MAO >100 orgs |
| Supabase | $0 (dev only — pauses!) | **$25/mo** (Pro) | Covers 100K MAU, 8GB DB |
| Vercel | $0 (no commercial!) | **$20/mo** (Pro) | 1TB bandwidth, 10M edge requests |
| Expo Push | **$0 forever** | $0 | Push delivery