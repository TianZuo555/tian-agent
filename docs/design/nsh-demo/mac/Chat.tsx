import { Scroll, type ScrollRef, Text, View, type JSX, effect, signal } from "nsh";
import { Input } from "nsh/base";
import { CONVS, PHASES, type ConvId } from "../data";
import { alpha, DAWN, FONT_DISPLAY, FONT_MONO, type Theme } from "../theme";
import { Avatar, Divider, For, Icon, IconButton, PhaseRail, Press, RailMini, StatusDot } from "../ui";

/* --------------------------------------------------------------- fragments */

function Head(props: { name: string; meta: string; t: Theme }): JSX.Element {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: "bold", color: props.t.text }}>{props.name}</Text>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: props.t.text3 }}>{props.meta}</Text>
    </View>
  );
}

function P(props: { t: Theme; children: JSX.Element | JSX.Element[] | string }): JSX.Element {
  return <Text style={{ fontSize: 14.5, lineHeight: 23, color: props.t.text }}>{props.children}</Text>;
}

function Mono(props: { t: Theme; children: string | number; size?: number; color?: string }): JSX.Element {
  return (
    <Text style={{ fontFamily: FONT_MONO, fontSize: props.size ?? 11.5, color: props.color ?? props.t.text3 }}>
      {String(props.children)}
    </Text>
  );
}

function Code(props: { t: Theme; children: string }): JSX.Element {
  return (
    <Text
      style={{
        fontFamily: FONT_MONO,
        fontSize: 12.5,
        color: props.t.text,
        backgroundColor: props.t.code,
        borderRadius: 3,
      }}
    >
      {" "}
      {props.children}{" "}
    </Text>
  );
}

function Card(props: { t: Theme; children: JSX.Element | JSX.Element[]; style?: object; glow?: boolean }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 14,
        padding: 14,
        gap: 12,
        boxShadow: t.glow && props.glow !== false ? t.rim : undefined,
        ...(props.style ?? {}),
      }}
    >
      {props.children}
    </View>
  );
}

/* ------------------------------------------------------------------- cards */

function RunCard(props: { t: Theme; onOpenDiff: () => void; branch?: string; stats?: [string, string][] }): JSX.Element {
  const t = props.t;
  const stats = props.stats ?? [
    ["文件", "4"],
    ["行", "+86 −23"],
    ["测试", "128/128"],
    ["用时", "9 分"],
  ];
  return (
    <Card t={t}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: alpha(t.work, 0.14),
            borderWidth: 1,
            borderColor: alpha(t.work, 0.35),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={12} color={t.work} width={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "bold", color: t.text }}>Run #12 · 修复重连后消息重复</Text>
          <Mono t={t} size={10.5}>
            {props.branch ?? "fix/ws-dedupe → main · 第 2 次尝试"}
          </Mono>
        </View>
      </View>

      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 }}>
        <For of={stats} by={([label]) => label}>
          {([label, value]) => (
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 10, color: t.text3 }}>{label}</Text>
              {label === "行" ? (
                <View style={{ flexDirection: "row", gap: 4 }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 13, color: t.add }}>+86</Text>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 13, color: t.del }}>−23</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 13, fontWeight: "bold", color: t.text }}>{value}</Text>
              )}
            </View>
          )}
        </For>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Press
          onPress={props.onOpenDiff}
          label="查看改动"
          style={{
            height: 28,
            paddingHorizontal: 10,
            borderRadius: 7,
            backgroundColor: t.text,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="diff" size={13} color={t.mode === "night" ? "#111217" : "#f4f2ed"} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: t.mode === "night" ? "#111217" : "#f4f2ed" }}>查看改动</Text>
        </Press>
        <For of={["Land", "Ship"]} by={(label) => label}>
          {(label) => (
            <Press label={label} style={{ height: 28, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
              <Text style={{ fontSize: 12, color: t.text }}>{label}</Text>
            </Press>
          )}
        </For>
        <View style={{ flex: 1 }} />
        <Press label="Discard" style={{ height: 28, paddingHorizontal: 11, borderRadius: 7, borderWidth: 1, borderColor: alpha(t.fail, 0.5), justifyContent: "center" }} hover={{ backgroundColor: alpha(t.fail, 0.1) }}>
          <Text style={{ fontSize: 12, color: t.fail }}>Discard</Text>
        </Press>
      </View>
    </Card>
  );
}

