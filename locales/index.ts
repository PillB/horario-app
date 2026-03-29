/**
 * Locale registry — game-dev pattern.
 *
 * English is loaded first (base); the chosen language is deep-merged on top.
 * Any missing key in the chosen language automatically falls back to English.
 *
 * Usage:
 *   const { t, locale, setLanguage } = useLocale();
 *   t('common.save')           // → 'Save' (or translated)
 *   t('common.needed', {n: 3}) // → '3 needed' (with interpolation)
 */

import { en } from './en';
import type { LangCode, Translations } from './en';

export type { LangCode, Translations };
export { en };

// ─── Lazy language loaders ───────────────────────────────────────────────────
// Each loader is a dynamic import so unused languages are never bundled.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocaleModule = Record<string, any>;

const loaders: Record<LangCode, () => Promise<LocaleModule>> = {
  en: async () => ({ en }),
  es: async () => import('./es'),
  de: async () => import('./de'),
  fr: async () => import('./fr'),
  it: async () => import('./it'),
  zh: async () => import('./zh'),
  sw: async () => import('./sw'),
  tl: async () => import('./tl'),
  hi: async () => import('./hi'),
};

/** All supported language codes */
export const LANG_CODES: LangCode[] = ['en', 'es', 'de', 'fr', 'it', 'zh', 'sw', 'tl', 'hi'];

/**
 * Deep-merge two objects. `override` keys win; missing keys fall back to `base`.
 * Only plain objects are recursed into — strings/numbers/booleans are replaced wholesale.
 */
function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const b = base[key];
    const o = override[key];
    if (
      o !== undefined &&
      o !== null &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      typeof b === 'object' &&
      b !== null &&
      !Array.isArray(b)
    ) {
      result[key as string] = deepMerge(b as object, o as Partial<typeof b>) as unknown;
    } else if (o !== undefined) {
      result[key as string] = o as unknown;
    }
  }
  return result as T;
}

/**
 * Load a locale by code.
 * Returns the deep-merged result of English (base) + chosen language.
 * Falls back gracefully to English on any error.
 */
export async function loadLocale(code: LangCode): Promise<Translations> {
  if (code === 'en') return en;
  try {
    const mod = await loaders[code]();
    // Module may export named const (es, de, …) or default
    const lang = (mod[code] ?? mod.default ?? null) as Translations | null;
    if (!lang) return en;
    return deepMerge(en, lang as Partial<Translations>);
  } catch {
    return en;
  }
}

/** Synchronous accessor for the English base (used as initial state) */
export function getBaseLocale(): Translations {
  return en;
}
