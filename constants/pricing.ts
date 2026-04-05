/**
 * Horario Pricing Constants
 *
 * Per-account pricing (not per-user) — the key LatAm localization decision.
 * Source: docs/pricing/pricing-strategy.md (RES-003)
 *
 * USD prices are the canonical source.
 * Local currency equivalents are informational; billing is always in USD via Stripe
 * or local currency via Culqi (Peru only).
 */

// ─── Tier IDs ─────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'starter' | 'growth' | 'pro';

export const TIERS = ['free', 'starter', 'growth', 'pro'] as const satisfies SubscriptionTier[];

// ─── Prices (USD) ─────────────────────────────────────────────────────────────

export const TIER_PRICES_USD: Record<SubscriptionTier, { monthly: number; annual: number; annualMonthly: number }> = {
  free:    { monthly: 0,  annual: 0,      annualMonthly: 0 },
  starter: { monthly: 19, annual: 182.40, annualMonthly: 15.20 },
  growth:  { monthly: 39, annual: 374.40, annualMonthly: 31.20 },
  pro:     { monthly: 79, annual: 758.40, annualMonthly: 63.20 },
};

/** Annual discount percentage (20% off) */
export const ANNUAL_DISCOUNT_PCT = 20;

// ─── Local Currency Prices (display only — billing via Stripe/Culqi) ──────────

export const TIER_PRICES_LOCAL: Record<string, Record<SubscriptionTier, { monthly: number; currency: string; symbol: string }>> = {
  PE: { // Peru (PEN) — PPP factor 85%
    free:    { monthly: 0,      currency: 'PEN', symbol: 'S/' },
    starter: { monthly: 60,     currency: 'PEN', symbol: 'S/' },
    growth:  { monthly: 124,    currency: 'PEN', symbol: 'S/' },
    pro:     { monthly: 244,    currency: 'PEN', symbol: 'S/' },
  },
  MX: { // Mexico (MXN) — PPP factor 90%
    free:    { monthly: 0,      currency: 'MXN', symbol: '$' },
    starter: { monthly: 298,    currency: 'MXN', symbol: '$' },
    growth:  { monthly: 612,    currency: 'MXN', symbol: '$' },
    pro:     { monthly: 1225,   currency: 'MXN', symbol: '$' },
  },
  CO: { // Colombia (COP) — PPP factor 80%
    free:    { monthly: 0,      currency: 'COP', symbol: '$' },
    starter: { monthly: 60750,  currency: 'COP', symbol: '$' },
    growth:  { monthly: 125500, currency: 'COP', symbol: '$' },
    pro:     { monthly: 251100, currency: 'COP', symbol: '$' },
  },
  BR: { // Brazil (BRL) — PPP factor 88%
    free:    { monthly: 0,      currency: 'BRL', symbol: 'R$' },
    starter: { monthly: 87,     currency: 'BRL', symbol: 'R$' },
    growth:  { monthly: 173,    currency: 'BRL', symbol: 'R$' },
    pro:     { monthly: 352,    currency: 'BRL', symbol: 'R$' },
  },
  CL: { // Chile (CLP) — PPP factor 95%
    free:    { monthly: 0,       currency: 'CLP', symbol: '$' },
    starter: { monthly: 16900,   currency: 'CLP', symbol: '$' },
    growth:  { monthly: 34800,   currency: 'CLP', symbol: '$' },
    pro:     { monthly: 70500,   currency: 'CLP', symbol: '$' },
  },
};

// ─── Tier Limits ──────────────────────────────────────────────────────────────

export const TIER_LIMITS: Record<SubscriptionTier, {
  /** Max workers per account */
  maxWorkers: number;
  /** Max locations per account */
  maxLocations: number;
  /** Max AI-optimized schedules per month (free tier gate) */
  maxAiSchedulesPerMonth: number;
  /** Max demand forecast runs per month */
  maxForecastRunsPerMonth: number;
}> = {
  free: {
    maxWorkers:            10,
    maxLocations:          1,
    maxAiSchedulesPerMonth: 1,  // PRIMARY conversion trigger
    maxForecastRunsPerMonth: 1,
  },
  starter: {
    maxWorkers:            25,
    maxLocations:          1,
    maxAiSchedulesPerMonth: Infinity,
    maxForecastRunsPerMonth: Infinity,
  },
  growth: {
    maxWorkers:            50,
    maxLocations:          3,
    maxAiSchedulesPerMonth: Infinity,
    maxForecastRunsPerMonth: Infinity,
  },
  pro: {
    maxWorkers:            Infinity,
    maxLocations:          Infinity,
    maxAiSchedulesPerMonth: Infinity,
    maxForecastRunsPerMonth: Infinity,
  },
};

