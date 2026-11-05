import { signal, Storage } from 'nsh';
import { en, type MessageKey, type Params } from '../../src/renderer/i18n/en';
import { zh } from '../../src/renderer/i18n/zh';

export const language = signal<'en' | 'zh'>('en');
export async function loadLanguage() {
  language.set((await Storage.getItem('tian.language')) === 'zh' ? 'zh' : 'en');
}
export function setLanguage(value: 'en' | 'zh') {
  language.set(value);
  void Storage.setItem('tian.language', value);
}
export function t(key: MessageKey, params?: Params): string {
  const raw = (language() === 'zh' ? zh[key] : undefined) ?? en[key];
  const text = typeof raw === 'function' ? raw(params ?? {}) : raw;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params?.[name] === undefined ? match : String(params[name]),
  );
}
