import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAdvisorLanguage, languageInfo, type AdvisorLanguage } from '../../../../shared/copilot.ts';
import { api } from '../api.ts';
import { Translator, type TranslationStatus } from './translator.ts';

const STORAGE_KEY = 'keel.language';

interface LanguageContextValue {
  language: AdvisorLanguage;
  setLanguage: (language: AdvisorLanguage) => void;
  /** `translating` while a batch is in flight, `unavailable` when nothing came back. */
  status: TranslationStatus;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** The language chosen last time, or the one the browser asks for if the app offers it. */
function initialLanguage(): AdvisorLanguage {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && isAdvisorLanguage(saved)) return saved;
  } catch {
    // Storage unavailable; fall through to the browser's preference.
  }
  for (const tag of navigator.languages ?? []) {
    const base = tag.split('-')[0]?.toLowerCase() ?? '';
    if (isAdvisorLanguage(base)) return base;
  }
  return 'en';
}

/**
 * Holds the chosen language and drives the DOM translator underneath it. Mounted once, above
 * the router, so a language survives navigation and every page is translated the same way.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AdvisorLanguage>(initialLanguage);
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const translatorRef = useRef<Translator | null>(null);

  if (translatorRef.current === null) {
    translatorRef.current = new Translator({
      fetchTranslations: (target, strings) => api.i18n.translate(target, strings),
      onStatus: setStatus,
    });
  }

  useEffect(() => {
    const translator = translatorRef.current;
    if (!translator) return;
    translator.attach(document.body);
    return () => translator.detach();
  }, []);

  useEffect(() => {
    translatorRef.current?.setLanguage(language);
    const info = languageInfo(language);
    document.documentElement.lang = language;
    document.documentElement.dir = info.rtl ? 'rtl' : 'ltr';
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A remembered language is a convenience, not a requirement.
    }
  }, [language]);

  const setLanguage = useCallback((next: AdvisorLanguage) => setLanguageState(next), []);
  const value = useMemo(() => ({ language, setLanguage, status }), [language, setLanguage, status]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside a LanguageProvider');
  return context;
}
