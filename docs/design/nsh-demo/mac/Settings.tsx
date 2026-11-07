import { Scroll, Text, View, type JSX, signal } from "nsh";
import { USAGE } from "../data";
import { alpha, FONT_DISPLAY, FONT_MONO, finishSignal, modeSignal, type Theme } from "../theme";
import { Chip, For, Icon, IconButton, Press, StatusDot } from "../ui";

function Switch(props: { t: Theme; on: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  const t = props.t;
  return (
    <Press
      label={props.label}
      role="switch"
      selected={props.on}
      onPress={() => props.onChange(!props.on)}
      style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: props.on ? t.work : t.mode === "night" ? "rgba(255,255,255,0.14)" : "rgba(20,20,40,0.16)" }}
    >
      <View
        style={{
          position: "absolute",
          top: 2,
          left: props.on ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: props.on ? (t.mode === "night" ? "#08110f" : "#ffffff") : t.mode === "night" ? "#c9c9d2" : "#ffffff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      />
    </Press>
  );
}

function Segmented(props: { t: Theme; value: string; items: string[]; onChange: (v: string) => void; width?: number }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: t.mode === "night" ? "rgba(0,0,0,0.3)" : "rgba(20,20,40,0.06)" }}>
      <For of={props.items} by={(item) => item}>
        {(item) => {
        const active = item === props.value;
        return (
          <Press
            label={item}
            selected={active}
            onPress={() => props.onChange(item)}
            style={{
              height: 24,
              width: props.width,
              paddingHorizontal: props.width ? 0 : 12,
              borderRadius: 6,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: active ? t.text : "transparent",
            }}
          >
            <Text style={{ fontSize: 11.5, color: active ? t.winSolid : t.text2 }}>{item}</Text>
          </Press>
        );
      }}
      </For>
    </View>
  );
}

function Row(props: { t: Theme; title: string; note?: string; children: JSX.Element }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 12.5, color: t.text }}>{props.title}</Text>
        {props.note ? <Text style={{ fontSize: 10.5, lineHeight: 15, color: t.text3 }}>{props.note}</Text> : null}
      </View>
      {props.children}
    </View>
  );
}

function Slider(props: { t: Theme; value: number; max?: number; label: string }): JSX.Element {
  const t = props.t;
  const width = 132;
  const at = Math.min(1, props.value) * width;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
      <View style={{ width, height: 3, borderRadius: 2, backgroundColor: t.line2 }}>
        <View style={{ width: at, height: 3, borderRadius: 2, backgroundColor: t.text2 }} />
        <View
          style={{
            position: "absolute",
            left: at - 6,
            top: -4.5,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: t.text,
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        />
      </View>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10, width: 34, color: t.text3 }}>{props.label}</Text>
    </View>
  );
}

function Select(props: { t: Theme; value: string; note?: string }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: 26,
        paddingHorizontal: 9,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
      }}
    >
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: t.text }}>{props.value}</Text>
      <Icon name="chevron-down" size={10} color={t.text3} />
    </View>
  );
}

function Section(props: { t: Theme; title: string; note?: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ gap: 2, marginBottom: 14 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "bold", color: t.text, marginBottom: 2 }}>{props.title}</Text>
      {props.note ? <Text style={{ fontSize: 10.5, color: t.text3, marginBottom: 4 }}>{props.note}</Text> : null}
      {props.children}
    </View>
  );
}

