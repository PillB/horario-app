# Manual Platform Setup — Index

These steps **cannot be automated** — they require logging into external dashboards.
Complete them in order before enabling paid subscriptions.

---

## Sequence

| # | Step | Platform | Time | Critical |
|---|---|---|---|:---:|
| 1 | [Run Supabase migrations](./SETUP_SUPABASE.md) | Supabase | 5 min | ✅ |
| 2 | [Create Stripe products & prices](./SETUP_STRIPE.md) | Stripe | 15 min | ✅ |
| 3 | [Set up Culqi for Peru (Yape)](./SETUP_CULQI.md) | Culqi | 20 min | ✅ Peru launch |
| 4 | [Configure Clerk JWT + webhook](./SETUP_CLERK.md) | Clerk | 10 min | ✅ |
| 5 | [Add environment variables to Vercel](./SETUP_VERCEL.md) | Vercel | 5 min | ✅ |

---

## After all steps are complete

1. Deploy to Vercel: `git push` (or manual deploy from Vercel dashboard)
2. Test checkout flow end-to-end (use Stripe test cards)
3. Verify webhook events arrive in Supabase `subscriptions` table
4. Verify Clerk `publicMetadata.horario_tier` updates after payment
5. Remove `STRIPE_SECRET_KEY=FILL_ME_IN` from any non-.env.local files

---

*Last updated: 2026-04-05 — researched against 2024-2025 platform docs and community issues.*
