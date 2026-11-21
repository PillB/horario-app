/**
 * @jest-environment node
 *
 * Drift guard: the catalog scripts/paddle/setup.js creates in Paddle sells
 * exactly the prices the app shows (constants/pricing.ts), and its webhook
 * destination sends every event the webhook route acts on. If someone edits
 * one list and not the other, customers would be charged a price the plans
 * screen never showed.
 */
import { ANNUAL_MONTHS_CHARGED, PAID_TIERS, TIER_PRICES_LOCAL, TIER_PRICES_USD } from '@/constants/pricing';
import { PRICE_ENV } from '@/server/paddle';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS script run with plain node
const setup = require('../paddle/setup.js') as {
  buildCatalog: () => {
    products: Record<string, { tax_category: string }>;
    prices: Record<string, { tier: string; body: Record<string, unknown> & { unit_price: { amount: string; currency_code: string }; unit_price_overrides: { country_codes: string[]; unit_price: { amount: string; currency_code: string } }[]; billing_cycle: { interval: string } } }>;
  };
  webhookBody: (origin: string) => { destination: string; subscribed_events: string[] };
  PRICE_ENV: Record<string, string>;
  MONTHS_CHARGED_PER_YEAR: number;
};

describe('Paddle setup script', () => {
  const catalog = setup.buildCatalog();

  it('creates one price per paid plan and period, with the env names the server reads', () => {
    expect(Object.keys(catalog.prices).sort()).toEqual(Object.keys(PRICE_ENV).sort());
    expect(setup.PRICE_ENV).toEqual(PRICE_ENV);
    expect(Object.keys(catalog.products).sort()).toEqual([...PAID_TIERS].sort());
    expect(setup.MONTHS_CHARGED_PER_YEAR).toBe(ANNUAL_MONTHS_CHARGED);
  });

  it('charges what the plans screen shows, in USD and in PEN for Peru (cents as strings)', () => {
    const shown: string[] = [];
    const sold: string[] = [];
    for (const tier of PAID_TIERS) {
      for (const interval of ['month', 'year'] as const) {
        const price = catalog.prices[`${tier}_${interval}`].body;
        const usd = interval === 'month' ? TIER_PRICES_USD[tier].monthly : TIER_PRICES_USD[tier].annual;
        const pen = interval === 'month' ? TIER_PRICES_LOCAL.PE[tier].monthly : TIER_PRICES_LOCAL.PE[tier].annual;
        shown.push(`${tier} ${interval} USD ${usd * 100} PE PEN ${pen * 100} every ${interval}`);
        const pe = price.unit_price_overrides.find((o) => o.country_codes.includes('PE'))!;
        sold.push(`${tier} ${interval} ${price.unit_price.currency_code} ${price.unit_price.amount} PE ${pe.unit_price.currency_code} ${pe.unit_price.amount} every ${price.billing_cycle.interval}`);
      }
    }
    expect(sold).toEqual(shown);
    // The research's figures, by hand: Esencial US$19 / S/ 59, Pro US$39 / S/ 119 a month; a year = 10 months.
    expect(catalog.prices.pro_year.body.unit_price.amount).toBe('39000');
    expect(catalog.prices.esencial_month.body.unit_price_overrides[0].unit_price.amount).toBe('5900');
  });

  it('is sold per location (quantity) with tax handled by location, as software', () => {
    for (const { body } of Object.values(catalog.prices)) {
      expect(body).toMatchObject({ tax_mode: 'location', quantity: { minimum: 1, maximum: 1000 } });
    }
    for (const product of Object.values(catalog.products)) expect(product.tax_category).toBe('saas');
  });

  it('subscribes the webhook to every subscription state change, at the app\'s webhook route', () => {
    const hook = setup.webhookBody('https://horario.app/');
    expect(hook.destination).toBe('https://horario.app/api/paddle-webhook');
    for (const name of ['created', 'updated', 'activated', 'canceled', 'past_due', 'paused', 'resumed']) {
      expect(hook.subscribed_events).toContain(`subscription.${name}`);
    }
  });
});