function HandoffCard(props: { t: Theme; onGoto: () => void }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        padding: 11,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
      }}
    >
      <Avatar who="chief" size={24} t={t} halo={false} orbit={false} />
      <Icon name="chevron-right" size={11} color={t.text3} />
      <Avatar who="atlas" size={26} t={t} working />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: 0.4, color: t.text3 }}>委派 · tian-agent</Text>
        <Text style={{ fontSize: 12.5, fontWeight: "500", color: t.text }}>修复 WebSocket 重连后消息重复</Text>
        <Text style={{ fontSize: 10.5, color: t.text3 }}>附 1 张截图 · 完成后向 Chief 汇报</Text>
      </View>
      <Press
        onPress={props.onGoto}
        label="打开 Atlas"
        style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
        hover={{ opacity: 0.75 }}
      >
        <Text style={{ fontSize: 11.5, color: t.text2 }}>打开 Atlas</Text>
        <Icon name="chevron-right" size={11} color={t.text3} />
      </Press>
    </View>
  );
}

function MiniRunLine(props: { t: Theme; id: string; title: string; state: string; at: number; who: "atlas" | "juno" }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Avatar who={props.who} size={20} t={t} orbit={false} halo={false} />
      <Text style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: t.text2 }}>{props.id}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: t.text, numberOfLines: 1 }}>
        {props.title}
      </Text>
      <Text style={{ fontSize: 11.5, color: t.text2 }}>{props.state}</Text>
      <RailMini at={props.at} t={t} />
    </View>
  );
}

function ScreenshotCard(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        width: 210,
        height: 132,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.line2,
        backgroundColor: t.mode === "night" ? "#0d0f15" : "#fffdf9",
        padding: 10,
        gap: 6,
        boxShadow: t.glow ? t.e3 : undefined,
      }}
    >
      <View style={{ flexDirection: "row", gap: 3 }}>
        <For of={[0, 1, 2]} by="index">
          {(i) => <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.text3 }} />}
        </For>
      </View>
      <View style={{ flex: 1, gap: 6, paddingTop: 2 }}>
        <View style={{ height: 8, width: "72%", borderRadius: 4, backgroundColor: alpha(t.text, 0.14) }} />
        <View style={{ height: 8, width: "88%", borderRadius: 4, backgroundColor: alpha(t.text, 0.1) }} />
        <View style={{ height: 8, width: "88%", borderRadius: 4, backgroundColor: alpha(t.text, 0.1) }} />
        <View style={{ height: 8, width: "34%", borderRadius: 4, backgroundColor: alpha(t.text, 0.14) }} />
      </View>
      <View
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 5,
          backgroundColor: alpha(t.fail, 0.18),
          borderWidth: 1,
          borderColor: alpha(t.fail, 0.4),
        }}
      >
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.fail }}>×2 同一条</Text>
      </View>
    </View>
  );
}

function UserBubble(props: { t: Theme; text: string; meta: string; shot?: boolean }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ alignItems: "flex-end", gap: 6 }}>
      {props.shot ? <ScreenshotCard t={t} /> : null}
      <View
        style={{
          maxWidth: 460,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 20,
          borderBottomRightRadius: 6,
          backgroundColor: t.bubble,
        }}
      >
        <Text style={{ fontSize: 14.5, lineHeight: 22, color: t.bubbleText }}>{props.text}</Text>
      </View>
      <Mono t={t} size={10}>
        {props.meta}
      </Mono>
    </View>
  );
}

