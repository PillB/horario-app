/**
 * useLocale — i18n hook
 *
 * Game-dev pattern:
 *  1. Initialise with English base (sync, no flash).
 *  2. Detect device locale (expo-localization) on first launch when no
 *     persisted choice exists; map BCP-47 → nearest supported LangCode.
 *  3. Load persisted language from AsyncStorage (overrides detection).
 *  4. Deep-merge chosen language over English fallback.
 *  5. Expose t() for interpolated translation lookups.
 *  6. Apply RTL layout direction after language resolves.
 *
 * Usage:
 *   const { t, tPlural, langCode, setLanguage, locale } = useLocale();
 *   t('common.save')                          → 'Save'
 *   t('common.needed', { n: '3' })            → '3 needed'
 *   tPlural('roster.worker', 1)               → resolves 'roster.worker_one'
 *   tPlural('roster.worker', 5)               → resolves 'roster.worker_other'
 *   formatDate(new Date(), 'es')              → '1 de enero de 2025'
 *   formatNumber(1234.5, 'de')                → '1.234,5'
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import { getBaseLocale, loadLocale } from '@/locales/index';
import type { LangCode, Translations } from '@/locales/en';
import { isDateKey, parseDateKey } from '@/utils/dateKeys';

const STORAGE_KEY = '@horario:language';

// ─── BCP-47 locale map ────────────────────────────────────────────────────────
// Maps each supported LangCode to its canonical BCP-47 locale tag used by
// Intl.DateTimeFormat and Intl.NumberFormat.

export const LANG_TO_BCP47: Record<LangCode, string> = {
  en: 'en-US',
  es: 'es-MX',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  zh: 'zh-CN',
  sw: 'sw-KE',
  tl: 'tl-PH',
  hi: 'hi-IN',
};

// ─── RTL language codes ───────────────────────────────────────────────────────
// Currently none of the nine supported languages are RTL. This set is kept
// ready for future additions (ar, he, fa, ur …).
// NOTE: Changing RTL direction requires an app restart to take full effect —
// call Updates.reloadAsync() (expo-updates) after forceRTL() if a live reload
// is desired. The hook sets the flag but does NOT force a reload automatically.

const RTL_LANG_CODES = new Set(['ar', 'he', 'fa', 'ur']);

// ─── Supported LangCode list ──────────────────────────────────────────────────

const SUPPORTED_LANG_CODES: LangCode[] = [
  'en', 'es', 'de', 'fr', 'it', 'zh', 'sw', 'tl', 'hi',
];

function isValidLangCode(code: string): code is LangCode {
  return (SUPPORTED_LANG_CODES as string[]).includes(code);
}

// ─── Device locale detection ──────────────────────────────────────────────────
// Maps the device's BCP-47 language tag to the nearest supported LangCode.
// Strategy:
//   1. Exact match on the primary subtag (e.g. 'es' from 'es-MX').
//   2. Special-case 'zh' variants (zh-Hans, zh-Hant, zh-SG, etc.) → 'zh'.
//   3. Fall back to 'en'.

function detectDeviceLangCode(): LangCode {
  try {
    const locales = getLocales();
    if (!locales || locales.length === 0) return 'en';

    for (const locale of locales) {
      // expo-localization returns languageTag like 'en-US', 'es-MX', 'zh-Hans-CN'
      const tag = locale.languageTag ?? '';
      const primarySubtag = tag.split('-')[0].toLowerCase();

      // Chinese variants all map to 'zh'
      if (primarySubtag === 'zh') return 'zh';

      if (isValidLangCode(primarySubtag)) return primarySubtag;
    }
  } catch {
    // expo-localization unavailable in test / SSR environments
  }
  return 'en';
}

// ─── Path resolver ────────────────────────────────────────────────────────────
// Resolves 'scheduler.workers.addButton' → 'Add worker' from a Translations object.

function resolvePath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

// ─── Interpolation ────────────────────────────────────────────────────────────
// Replaces {variable} placeholders with values from the params map.

function interpolate(template: string, params?: Record<string, string>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

// ─── Exported formatters ──────────────────────────────────────────────────────

/**
 * Format a Date (or ISO date string) using the locale-appropriate BCP-47 tag.
 *
 * Example:
 *   formatDate(new Date(), 'fr')              → '1 janvier 2025'
 *   formatDate('2025-06-15', 'zh')            → '2025年6月15日'
 */
export function formatDate(
  date: Date | string,
  langCode: LangCode,
  options?: Intl.DateTimeFormatOptions,
): string {
  // A bare 'YYYY-MM-DD' key is a calendar date: parse it as local noon, not
  // UTC midnight (which renders as the previous day west of UTC).
  const d =
    typeof date === 'string' ? (isDateKey(date) ? parseDateKey(date) : new Date(date)) : date;
  const bcp47 = LANG_TO_BCP47[langCode] ?? 'en-US';
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  };
  try {
    return new Intl.DateTimeFormat(bcp47, defaultOptions).format(d);
  } catch {
    // Intl may not support the locale in all environments
    return new Intl.DateTimeFormat('en-US', defaultOptions).format(d);
  }
}

/**
 * Format a number using the locale-appropriate thousands / decimal separators.
 *
 * Example:
 *   formatNumber(1234567.89, 'de')  → '1.234.567,89'
 *   formatNumber(1234567.89, 'en')  → '1,234,567.89'
 */
export function formatNumber(n: number, langCode: LangCode): string {
  const bcp47 = LANG_TO_BCP47[langCode] ?? 'en-US';
  try {
    return new Intl.NumberFormat(bcp47).format(n);
  } catch {
    return new Intl.NumberFormat('en-US').format(n);
  }
}

