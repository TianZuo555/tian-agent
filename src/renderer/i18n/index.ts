import { useSyncExternalStore } from 'react';
import { en, type MessageKey, type Messages, type Params } from './en';
import { zh } from './zh';

export type { MessageKey, Params };

/**
 * English is the default locale; a stored choice wins over it. The sidebar's
 * open state sets the precedent for UI preferences living in localStorage
 * rather than the service — same deal here. The store also builds under
 * Node's test runner, which has no localStorage, so every access is guarded.
 */
export type Locale = 'en' | 'zh';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

const STORAGE_KEY = 'tian.language';
const dictionaries: Record<Locale, Partial<Messages>> = { en, zh };

function readStored(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

let locale: Locale = readStored();
const listeners = new Set<() => void>();

function applyLangTag() {
  try {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  } catch {
    /* no DOM in tests */
  }
}
applyLangTag();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* this window only */
  }
  applyLangTag();
  for (const listener of listeners) listener();
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
  );
}

/** BCP-47 tag for Intl/toLocale* calls so dates follow the UI language. */
export function localeTag(): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

/**
 * Resolve a message for the current locale, falling back to English for any
 * key a locale has not translated. Function messages receive the params
 * verbatim; string messages get `{param}` interpolation.
 */
export function t(key: MessageKey, params?: Params): string {
  const raw = dictionaries[locale][key] ?? en[key];
  const text = typeof raw === 'function' ? raw(params ?? {}) : raw;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

/**
 * The component-facing form: subscribing here is what makes a view re-render
 * on a locale switch, so every component that renders copy calls it — even
 * ones that also use module-level tables of message keys.
 */
export function useT(): typeof t {
  useLocale();
  return t;
}
