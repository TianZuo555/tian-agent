import { Scroll, Text, View, type JSX } from "nsh";
import { KIT_STATES, KIT_SURFACES, PHASES } from "../data";
import { alpha, DAWN, FONT_DISPLAY, FONT_MONO, type Theme } from "../theme";
import { Avatar, Chip, For, Icon, PhaseRail, Press, Spinner, StatusDot } from "../ui";

function Section(props: { t: Theme; title: string; sub: string; note?: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
        <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 27, color: t.text }}>{props.title}</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{props.sub}</Text>
      </View>
      {props.note ? <Text style={{ fontSize: 12, lineHeight: 18, color: t.text2, maxWidth: 720 }}>{props.note}</Text> : null}
      {props.children}
    </View>
  );
}

function Card(props: { t: Theme; children: JSX.Element | JSX.Element[]; style?: object }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 14,
        backgroundColor: t.card,
        padding: 14,
        gap: 10,
        ...(props.style ?? {}),
      }}
    >
      {props.children}
    </View>
  );
}

function ElevationStage(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const layers = [
    { label: "卡片 · L2", spec: "rim + 无投影", x: 240, y: 108, w: 140, h: 82 },
    { label: "浮层 · L3", spec: "glass + e3", x: 520, y: 52, w: 150, h: 88 },
    { label: "遮罩 · L4", spec: "glass + e4", x: 790, y: 106, w: 150, h: 92 },
  ];
  return (
    <View
      style={{
        height: 220,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: t.line,
        backgroundImage: t.glow
          ? `radial-gradient(circle at 18% 16%, ${alpha("#ffb86b", 0.30)}, rgba(0,0,0,0) 42%), radial-gradient(circle at 78% 88%, ${alpha("#ff6f91", 0.26)}, rgba(0,0,0,0) 55%), radial-gradient(circle at 60% 10%, ${alpha("#8b7cff", 0.18)}, rgba(0,0,0,0) 50%), linear-gradient(140deg, #0b1022, #101321 60%, #0a0b12)`
          : undefined,
        backgroundColor: t.glow ? undefined : t.wall,
      }}
    >
      <View style={{ position: "absolute", left: 24, top: 22 }}>
        <Avatar who="chief" size={44} t={t} working />
      </View>
      <For of={layers} by={(l) => l.label}>
        {(l) => (
          <View
            style={{
              position: "absolute",
              left: l.x,
              top: l.y,
              width: l.w,
              height: l.h,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.glassLine,
              backgroundColor: t.glass,
              backdropFilter: t.glow ? "blur(24px)" : undefined,
              boxShadow: t.glow ? (l.label.includes("L4") ? t.e4 : l.label.includes("L3") ? t.e3 : t.rim) : undefined,
              padding: 12,
              justifyContent: "center",
              gap: 2,
            }}
          >
            <Text style={{ fontSize: 12, color: t.text }}>{l.label}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>{l.spec}</Text>
          </View>
        )}
      </For>
      <Text style={{ position: "absolute", left: 16, bottom: 12, fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>
        移动指针，或聚焦光源后用方向键移动
      </Text>
    </View>
  );
}

function Surfaces(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <For of={KIT_SURFACES} by={(s) => s.level}>
        {(s) => (
          <View
            style={{
              flex: 1,
              minHeight: 118,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: s.level === "L0" ? t.line2 : t.line,
              backgroundColor: s.level === "L0" ? "transparent" : s.level === "L2" ? t.card : t.glass,
              padding: 11,
              gap: 4,
              justifyContent: "flex-end",
            }}
          >
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>{s.level}</Text>
            <Text style={{ fontSize: 12.5, color: t.text }}>{s.name}</Text>
            <Text style={{ fontSize: 9.5, lineHeight: 14, color: t.text2 }}>{s.use}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>{s.spec}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

function Identities(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const cast = [
    { who: "chief" as const, name: "Chief · 光球", note: "唯一的彩色渐变。转速表示状态：慢转是空闲，快转加虚线光环是思考或工作，琥珀色光环是等你。" },
    { who: "atlas" as const, name: "Manager · 行星", note: "每个项目一种色相。名字在注册项目时给出。颜色只用于身份，不用于状态。" },
    { who: "juno" as const, name: "Worker · 卫星", note: "Worker 是 Manager 的卫星。你看得到它在转，看不到它的日志。" },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <For of={cast} by={(c) => c.who}>
        {(c) => (
          <Card t={t} style={{ flex: 1 }}>
            <Avatar who={c.who} size={48} t={t} working={c.who === "chief"} />
            <Text style={{ fontSize: 12.5, fontWeight: "bold", color: t.text }}>{c.name}</Text>
            <Text style={{ fontSize: 10, lineHeight: 15, color: t.text2 }}>{c.note}</Text>
          </Card>
        )}
      </For>
    </View>
  );
}

function States(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <For of={KIT_STATES} by={(s) => s.state}>
        {(s) => (
          <View
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              gap: 6,
              backgroundColor: t.card,
            }}
          >
            <Avatar who={s.who} size={36} t={t} working={s.tone === "work"} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <StatusDot tone={s.tone} t={t} size={4} />
              <Text style={{ fontSize: 10, color: t.text2 }}>{s.label}</Text>
            </View>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: t.text3 }}>{s.state}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

function Buttons(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Press label="查看改动" style={{ height: 32, paddingHorizontal: 13, borderRadius: 8, backgroundColor: t.text, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="diff" size={13} color={t.winSolid} />
          <Text style={{ fontSize: 12, fontWeight: "500", color: t.winSolid }}>查看改动</Text>
        </Press>
        <Press label="Land" style={{ height: 32, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: t.line2, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
          <Text style={{ fontSize: 12, color: t.text }}>Land</Text>
        </Press>
        <Press label="Ship" style={{ height: 32, paddingHorizontal: 14, borderRadius: 8, justifyContent: "center" }} hover={{ backgroundColor: t.card2 }}>
          <Text style={{ fontSize: 12, color: t.text2 }}>Ship</Text>
        </Press>
        <Press label="Discard" style={{ height: 32, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: alpha(t.fail, 0.5), justifyContent: "center" }} hover={{ backgroundColor: alpha(t.fail, 0.1) }}>
          <Text style={{ fontSize: 12, color: t.fail }}>Discard</Text>
        </Press>
        <Press label="发送" style={{ width: 32, height: 32, borderRadius: 16, backgroundImage: DAWN, alignItems: "center", justifyContent: "center" }}>
          <Icon name="arrow-up" size={16} color="#fff" width={2} />
        </Press>
        <Spinner t={t} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View
          style={{
            flex: 1,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: t.line2,
            backgroundColor: t.card,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
          }}
        >
          <Icon name="clip" size={14} color={t.text3} />
          <Text style={{ flex: 1, fontSize: 12, color: t.text3 }}>和 Chief 说…</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>claude-opus-4 · 高</Text>
          <Icon name="chevron-down" size={9} color={t.text3} />
        </View>
        <View
          style={{
            flex: 1,
            height: 40,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.code,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
          }}
        >
          <Icon name="search" size={13} color={t.text3} />
          <Text style={{ flex: 1, fontSize: 12, color: t.text3 }}>搜索或跳转</Text>
          <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: t.line }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>⌘K</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 34, height: 20, borderRadius: 10, padding: 2, backgroundColor: t.work }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: t.mode === "night" ? "#08110f" : "#fff", alignSelf: "flex-end" }} />
          </View>
          <Text style={{ fontSize: 11, color: t.text2 }}>开关</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: t.work, alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={9} color={t.mode === "night" ? "#08110f" : "#fff"} width={2.2} />
          </View>
          <Text style={{ fontSize: 11, color: t.text2 }}>复选</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 3, padding: 2, borderRadius: 8, backgroundColor: t.mode === "night" ? "rgba(0,0,0,0.3)" : "rgba(20,20,40,0.06)" }}>
          <View style={{ paddingHorizontal: 9, height: 22, borderRadius: 6, backgroundColor: t.text, justifyContent: "center" }}>
            <Text style={{ fontSize: 10.5, color: t.winSolid }}>统一</Text>
          </View>
          <View style={{ paddingHorizontal: 9, height: 22, borderRadius: 6, justifyContent: "center" }}>
            <Text style={{ fontSize: 10.5, color: t.text2 }}>并排</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 90, height: 3, borderRadius: 2, backgroundColor: t.line2 }}>
            <View style={{ width: 62, height: 3, borderRadius: 2, backgroundColor: t.text2 }} />
            <View style={{ position: "absolute", left: 56, top: -4.5, width: 12, height: 12, borderRadius: 6, backgroundColor: t.text }} />
          </View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>70</Text>
        </View>
      </View>
    </View>
  );
}

