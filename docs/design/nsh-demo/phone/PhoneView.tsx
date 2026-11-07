import { Scroll, Text, View, type JSX, signal } from "nsh";
import { alpha, DAWN, FONT_DISPLAY, FONT_MONO, type Theme } from "../theme";
import { Avatar, For, Icon, PhaseRail, Press, StatusDot } from "../ui";

function Island(props: { t: Theme }): JSX.Element {
  return <View style={{ position: "absolute", top: 7, alignSelf: "center", width: 88, height: 22, borderRadius: 11, backgroundColor: props.t.mode === "night" ? "#000" : "#15161b" }} />;
}

function StatusBar(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ height: 38, flexDirection: "row", alignItems: "center", paddingHorizontal: 22, paddingTop: 2 }}>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: "bold", color: t.text }}>9:41</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon name="signal" size={12} color={t.text} />
        <Icon name="wifi" size={12} color={t.text} />
        <Icon name="battery" size={15} color={t.text} />
      </View>
    </View>
  );
}

function HomeBar(props: { t: Theme }): JSX.Element {
  return <View style={{ height: 16, alignItems: "center", justifyContent: "center" }}><View style={{ width: 96, height: 4, borderRadius: 2, backgroundColor: props.t.mode === "night" ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)" }} /></View>;
}

function Phone(props: { t: Theme; children: JSX.Element | JSX.Element[] }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        width: 340,
        height: 700,
        borderRadius: 46,
        padding: 7,
        backgroundColor: t.mode === "night" ? "#1a1b21" : "#dcdad4",
        borderWidth: 1,
        borderColor: t.line2,
        boxShadow: t.glow ? t.e4 : t.e3,
        flexShrink: 0,
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: 38,
          overflow: "hidden",
          backgroundColor: t.screen,
          backgroundImage: t.glow
            ? `radial-gradient(circle at 50% -8%, ${alpha("#ff6f91", t.mode === "night" ? 0.22 : 0.18)}, rgba(0,0,0,0) 55%)`
            : undefined,
        }}
      >
        <Island t={t} />
        <StatusBar t={t} />
        {props.children}
        <HomeBar t={t} />
      </View>
    </View>
  );
}

function PhoneNav(props: { t: Theme; who: "chief" | "atlas"; title: string; sub: string; tone: "work" | "wait" }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        height: 46,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        backgroundColor: alpha(t.winSolid, 0.86),
        borderBottomWidth: 1,
        borderBottomColor: t.line,
      }}
    >
      <Icon name="chevron-left" size={16} color={t.text2} />
      <Avatar who={props.who} size={22} t={t} working={props.tone === "work"} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12.5, fontWeight: "bold", color: t.text }}>{props.title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <StatusDot tone={props.tone} size={4} t={t} />
          <Text style={{ fontSize: 9.5, color: t.text2, numberOfLines: 1 }}>{props.sub}</Text>
        </View>
      </View>
      <Icon name="more" size={14} color={t.text2} />
    </View>
  );
}

function MiniShot(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        width: 150,
        height: 86,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.line2,
        backgroundColor: t.mode === "night" ? "#0d0f15" : "#fffdf9",
        padding: 7,
        gap: 5,
      }}
    >
      <View style={{ flexDirection: "row", gap: 2 }}>
        <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: t.text3 }} />
        <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: t.text3 }} />
        <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: t.text3 }} />
      </View>
      <View style={{ height: 6, width: "60%", borderRadius: 3, backgroundColor: alpha(t.text, 0.16) }} />
      <View style={{ height: 6, width: "84%", borderRadius: 3, backgroundColor: alpha(t.text, 0.1) }} />
      <View style={{ height: 6, width: "84%", borderRadius: 3, backgroundColor: alpha(t.text, 0.1) }} />
      <View
        style={{
          position: "absolute",
          right: 8,
          bottom: 6,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: 4,
          backgroundColor: alpha(t.fail, 0.18),
        }}
      >
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: t.fail }}>×2</Text>
      </View>
    </View>
  );
}

