import { signal } from 'nsh';
import type { Look } from './theme';

// Transient client state (sample data: docs/design/client-mockup.html).
export type ConvId = 'chief' | 'atlas' | 'juno' | 'vega';
export type InspTab = 'changes' | 'tasks' | 'details';
export type SettingsPage =
  | 'appearance'
  | 'general'
  | 'capture'
  | 'notify'
  | 'model'
  | 'providers'
  | 'workers'
  | 'skills'
  | 'server'
  | 'channels'
  | 'usage'
  | 'improve';
export type Band = 'agent' | 'personal' | 'ops';

export const look = signal<Look>('night');
export const followSystem = signal(false);
export const selected = signal<ConvId>('chief');
export const inspector = signal(true);
export const inspectorTab = signal<InspTab>('changes');
export const settingsOpen = signal(false);
export const settingsPage = signal<SettingsPage>('appearance');
export const paletteOpen = signal(false);
export const paletteQuery = signal('');
export const draft = signal('');
export const sent = signal<string[]>([]);
export const glass = signal(70);
export const pointerLight = signal(true);
export const ambientLight = signal(true);
export const reduceMotion = signal(false);
export const chatSize = signal(15);
export const codeWrap = signal(false);
export const captureSuggest = signal(true);
export const captureDefault = signal<'conversation' | 'chief'>('conversation');
export const migration = signal<'online' | 'offline'>('online');

export function goTo(id: ConvId) {
  selected.set(id);
  settingsOpen.set(false);
}

export function toggleLook() {
  look.set(look() === 'night' ? 'day' : 'night');
}

export function openSettings(page?: SettingsPage) {
  if (page) settingsPage.set(page);
  settingsOpen.set(true);
}

export function closeSettings() {
  settingsOpen.set(false);
}

export function send() {
  const text = draft().trim();
  if (!text) return;
  sent.update((rows) => [...rows, text]);
  draft.set('');
  selected.set('chief');
}

export const BANDS: {
  id: Band;
  label: string;
  note: string;
  pages: { id: SettingsPage; label: string; badge?: string }[];
}[] = [
  {
    id: 'agent',
    label: '智能体',
    note: '属于账号',
    pages: [
      { id: 'model', label: '模型' },
      { id: 'providers', label: '提供方', badge: '2' },
      { id: 'workers', label: 'Worker 与 Intent' },
      { id: 'skills', label: '技能', badge: '1 待批' },
    ],
  },
  {
    id: 'personal',
    label: '个人',
    note: '只在这台设备',
    pages: [
      { id: 'general', label: '通用' },
      { id: 'appearance', label: '外观' },
      { id: 'capture', label: '截图' },
      { id: 'notify', label: '通知' },
    ],
  },
  {
    id: 'ops',
    label: '运行',
    note: '属于服务器',
    pages: [
      { id: 'server', label: '服务器与设备', badge: '3' },
      { id: 'channels', label: '渠道' },
      { id: 'usage', label: '用量' },
      { id: 'improve', label: '改进日志', badge: '4' },
    ],
  },
];

export const PAGE_TITLES: Record<
  SettingsPage,
  { title: string; note?: string }
> = {
  appearance: { title: '外观', note: '只影响这台设备。' },
  general: { title: '通用' },
  capture: { title: '截图', note: '截图一步发进对话。' },
  notify: { title: '通知', note: '只在需要你的时候打扰你。' },
  model: { title: '模型', note: '新对话的默认值。每个对话可以单独改。' },
  providers: { title: '提供方', note: '密钥存在服务器上，不经过这台设备。' },
  workers: {
    title: 'Worker 与 Intent',
    note: 'Manager 派 Run 时选一个 Intent，或直接指定 runtime 和模型。',
  },
  skills: { title: '技能', note: '可复用的流程。新版本需要你批准。' },
  server: {
    title: '服务器与设备',
    note: 'tailnet 就是凭据。撤销一台设备后，它需要重新配对。',
  },
  channels: { title: '渠道', note: '每个渠道有自己的对话，共用同一份记忆。' },
  usage: { title: '用量', note: '最近 26 周。' },
  improve: {
    title: '改进日志',
    note: '问题、摩擦、想法和成功经验。可以提升为 Task。',
  },
};
