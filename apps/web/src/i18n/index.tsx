import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type StringKey } from './strings/en';
import { sv } from './strings/sv';
import { bg } from './strings/bg';
import { es } from './strings/es';
import { fr } from './strings/fr';
import { it } from './strings/it';

export type Lang = 'en' | 'sv' | 'bg' | 'es' | 'fr' | 'it';
const STORAGE_KEY = 'storyMaker.lang';

const TABLES: Record<Lang, Record<StringKey, string>> = { en, sv, bg, es, fr, it };

export function resolveInitialLang(navigatorLang: string, stored: string | null): Lang {
  if (
    stored === 'en' || stored === 'sv' || stored === 'bg' ||
    stored === 'es' || stored === 'fr' || stored === 'it'
  ) return stored;
  const nav = navigatorLang.toLowerCase();
  if (nav.startsWith('sv')) return 'sv';
  if (nav.startsWith('bg')) return 'bg';
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('fr')) return 'fr';
  if (nav.startsWith('it')) return 'it';
  return 'en';
}

export function t(key: StringKey, lang: Lang, vars?: Record<string, string>): string {
  const raw = TABLES[lang]?.[key] ?? TABLES.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

interface LangContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    return resolveInitialLang(nav, stored);
  });

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>');
  return ctx;
}

export function useT() {
  const { lang } = useLang();
  return useCallback((key: StringKey, vars?: Record<string, string>) => t(key, lang, vars), [lang]);
}