function HomeScreen(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flex: 1 }}>
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingBottom: 90 }} scrollbar={false}>
        <View style={{ alignItems: "center", paddingTop: 18, gap: 6 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: 0.3, color: t.text3 }}>11 月 6 日 · 周五</Text>
          <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 32, lineHeight: 38, color: t.text }}>下午好，Tian</Text>
          <Avatar who="chief" size={74} t={t} working />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 11,
              paddingVertical: 6,
              borderRadius: 16,
              backgroundColor: t.card,
              borderWidth: 1,
              borderColor: t.line,
              marginTop: 2,
            }}
          >
            <StatusDot tone="work" t={t} size={5} />
            <Text style={{ fontSize: 10.5, color: t.text2 }}>Chief 正在汇总 Atlas 的报告</Text>
          </View>
        </View>

        <Text style={{ fontSize: 9, letterSpacing: 0.8, color: t.text3, marginTop: 20, marginBottom: 6 }}>需要你</Text>
        <Press
          label="Juno 等你决定"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 9,
            padding: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: alpha(t.wait, 0.42),
            backgroundColor: alpha(t.wait, t.mode === "night" ? 0.07 : 0.09),
          }}
        >
          <Avatar who="juno" size={26} t={t} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: "bold", color: t.text }}>Juno 等你决定</Text>
            <Text style={{ fontSize: 10, color: t.text2 }}>healthapp 迁移：在线还是停机</Text>
          </View>
          <Text style={{ fontSize: 15, color: t.text3 }}>›</Text>
        </Press>

        <Text style={{ fontSize: 9, letterSpacing: 0.8, color: t.text3, marginTop: 16, marginBottom: 6 }}>项目</Text>
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, backgroundColor: t.card, overflow: "hidden" }}>
          <For
            of={[
              { who: "atlas" as const, name: "Atlas", scope: "tian-agent", note: "2 个 Worker · 1 个待审阅", time: "刚刚", tone: "work" as const },
              { who: "vega" as const, name: "Vega", scope: "d2r-mobile", note: "空闲", time: "3 时", tone: "idle" as const },
            ]}
            by={(row) => row.name}
          >
            {(row, i) => (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                  padding: 10,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.line,
                }}
              >
                <Avatar who={row.who} size={28} t={t} working={row.tone === "work"} />
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={{ fontSize: 12, fontWeight: "bold", color: t.text }}>{row.name}</Text>
                    <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>{row.scope}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <StatusDot tone={row.tone} size={4} t={t} />
                    <Text style={{ fontSize: 9.5, color: t.text2 }}>{row.note}</Text>
                  </View>
                </View>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>{row.time}</Text>
              </View>
            )}
          </For>
        </View>
      </Scroll>

      <View
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 24,
          height: 42,
          borderRadius: 21,
          borderWidth: 1,
          borderColor: t.glassLine,
          backgroundColor: t.glass,
          backdropFilter: t.glow ? "blur(20px)" : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 13,
        }}
      >
        <Icon name="sparkle" size={13} color={t.text3} />
        <Text style={{ flex: 1, fontSize: 11.5, color: t.text3 }}>跟 Chief 说…</Text>
        <Icon name="mic" size={13} color={t.text3} />
      </View>
    </View>
  );
}