// ─── Hook types ───────────────────────────────────────────────────────────────

export type TFunction = (path: string, params?: Record<string, string>) => string;

export type TPluralFunction = (
  path: string,
  count: number,
  params?: Record<string, string>,
) => string;

type UseLocaleReturn = {
  /** Translation function — resolves a dot-path key with optional interpolation */
  t: TFunction;
  /**
   * Pluralisation helper — appends _one or _other to path based on count,
   * then falls back to the base path if the suffixed key is missing.
   *
   * Example:
   *   tPlural('roster.worker', 1)  → t('roster.worker_one')  ?? t('roster.worker')
   *   tPlural('roster.worker', 3)  → t('roster.worker_other') ?? t('roster.worker')
   */
  tPlural: TPluralFunction;
  /** Current language code */
  langCode: LangCode;
  /** Full merged translations object (use sparingly — prefer t()) */
  locale: Translations;
  /** Change the active language and persist the choice */
  setLanguage: (code: LangCode) => Promise<void>;
  /** True while the initial language is being resolved */
  isLoading: boolean;
  /** True when the active language is written right-to-left */
  isRTL: boolean;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLocale(): UseLocaleReturn {
  const base = getBaseLocale();
  const [locale, setLocale] = useState<Translations>(base);
  const [langCode, setLangCode] = useState<LangCode>('en');
  const [isLoading, setIsLoading] = useState(true);
  const [isRTL, setIsRTL] = useState(false);

  // Guard against stale async responses (e.g. rapid language switching)
  const requestRef = useRef(0);

  // ── Apply RTL direction ─────────────────────────────────────────────────────
  // forceRTL is idempotent when the value has not changed. A full app restart
  // is required for the layout engine to fully re-mirror all views. The flag is
  // set here so consuming components can conditionally adjust styles before the
  // restart occurs (e.g. switching icon positions, text alignment).

  const applyRTL = useCallback((code: LangCode) => {
    const shouldBeRTL = RTL_LANG_CODES.has(code);
    I18nManager.forceRTL(shouldBeRTL);
    setIsRTL(shouldBeRTL);
  }, []);

  // ── Core language loader ────────────────────────────────────────────────────

  const applyLanguage = useCallback(
    async (code: LangCode) => {
      const id = ++requestRef.current;
      const merged = await loadLocale(code);
      if (id !== requestRef.current) return; // stale response — discard
      setLocale(merged);
      setLangCode(code);
      applyRTL(code);
    },
    [applyRTL],
  );

  // ── On mount: resolve initial language ─────────────────────────────────────
  // Priority: AsyncStorage persisted choice → device locale detection → 'en'

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);

        if (!cancelled) {
          if (saved && isValidLangCode(saved)) {
            // User has previously chosen a language — honour it.
            await applyLanguage(saved);
          } else {
            // First launch: detect from device locale.
            const detected = detectDeviceLangCode();
            await applyLanguage(detected);
            // Persist the detected choice so subsequent launches are instant.
            try {
              await AsyncStorage.setItem(STORAGE_KEY, detected);
            } catch {
              // Non-fatal — detected language is still applied in-session.
            }
          }
        }
      } catch {
        // Storage or locale load failure — English base is already displayed.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyLanguage]);

  // ── Public setLanguage ──────────────────────────────────────────────────────

  const setLanguage = useCallback(
    async (code: LangCode) => {
      await applyLanguage(code);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, code);
      } catch {
        // Non-fatal — language still switches in-session.
      }
    },
    [applyLanguage],
  );

  // ── Translation function ────────────────────────────────────────────────────
  // Resolution order:
  //   1. Merged (active language) translations
  //   2. English base fallback
  //   3. Empty string — never expose raw dot-path keys to users

  const t = useCallback<TFunction>(
    (path, params) => {
      const value = resolvePath(locale as unknown as Record<string, unknown>, path);
      if (value !== undefined) return interpolate(value, params);

      const fallback = resolvePath(base as unknown as Record<string, unknown>, path);
      if (fallback !== undefined) return interpolate(fallback, params);

      // Return empty string rather than the raw key path to avoid leaking
      // internal identifiers into the user-visible UI.
      return '';
    },
    [locale, base],
  );

  // ── Pluralisation helper ────────────────────────────────────────────────────
  // Appends _one (count === 1) or _other (count !== 1) to the path, then falls
  // back to the base path if the suffixed variant is absent.
  // Locale files should define keys like:
  //   roster.worker_one:   '1 worker'
  //   roster.worker_other: '{count} workers'

  const tPlural = useCallback<TPluralFunction>(
    (path, count, params) => {
      const suffix = count === 1 ? '_one' : '_other';
      const suffixedPath = `${path}${suffix}`;
      const mergedParams = { count: String(count), ...params };

      const suffixed = resolvePath(
        locale as unknown as Record<string, unknown>,
        suffixedPath,
      );
      if (suffixed !== undefined) return interpolate(suffixed, mergedParams);

      const suffixedBase = resolvePath(
        base as unknown as Record<string, unknown>,
        suffixedPath,
      );
      if (suffixedBase !== undefined) return interpolate(suffixedBase, mergedParams);

      // Fall back to the unsuffixed base path
      const plain = resolvePath(locale as unknown as Record<string, unknown>, path);
      if (plain !== undefined) return interpolate(plain, mergedParams);

      const plainBase = resolvePath(base as unknown as Record<string, unknown>, path);
      if (plainBase !== undefined) return interpolate(plainBase, mergedParams);

      return '';
    },
    [locale, base],
  );

  return { t, tPlural, langCode, locale, setLanguage, isLoading, isRTL };
}