#!/usr/bin/env node
/**
 * Creates Horario's Paddle catalog and webhook destination, then prints the
 * environment variables to set. Safe to run twice: what already exists (found
 * by `custom_data.horario`) is reused, not duplicated.
 *
 *   PADDLE_API_KEY=pdl_sdbx_apikey_... node scripts/paddle/setup.js https://your-app.example
 *
 * The API key needs: product.write, price.write, notification_setting.write
 * (and read for each). Run it once with the sandbox key and once with the
 * live key; each environment has its own catalog and its own webhook secret.
 *
 * Request bodies follow developer.paddle.com (api-reference: create-product,
 * create-price, create-notification-setting; read 2026-11-21). Prices are the
 * product research's list (constants/pricing.ts; scripts/__tests__/paddleSetup.test.ts
 * fails if the two drift apart): per location, a year = ten months, Peru in
 * PEN with IGV included. `tax_mode: location` lets Paddle show tax-inclusive
 * prices where that is the custom (Peru, EU) and add tax where it is not (US).
 */
'use strict';

const PLANS = {
  esencial: { name: 'Horario Esencial', description: 'Scheduling for one team: up to 40 people, unlimited auto-schedule, labor-law checks.', usd: 19, pen: 59 },
  pro: { name: 'Horario Pro', description: 'Unlimited people and locations, demand forecast and sales upload.', usd: 39, pen: 119 },
};
const MONTHS_CHARGED_PER_YEAR = 10;
const QUANTITY = { minimum: 1, maximum: 1000 };

const WEBHOOK_EVENTS = [
  'subscription.created',
  'subscription.updated',
  'subscription.activated',
  'subscription.canceled',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.trialing',
  'transaction.completed',
  'transaction.payment_failed',
];

const PRICE_ENV = {
  esencial_month: 'PADDLE_PRICE_ESENCIAL_MONTH',
  esencial_year: 'PADDLE_PRICE_ESENCIAL_YEAR',
  pro_month: 'PADDLE_PRICE_PRO_MONTH',
  pro_year: 'PADDLE_PRICE_PRO_YEAR',
};

/** Whole currency units to Paddle's lowest denomination, as a string. */
const minor = (units) => String(Math.round(units * 100));

/** Pure: the product and price bodies to create, keyed by plan and by price key. */
function buildCatalog() {
  const products = {};
  const prices = {};
  for (const [tier, plan] of Object.entries(PLANS)) {
    products[tier] = { name: plan.name, description: plan.description, tax_category: 'saas', custom_data: { horario: `product:${tier}` } };
    for (const interval of ['month', 'year']) {
      const months = interval === 'month' ? 1 : MONTHS_CHARGED_PER_YEAR;
      const key = `${tier}_${interval}`;
      prices[key] = {
        tier,
        body: {
          description: `${plan.name}, per location, ${interval === 'month' ? 'monthly' : 'yearly (two months free)'}`,
          name: interval === 'month' ? 'Monthly' : 'Yearly',
          unit_price: { amount: minor(plan.usd * months), currency_code: 'USD' },
          unit_price_overrides: [{ country_codes: ['PE'], unit_price: { amount: minor(plan.pen * months), currency_code: 'PEN' } }],
          billing_cycle: { interval, frequency: 1 },
          tax_mode: 'location',
          quantity: QUANTITY,
          custom_data: { horario: `price:${key}` },
        },
      };
    }
  }
  return { products, prices };
}

function webhookBody(origin) {
  return {
    description: 'Horario plans',
    type: 'url',
    destination: `${origin.replace(/\/+$/, '')}/api/paddle-webhook`,
    subscribed_events: WEBHOOK_EVENTS,
    api_version: 1,
    traffic_source: 'platform',
  };
}

async function main() {
  const apiKey = process.env.PADDLE_API_KEY || '';
  const origin = process.argv[2] || '';
  const fail = (message) => {
    console.error(message);
    process.exit(1);
  };
  if (!/^pdl_(sdbx|live)_apikey_/.test(apiKey)) fail('Set PADDLE_API_KEY to a Paddle API key (pdl_sdbx_apikey_… for the sandbox).');
  if (!/^https:\/\/[^/]+/.test(origin)) fail('Pass the app origin, for example: node scripts/paddle/setup.js https://horario.app');
  const base = apiKey.startsWith('pdl_sdbx_') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) fail(`Paddle refused ${method} ${path} (${res.status}): ${json?.error?.code ?? ''} ${json?.error?.detail ?? ''}`);
    return json;
  };
  const listAll = async (path) => {
    const rows = [];
    let next = `${path}${path.includes('?') ? '&' : '?'}per_page=200`;
    while (next) {
      const page = await api('GET', next);
      rows.push(...(page.data ?? []));
      const after = page.meta?.pagination?.has_more ? page.meta.pagination.next : null;
      next = after ? after.replace(base, '') : null;
    }
    return rows;
  };
  const tagged = (rows, tag) => rows.find((row) => row.custom_data && row.custom_data.horario === tag);

  const catalog = buildCatalog();
  const products = await listAll('/products?status=active');
  const prices = await listAll('/prices?status=active');
  const productIds = {};
  for (const [tier, body] of Object.entries(catalog.products)) {
    const found = tagged(products, body.custom_data.horario);
    productIds[tier] = found ? found.id : (await api('POST', '/products', body)).data.id;
    console.error(`${found ? 'kept' : 'created'} product ${body.name}: ${productIds[tier]}`);
  }
  const env = {};
  for (const [key, { tier, body }] of Object.entries(catalog.prices)) {
    const found = tagged(prices, body.custom_data.horario);
    const id = found ? found.id : (await api('POST', '/prices', { ...body, product_id: productIds[tier] })).data.id;
    console.error(`${found ? 'kept' : 'created'} price ${body.description}: ${id}`);
    env[PRICE_ENV[key]] = id;
  }

  const hook = webhookBody(origin);
  const destinations = await listAll('/notification-settings');
  const existing = destinations.find((d) => d.destination === hook.destination);
  const destination = existing ?? (await api('POST', '/notification-settings', hook)).data;
  console.error(`${existing ? 'kept' : 'created'} webhook destination ${hook.destination}: ${destination.id}`);

  console.log('\n# Server-only environment variables (Vercel > Settings > Environment Variables):');
  for (const [name, value] of Object.entries(env)) console.log(`${name}=${value}`);
  if (destination.endpoint_secret_key) {
    console.log(`PADDLE_WEBHOOK_SECRET=${destination.endpoint_secret_key}`);
  } else {
    console.log('# PADDLE_WEBHOOK_SECRET: copy it from Paddle > Developer tools > Notifications > this destination');
  }
  console.log(`# Client: EXPO_PUBLIC_PADDLE_ENV=${base.includes('sandbox') ? 'sandbox' : 'production'} and EXPO_PUBLIC_PADDLE_CLIENT_TOKEN from Developer tools > Authentication`);
  console.log(`# Paddle > Checkout > Checkout settings > Default payment link: ${origin.replace(/\/+$/, '')}/pay`);
}

module.exports = { buildCatalog, webhookBody, PLANS, PRICE_ENV, WEBHOOK_EVENTS, MONTHS_CHARGED_PER_YEAR };

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