function ChiefScreen(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flex: 1 }}>
      <PhoneNav t={t} who="chief" title="Chief" sub="工作中 · 全局" tone="work" />
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 100, gap: 12 }} scrollbar={false}>
        <Text style={{ fontSize: 13, lineHeight: 20, color: t.text }}>早上好。今天三件事：</Text>
        <View style={{ gap: 4 }}>
          <For of={["1.  Atlas 完成了 #11", "2.  Juno 在等你决定", "3.  训练本周 2 / 3"]} by="index">
            {(line) => <Text style={{ fontSize: 12, lineHeight: 18, color: t.text2 }}>{line}</Text>}
          </For>
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <MiniShot t={t} />
          <View style={{ maxWidth: 240, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 14, borderBottomRightRadius: 5, backgroundColor: t.bubble }}>
            <Text style={{ fontSize: 11.5, lineHeight: 17, color: t.bubbleText }}>消息重复了，让 Atlas 看一下</Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, lineHeight: 19, color: t.text }}>看到了，像是重连后重放了事件。已交给 Atlas。</Text>
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 11, backgroundColor: t.card, padding: 9, flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Avatar who="atlas" size={22} t={t} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>委派 · tian-agent</Text>
            <Text style={{ fontSize: 11, fontWeight: "500", color: t.text }}>修复重连后消息重复</Text>
          </View>
          <Text style={{ fontSize: 13, color: t.text3 }}>›</Text>
        </View>
      </Scroll>

      <View
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: 22,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: t.line2,
          backgroundColor: t.glass,
          backdropFilter: t.glow ? "blur(20px)" : undefined,
          paddingTop: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 }}>
          <View style={{ width: 26, height: 20, borderRadius: 5, borderWidth: 1, borderColor: t.line2, alignItems: "center", justifyContent: "center" }}>
            <Icon name="image" size={11} color={t.text2} />
          </View>
          <Text style={{ flex: 1, fontSize: 10, color: t.text }}>刚截的图 · 刚刚</Text>
          <Text style={{ fontSize: 9.5, color: t.text2 }}>附加</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7 }}>
          <Icon name="plus" size={15} color={t.text2} />
          <Text style={{ flex: 1, fontSize: 11.5, color: t.text3 }}>和 Chief 说…</Text>
          <Icon name="mic" size={12} color={t.text3} />
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundImage: DAWN, alignItems: "center", justifyContent: "center" }}>
            <Icon name="arrow-up" size={14} color="#fff" width={2} />
          </View>
        </View>
      </View>
    </View>
  );
}

function RunMiniCard(props: { t: Theme; id: string; title: string; at: number; elapsed: string; lines: string[] }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 11, backgroundColor: t.card, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.text2 }}>{props.id}</Text>
        <Text style={{ flex: 1, fontSize: 11.5, color: t.text, numberOfLines: 1 }}>{props.title}</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.text3 }}>{props.elapsed}</Text>
      </View>
      <PhaseRail t={t} steps={4} at={props.at} labels={["理解", "修改", "验证", "汇报"]} width={280} />
      <View style={{ gap: 2 }}>
        <For of={props.lines} by="index">
          {(line) => (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3, numberOfLines: 1 }}>{line}</Text>
          )}
        </For>
      </View>
    </View>
  );
}

function AtlasScreen(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flex: 1 }}>
      <PhoneNav t={t} who="atlas" title="Atlas" sub="tian-agent · 2 个 Worker" tone="work" />
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 92, gap: 10 }} scrollbar={false}>
        <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 11, backgroundColor: t.card, padding: 10, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: alpha(t.work, 0.15), borderWidth: 1, borderColor: alpha(t.work, 0.4), alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={10} color={t.work} width={2} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 11.5, fontWeight: "bold", color: t.text }}>Run #12 待审阅</Text>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>4 个文件 · +86 −23 · 128/128</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ flex: 1, height: 26, borderRadius: 6, backgroundColor: t.text, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 10.5, fontWeight: "500", color: t.winSolid }}>查看改动</Text>
            </View>
            <View style={{ width: 54, height: 26, borderRadius: 6, borderWidth: 1, borderColor: t.line2, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 10.5, color: t.text }}>Land</Text>
            </View>
          </View>
        </View>

        <RunMiniCard t={t} id="#13" title="断网重连测试" at={2} elapsed="04:12" lines={["10:48 新增 reconnect.test.ts", "10:49 第 1 次：2 个用例超时", "10:50 换成可控的假时钟"]} />
        <RunMiniCard t={t} id="#14" title="更新协议文档" at={0} elapsed="00:38" lines={["10:52 读取 docs/spec/protocol.md", "10:53 定位 resume 一段"]} />
      </Scroll>

      <View
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: 22,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: t.glassLine,
          backgroundColor: t.glass,
          backdropFilter: t.glow ? "blur(20px)" : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingHorizontal: 12,
        }}
      >
        <Icon name="plus" size={15} color={t.text2} />
        <Text style={{ flex: 1, fontSize: 11.5, color: t.text3 }}>给 Atlas 布置任务…</Text>
        <Icon name="mic" size={12} color={t.text3} />
      </View>
    </View>
  );
}

