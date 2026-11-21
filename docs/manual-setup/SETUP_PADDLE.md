# Paddle: switching on paid plans

Status on 2026-11-21 (CHG-104): **built, not switched on.** The checkout, plan changes, the billing portal, cancel, the signed webhook and the plan it gives are in the code and tested against fakes and a local Postgres. Nobody can pay until the steps below are done and `EXPO_PUBLIC_CHECKOUT_ENABLED=1` is set. Without the Paddle variables the plans screen keeps its "not available yet" note and the proxy answers 501.

Paddle is the merchant of record (product research §4): it shows the checkout, charges the card, collects sales tax, VAT and Peru's IGV, sends the invoice and pays out. Horario never sees a card. Paddle's dashboard changes; where its pages differ from this one, follow Paddle.

## How it works

```
Plans screen ── createCheckoutSession ──▶ proxy ── POST /transactions ──▶ Paddle
   (manager)                               │  items: plan price × number of locations
                                           │  custom_data: account + HMAC (signed by the server)
                                           ◀── checkout.url = https://<app>/pay?_ptxn=txn_…
/pay page loads Paddle.js ──▶ Paddle overlay checkout (card, tax, receipt)
Paddle ── signed webhook ──▶ /api/paddle-webhook ── apply_paddle_subscription() ──▶ subscriptions row
                                                                                      │
every gated request ── server/plans.ts reads the row ─────────────────────────────────┘
```

- **The plan changes only when the signed webhook arrives.** The browser saying "paid" changes nothing.
- **Per location:** the quantity is the number of locations (at least 1). Pro and Esencial both pay per location; the plan allows as many locations as it pays for.
- **Switching plan** (Esencial ↔ Pro, monthly ↔ yearly) is a prorated change of the same subscription, from the plans screen.
- **Manage billing** opens Paddle's customer portal: card, invoices, cancel.
- **Cancel** ends at the close of the paid period. The account then drops to Gratis and keeps every record.
- **A failed renewal** keeps the plan for 14 days (`PAST_DUE_GRACE_DAYS`) while Paddle retries the card, then Gratis.
- **iOS** shows no buy button (App Store rule 3.1.1). A plan bought on the web works in the app.

## 1. What Pablo does (in this order)

Steps 1 to 4 are the same for the sandbox and for live. Do everything in the **sandbox** first (sandbox-vendors.paddle.com): it needs no verification and test cards work.

| # | Step | Where | Notes |
|---|---|---|---|
| 1 | Public pages: what the product is, plan prices, **Terms of Service, Privacy Policy, Refund Policy** | The website | Paddle reviews them before live payments. Prices must match section 3. A landing page at `/welcome` is being built in another thread; the three legal pages still need Pablo's details (legal name, address, contact). Suggested refund wording: "14 days, no questions asked". |
| 2 | A support email at the product's own domain | Mail host | Paddle tends to refuse free-mail addresses for the seller account. |
| 3 | A Paddle account | paddle.com | Individual seller is fine. Live needs ID, proof of address and the payout bank account. |
| 4 | An API key | Paddle > Developer tools > Authentication > API keys | Permissions: transaction read/write, subscription read/write, customer read, customer portal session write, product, price and notification setting read/write (the last three only for step 5; you can make a second, narrower key for the server afterwards). Keys expire after 90 days by default; set a reminder. |
| 5 | Run the setup script | A terminal with the repository | `PADDLE_API_KEY=pdl_sdbx_apikey_… node scripts/paddle/setup.js https://<app domain>` creates the two products, the four prices (USD, PEN for Peru, per location) and the webhook destination, and prints every variable to set. Running it twice changes nothing. |
| 6 | Default payment link = `https://<app domain>/pay` | Paddle > Checkout > Checkout settings | Paddle refuses to create checkouts without it. In live the domain must be approved first (Paddle > Website approval). |
| 7 | A client-side token | Paddle > Developer tools > Authentication > Client-side tokens | Public by design (`test_…` in the sandbox). |
| 8 | The variables (section 2) in Vercel | Vercel > Project > Settings > Environment Variables | Sandbox values on Preview, live values on Production. Never in chat, the repository or any other `EXPO_PUBLIC_*` variable. |
| 9 | Apply migration `20261122000107_paddle_billing.sql` | `migrate.yml` (dev on merge; prod is the manual run) | |
| 10 | Test on the sandbox deployment | The app | Card `4242 4242 4242 4242`, any future date, any CVC. Check: the plan becomes Pro within a minute; "Switch to Esencial" changes it; Manage billing opens; cancel in the portal shows "ends on …"; a declined card leaves the plan as it was. Paddle > Notifications shows each delivery and lets you replay one. |
| 11 | `EXPO_PUBLIC_CHECKOUT_ENABLED=1` | Vercel, Preview first | Then repeat 3 to 10 with the live account and set it on Production. |