function Messages(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const diff = [
    { n: "138", text: "private onFrame(frame) {", kind: "ctx" },
    { n: "139", text: "  this.emit(frame.event);", kind: "del" },
    { n: "139", text: "  const id = frame.event.messageId;", kind: "add" },
    { n: "140", text: "  if (id && this.seen.has(id)) return;", kind: "add" },
    { n: "141", text: "  this.emit(frame.event);", kind: "add" },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <Card t={t} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Avatar who="chief" size={22} t={t} working />
          <Text style={{ fontSize: 12, fontWeight: "bold", color: t.text }}>Chief</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>11:06 · 输出中</Text>
        </View>
        <Text style={{ fontSize: 12.5, lineHeight: 19, color: t.text }}>
          Atlas 汇报：Run #12 完成，测试全部通过。根因是 resume 时客户端没有按 messageId 去重。改动等你审阅。
          <Text style={{ color: t.work }}>▍</Text>
        </Text>
        <View style={{ alignSelf: "flex-end", maxWidth: 240, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 14, borderBottomRightRadius: 5, backgroundColor: t.bubble }}>
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: t.bubbleText }}>消息重复了，让 Atlas 看一下</Text>
        </View>
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 9, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: alpha(t.work, 0.16), alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={9} color={t.work} width={2} />
            </View>
            <Text style={{ flex: 1, fontSize: 11, fontWeight: "bold", color: t.text }}>Run #12 · 修复重连后消息重复</Text>
          </View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>4 个文件 · +86 −23 · 128/128</Text>
          <PhaseRail t={t} steps={4} at={2} labels={PHASES} width={260} />
        </View>
      </Card>
      <Card t={t} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="diff" size={11} color={t.text2} />
          <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 9, color: t.text2 }}>src/service/client.ts</Text>
          <Chip t={t} tone={t.add}>
            +86
          </Chip>
          <Chip t={t} tone={t.del}>
            −23
          </Chip>
        </View>
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: t.line, backgroundColor: t.code, overflow: "hidden" }}>
          <For of={diff} by="index">
            {(r) => (
              <View style={{ flexDirection: "row", height: 17, backgroundColor: r.kind === "add" ? t.addBg : r.kind === "del" ? t.delBg : "transparent" }}>
                <Text style={{ width: 24, textAlign: "right", paddingRight: 4, fontFamily: FONT_MONO, fontSize: 8, lineHeight: 17, color: t.text3 }}>{r.n}</Text>
                <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 8, lineHeight: 17, color: r.kind === "add" ? t.add : r.kind === "del" ? t.del : t.text2, numberOfLines: 1 }}>
                  {r.text}
                </Text>
              </View>
            )}
          </For>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Avatar who="atlas" size={16} t={t} orbit={false} halo={false} />
          <Text style={{ flex: 1, fontSize: 9.5, lineHeight: 14, color: t.text2 }}>
            <Text style={{ fontWeight: "bold", color: t.text }}>Atlas</Text> 没有 messageId 的帧是系统事件，保留原样转发。
          </Text>
        </View>
      </Card>
    </View>
  );
}