function PulseCard(props: { t: Theme; id: string; title: string; at: number; elapsed: string; detail: string }): JSX.Element {
  const t = props.t;
  return (
    <Card t={t}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Avatar who="atlas" size={20} t={t} orbit={false} halo={false} />
        <Text style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: t.text2 }}>{props.id}</Text>
        <Text style={{ flex: 1, fontSize: 13, color: t.text, numberOfLines: 1 }}>
          {props.title}
        </Text>
        <Mono t={t} size={10.5}>
          {props.elapsed}
        </Mono>
      </View>
      <PhaseRail steps={4} at={props.at} labels={PHASES} t={t} width={300} />
      <Text style={{ fontSize: 12, color: t.text2 }}>{props.detail}</Text>
    </Card>
  );
}

function CodeBlock(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.code }}>
      <View
        style={{
          height: 28,
          paddingHorizontal: 10,
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: 1,
          borderBottomColor: t.line,
        }}
      >
        <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10, color: t.text3 }}>ts · client.ts:139</Text>
        <IconButton name="copy" t={t} label="复制代码" size={12} box={20} />
      </View>
      <View style={{ padding: 10, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: 3 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#ff8a80" }}>private</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#ffc25c" }}>onFrame</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>(frame: ServerFrame) {"{"}</Text>
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text3 }}>  // replayed frames reach emit() twice</Text>
        <View style={{ flexDirection: "row", gap: 3 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#ff8a80" }}>this</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>.</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#ffc25c" }}>emit</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>(frame.event);</Text>
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>{"}"}</Text>
      </View>
    </View>
  );
}

function DecisionCard(props: { t: Theme; choice: string; setChoice: (v: string) => void; decided: boolean; onDecide: () => void }): JSX.Element {
  const t = props.t;
  const options = [
    { id: "online", name: "在线迁移", tag: "推荐", note: "不停服 · 约 20 分钟 · 双写期间多占 30% 存储" },
    { id: "offline", name: "停机迁移", note: "停服约 3 分钟 · 步骤更少 · 期间手机端无法同步" },
  ];
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: alpha(t.wait, 0.45),
        backgroundColor: alpha(t.wait, t.mode === "night" ? 0.07 : 0.09),
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: 0.5, color: t.wait }}>需要你决定 · 阻塞</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 11, color: t.text3 }}>Juno · healthapp</Text>
      </View>
      <Text style={{ fontSize: 14, fontWeight: "bold", color: t.text }}>数据库迁移方式</Text>
      <Text style={{ fontSize: 11.5, color: t.text2 }}>批准后，Juno 派 1 个 Worker 执行。拒绝后，这个操作不会再被提出。</Text>
      <For of={options} by={(o) => o.id}>
        {(o) => {
        const active = props.choice === o.id;
        return (
          <Press
            label={o.name}
            onPress={() => props.setChoice(o.id)}
            style={{
              borderRadius: 10,
              borderWidth: 1,
              borderColor: active ? alpha(t.work, 0.55) : t.line,
              backgroundColor: active ? alpha(t.work, 0.09) : t.card,
              padding: 10,
              gap: 2,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  borderWidth: active ? 4 : 1,
                  borderColor: active ? t.work : t.line2,
                }}
              />
              <Text style={{ fontSize: 13, fontWeight: "500", color: t.text }}>{o.name}</Text>
              {o.tag ? (
                <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: alpha(t.work, 0.16) }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.work }}>{o.tag}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 11, color: t.text2, paddingLeft: 18 }}>{o.note}</Text>
          </Press>
        );
      }}
      </For>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Press
          onPress={props.onDecide}
          label="批准所选"
          style={{
            height: 28,
            paddingHorizontal: 12,
            borderRadius: 7,
            backgroundColor: props.decided ? alpha(t.work, 0.2) : t.text,
            justifyContent: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Icon name="check" size={12} color={props.decided ? t.work : t.mode === "night" ? "#111217" : "#f4f2ed"} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: props.decided ? t.work : t.mode === "night" ? "#111217" : "#f4f2ed" }}>
            {props.decided ? "已批准 · 已派 Worker" : "批准所选"}
          </Text>
        </Press>
        <Press label="再问问" style={{ height: 28, paddingHorizontal: 12, borderRadius: 7, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }}>
          <Text style={{ fontSize: 12, color: t.text }}>再问问</Text>
        </Press>
        <Press label="拒绝" style={{ height: 28, paddingHorizontal: 12, borderRadius: 7, justifyContent: "center" }}>
          <Text style={{ fontSize: 12, color: t.text3 }}>拒绝</Text>
        </Press>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- composer */