function ReviewScreen(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const rows = [
    { n: "138", text: "private onFrame(frame) {", kind: "ctx" },
    { n: "139", text: "  this.emit(frame.event);", kind: "del" },
    { n: "139", text: "  const id = frame.event.messageId;", kind: "add" },
    { n: "140", text: "  if (id && this.seen.has(id)) return;", kind: "add" },
    { n: "141", text: "  if (id) this.remember(id);", kind: "add" },
    { n: "142", text: "  this.emit(frame.event);", kind: "add" },
    { n: "143", text: "}", kind: "ctx" },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 42, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <Icon name="chevron-left" size={15} color={t.text2} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: "bold", color: t.text }}>Run #12 的改动</Text>
        <Icon name="more" size={13} color={t.text2} />
      </View>
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>fix/ws-dedupe → main</Text>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <For of={[["文件", "4"], ["行", "+86 −23"], ["测试", "128/128"], ["尝试", "2"]] as [string, string][]} by={([k]) => k}>
            {([k, v]) => (
              <View style={{ gap: 1 }}>
                <Text style={{ fontSize: 8.5, color: t.text3 }}>{k}</Text>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: k === "行" ? t.add : t.text }}>{v}</Text>
              </View>
            )}
          </For>
        </View>
      </View>
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 12, gap: 6 }} scrollbar={false}>
        <View style={{ flexDirection: "row", gap: 5 }}>
          <For of={[["client.ts", true], ["reconnect", false], ["protocol", false]] as [string, boolean][]} by={([name]) => name}>
            {([name, on]) => (
              <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: on ? t.line2 : t.line, backgroundColor: on ? t.card2 : "transparent" }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: on ? t.text : t.text3 }}>{name}</Text>
              </View>
            )}
          </For>
        </View>
        <View style={{ borderRadius: 9, borderWidth: 1, borderColor: t.line, backgroundColor: t.code, overflow: "hidden" }}>
          <For of={rows} by="index">
            {(r) => (
              <View style={{ flexDirection: "row", height: 17, backgroundColor: r.kind === "add" ? t.addBg : r.kind === "del" ? t.delBg : "transparent" }}>
                <Text style={{ width: 26, textAlign: "right", paddingRight: 4, fontFamily: FONT_MONO, fontSize: 8.5, lineHeight: 17, color: t.text3 }}>{r.n}</Text>
                <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 8.5, lineHeight: 17, color: r.kind === "add" ? t.add : r.kind === "del" ? t.del : t.text2, numberOfLines: 1 }}>
                  {r.text}
                </Text>
              </View>
            )}
          </For>
        </View>
        <View style={{ paddingVertical: 4, alignItems: "center" }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 8, color: t.text3 }}>··· 52 行 ···</Text>
        </View>
        <View style={{ padding: 8, borderRadius: 8, borderWidth: 1, borderColor: t.line2, backgroundColor: t.card, flexDirection: "row", gap: 6 }}>
          <Text style={{ fontSize: 8.5, fontWeight: "bold", color: t.text2 }}>你</Text>
          <Text style={{ flex: 1, fontSize: 9, lineHeight: 13, color: t.text2 }}>这里加个注释说明为什么要 dedupe</Text>
        </View>
      </Scroll>
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 18, paddingTop: 6 }}>
        <View style={{ flex: 1, height: 30, borderRadius: 15, borderWidth: 1, borderColor: alpha(t.fail, 0.45), alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10.5, color: t.fail }}>Discard</Text>
        </View>
        <View style={{ flex: 1, height: 30, borderRadius: 15, borderWidth: 1, borderColor: t.line2, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10.5, color: t.text }}>Ship</Text>
        </View>
        <View style={{ flex: 1.2, height: 30, borderRadius: 15, backgroundColor: t.text, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10.5, fontWeight: "500", color: t.winSolid }}>Land</Text>
        </View>
      </View>
    </View>
  );
}

