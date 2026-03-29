/**
 * useLocale — i18n hook
 *
 * Game-dev pattern:
 *  1. Initialise with English base (sync, no flash).
 *  2. Load persisted language from AsyncStorage.
 *  3. Deep-merge chosen language over English fallback.
 *  4. Expose t() for interpolated translation lookups.
 *
 * Usage:
 *   const { t, langCode, setLanguage, locale } = useLocale();
 *   t('common.save')                    → 'Save'
 *   t('common.needed', { n: '3' })      → '3 needed'
 *   t('wellness.body', { minutes: '5', plural: 's' }) → 'You have been focused…'
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBaseLocale, loadLocale } from '@/locales/index';
import type { LangCode, Translations } from '@/locales/en';

const STORAGE_KEY = '@horario:language';

// ─── Path resolver ────────────────────────────────────────────────────────────
// Resolves 'scheduler.workers.addButton' → 'Add worker' from a Translations object.

function resolvePath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type TFunction = (path: string, params?: Record<string, string>) => string;

type UseLocaleReturn = {
  /** Translation function — resolves a dot-path key with optional interpolation */
  t: TFunction;
  /** Current language code */
  langCode: LangCode;
  /** Full merged translations object (use sparingly — prefer t()) */
  locale: Translations;
  /** Change the active language and persist the choice */
  setLanguage: (code: LangCode) => Promise<void>;
  /** True while the initial language is loading */
  isLoading: boolean;
};

export function useLocale(): UseLocaleReturn {
  const base = getBaseLocale();
  const [locale, setLocale] = useState<Translations>(base);
  const [langCode, setLangCode] = useState<LangCode>('en');
  const [isLoading, setIsLoading] = useState(true);
  // Guard against stale async responses (e.g. rapid language switching)
  const requestRef = useRef(0);

  const applyLanguage = useCallback(async (code: LangCode) => {
    const id = ++requestRef.current;
    const merged = await loadLocale(code);
    if (id !== requestRef.current) return; // stale, discard
    setLocale(merged);
    setLangCode(code);
  }, []);

  // On mount: read persisted language
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && saved && isValidLangCode(saved)) {
          await applyLanguage(saved as LangCode);
        }
      } catch {
        // Ignore storage errors — English base is already set
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applyLanguage]);

  const setLanguage = useCallback(async (code: LangCode) => {
    await applyLanguage(code);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Non-fatal — language still switches in-session
    }
  }, [applyLanguage]);

  const t = useCallback<TFunction>((path, params) => {
    const value = resolvePath(locale as unknown as Record<string, unknown>, path);
    if (value !== undefined) return interpolate(value, params);
    // Fallback to English base
    const fallback = resolvePath(base as unknown as Record<string, unknown>, path);
    if (fallback !== undefined) return interpolate(fallback, params);
    // Last resort: return the path key so missing translations are obvious
    return path;
  }, [locale, base]);

  return { t, langCode, locale, setLanguage, isLoading };
}

function isValidLangCode(code: string): boolean {
  return ['en', 'es', 'de', 'fr', 'it', 'zh', 'sw', 'tl', 'hi'].includes(code);
}