export function Composer(props: {
  t: Theme;
  conv: ConvId;
  placeholder: string;
  onSend: (text: string) => void;
  attachment?: boolean;
  onRemoveAttachment?: () => void;
}): JSX.Element {
  const t = props.t;
  const draft = signal("");
  const send = () => {
    const text = draft().trim();
    if (!text) return;
    props.onSend(text);
    draft.set("");
  };
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 32,
        paddingBottom: 22,
        paddingTop: 26,
        backgroundImage: `linear-gradient(180deg, ${alpha(t.winSolid, 0)} 0%, ${t.winSolid} 36%)`,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
          borderRadius: 22,
          borderWidth: 1,
          borderColor: t.line2,
          backgroundColor: t.card,
          boxShadow: t.glow ? `${t.rimStrong}, ${t.e3}` : t.e3,
          backdropFilter: t.glow ? "blur(20px)" : undefined,
        }}
      >
        {props.attachment ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              paddingHorizontal: 12,
              paddingTop: 10,
            }}
          >
            <View
              style={{
                width: 34,
                height: 28,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: t.line2,
                backgroundColor: alpha(t.text, 0.06),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="image" size={14} color={t.text2} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 12, color: t.text }}>刚截的图 · 1 分钟前 · 1170 × 2532</Text>
              <Text style={{ fontSize: 10, color: t.text3 }}>只提示，不自动上传</Text>
            </View>
            <Press label="附加" style={{ height: 24, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
              <Text style={{ fontSize: 11, color: t.text }}>附加</Text>
            </Press>
            <IconButton name="close" t={t} label="移除截图" size={12} box={24} onPress={props.onRemoveAttachment} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
          <IconButton name="clip" t={t} label="添加附件" size={16} box={30} />
          <IconButton name="sliders" t={t} label="对话设置" size={16} box={30} />
          <Input
            value={draft()}
            onChange={(e) => draft.set(e.value)}
            onSubmit={() => send()}
            submitBehavior="submit"
            placeholder={props.placeholder}
            style={{
              flex: 1,
              height: 34,
              fontSize: 14.5,
              color: t.text,
              placeholderColor: t.text3,
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: t.text3 }}>claude-opus-4 · 高</Text>
            <Icon name="chevron-down" size={10} color={t.text3} />
          </View>
          <Press
            label="发送"
            onPress={send}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundImage: DAWN,
              alignItems: "center",
              justifyContent: "center",
            }}
            hover={{ opacity: 0.9 }}
          >
            <Icon name="arrow-up" size={17} color="#fff" width={2} />
          </Press>
        </View>
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- panes */

