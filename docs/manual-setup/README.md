# Manual Platform Setup — Index

These steps **cannot be automated** — they require logging into external dashboards.
Complete them in order before enabling paid subscriptions.

---

## Sequence

| # | Step | Platform | Time | Critical |
|---|---|---|---|:---:|
| 1 | [Run Supabase migrations](./SETUP_SUPABASE.md) | Supabase | 5 min | ✅ |
| 2 | [Paddle account, catalog and keys](./SETUP_PADDLE.md) (checkout not built yet) | Paddle | see page | before taking payment |
| 3 | ~~Stripe~~ / ~~Culqi~~: superseded by Paddle (CHG-099), pages kept for reference | | | |
| 4 | [Configure Clerk JWT + webhook](./SETUP_CLERK.md) | Clerk | 10 min | ✅ |
| 5 | [Add environment variables to Vercel](./SETUP_VERCEL.md) | Vercel | 5 min | ✅ |

---

## After all steps are complete

1. Deploy to Vercel: `git push` (or manual deploy from Vercel dashboard)
2. Apply the migrations (`migrate.yml`), including `20261111000099_plans_entitlements.sql`
3. Set `HORARIO_PLATFORM_ADMIN_USER_IDS` to grant tester access on `/admin`
4. Payments: follow [SETUP_PADDLE.md](./SETUP_PADDLE.md)

---

*Last updated: 2026-11-11 (CHG-099).*
