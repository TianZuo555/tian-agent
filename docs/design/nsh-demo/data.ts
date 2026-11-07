import type { Who } from "./ui";

export type ConvId = "chief" | "atlas" | "juno" | "vega";

export interface Conv {
  id: ConvId;
  who: Who;
  name: string;
  scope?: string;
  presence: string;
  time: string;
  tone: "work" | "wait" | "idle";
  header: string;
  placeholder: string;
  badge?: number;
}

export const CONVS: Conv[] = [
  {
    id: "chief",
    who: "chief",
    name: "Chief",
    presence: "汇总 Atlas 的报告",
    time: "",
    tone: "work",
    header: "工作中 · 全局 · claude-opus-4 · 思考 高",
    placeholder: "和 Chief 说…",
    badge: 2,
  },
  {
    id: "atlas",
    who: "atlas",
    name: "Atlas",
    scope: "tian-agent",
    presence: "2 个 Worker · 1 待审阅",
    time: "刚刚",
    tone: "work",
    header: "Manager · tian-agent · claude-sonnet-4 · 2 个 Worker",
    placeholder: "给 Atlas 布置任务，或追问某个 Run…",
  },
  {
    id: "juno",
    who: "juno",
    name: "Juno",
    scope: "healthapp",
    presence: "等你决定迁移方式",
    time: "8 分",
    tone: "wait",
    header: "Manager · healthapp · claude-sonnet-4 · 等你决定",
    placeholder: "回复 Juno…",
  },
  {
    id: "vega",
    who: "vega",
    name: "Vega",
    scope: "d2r-mobile",
    presence: "空闲",
    time: "3 时",
    tone: "idle",
    header: "Manager · d2r-mobile · claude-sonnet-4 · 空闲",
    placeholder: "给 Vega 布置任务…",
  },
];

export const MINI_RUNS = [
  { id: "#12", title: "修复重连重复", at: 3, state: "待审阅" },
  { id: "#13", title: "断网重连测试", at: 2, state: "验证中" },
  { id: "#14", title: "更新协议文档", at: 0, state: "理解中" },
];

export const RUN12 = {
  title: "Run #12 · 修复重连后消息重复",
  branch: "fix/ws-dedupe → main · 第 2 次尝试",
  files: 4,
  add: 86,
  del: 23,
  tests: "128/128",
  minutes: 9,
};

export const FILES = [
  { path: "src/service/client.ts", add: 30, del: 6 },
  { path: "tests/reconnect.test.ts", add: 44, del: 0 },
  { path: "src/service/protocol.ts", add: 12, del: 7 },
  { path: "src/shared/types.ts", add: 0, del: 10 },
];

export type DiffRow = { old?: number; cur?: number; kind: "ctx" | "add" | "del" | "hunk" | "gap"; text: string };

export const DIFF: DiffRow[] = [
  { kind: "hunk", text: "@@ -138,9 +138,15 @@ export class ServiceClient" },
  { old: 138, cur: 138, kind: "ctx", text: "  private onFrame(frame: ServerFrame) {" },
  { old: 139, kind: "del", text: "    this.emit(frame.event);" },
  { cur: 139, kind: "add", text: "    const id = frame.event.messageId;" },
  { cur: 140, kind: "add", text: "    if (id && this.seen.has(id)) return;" },
  { cur: 141, kind: "add", text: "    if (id) this.remember(id);" },
  { cur: 142, kind: "add", text: "    this.emit(frame.event);" },
  { old: 140, cur: 143, kind: "ctx", text: "  }" },
  { kind: "gap", text: "⋯ 展开 52 行未改动 ⋯" },
  { old: 145, cur: 148, kind: "ctx", text: "  private resume() {" },
  { old: 146, kind: "del", text: "    this.send({ kind: 'resume', cursor });" },
  { cur: 149, kind: "add", text: "    this.send({ kind: 'resume', cursor, dedupe: true });" },
  { old: 147, cur: 150, kind: "ctx", text: "  }" },
  { kind: "hunk", text: "@@ -201,0 +210,5 @@" },
  { cur: 210, kind: "add", text: "  private remember(id: string) {" },
  { cur: 211, kind: "add", text: "    this.seen.add(id);" },
  { cur: 212, kind: "add", text: "    if (this.seen.size <= 2048) return;" },
  { cur: 213, kind: "add", text: "    this.seen.delete(oldest);" },
  { cur: 214, kind: "add", text: "  }" },
];

export const PHASES = ["理解", "修改", "验证", "汇报"];

export const KIT_SURFACES = [
  { level: "L0", name: "天幕", use: "桌面、页面底色", spec: "--wall", detail: "渐变 + 环境色斑" },
  { level: "L1", name: "窗体", use: "窗口、侧栏", spec: "blur 50 · saturate 1.5", detail: "rim-strong" },
  { level: "L2", name: "卡片", use: "消息卡、列表", spec: "fill 4.5% · 1px line", detail: "rim · 无投影" },
  { level: "L3", name: "浮层", use: "输入框、菜单、toast", spec: "glass · blur 24", detail: "rim-strong · e3" },
  { level: "L4", name: "遮罩", use: "截图浮层、sheet、⌘K", spec: "glass · blur 30", detail: "rim-strong · e4" },
];

export const KIT_STATES: { state: string; label: string; who: Who; tone: "work" | "wait" | "idle" }[] = [
  { state: "idle", label: "空闲", who: "atlas", tone: "idle" },
  { state: "working", label: "工作中", who: "chief", tone: "work" },
  { state: "waiting", label: "等你决定", who: "juno", tone: "wait" },
  { state: "reviewing", label: "待审阅", who: "vega", tone: "wait" },
];

export const SETTINGS_NAV = [
  { group: "智能体", note: "属于账号", items: ["模型", "Worker 与 Intent"] },
  { group: "个人", note: "只在这台设备", items: ["通用", "外观"] },
  { group: "运行", note: "属于服务器", items: ["服务器与设备", "用量"] },
];

export const USAGE = [
  { model: "claude-opus-4", role: "Chief", cost: "$38.20", share: 0.56 },
  { model: "claude-sonnet-4", role: "Manager · Worker", cost: "$21.75", share: 0.32 },
  { model: "gpt-5", role: "Worker · intent review", cost: "$9.40", share: 0.12 },
];

export const PHONE_NEEDS = { title: "Juno 等你决定", detail: "healthapp 迁移：在线还是停机" };