// ─── Feature Gates ────────────────────────────────────────────────────────────

/** Map of feature → minimum tier required to access it */
export const FEATURE_GATES: Record<string, SubscriptionTier> = {
  // Free tier features (always accessible)
  'scheduling.view':              'free',
  'scheduling.manual_assign':     'free',
  'workers.manage':               'free',
  'demand_forecast.basic':        'free',
  'uncovered_loss_metric':        'free',   // Always visible — conversion anchor
  'onboarding':                   'free',

  // Starter features
  'scheduling.ai_optimize':       'starter', // Unlimited AI schedules
  'scheduling.unlimited':         'starter',
  'notifications.push':           'starter',
  'notifications.whatsapp':       'starter', // PRIMARY upgrade anchor
  'analytics.basic':              'starter',
  'shift_swap.self_service':      'starter',
  'availability.employee_portal': 'starter',
  'export.pdf':                   'starter',
  'export.excel':                 'starter',
  'realtime_updates':             'starter',

  // Growth features
  'multi_location':               'growth',
  'analytics.advanced':           'growth',
  'ai_optimization.full':         'growth',
  'labor_law.basic_alerts':       'growth',
  'roles.permissions':            'growth',
  'mobile.offline':               'growth',

  // Pro features
  'labor_law.full_engine':        'pro',
  'labor_law.audit_log':          'pro',
  'multi_location.unlimited':     'pro',
  'integrations.payroll':         'pro',
  'integrations.pos':             'pro',
  'api_access':                   'pro',
  'support.dedicated':            'pro',
};

// ─── Tier Metadata (UI) ───────────────────────────────────────────────────────

export const TIER_META: Record<SubscriptionTier, {
  label: string;
  tagline: string;
  color: string;
  isPopular: boolean;
}> = {
  free:    { label: 'Gratis',  tagline: 'Para empezar',            color: '#6B7280', isPopular: false },
  starter: { label: 'Starter', tagline: 'Para un local',           color: '#0D9488', isPopular: false },
  growth:  { label: 'Growth',  tagline: 'Más popular — multisede', color: '#0D9488', isPopular: true  },
  pro:     { label: 'Pro',     tagline: 'Cumplimiento total',       color: '#7C3AED', isPopular: false },
};

// ─── Stripe Price IDs (populated via env vars set in Vercel) ─────────────────

export const STRIPE_PRICE_IDS: Record<SubscriptionTier, { monthly: string | undefined; annual: string | undefined }> = {
  free:    { monthly: undefined,                                          annual: undefined },
  starter: { monthly: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,       annual: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID },
  growth:  { monthly: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,        annual: process.env.STRIPE_GROWTH_ANNUAL_PRICE_ID },
  pro:     { monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,           annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<SubscriptionTier, number> = { free: 0, starter: 1, growth: 2, pro: 3 };

/** Returns true if `tier` meets or exceeds the `required` tier. */
export function tierMeetsRequirement(tier: SubscriptionTier, required: SubscriptionTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[required];
}

/** Returns the minimum tier required to access a named feature. */
export function requiredTierForFeature(feature: string): SubscriptionTier {
  return FEATURE_GATES[feature] ?? 'pro'; // unknown features default to most restrictive
}

/** Returns true if the given tier can access the named feature. */
export function tierCanAccessFeature(tier: SubscriptionTier, feature: string): boolean {
  return tierMeetsRequirement(tier, requiredTierForFeature(feature));
}

/** Returns the next tier above the given one, or null if already at Pro. */
export function nextTier(tier: SubscriptionTier): SubscriptionTier | null {
  const idx = TIERS.indexOf(tier);
  return idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
}

/** Formats a USD price for display. */
export function formatPriceUsd(usd: number, interval: 'month' | 'year' = 'month'): string {
  if (usd === 0) return 'Gratis';
  return `$${usd.toFixed(0)} / ${interval === 'month' ? 'mes' : 'año'}`;
}