function Appearance(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const pointer = signal(t.glow);
  const ambient = signal(t.glow);
  const reduce = signal(false);
  const wrap = signal(false);
  return (
    <View>
      <Section t={t} title="外观" note="只影响这台设备。">
        <Row t={t} title="主题" note="夜与昼是两套独立的色板。">
          <Segmented t={t} value={modeSignal() === "night" ? "夜" : "昼"} items={["夜", "昼"]} onChange={(v) => modeSignal.set(v === "夜" ? "night" : "day")} />
        </Row>
        <Row t={t} title="光影" note="哑光去掉页面的光池、聚光灯和彩色阴影。">
          <Segmented t={t} value={finishSignal() === "glow" ? "光晕" : "哑光"} items={["光晕", "哑光"]} onChange={(v) => finishSignal.set(v === "光晕" ? "glow" : "matte")} />
        </Row>
        <Row t={t} title="玻璃强度" note="0 时所有表面不透明，适合低电量或「降低透明度」。">
          <Slider t={t} value={finishSignal() === "glow" ? 0.7 : 0} label={finishSignal() === "glow" ? "70" : "0"} />
        </Row>
        <Row t={t} title="指针光" note="悬停卡片时跟随指针的柔光。">
          <Switch t={t} on={pointer()} onChange={pointer.set} label="指针光" />
        </Row>
        <Row t={t} title="Chief 环境光" note="Chief 光球投到窗口左上的暖光。">
          <Switch t={t} on={ambient()} onChange={ambient.set} label="Chief 环境光" />
        </Row>
        <Row t={t} title="减少动效" note="跟随系统时读取 prefers-reduced-motion。">
          <Switch t={t} on={reduce()} onChange={reduce.set} label="减少动效" />
        </Row>
      </Section>

      <Section t={t} title="文字">
        <Row t={t} title="对话字号" note="只改消息正文，界面文字不变。">
          <Slider t={t} value={0.5} label="15 px" />
        </Row>
        <Row t={t} title="代码换行" note="代码块和改动视图默认不换行。">
          <Switch t={t} on={wrap()} onChange={wrap.set} label="代码换行" />
        </Row>
      </Section>
    </View>
  );
}

function General(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const login = signal(true);
  const menubar = signal(true);
  return (
    <View>
      <Section t={t} title="通用">
        <Row t={t} title="语言" note="界面文字与日期的语言。">
          <Select t={t} value="简体中文" />
        </Row>
        <Row t={t} title="登录时打开">
          <Switch t={t} on={login()} onChange={login.set} label="登录时打开" />
        </Row>
        <Row t={t} title="菜单栏图标" note="显示 Chief 状态和正在工作的 Worker 数。">
          <Switch t={t} on={menubar()} onChange={menubar.set} label="菜单栏图标" />
        </Row>
      </Section>
      <Section t={t} title="键盘">
        <For
          of={[
            ["快速问 Chief", "⌥ Space"],
            ["发送", "↵"],
            ["换行", "⇧ ↵"],
            ["命令面板", "⌘ K"],
            ["设置", "⌘ ,"],
          ]}
          by={([k]) => k}
        >
          {([k, v]) => (
            <Row t={t} title={k}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <For of={v.split(" ")} by="index">
                  {(part) => (
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
                      <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.text2 }}>{part}</Text>
                    </View>
                  )}
                </For>
              </View>
            </Row>
          )}
        </For>
      </Section>
    </View>
  );
}

function Models(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View>
      <Section t={t} title="模型" note="新对话的默认值。每个对话可以单独改。">
        <Row t={t} title="Chief" note="全局默认值。">
          <Select t={t} value="claude-opus-4 · 高" />
        </Row>
        <Row t={t} title="Manager" note="所有项目的默认值；项目设置可以覆盖。">
          <Select t={t} value="claude-sonnet-4 · 中" />
        </Row>
        <Row t={t} title="记忆提取" note="后台 Memory Worker。">
          <Select t={t} value="启发式（不调用模型）" />
        </Row>
      </Section>
    </View>
  );
}

