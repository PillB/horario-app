# Paddle checkout: what is needed

Status on 2026-11-11 (CHG-099): **not built.** Plans, prices, limits, the 14-day trial and tester access all work without Paddle. A business cannot pay yet: the plans screen shows no buy button until `EXPO_PUBLIC_CHECKOUT_ENABLED=1`, and the proxy answers the two payment actions with 501.

This page lists what Pablo has to provide, and what will be built once he has. Paddle is the merchant of record chosen in the product research (§4): it charges the customer, handles sales tax and IGV, and pays out. Paddle's own steps change; follow its current pages where they differ from this one.

## 1. What Pablo provides

Do these in order. Steps 1 to 3 need no code.

| # | What | Notes |
|---|---|---|
| 1 | A public website for the product | Paddle reviews it before it lets the account sell. It must show what the product is, the prices of each plan, Terms of Service, a Privacy Policy and a Refund Policy. The plan names and prices must match section 3 below. |
| 2 | An email address at the product's own domain | For the Paddle account and for support. Paddle is known to turn down free-mail addresses. |
| 3 | A Paddle account, verified | Sign up as an individual (no company needed). Verification asks for a government ID, proof of address and the payout bank account. Start in the **sandbox** (sandbox-vendors.paddle.com); it needs no verification and is enough to build and test everything. |
| 4 | The website domain approved in Paddle | Paddle > Checkout > Website approval. Checkout only opens on approved domains. Add the production domain of the app too. |
| 5 | The catalog (section 3) created in Paddle | Two products, four prices. Create it in the sandbox first, then again in live. |
| 6 | The keys (section 2), stored as environment variables | Never paste them in chat, in the repository or in an `EXPO_PUBLIC_*` variable (except the client-side token, which is public by design). |
| 7 | One decision | Refund policy wording: Paddle requires one. A common choice is "14 days, no questions". |

Before the first payout, the research (§4.5) lists questions for a contador about declaring the income in Peru. That does not block the build.

## 2. Keys and settings

Two sets: one for the sandbox (preview and development deployments) and one for live (production).

| Variable | Where it comes from | Where it goes |
|---|---|---|
| `PADDLE_API_KEY` | Paddle > Developer tools > Authentication > API keys. Give it only: read and write on transactions, subscriptions and customers. | Server only (Vercel environment variable) |
| `PADDLE_WEBHOOK_SECRET` | Paddle > Developer tools > Notifications > the destination created in step 4 below > secret key | Server only |
| `EXPO_PUBLIC_PADDLE_CLIENT_TOKEN` | Paddle > Developer tools > Authentication > Client-side tokens | Client (public by design) |
| `EXPO_PUBLIC_PADDLE_ENV` | `sandbox` or `production` | Client |
| `PADDLE_PRICE_ESENCIAL_MONTH`, `PADDLE_PRICE_ESENCIAL_YEAR`, `PADDLE_PRICE_PRO_MONTH`, `PADDLE_PRICE_PRO_YEAR` | The four price ids (`pri_…`) from the catalog | Server only |
| `EXPO_PUBLIC_CHECKOUT_ENABLED` | `1` once everything below works | Client |
| `HORARIO_PLATFORM_ADMIN_USER_IDS` | Clerk user ids (comma-separated) that may grant tester access on `/admin`. Not Paddle, but needed for the admin screen. | Server only |

Notification destination (the webhook): URL `https://<app domain>/api/paddle-webhook`, events `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.past_due`, `transaction.completed`, `transaction.payment_failed`.

## 3. Catalog

Prices are per location; the quantity on the subscription is the number of locations. Source: `constants/pricing.ts`.

| Product | Price | USD | Peru (PEN, IGV included) |
|---|---|---|---|
| Esencial | monthly | 19 | 59 |
| Esencial | yearly (two months free) | 190 | 590 |
| Pro | monthly | 39 | 119 |
| Pro | yearly (two months free) | 390 | 1,190 |

On each price: base currency USD, a country-specific price override for Peru in PEN, tax mode "inclusive" for Peru and "exclusive" for the United States (the account default can be "location-based" if Paddle offers it), quantity from 1 to 1000. No trial on the Paddle price: the 14-day trial is given by the app without a card.

## 4. What gets built once the keys exist

None of this exists yet. Estimated as one pull request.

1. **Database:** allow `paddle` in `subscriptions.payment_provider`; add `paddle_customer_id` and `paddle_subscription_id`; a `paddle_events` table keyed by event id so that a repeated webhook is applied once.
2. **`createCheckoutSession` (proxy):** a manager asks for a plan and a billing period; the server looks up the price id and creates a Paddle transaction with `custom_data.account_id` taken from the session (never from the client) and quantity = the account's number of locations (at least 1); it returns the transaction id. The client opens Paddle's overlay checkout with it (Paddle.js on web; a browser page on a phone).
3. **`/api/paddle-webhook`:** checks the `Paddle-Signature` header (HMAC-SHA256 of timestamp and raw body with `PADDLE_WEBHOOK_SECRET`, rejects old timestamps), then writes: an `account_entitlements` row with `source = paddle`, the plan, the paid period and `location_quota` = quantity; and the `subscriptions` row (status, period, cancel flag). A cancelled or unpaid subscription ends the entitlement at the end of the paid period. The account then drops to Gratis and keeps its data (`server/plans.ts` already does this).
4. **`createBillingPortalSession` (proxy):** returns Paddle's customer portal link, where the customer changes card, downloads invoices or cancels.
5. **Tests:** signature check (good, bad, replayed), each event against the local database, and one manual run in the sandbox with Paddle's test cards.
6. **Switch on:** set `EXPO_PUBLIC_CHECKOUT_ENABLED=1` in the sandbox deployment, test, then repeat with the live keys.

## 5. Already in place

- Plans, prices and limits: `constants/pricing.ts`.
- The plan in force is decided on the server on every gated request: `server/plans.ts`, table `account_entitlements` (migration `20261111000099_plans_entitlements.sql`).
- 14-day Pro trial for every new account, without a card.
- Tester and complimentary access: `/admin`, for the user ids in `HORARIO_PLATFORM_ADMIN_USER_IDS`.
- The plans screen (`components/PricingModal.tsx`) and the plan card on Profile.

## 6. Known gaps that Paddle does not fix

- **Trials per account, not per person.** The tenant is the Clerk organization (or the user). Someone who creates a new organization gets a new trial. Fixing it means tying the trial to the verified email or to a payment method.
- **No email before a plan ends.** The research asks for one 7 days before; there is no email sender yet.
- **Invite codes for testers** are not built; access is granted by account id on `/admin`.
- **Locations on Esencial.** Without Paddle there is no way to pay for a second location, so Esencial is limited to 1 (a platform admin can raise it through a grant's `location_quota`, which the admin screen does not expose yet).