function TableCard(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const rows = [
    ["tian-agent", "Atlas", "空闲", "—"],
    ["healthapp", "Juno", "等你", "迁移方式"],
    ["d2r-mobile", "Vega", "空闲", "—"],
  ];
  return (
    <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, overflow: "hidden", marginTop: 4 }}>
      <View style={{ flexDirection: "row", backgroundColor: t.card2, paddingVertical: 6, paddingHorizontal: 8 }}>
        <For of={["项目", "Manager", "状态", "下一步"]} by="index">
          {(h, i) => (
            <Text style={{ flex: i === 0 ? 1.2 : 1, fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{h}</Text>
          )}
        </For>
      </View>
      <For of={rows} by={(r) => r[0]}>
        {(r) => (
          <View style={{ flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: t.line }}>
            <Text style={{ flex: 1.2, fontFamily: FONT_MONO, fontSize: 11, color: t.text2 }}>{r[0]}</Text>
            <Text style={{ flex: 1, fontSize: 11.5, color: t.text }}>{r[1]}</Text>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}>
              <StatusDot tone={r[2] === "等你" ? "wait" : "work"} size={5} t={t} />
              <Text style={{ fontSize: 11.5, color: t.text2 }}>{r[2]}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 11.5, color: t.text3 }}>{r[3]}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

function ChiefPane(props: { t: Theme; sent: { text: string; time: string }[]; onGoto: (id: ConvId) => void; onOpenDiff: () => void }): JSX.Element {
  const t = props.t;
  return (
    <>
      <Divider t={t} label="今天 · 11 月 6 日 周五" />
      <View style={{ gap: 8 }}>
        <Head name="Chief" meta="09:00 · 主动" t={t} />
        <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 24, lineHeight: 30, color: t.text }}>早上好，Tian。</Text>
        <P t={t}>今天有三件事值得你看一眼：</P>
        <View style={{ gap: 3, paddingLeft: 2 }}>
          <Text style={{ fontSize: 14.5, lineHeight: 23, color: t.text }}>
            <Text style={{ color: t.text3 }}>1.  </Text>
            <Text style={{ fontWeight: "bold" }}>Atlas</Text> 昨晚完成了 <Code t={t}>Run #11</Code>，已经 Land 到 <Code t={t}>main</Code>。
          </Text>
          <Text style={{ fontSize: 14.5, lineHeight: 23, color: t.text }}>
            <Text style={{ color: t.text3 }}>2.  </Text>
            <Text style={{ fontWeight: "bold" }}>Juno</Text> 在等你决定 healthapp 的数据库迁移方式。
          </Text>
          <Text style={{ fontSize: 14.5, lineHeight: 23, color: t.text }}>
            <Text style={{ color: t.text3 }}>3.  </Text>
            目标「每周训练三次」本周进度 <Text style={{ fontWeight: "bold" }}>2 / 3</Text>，周日前还差一次。
          </Text>
        </View>
        <TableCard t={t} />
      </View>

      <UserBubble t={t} shot text="手机上收到的消息重复了，截图在这。让 Atlas 看一下。" meta="10:24 · iPhone" />

      <View style={{ gap: 8 }}>
        <Head name="Chief" meta="10:25" t={t} />
        <P t={t}>
          看到了：截图里同一条消息出现了两次，时间相同。这像是重连后服务端重放了事件，客户端没有去重。我把它交给 Atlas。
        </P>
        <HandoffCard t={t} onGoto={() => props.onGoto("atlas")} />
      </View>

      <View style={{ gap: 8 }}>
        <Head name="Chief" meta="10:42 · Atlas 汇报" t={t} />
        <P t={t}>
          Atlas 汇报：<Code t={t}>Run #12</Code> 完成，测试全部通过。根因是 resume 时客户端没有按 <Code t={t}>messageId</Code> 去重。改动等你审阅。
        </P>
        <RunCard t={t} onOpenDiff={props.onOpenDiff} />
      </View>

      <View style={{ gap: 8 }}>
        <Head name="Chief" meta="10:58" t={t} />
        <P t={t}>Atlas 顺手开了两个 Run，补测试和文档。只看状态：</P>
        <Card t={t} style={{ gap: 10 }}>
          <MiniRunLine t={t} id="#13" title="断网重连测试" state="验证中 · 第 2 次" at={2} who="atlas" />
          <MiniRunLine t={t} id="#14" title="更新协议文档" state="理解中" at={0} who="atlas" />
        </Card>
      </View>

      <View style={{ gap: 8 }}>
        <Head name="Chief" meta="11:06 · 输出中" t={t} />
        <Text style={{ fontSize: 14.5, lineHeight: 23, color: t.text }}>
          另外，Juno 在等你决定。healthapp 的数据库迁移有两种方式：在线迁移不停服，但要 20 分钟；停机迁移只要 3 分钟，会中断同步。现在是工作日白天，我建议在线迁移。
          <Text style={{ color: t.work }}>▍</Text>
        </Text>
        <View style={{ borderLeftWidth: 2, borderLeftColor: t.line2, paddingLeft: 12 }}>
          <Text style={{ fontSize: 13.5, lineHeight: 22, color: t.text2 }}>选好之后，Juno 会直接派 Worker 执行，结束后我再告诉你。</Text>
        </View>
        <Press
          onPress={() => props.onGoto("juno")}
          label="去 Juno 那里决定"
          style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
          hover={{ opacity: 0.75 }}
        >
          <Text style={{ fontSize: 12.5, color: t.text2 }}>去 Juno 那里决定</Text>
          <Icon name="chevron-right" size={11} color={t.text3} />
        </Press>
      </View>

      <For of={props.sent} by={(m) => m.time + m.text}>
        {(m) => <UserBubble t={t} text={m.text} meta={m.time} />}
      </For>
    </>
  );
}

