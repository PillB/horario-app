/**
 * LocaleContext — provides the i18n hook values via React context so any
 * component can call useT() without prop-drilling.
 *
 * Wrap the app root with <LocaleProvider> once, then call useT() anywhere.
 */

import React, { createContext, useContext } from 'react';
import { useLocale, type TFunction } from '@/hooks/useLocale';
import type { LangCode, Translations } from '@/locales/en';

type LocaleContextValue = {
  t: TFunction;
  langCode: LangCode;
  locale: Translations;
  setLanguage: (code: LangCode) => Promise<void>;
  isLoading: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const value = useLocale();
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Call inside any component to access translations */
export function useT(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useT must be used inside <LocaleProvider>');
  return ctx;
}