function Loading(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Card t={t} style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 0.6, color: t.text3 }}>状态光</Text>
        <View style={{ gap: 8 }}>
          <For
            of={[
              ["工作中", "work"],
              ["等你决定", "wait"],
              ["空闲", "idle"],
              ["失败", "fail"],
            ] as [string, "work" | "wait" | "idle" | "fail"][]}
            by={([label]) => label}
          >
            {([label, tone]) => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <StatusDot tone={tone} t={t} size={5} />
                <Text style={{ flex: 1, fontSize: 10.5, color: t.text2 }}>{label}</Text>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>{tone}</Text>
              </View>
            )}
          </For>
        </View>
      </Card>
      <Card t={t} style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 0.6, color: t.text3 }}>连接与加载</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Spinner t={t} size={13} />
          <Text style={{ fontSize: 10.5, color: t.text2 }}>正在重连 Pi Server…</Text>
        </View>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.line2 }}>
          <View style={{ width: "62%", height: 4, borderRadius: 2, backgroundColor: t.work }} />
        </View>
        <View style={{ gap: 5 }}>
          <View style={{ height: 7, width: "78%", borderRadius: 3, backgroundColor: alpha(t.text, 0.09) }} />
          <View style={{ height: 7, width: "92%", borderRadius: 3, backgroundColor: alpha(t.text, 0.07) }} />
          <View style={{ height: 7, width: "54%", borderRadius: 3, backgroundColor: alpha(t.text, 0.05) }} />
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip t={t} tone={t.work}>
            18 ms
          </Chip>
          <Chip t={t}>tailnet</Chip>
          <Chip t={t}>已同步 11:06</Chip>
        </View>
      </Card>
    </View>
  );
}