function AtlasPane(props: { t: Theme; sent: { text: string; time: string }[]; onOpenDiff: () => void }): JSX.Element {
  const t = props.t;
  return (
    <>
      <Divider t={t} label="Chief 委派 · 10:25" />
      <View style={{ gap: 8 }}>
        <Head name="Atlas" meta="10:26" t={t} />
        <P t={t}>
          收到。我读了 <Code t={t}>src/service/client.ts</Code> 的重连逻辑：resume 时服务端重放 cursor 之后的事件，客户端没有按{" "}
          <Code t={t}>messageId</Code> 去重。关键在这里：
        </P>
        <CodeBlock t={t} />
        <P t={t}>
          我拆成一个 Run 修复，intent 用 <Code t={t}>simple</Code>。
        </P>
      </View>

      <RunCard t={t} onOpenDiff={props.onOpenDiff} branch="fix/ws-dedupe → main · pi · claude-sonnet-4 · intent simple" />

      <UserBubble t={t} text="再开一个 Run 补测试，覆盖断网 30 秒以上的情况。协议文档也顺手更新。" meta="10:44 · Mac" />

      <View style={{ gap: 8 }}>
        <Head name="Atlas" meta="10:45" t={t} />
        <P t={t}>
          好。<Code t={t}>#13</Code> 补测试，intent <Code t={t}>review</Code>；<Code t={t}>#14</Code> 更新{" "}
          <Code t={t}>docs/spec/protocol.md</Code> 的 resume 说明。
        </P>
      </View>

      <PulseCard t={t} id="#13" title="断网 30 秒以上的重连测试" at={2} elapsed="04:12" detail="正在跑测试 · 第 2 次尝试" />
      <PulseCard t={t} id="#14" title="更新协议文档" at={0} elapsed="00:38" detail="理解中 · 读取 spec/protocol.md" />

      <For of={props.sent} by={(m) => m.time + m.text}>
        {(m) => <UserBubble t={t} text={m.text} meta={m.time} />}
      </For>
    </>
  );
}

function JunoPane(props: { t: Theme; sent: { text: string; time: string }[] }): JSX.Element {
  const t = props.t;
  const choice = signal("online");
  const decided = signal(false);
  return (
    <>
      <Divider t={t} label="今天 · 10:58" />
      <View style={{ gap: 8 }}>
        <Head name="Juno" meta="10:58" t={t} />
        <P t={t}>
          <Code t={t}>workouts</Code> 表要拆出 <Code t={t}>sets</Code>，当前 41 万行。两种方式都能做，差别在停服时间：
        </P>
        <DecisionCard t={t} choice={choice()} setChoice={choice.set} decided={decided()} onDecide={() => decided.set(true)} />
      </View>
      <For of={props.sent} by={(m) => m.time + m.text}>
        {(m) => <UserBubble t={t} text={m.text} meta={m.time} />}
      </For>
    </>
  );
}

