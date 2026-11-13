import { cleanup, effect, signal, Storage } from 'nsh';
import { createNavStack } from 'nsh/base';
import { en, type MessageKey } from '../../src/renderer/i18n/en';
import { zh } from '../../src/renderer/i18n/zh';
import type { ConvId, SettingsPage } from './state';

export type MobileKey =
  Extract<MessageKey, `mobile.${string}`> extends `mobile.${infer K}`
    ? K
    : never;
export type Route =
  | { page: 'home' }
  | { page: 'chat'; id: ConvId }
  | { page: 'diff' }
  | { page: 'settings' }
  | { page: 'setting'; id: SettingsPage };
export const navigation = createNavStack<Route>([{ page: 'home' }]);
export const language = signal<'en' | 'zh'>('en');
export function copy(key: MobileKey): string {
  const id = `mobile.${key}` as Extract<MessageKey, `mobile.${string}`>;
  return String((language() === 'zh' ? zh[id] : undefined) ?? en[id]);
}
export type Attachment = { uri: string; name: string };
export type LocalMessage = { id: number; text: string; images: Attachment[] };
export const drafts = signal<Record<ConvId, string>>({
  chief: '',
  atlas: '',
  juno: '',
  vega: '',
});
export const messages = signal<Record<ConvId, LocalMessage[]>>({
  chief: [],
  atlas: [],
  juno: [],
  vega: [],
});
export const attachments = signal<Record<ConvId, Attachment[]>>({
  chief: [],
  atlas: [],
  juno: [],
  vega: [],
});
export const connection = signal<
  'online' | 'syncing' | 'reconnecting' | 'offline'
>('online');
export const approval = signal<'pending' | 'approved' | 'rejected'>('pending');
export const migrationChoice = signal<'online' | 'offline'>('online');
export const review = signal<'pending' | 'landed' | 'shipped' | 'discarded'>(
  'pending',
);
export const conversationModels = signal<
  Partial<
    Record<ConvId, { model: string; thinking: 'high' | 'medium' | 'low' }>
  >
>({});
export const model = signal('claude-opus-4');
export const thinking = signal<'high' | 'medium' | 'low'>('high');
export const notice = signal('');
export const shareOpen = signal(false);
export const notificationPrefs = signal({
  waiting: true,
  failed: true,
  done: true,
});
export const imageDownscale = signal(true);
export const urls = new Set<string>();
let messageId = 0;

export function openConversation(id: ConvId) {
  navigation.push({ page: 'chat', id });
}
export function sendLocal(id: ConvId, text = drafts()[id]) {
  if (connection() !== 'online') return false;
  const images = attachments()[id];
  if (!text.trim() && images.length === 0) return false;
  messages.update((rows) => ({
    ...rows,
    [id]: [...rows[id], { id: ++messageId, text: text.trim(), images }],
  }));
  drafts.update((rows) => ({ ...rows, [id]: '' }));
  attachments.update((rows) => ({ ...rows, [id]: [] }));
  notice.set(copy('sampleSent'));
  return true;
}
export function persistPreferences(prefs: {
  theme: () => string;
  setTheme: (value: 'night' | 'day' | 'system') => void;
  glass: { (): number; set(value: number): void };
  ambient: { (): boolean; set(value: boolean): void };
  motion: { (): boolean; set(value: boolean): void };
  size: { (): number; set(value: number): void };
  wrap: { (): boolean; set(value: boolean): void };
  capture: { (): boolean; set(value: boolean): void };
}) {
  let alive = true;
  const ready = signal(false);
  cleanup(() => {
    alive = false;
    for (const uri of urls) URL.revokeObjectURL(uri);
    urls.clear();
  });
  void Storage.getItem('tian.ios.preferences')
    .then((raw) => {
      if (!alive) return;
      if (raw) {
        try {
          const p = JSON.parse(raw);
          if (['night', 'day', 'system'].includes(p.theme))
            prefs.setTheme(p.theme);
          if (p.language === 'en' || p.language === 'zh')
            language.set(p.language);
          if (typeof p.glass === 'number')
            prefs.glass.set(Math.max(0, Math.min(100, p.glass)));
          if (typeof p.ambient === 'boolean') prefs.ambient.set(p.ambient);
          if (typeof p.motion === 'boolean') prefs.motion.set(p.motion);
          if (typeof p.size === 'number')
            prefs.size.set(Math.max(12, Math.min(22, p.size)));
          if (typeof p.wrap === 'boolean') prefs.wrap.set(p.wrap);
          if (typeof p.capture === 'boolean') prefs.capture.set(p.capture);
          if (typeof p.downscale === 'boolean') imageDownscale.set(p.downscale);
          if (
            p.notifications &&
            ['waiting', 'failed', 'done'].every(
              (key) => typeof p.notifications[key] === 'boolean',
            )
          )
            notificationPrefs.set(p.notifications);
          if (['claude-opus-4', 'claude-sonnet-4', 'gpt-5'].includes(p.model))
            model.set(p.model);
          if (['low', 'medium', 'high'].includes(p.thinking))
            thinking.set(p.thinking);
        } catch {
          notice.set(copy('storageError'));
        }
      }
      ready.set(true);
    })
    .catch(() => {
      if (alive) {
        ready.set(true);
        notice.set(copy('storageError'));
      }
    });
  effect(() => {
    if (!ready()) return;
    const value = {
      language: language(),
      theme: prefs.theme(),
      glass: prefs.glass(),
      ambient: prefs.ambient(),
      motion: prefs.motion(),
      size: prefs.size(),
      wrap: prefs.wrap(),
      capture: prefs.capture(),
      downscale: imageDownscale(),
      notifications: notificationPrefs(),
      model: model(),
      thinking: thinking(),
    };
    void Storage.setItem('tian.ios.preferences', JSON.stringify(value)).catch(
      () => {
        if (alive) notice.set(copy('storageError'));
      },
    );
  });
}