function Overlays(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Card t={t} style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 0.6, color: t.text3 }}>菜单 · POPOVER</Text>
        <View
          style={{
            alignSelf: "flex-start",
            width: 180,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.line2,
            backgroundColor: t.glass,
            backdropFilter: t.glow ? "blur(24px)" : undefined,
            boxShadow: t.glow ? t.e3 : undefined,
            padding: 5,
            gap: 1,
          }}
        >
          <For
            of={[
              ["打开 Atlas", "chevron-right"],
              ["在 Finder 中显示", "layers"],
              ["复制 Run 链接", "copy"],
            ] as [string, "chevron-right" | "layers" | "copy"][]}
            by={([label]) => label}
          >
            {([label, icon], i) => (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7, height: 26, paddingHorizontal: 7, borderRadius: 6, backgroundColor: i === 0 ? t.card2 : "transparent" }}>
                <Icon name={icon} size={11} color={t.text2} />
                <Text style={{ flex: 1, fontSize: 10.5, color: t.text }}>{label}</Text>
              </View>
            )}
          </For>
        </View>
      </Card>
      <Card t={t} style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 0.6, color: t.text3 }}>TOAST</Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 11,
            paddingVertical: 9,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: t.line2,
            backgroundColor: t.glass,
            backdropFilter: t.glow ? "blur(24px)" : undefined,
            boxShadow: t.glow ? t.e3 : undefined,
          }}
        >
          <StatusDot tone="work" t={t} size={5} />
          <Text style={{ flex: 1, fontSize: 10.5, color: t.text }}>已发送给 Atlas · Run #13 排队</Text>
          <Text style={{ fontSize: 10, color: t.text3 }}>撤回</Text>
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 0.6, color: t.text3 }}>SHEET · 手机</Text>
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: t.line2, backgroundColor: t.glass, padding: 10, gap: 6 }}>
          <View style={{ width: 32, height: 3, borderRadius: 2, backgroundColor: t.line2, alignSelf: "center" }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Avatar who="atlas" size={18} t={t} orbit={false} halo={false} />
            <Text style={{ flex: 1, fontSize: 10.5, color: t.text }}>检查器 · Run #12</Text>
            <Text style={{ fontSize: 10, color: t.text3 }}>关闭</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

export function KitView(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 30, paddingBottom: 40 }} scrollbar={false}>
      <View style={{ width: "100%", maxWidth: 1100, alignSelf: "center", gap: 26, paddingTop: 8 }}>
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 38, lineHeight: 44, color: t.text }}>组件与光影</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 19, color: t.text2, maxWidth: 620 }}>
            界面只有一个光源：Chief。光从左上方来，其他元素只反光，不发光。例外只有两个：状态光和焦点环。下面每个组件都可以在两种主题下查看。
          </Text>
        </View>

        <Section t={t} title="光影" sub="light · elevation" note="深度来自三件事：表面的模糊程度、顶部的边缘高光、投影的长度。层级越高，模糊越强，投影越长。">
          <ElevationStage t={t} />
          <Card t={t} style={{ gap: 4 }}>
            <Text style={{ fontSize: 11.5, fontWeight: "bold", color: t.text }}>光源实验</Text>
            <Text style={{ fontSize: 10, lineHeight: 15, color: t.text2 }}>投影总在光源的反方向，层级越高投影越远。边缘高光朝向光源。产品里光源固定在左上，也就是 Chief 所在的位置。</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>--sun · --rim · --e3 · --e4</Text>
          </Card>
          <Surfaces t={t} />
        </Section>

        <Section t={t} title="身份与状态" sub="identity" note="四种角色，一套色相：Chief 是暖金，Atlas 薄荷，Juno 琥珀，Vega 薰衣草。颜色只说明是谁，不说明在做什么。">
          <Identities t={t} />
          <States t={t} />
        </Section>

        <Section t={t} title="按钮与输入" sub="controls" note="主按钮是纸白底，危险操作只描边。输入框浮在玻璃上，模型和思考深度收在右侧。">
          <Buttons t={t} />
        </Section>

        <Section t={t} title="消息块" sub="message" note="消息是卡片，不是气泡流。运行状态原地更新：四个阶段、一句话、用时。">
          <Messages t={t} />
        </Section>

        <Section t={t} title="连接与加载" sub="connection">
          <Loading t={t} />
        </Section>

        <Section t={t} title="浮层" sub="overlay">
          <Overlays t={t} />
        </Section>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 }}>
          <Avatar who="chief" size={16} t={t} halo={false} orbit={false} />
          <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>
            这个 Demo 由 NSH 编译成 WebAssembly，界面用 HTML + CSS 渲染，布局和文字由 Rust 引擎计算。
          </Text>
        </View>
      </View>
    </Scroll>
  );
}
