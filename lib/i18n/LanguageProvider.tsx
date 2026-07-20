'use client';

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { translate, dir as dirOf, type Lang } from './dictionary';

interface I18nValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: (key: string) => string;
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export const LANG_COOKIE = 'etlaq_lang';

// Persist the choice so SSR (which reads the cookie) and the next visit agree —
// avoids a flash of the wrong direction.
function persist(lang: Lang) {
  try {
    localStorage.setItem(LANG_COOKIE, lang);
    document.cookie = `${LANG_COOKIE}=${lang};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* storage unavailable */
  }
}

export function LanguageProvider({
  initialLang = 'en',
  children,
}: {
  initialLang?: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  // Self-correct to the persisted choice on mount, in case SSR served the default
  // (e.g. a cached/prerendered response that didn't see the cookie).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_COOKIE);
      if ((saved === 'ar' || saved === 'en') && saved !== lang) setLangState(saved);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang/dir> in sync with the active language.
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = dirOf(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persist(next);
  }, []);

  const toggle = useCallback(() => setLang(lang === 'ar' ? 'en' : 'ar'), [lang, setLang]);

  const t = useCallback((key: string) => translate(lang, key), [lang]);

  return (
    <I18nContext.Provider value={{ lang, dir: dirOf(lang), t, setLang, toggle }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback if a component renders outside the provider (English/LTR).
    return {
      lang: 'en',
      dir: 'ltr',
      t: (key: string) => translate('en', key),
      setLang: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