function VegaPane(props: { t: Theme; sent: { text: string; time: string }[] }): JSX.Element {
  const t = props.t;
  const suggestions = ["检查依赖更新", "跑一遍测试", "总结本周改动"];
  return (
    <>
      <View style={{ alignItems: "center", paddingTop: 80, gap: 10 }}>
        <Avatar who="vega" size={64} t={t} />
        <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 26, color: t.text }}>Vega 在待命</Text>
        <Text style={{ fontSize: 13, color: t.text2 }}>d2r-mobile 没有进行中的 Run。上次汇报是 3 小时前。</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <For of={suggestions} by={(s) => s}>
            {(s) => (
            <Press
              label={s}
              style={{
                height: 28,
                paddingHorizontal: 11,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: t.line,
                backgroundColor: t.card,
                justifyContent: "center",
              }}
              hover={{ backgroundColor: t.card2 }}
            >
              <Text style={{ fontSize: 12, color: t.text2 }}>{s}</Text>
            </Press>
            )}
          </For>
        </View>
      </View>
      <For of={props.sent} by={(m) => m.time + m.text}>
        {(m) => <UserBubble t={t} text={m.text} meta={m.time} />}
      </For>
    </>
  );
}

/* ----------------------------------------------------------------- chat */

export function Chat(props: {
  t: Theme;
  conv: ConvId;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onOpenDiff: () => void;
  onGoto: (id: ConvId) => void;
}): JSX.Element {
  const t = props.t;
  const info = () => CONVS.find((c) => c.id === props.conv) ?? CONVS[0];
  const sent = signal<Record<ConvId, { text: string; time: string }[]>>({ chief: [], atlas: [], juno: [], vega: [] });
  const attachment = signal(true);
  let stream: ScrollRef | null = null;
  effect(() => {
    const id = setTimeout(() => stream?.scrollToEnd({ animated: false }), 260);
    return () => clearTimeout(id);
  });
  const send = (text: string) => {
    sent.update((prev) => ({ ...prev, [props.conv]: [...prev[props.conv], { text, time: "11:08 · 演示" }] }));
    setTimeout(() => stream?.scrollToEnd({ animated: true }), 120);
  };
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        style={{
          height: 64,
          flexDirection: "row",
          alignItems: "center",
          gap: 11,
          paddingLeft: 24,
          paddingRight: 14,
          borderBottomWidth: 1,
          borderBottomColor: t.line,
          backgroundColor: t.winSolid,
        }}
      >
        <Avatar who={info().who} size={30} t={t} working={info().tone === "work"} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "500", color: t.text }}>{info().name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <StatusDot tone={info().tone} size={5} t={t} />
            <Text style={{ fontSize: 11.5, color: t.text2, numberOfLines: 1 }}>
              {info().header}
            </Text>
          </View>
        </View>
        <IconButton name="search" t={t} label="搜索对话" size={15} box={30} />
        <IconButton name="panel" t={t} label="切换检查器" size={16} box={30} active={props.inspectorOpen} onPress={props.onToggleInspector} />
      </View>

      <Scroll ref={(node) => (stream = node)} style={{ flex: 1 }} contentStyle={{ paddingTop: 26, paddingBottom: 160 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 720,
            alignSelf: "center",
            paddingHorizontal: 32,
            flexDirection: "column",
            gap: 22,
          }}
        >
          {props.conv === "chief" ? <ChiefPane t={t} sent={sent().chief} onGoto={props.onGoto} onOpenDiff={props.onOpenDiff} /> : null}
          {props.conv === "atlas" ? <AtlasPane t={t} sent={sent().atlas} onOpenDiff={props.onOpenDiff} /> : null}
          {props.conv === "juno" ? <JunoPane t={t} sent={sent().juno} /> : null}
          {props.conv === "vega" ? <VegaPane t={t} sent={sent().vega} /> : null}
        </View>
      </Scroll>

      <Composer
        t={t}
        conv={props.conv}
        placeholder={info().placeholder}
        onSend={send}
        attachment={props.conv === "chief" && attachment()}
        onRemoveAttachment={() => attachment.set(false)}
      />
    </View>
  );
}