function Providers(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View>
      <Section t={t} title="提供方" note="密钥存在服务器上，不经过这台设备。">
        <Row t={t} title="Magpie" note="本机网关 · 42 个模型">
          <Chip t={t} tone={t.work}>
            已连接
          </Chip>
        </Row>
        <Row t={t} title="Anthropic" note="API key · sk-ant-…3f2a">
          <Chip t={t} tone={t.work}>
            已连接
          </Chip>
        </Row>
        <Row t={t} title="OpenAI">
          <Press label="添加" style={{ height: 24, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
            <Text style={{ fontSize: 11, color: t.text }}>添加</Text>
          </Press>
        </Row>
      </Section>
    </View>
  );
}

function Workers(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const intents = [
    { name: "simple", runtime: "pi", model: "claude-sonnet-4", think: "中" },
    { name: "review", runtime: "codex", model: "gpt-5", think: "高" },
    { name: "docs", runtime: "pi", model: "claude-haiku-4", think: "低" },
  ];
  return (
    <View>
      <Section t={t} title="Intent" note="Manager 派 Run 时选一个 Intent，或直接指定 runtime 和模型。">
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", paddingHorizontal: 10, height: 28, alignItems: "center", backgroundColor: t.card2 }}>
            <For of={["名字", "Runtime", "模型", "思考"]} by="index">
              {(h, i) => (
                <Text style={{ flex: i === 0 ? 1 : 1.2, fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{h}</Text>
              )}
            </For>
          </View>
          <For of={intents} by={(it) => it.name}>
            {(it) => (
            <View style={{ flexDirection: "row", paddingHorizontal: 10, height: 32, alignItems: "center", borderTopWidth: 1, borderTopColor: t.line }}>
              <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 11, color: t.text }}>{it.name}</Text>
              <Text style={{ flex: 1.2, fontFamily: FONT_MONO, fontSize: 10.5, color: t.text2 }}>{it.runtime}</Text>
              <Text style={{ flex: 1.2, fontFamily: FONT_MONO, fontSize: 10.5, color: t.text2 }}>{it.model}</Text>
              <Text style={{ flex: 1.2, fontSize: 10.5, color: t.text2 }}>{it.think}</Text>
            </View>
            )}
          </For>
        </View>
        <Press label="新建 Intent" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" }}>
          <Icon name="plus" size={11} color={t.text2} />
          <Text style={{ fontSize: 11.5, color: t.text2 }}>新建 Intent</Text>
        </Press>
      </Section>
      <Section t={t} title="执行">
        <Row t={t} title="同时运行的 Worker" note="超过时排队。">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 13, color: t.text }}>3</Text>
            <View style={{ flexDirection: "row", gap: 3 }}>
              <For of={[0, 1, 2]} by="index">
                {(i) => <View style={{ width: 5, height: 14, borderRadius: 2, backgroundColor: t.work }} />}
              </For>
            </View>
          </View>
        </Row>
        <Row t={t} title="Seatbelt 沙箱" note="新项目的默认模式。每个项目可以在项目设置里改（D22）。">
          <Select t={t} value="workspace-write" />
        </Row>
      </Section>
    </View>
  );
}

function Server(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View>
      <Section t={t} title="服务器与设备" note="tailnet 就是凭据。撤销一台设备后，它需要重新配对。">
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 8, backgroundColor: t.card }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StatusDot tone="work" size={7} t={t} />
            <Text style={{ flex: 1, fontSize: 12.5, fontWeight: "bold", color: t.text }}>mac-studio</Text>
            <Chip t={t} tone={t.work}>
              18 ms
            </Chip>
          </View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.text2 }}>wss://mac-studio.tail3c1.ts.net:8787</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>Pi Server 1.1.0 · 已同步 11:06</Text>
            <Press label="重新连接" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
              <Text style={{ fontSize: 10.5, color: t.text }}>重新连接</Text>
            </Press>
          </View>
        </View>
      </Section>
      <Section t={t} title="已配对的设备">
        <For<readonly [string, string, boolean]>
          of={[
            ["MacBook Air", "这台设备 · 现在", true],
            ["iPhone", "上次在线 11:02", false],
            ["Web · mac-studio", "上次在线 昨天", false],
          ]}
          by={([name]) => name}
        >
          {([name, note, self]) => (
            <Row t={t} title={name} note={note}>
              {self ? (
                <Chip t={t}>本机</Chip>
              ) : (
                <Press label={`撤销 ${name}`} style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, justifyContent: "center" }} hover={{ backgroundColor: alpha(t.fail, 0.1) }}>
                  <Text style={{ fontSize: 10.5, color: t.fail }}>撤销</Text>
                </Press>
              )}
            </Row>
          )}
        </For>
      </Section>
      <Section t={t} title="本机缓存">
        <Row t={t} title="离线缓存" note="上限 200 MiB，按对话淘汰。">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: t.text2 }}>86 MiB</Text>
            <Press label="清除" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }}>
              <Text style={{ fontSize: 10.5, color: t.text }}>清除</Text>
            </Press>
          </View>
        </Row>
      </Section>
    </View>
  );
}

