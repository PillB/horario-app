/**
 * Pricing copy follows the pricing research (product/pricing-and-product-research-2026-10.md):
 * paid plans start at US$19 per location a month, the trial is 14 days, there is no
 * per-employee fee. The old "$12/mo flat" and "10 days" text must not come back (QA 2026-11-01).
 */
import { de } from '@/locales/de';
import { en } from '@/locales/en';
import { es } from '@/locales/es';
import { fr } from '@/locales/fr';
import { hi } from '@/locales/hi';
import { it as itLocale } from '@/locales/it';
import { sw } from '@/locales/sw';
import { tl } from '@/locales/tl';
import { zh } from '@/locales/zh';

const LOCALES = { en, es, de, fr, it: itLocale, zh, sw, tl, hi } as Record<string, unknown>;

const strings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
};

describe('pricing copy', () => {
  it.each(Object.keys(LOCALES))('%s quotes US$19 per location and a 14-day trial, never $12', (code) => {
    const locale = LOCALES[code] as { auth: { signUp: { pricing: string } }; upgrade: { trial: { subtitle: string }; free: { pricing: string } } } & { auth: { signUp: { promo: string } } };
    expect(locale.auth.signUp.pricing).toMatch(/19/);
    // The banner fills in the price list of the business's country (CHG-109): US$19, or S/ 59 in Peru.
    expect(locale.upgrade.free.pricing).toContain('{price}');
    expect(locale.upgrade.trial.subtitle).toContain('{price}');
    // The trial is automatic (no button offers it): the sign-up offer states it.
    expect(locale.auth.signUp.promo).toMatch(/14/);
    const all = strings(LOCALES[code]);
    expect(all.filter((s) => /\$\s?12\b|\b12\s?\$|12\/mo/.test(s))).toEqual([]);
    expect(all.filter((s) => /1[,. ]200\+?/.test(s))).toEqual([]);
  });
});