Before the first payout: a RUC and a contador (research §4.5). That does not block the sandbox.

## 2. Variables

| Variable | Where it comes from | Where it goes |
|---|---|---|
| `PADDLE_API_KEY` | Step 4 | Server only |
| `PADDLE_WEBHOOK_SECRET` | Printed by the setup script (or Paddle > Developer tools > Notifications > the destination) | Server only |
| `PADDLE_PRICE_ESENCIAL_MONTH`, `PADDLE_PRICE_ESENCIAL_YEAR`, `PADDLE_PRICE_PRO_MONTH`, `PADDLE_PRICE_PRO_YEAR` | Printed by the setup script (`pri_…`) | Server only |
| `EXPO_PUBLIC_PADDLE_CLIENT_TOKEN` | Step 7 | Client (public) |
| `EXPO_PUBLIC_PADDLE_ENV` | `sandbox` or `production` | Client |
| `EXPO_PUBLIC_CHECKOUT_ENABLED` | `1` once step 10 passes | Client |

The server picks the sandbox or the live API from the key itself (`pdl_sdbx_` or `pdl_live_`). The webhook answers 503 (and Paddle retries) while its secret or any price id is missing, so a half-set deployment never drops a payment.

## 3. Catalog (created by the setup script)

Source: `constants/pricing.ts`; `scripts/__tests__/paddleSetup.test.ts` fails if the script and the app drift apart.

| Plan | Monthly | Yearly (two months free) | Peru monthly / yearly (IGV included) |
|---|---|---|---|
| Esencial | US$19 | US$190 | S/ 59 / S/ 590 |
| Pro | US$39 | US$390 | S/ 119 / S/ 1,190 |

Per location (quantity 1 to 1000), tax mode "location" (inclusive where that is the custom, added on top in the US), tax category SaaS, no Paddle trial (the app gives the 14-day trial without a card).

## 4. What to watch after launch

- **Paddle > Notifications**: failed deliveries. The webhook answers 5xx only when the database is down; Paddle retries for about two days and you can replay.
- **`paddle_events` rows with outcome `unmatched` or `second_subscription`**: a payment with no account, or a business that paid twice (two tabs). Refund the second one in Paddle. The logs say `[paddle-webhook] unmatched` / `second_subscription`.
- **API key expiry** (90 days by default): an expired key makes checkout answer "The payment service refused the request".

## 5. Known limits

- Trials are per account (Clerk organization or user), not per person.
- No email before a plan ends or when a renewal fails (Paddle sends its own payment-failure emails).
- No invoice in SUNAT format (factura); Peruvian businesses get Paddle's invoice.
- The plan shown after paying updates when the webhook arrives (usually seconds; the screen re-reads it after 4 s and on the next open).
- Changing only the billing period of the current plan, or the number of paid locations, has no button yet; the proxy action `changeSubscription` supports both.
- Paddle.js may need more hosts in the Content-Security-Policy than `vercel.json` allows today (`cdn.paddle.com`, `*.paddle.com`, `buy.paddle.com`, `sandbox-buy.paddle.com`). If the overlay stays blank in step 10, the browser console names the blocked host.