function Skills(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <Section t={t} title="技能" note="可复用的流程。新版本需要你批准。">
      <Row t={t} title="weekly-review" note="v3 · 已验证 4 次">
        <Chip t={t} tone={t.work}>
          已启用
        </Chip>
      </Row>
      <Row t={t} title="release-notes" note="v2 → v3 · 待批准">
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Press label="查看" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
            <Text style={{ fontSize: 10.5, color: t.text2 }}>查看</Text>
          </Press>
          <Press label="批准" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, backgroundColor: t.text, justifyContent: "center" }}>
            <Text style={{ fontSize: 10.5, fontWeight: "500", color: t.winSolid }}>批准</Text>
          </Press>
        </View>
      </Row>
    </Section>
  );
}

function Channels(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View>
      <Section t={t} title="渠道" note="每个渠道有自己的对话，共用同一份记忆。">
        <Row t={t} title="Telegram" note="@tian_chief_bot · 白名单 1 个 chat">
          <Chip t={t} tone={t.work}>
            已连接
          </Chip>
        </Row>
        <Row t={t} title="微信 · ClawBot" note="扫码登录，24 小时保活。">
          <Press label="扫码连接" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
            <Text style={{ fontSize: 10.5, color: t.text }}>扫码连接</Text>
          </Press>
        </Row>
        <Row t={t} title="Inbox 文件邮箱" note=".tian/inbox">
          <Chip t={t} tone={t.work}>
            启用
          </Chip>
        </Row>
      </Section>
    </View>
  );
}

function Improve(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const entries = [
    { kind: "issue", title: "重连后消息重复", note: "已修复 · Run #12", tone: t.work },
    { kind: "friction", title: "手机上看不全长表格", note: "可以提升为 Task", tone: t.wait },
    { kind: "idea", title: "锁屏显示 Run 进度", note: "可以提升为 Task", tone: t.text2 },
    { kind: "win", title: "截图直发省了三步", note: "来自 iPhone", tone: t.add },
  ];
  return (
    <Section t={t} title="改进日志" note="问题、摩擦、想法和成功经验。可以提升为 Task。">
      <For of={entries} by={(e) => e.title}>
        {(e) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.line }}>
            <Text style={{ width: 48, fontFamily: FONT_MONO, fontSize: 9, color: e.tone }}>{e.kind}</Text>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 11.5, color: t.text }}>{e.title}</Text>
              <Text style={{ fontSize: 9.5, color: t.text3 }}>{e.note}</Text>
            </View>
            <Text style={{ fontSize: 10.5, color: t.text2 }}>提升为 Task</Text>
          </View>
        )}
      </For>
    </Section>
  );
}

function Usage(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View>
      <Section t={t} title="用量" note="最近 26 周。">
        <For of={USAGE} by={(u) => u.model}>
          {(u) => (
          <View style={{ gap: 5, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.line }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 11, color: t.text }}>{u.model}</Text>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>{u.cost}</Text>
            </View>
            <Text style={{ fontSize: 10, color: t.text3 }}>{u.role}</Text>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: t.line2 }}>
              <View style={{ width: `${u.share * 100}%`, height: 4, borderRadius: 2, backgroundImage: "linear-gradient(90deg, #ffb86b, #ff6f91 55%, #8b7cff)" }} />
            </View>
          </View>
          )}
        </For>
        <View style={{ flexDirection: "row", paddingTop: 12 }}>
          <Text style={{ flex: 1, fontSize: 11, color: t.text3 }}>合计</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 13, color: t.text }}>$69.35</Text>
        </View>
      </Section>
    </View>
  );
}