function SettingsScreen(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const groups = [
    { group: "智能体 · 账号", rows: [["模型", "opus-4"], ["Worker 与 Intent", "3"], ["技能", "1"]] },
    { group: "个人 · 这台设备", rows: [["外观", "夜"], ["截图", ""], ["通知", "只在等你时"]] },
    { group: "运行 · 服务器", rows: [["渠道", ""], ["用量", "$69"]] },
  ];
  return (
    <View style={{ flex: 1, paddingHorizontal: 14 }}>
      <View style={{ height: 40, justifyContent: "center" }}>
        <Text style={{ fontSize: 16, fontWeight: "bold", color: t.text }}>设置</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <StatusDot tone="work" size={5} t={t} />
        <Text style={{ flex: 1, fontSize: 10.5, color: t.text2 }}>mac-studio</Text>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: t.text3 }}>tailnet · 已连接 · 24 ms</Text>
      </View>
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingTop: 8, paddingBottom: 20, gap: 10 }} scrollbar={false}>
        <For of={groups} by={(g) => g.group}>
          {(g) => (
            <View style={{ gap: 1 }}>
              <Text style={{ fontSize: 8.5, letterSpacing: 0.6, color: t.text3, paddingVertical: 4 }}>{g.group}</Text>
              <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, backgroundColor: t.card, overflow: "hidden" }}>
                <For of={g.rows} by={([k]) => k}>
                  {([k, v], i) => (
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, height: 32, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}>
                      <Text style={{ flex: 1, fontSize: 11.5, color: t.text }}>{k}</Text>
                      <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{v}</Text>
                      <Icon name="chevron-right" size={11} color={t.text3} />
                    </View>
                  )}
                </For>
              </View>
            </View>
          )}
        </For>
        <Text style={{ fontSize: 8.5, lineHeight: 13, color: t.text3, paddingHorizontal: 2 }}>
          三个分组，说清楚谁拥有它：智能体的能力属于账号，个人偏好只在这台设备，运行状态属于服务器。
        </Text>
      </Scroll>
    </View>
  );
}

export function PhoneView(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 34, paddingTop: 10, paddingBottom: 14, flexDirection: "row", alignItems: "flex-end", gap: 24 }}>
        <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 38, lineHeight: 44, color: t.text }}>口袋里的 Chief</Text>
        <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 19, color: t.text2, maxWidth: 520 }}>
          同一个 TSX 应用。手机上只有两层：列表与对话。按钮和输入框浮在 Liquid Glass 上，对话从下面滚过。检查器变成从顶栏拉出的 sheet。
        </Text>
      </View>
      <Scroll horizontal style={{ flex: 1 }} contentStyle={{ flexDirection: "row", gap: 26, paddingHorizontal: 34, paddingBottom: 26, paddingTop: 4 }} scrollbar={false}>
        <Phone t={t}>
          <HomeScreen t={t} />
        </Phone>
        <Phone t={t}>
          <ChiefScreen t={t} />
        </Phone>
        <Phone t={t}>
          <AtlasScreen t={t} />
        </Phone>
        <Phone t={t}>
          <ReviewScreen t={t} />
        </Phone>
        <Phone t={t}>
          <SettingsScreen t={t} />
        </Phone>
      </Scroll>
    </View>
  );
}
