/**
 * Plans, prices, limits and feature gates.
 *
 * Source: product research, "Proposed plans" (Gratis / Esencial / Pro, a
 * subscription per location). The server decides the plan an account has
 * (`server/plans.ts`, table `account_entitlements`); this file is the one
 * definition of what each plan includes, shared by the client and the proxy.
 *
 * Checkout is not built yet: see docs/manual-setup/SETUP_PADDLE.md.
 */

// ─── Plans ────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'gratis' | 'esencial' | 'pro';

/** Lowest to highest. */
export const TIERS: SubscriptionTier[] = ['gratis', 'esencial', 'pro'];

export const PAID_TIERS: Exclude<SubscriptionTier, 'gratis'>[] = ['esencial', 'pro'];

export const isSubscriptionTier = (value: unknown): value is SubscriptionTier =>
  typeof value === 'string' && (TIERS as string[]).includes(value);

/** Every new business gets Pro for this many days, no card needed. */
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN: SubscriptionTier = 'pro';

// ─── Prices (per location) ────────────────────────────────────────────────────

/** A year costs ten months: two months free. */
export const ANNUAL_MONTHS_CHARGED = 10;
export const ANNUAL_MONTHS_FREE = 12 - ANNUAL_MONTHS_CHARGED;

export type PlanPrice = { monthly: number; annual: number };

export const TIER_PRICES_USD: Record<SubscriptionTier, PlanPrice> = {
  gratis: { monthly: 0, annual: 0 },
  esencial: { monthly: 19, annual: 19 * ANNUAL_MONTHS_CHARGED },
  pro: { monthly: 39, annual: 39 * ANNUAL_MONTHS_CHARGED },
};

export type LocalPrices = { currency: string; symbol: string; taxIncluded: boolean } & Record<SubscriptionTier, PlanPrice>;

/** Local price lists by country. Any other country pays the USD list. Peru's prices include IGV. */
export const TIER_PRICES_LOCAL: Record<string, LocalPrices> = {
  PE: {
    currency: 'PEN',
    symbol: 'S/ ',
    taxIncluded: true,
    gratis: { monthly: 0, annual: 0 },
    esencial: { monthly: 59, annual: 59 * ANNUAL_MONTHS_CHARGED },
    pro: { monthly: 119, annual: 119 * ANNUAL_MONTHS_CHARGED },
  },
};

const USD_PRICES: LocalPrices = { currency: 'USD', symbol: 'US$', taxIncluded: false, ...TIER_PRICES_USD };

export function pricesForCountry(countryCode: string | null | undefined): LocalPrices {
  return (countryCode && TIER_PRICES_LOCAL[countryCode.toUpperCase()]) || USD_PRICES;
}

/** "US$19", "S/ 1,190". No decimals: every list price is a whole number. */
export function formatPlanPrice(amount: number, prices: Pick<LocalPrices, 'symbol'>): string {
  return `${prices.symbol}${Math.round(amount).toLocaleString('en-US')}`;
}

// ─── Limits ───────────────────────────────────────────────────────────────────

export type TierLimits = {
  /** Staff on the team. */
  maxWorkers: number;
  /** Business locations. A paid subscription is per location; see `location_quota` on the entitlement. */
  maxLocations: number;
  /** Auto-schedule runs applied per calendar month (UTC), for the whole account. */
  maxAutoSchedulesPerMonth: number;
};

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  gratis: { maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 3 },
  esencial: { maxWorkers: 40, maxLocations: 1, maxAutoSchedulesPerMonth: Infinity },
  pro: { maxWorkers: Infinity, maxLocations: Infinity, maxAutoSchedulesPerMonth: Infinity },
};

// ─── Feature gates ────────────────────────────────────────────────────────────

/** Feature → lowest plan that includes it. */
export const FEATURE_GATES: Record<string, SubscriptionTier> = {
  // Gratis
  'scheduling.view': 'gratis',
  'scheduling.manual_assign': 'gratis',
  'scheduling.publish': 'gratis',
  'scheduling.auto_assign': 'gratis', // 3 a month, see TIER_LIMITS
  'workers.manage': 'gratis',
  'availability': 'gratis',
  'notifications.push': 'gratis',
  'labor_law.warnings': 'gratis',
  'uncovered_loss_metric': 'gratis',
  'onboarding': 'gratis',
  'swaps.view': 'gratis',
  'time_off.view': 'gratis',

  // Esencial
  'scheduling.auto_assign_unlimited': 'esencial',
  'labor_law.explanations': 'esencial',
  'labor_law.blocking': 'esencial',
  'swaps.manage': 'esencial',
  'open_shifts': 'esencial',
  'time_off.manage': 'esencial',
  'attendance.pin_clock': 'esencial',
  'export.hours': 'esencial',
  'support.email': 'esencial',

  // Pro
  'demand_forecast': 'pro',
  'labor_cost_vs_sales': 'pro',
  'integrations.pos': 'pro',
  'multi_location': 'pro',
  'attendance.peru_register': 'pro',
  'scheduling.best_optimizer': 'pro',
  'support.priority': 'pro',
};

// ─── Display ──────────────────────────────────────────────────────────────────

/** Plan names are product names and are not translated. */
export const TIER_META: Record<SubscriptionTier, { label: string; color: string; isPopular: boolean }> = {
  gratis: { label: 'Gratis', color: '#6B7280', isPopular: false },
  esencial: { label: 'Esencial', color: '#0F766E', isPopular: true },
  pro: { label: 'Pro', color: '#7C3AED', isPopular: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<SubscriptionTier, number> = { gratis: 0, esencial: 1, pro: 2 };

export function tierRank(tier: SubscriptionTier): number {
  return TIER_ORDER[tier];
}

/** True when `tier` is `required` or higher. */
export function tierMeetsRequirement(tier: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[required];
}

/** The lowest plan with the feature. An unknown feature needs Pro. */
export function requiredTierForFeature(feature: string): SubscriptionTier {
  return FEATURE_GATES[feature] ?? 'pro';
}

export function tierCanAccessFeature(tier: SubscriptionTier, feature: string): boolean {
  return tierMeetsRequirement(tier, requiredTierForFeature(feature));
}

/** The plan above, or null on Pro. */
export function nextTier(tier: SubscriptionTier): SubscriptionTier | null {
  const idx = TIERS.indexOf(tier);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}

/** Plan names stored before the Gratis / Esencial / Pro rewrite (also mapped in the migration). */
export function tierFromLegacy(value: unknown): SubscriptionTier {
  if (isSubscriptionTier(value)) return value;
  if (value === 'starter') return 'esencial';
  if (value === 'growth') return 'pro';
  return 'gratis';
}