export function Settings(props: { t: Theme; onClose: () => void }): JSX.Element {
  const t = props.t;
  const tab = signal("外观");
  const groups = [
    { group: "智能体", note: "属于账号", items: ["模型", "提供方", "Worker 与 Intent", "技能"] },
    { group: "个人", note: "只在这台设备", items: ["通用", "外观"] },
    { group: "运行", note: "属于服务器", items: ["服务器与设备", "渠道", "用量", "改进日志"] },
  ];
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: t.mode === "night" ? "rgba(3,4,8,0.62)" : "rgba(40,36,50,0.28)",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
      onPress={props.onClose}
    >
      <View
        onPress={() => {}}
        style={{
          width: 900,
          maxWidth: "92%",
          height: 620,
          maxHeight: "88%",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: t.line2,
          backgroundColor: t.winSolid,
          boxShadow: t.e4,
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        <View style={{ width: 228, backgroundColor: t.side, borderRightWidth: 1, borderRightColor: t.line, paddingTop: 18 }}>
          <View style={{ paddingHorizontal: 18, paddingBottom: 14, gap: 2 }}>
            <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 26, color: t.text }}>设置</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>Tian Agent 1.1.0 · 演示</Text>
          </View>
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 8, paddingBottom: 16 }} scrollbar={false}>
            <For of={groups} by={(g) => g.group}>
              {(g) => (
              <View style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ flex: 1, fontSize: 9.5, letterSpacing: 0.8, color: t.text3 }}>{g.group.toUpperCase()}</Text>
                  <Text style={{ fontSize: 8.5, color: t.text3 }}>{g.note}</Text>
                </View>
                <For of={g.items} by={(item) => item}>
                  {(item) => {
                  const active = tab() === item;
                  return (
                    <Press
                      label={item}
                      role="tab"
                      selected={active}
                      onPress={() => tab.set(item)}
                      style={{
                        height: 30,
                        paddingHorizontal: 10,
                        borderRadius: 7,
                        justifyContent: "center",
                        backgroundColor: active ? t.card2 : "transparent",
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                      hover={{ backgroundColor: t.card }}
                    >
                      <Text style={{ flex: 1, fontSize: 12, color: active ? t.text : t.text2 }}>{item}</Text>
                    </Press>
                  );
                }}
                </For>
              </View>
              )}
            </For>
          </Scroll>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ height: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 22 }}>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "bold", color: t.text }}>{tab()}</Text>
            <IconButton name="close" t={t} label="关闭设置" size={14} box={28} onPress={props.onClose} />
          </View>
          <View style={{ height: 1, backgroundColor: t.line }} />
          <Scroll style={{ flex: 1 }} contentStyle={{ padding: 22, paddingBottom: 40 }} scrollbar={false}>
            <View style={{ maxWidth: 620 }}>
              {tab() === "外观" ? <Appearance t={t} /> : null}
              {tab() === "通用" ? <General t={t} /> : null}
              {tab() === "模型" ? <Models t={t} /> : null}
              {tab() === "提供方" ? <Providers t={t} /> : null}
              {tab() === "Worker 与 Intent" ? <Workers t={t} /> : null}
              {tab() === "服务器与设备" ? <Server t={t} /> : null}
              {tab() === "用量" ? <Usage t={t} /> : null}
              {tab() === "渠道" ? <Channels t={t} /> : null}
              {tab() === "技能" ? <Skills t={t} /> : null}
              {tab() === "改进日志" ? <Improve t={t} /> : null}
            </View>
          </Scroll>
        </View>
      </View>
    </View>
  );
}
