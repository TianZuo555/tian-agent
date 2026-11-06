import { HUES } from './theme';
import type { ConvId } from './state';
import type { RunState } from './ui';

export interface MiniRun {
  id: string;
  title: string;
  state: RunState;
  stage: number;
  review?: boolean;
  phase: string;
}

export interface Manager {
  id: Exclude<ConvId, 'chief'>;
  name: string;
  project: string;
  hue: string;
  state: RunState;
  presence: string;
  time: string;
  moons: number;
  runs: MiniRun[];
}

export const managers: Manager[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    project: 'tian-agent',
    hue: HUES.atlas,
    state: 'work',
    presence: '2 个 Worker · 1 待审阅',
    time: '刚刚',
    moons: 2,
    runs: [
      {
        id: '#12',
        title: '修复重连重复',
        state: 'done',
        stage: 4,
        review: true,
        phase: '待审阅',
      },
      {
        id: '#13',
        title: '断网重连测试',
        state: 'work',
        stage: 3,
        phase: '验证中',
      },
      {
        id: '#14',
        title: '更新协议文档',
        state: 'work',
        stage: 1,
        phase: '理解中',
      },
    ],
  },
  {
    id: 'juno',
    name: 'Juno',
    project: 'healthapp',
    hue: HUES.juno,
    state: 'wait',
    presence: '等你决定迁移方式',
    time: '8 分',
    moons: 0,
    runs: [],
  },
  {
    id: 'vega',
    name: 'Vega',
    project: 'd2r-mobile',
    hue: HUES.vega,
    state: 'idle',
    presence: '空闲',
    time: '3 时',
    moons: 0,
    runs: [],
  },
];

export const diffFiles = [
  { path: 'src/service/client.ts', add: '+30', del: '−6' },
  { path: 'tests/reconnect.test.ts', add: '+44', del: '−0' },
  { path: 'src/service/protocol.ts', add: '+12', del: '−7' },
  { path: 'src/shared/types.ts', add: '+0', del: '−10' },
];

export const diffPatch = `diff --git a/src/service/client.ts b/src/service/client.ts
--- a/src/service/client.ts
+++ b/src/service/client.ts
@@ -138,8 +138,17 @@ export class ServiceClient {
   private onFrame(frame: ServerFrame) {
-    this.emit(frame.event);
+    const id = frame.event.messageId;
+    if (id && this.seen.has(id)) return;
+    if (id) this.remember(id);
+    this.emit(frame.event);
   }
 
   private resume() {
-    this.send({ kind: 'resume', cursor });
+    this.send({ kind: 'resume', cursor, dedupe: true });
   }
+
+  private remember(id: string) {
+    this.seen.add(id);
+    if (this.seen.size <= 2048) return;
+    this.seen.delete(this.seen.values().next().value);
+  }
 }
`;

export const tasks = [
  {
    title: '审阅 Run #12',
    meta: 'Tian · 来自 Atlas · 10:42',
    state: 'work' as RunState,
  },
  {
    title: '决定 healthapp 迁移方式',
    meta: 'Tian · 来自 Juno · 阻塞',
    state: 'wait' as RunState,
  },
  {
    title: '本周第三次训练',
    meta: '目标 · 周日 20:00 前',
    state: 'idle' as RunState,
  },
  {
    title: 'Land Run #11',
    meta: 'Atlas · 昨天 23:10',
    state: 'done' as RunState,
  },
];

export const details = [
  { label: 'Scope', value: '全局' },
  { label: '模型', value: 'claude-opus-4 · 高' },
  { label: '本次对话', value: '184k tokens · $1.92' },
  { label: 'Core 记忆', value: '930 / 1500' },
  { label: '渠道', value: 'Mac · iPhone · Telegram' },
];

export const intents = [
  {
    name: 'simple',
    runtime: 'pi',
    model: 'claude-sonnet-4',
    thinking: '中',
    def: true,
  },
  {
    name: 'review',
    runtime: 'codex',
    model: 'gpt-5',
    thinking: '高',
    def: false,
  },
  {
    name: 'docs',
    runtime: 'pi',
    model: 'claude-haiku-4',
    thinking: '低',
    def: false,
  },
];

export const providers = [
  { name: 'Magpie', note: '本机网关 · 42 个模型', state: '已连接' },
  { name: 'Anthropic', note: 'API key · sk-ant-…3f2a', state: '已连接' },
  { name: 'OpenAI', note: 'API key', state: '添加' },
];

export const skills = [
  {
    name: 'weekly-review',
    note: 'v3 · 已验证 4 次',
    badge: '启用',
    warn: false,
  },
  { name: 'release-notes', note: 'v2 → v3 待批准', badge: '查看', warn: true },
];

export const devices = [
  {
    name: 'mac-studio',
    note: 'wss://mac-studio.tail3c1.ts.net:8787 · Pi Server',
    meta: '1.1.0 · 18 ms',
  },
  { name: 'MacBook Air', note: '这台设备 · 现在', meta: '本机' },
  { name: 'iPhone', note: '上次在线 11:02', meta: '撤销' },
  { name: 'Web · mac-studio', note: '上次在线 昨天', meta: '撤销' },
];

export const usage = [
  { name: 'claude-opus-4', note: 'Chief', cost: '$38.20', share: 0.62 },
  {
    name: 'claude-sonnet-4',
    note: 'Manager · Worker',
    cost: '$21.75',
    share: 0.35,
  },
  { name: 'gpt-5', note: 'Worker · intent review', cost: '$9.40', share: 0.15 },
];

export const improvements = [
  {
    kind: 'issue',
    title: '重连后消息重复',
    note: '已修复 · Run #12',
    state: 'done' as RunState,
  },
  {
    kind: 'friction',
    title: '手机上看不全长表格',
    note: '提升为 Task',
    state: 'wait' as RunState,
  },
  {
    kind: 'idea',
    title: '锁屏显示 Run 进度',
    note: '提升为 Task',
    state: 'idle' as RunState,
  },
  {
    kind: 'win',
    title: '截图直发省了三步',
    note: '1040 × 600',
    state: 'done' as RunState,
  },
];

export const paletteItems = [
  { group: '对话', label: 'Chief', hint: '⌘0', conv: 'chief' as ConvId },
  {
    group: '对话',
    label: 'Atlas · tian-agent',
    hint: '⌘1',
    conv: 'atlas' as ConvId,
  },
  {
    group: '对话',
    label: 'Juno · healthapp',
    hint: '⌘2',
    conv: 'juno' as ConvId,
  },
  {
    group: '对话',
    label: 'Vega · d2r-mobile',
    hint: '⌘3',
    conv: 'vega' as ConvId,
  },
  { group: '命令', label: '切换检查器', hint: '⌘B' },
  { group: '命令', label: '外观：夜 / 昼', hint: '' },
  { group: '命令', label: '设置', hint: '⌘,' },
];
