import { Scroll, Text, View, type JSX } from "nsh";
import { DIFF, FILES, PHASES, type ConvId } from "../data";
import { alpha, FONT_DISPLAY, FONT_MONO, type Theme } from "../theme";
import { Avatar, Chip, For, Icon, IconButton, Press, StatusDot } from "../ui";

function Segmented(props: { t: Theme; value: string; onChange: (v: string) => void; items: string[] }): JSX.Element {
  const t = props.t;
  return (
    <View
      style={{
        flexDirection: "row",
        padding: 2,
        borderRadius: 8,
        backgroundColor: t.mode === "night" ? "rgba(0,0,0,0.28)" : "rgba(20,20,40,0.06)",
        gap: 2,
      }}
    >
      <For of={props.items} by={(item) => item}>
        {(item) => {
        const active = props.value === item;
        return (
          <Press
            label={item}
            role="tab"
            selected={active}
            onPress={() => props.onChange(item)}
            style={{
              height: 24,
              paddingHorizontal: 11,
              borderRadius: 6,
              justifyContent: "center",
              backgroundColor: active ? t.text : "transparent",
            }}
          >
            <Text style={{ fontSize: 11.5, fontWeight: active ? "500" : "normal", color: active ? t.winSolid : t.text2 }}>{item}</Text>
          </Press>
        );
      }}
      </For>
    </View>
  );
}

function DiffLines(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const color = (kind: string) => (kind === "add" ? t.add : kind === "del" ? t.del : kind === "hunk" ? "#8b7cff" : t.text2);
  const bg = (kind: string) => (kind === "add" ? t.addBg : kind === "del" ? t.delBg : "transparent");
  return (
    <View style={{ backgroundColor: t.code }}>
      <For of={DIFF} by="index">
        {(row) => {
        if (row.kind === "gap") {
          return (
            <View style={{ height: 22, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderTopColor: t.line }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{row.text}</Text>
            </View>
          );
        }
        return (
          <View style={{ flexDirection: "row", height: 19, backgroundColor: bg(row.kind) }}>
            <Text style={{ width: 30, textAlign: "right", paddingRight: 5, fontFamily: FONT_MONO, fontSize: 10, lineHeight: 19, color: t.text3 }}>
              {row.old ?? ""}
            </Text>
            <Text style={{ width: 30, textAlign: "right", paddingRight: 6, fontFamily: FONT_MONO, fontSize: 10, lineHeight: 19, color: t.text3 }}>
              {row.cur ?? ""}
            </Text>
            <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10, lineHeight: 19, color: color(row.kind), numberOfLines: 1 }}>
              {row.text}
            </Text>
          </View>
        );
      }}
      </For>
    </View>
  );
}

function ChangePane(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <Scroll style={{ flex: 1 }} contentStyle={{ padding: 14, gap: 10 }} scrollbar={false}>
      <View
        style={{
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          backgroundColor: t.card,
          padding: 11,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Avatar who="atlas" size={18} t={t} orbit={false} halo={false} />
          <Text style={{ flex: 1, fontSize: 12.5, fontWeight: "bold", color: t.text }}>Run #12</Text>
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: alpha(t.wait, 0.45) }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: t.wait }}>待审阅</Text>
          </View>
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>
          fix/ws-dedupe → main · 4 个文件 · <Text style={{ color: t.add }}>+86</Text>{" "}
          <Text style={{ color: t.del }}>−23</Text>
        </Text>
      </View>

      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: "hidden" }}>
        <For of={FILES} by={(f) => f.path}>
          {(f, i) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 10,
              height: 30,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.line,
              backgroundColor: i === 0 ? alpha(t.text, 0.03) : "transparent",
            }}
          >
            <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10, color: i === 0 ? t.text : t.text2, numberOfLines: 1 }}>
              {f.path}
            </Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: f.add ? t.add : t.text3 }}>+{f.add}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: f.del ? t.del : t.text3 }}>−{f.del}</Text>
            <View style={{ flexDirection: "row", gap: 1.5 }}>
              <For of={[0, 1, 2, 3, 4]} by="index">
                {(k) => (
                  <View style={{ width: 4, height: 4, borderRadius: 1, backgroundColor: k < (i === 0 ? 4 : i === 1 ? 4 : 3) ? (i === 3 ? t.del : t.add) : t.line }} />
                )}
              </For>
            </View>
          </View>
          )}
        </For>
      </View>

      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, height: 30, borderBottomWidth: 1, borderBottomColor: t.line }}>
          <Icon name="diff" size={12} color={t.text2} />
          <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10, color: t.text2, numberOfLines: 1 }}>
            src/service/client.ts
          </Text>
          <View style={{ flexDirection: "row", gap: 2 }}>
            <For of={["统一", "并排"]} by={(m) => m}>
              {(m) => (
                <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: m === "统一" ? t.card2 : "transparent" }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: m === "统一" ? t.text : t.text3 }}>{m}</Text>
                </View>
              )}
            </For>
          </View>
        </View>
        <Scroll horizontal style={{ maxHeight: 250 }} contentStyle={{ minWidth: 430 }} scrollbar={false}>
          <DiffLines t={t} />
        </Scroll>
        <View
          style={{
            margin: 8,
            padding: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.line2,
            backgroundColor: t.card2,
            flexDirection: "row",
            gap: 6,
          }}
        >
          <Avatar who="atlas" size={14} t={t} orbit={false} halo={false} />
          <Text style={{ flex: 1, fontSize: 10.5, lineHeight: 15, color: t.text2 }}>
            <Text style={{ fontWeight: "bold", color: t.text }}>Atlas</Text> 没有 messageId 的帧是系统事件，保留原样转发。
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 6, paddingTop: 2 }}>
        <Press label="Discard" style={{ flex: 1, height: 30, borderRadius: 7, borderWidth: 1, borderColor: alpha(t.fail, 0.45), justifyContent: "center", alignItems: "center" }} hover={{ backgroundColor: alpha(t.fail, 0.1) }}>
          <Text style={{ fontSize: 11.5, color: t.fail }}>Discard</Text>
        </Press>
        <Press label="Ship" style={{ flex: 1, height: 30, borderRadius: 7, borderWidth: 1, borderColor: t.line2, justifyContent: "center", alignItems: "center" }} hover={{ backgroundColor: t.card2 }}>
          <Text style={{ fontSize: 11.5, color: t.text }}>Ship</Text>
        </Press>
        <Press label="Land" style={{ flex: 1, height: 30, borderRadius: 7, backgroundColor: t.text, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ fontSize: 11.5, fontWeight: "500", color: t.winSolid }}>Land</Text>
        </Press>
      </View>
    </Scroll>
  );
}

function TasksPane(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const tasks = [
    { label: "读懂重连与 resume 逻辑", done: true },
    { label: "按 messageId 去重（保留系统帧）", done: true },
    { label: "补断网 30 秒以上的测试", done: true },
    { label: "更新 docs/spec/protocol.md", done: false },
    { label: "等你审阅后 Land", done: false },
  ];
  return (
    <Scroll style={{ flex: 1 }} contentStyle={{ padding: 14, gap: 8 }} scrollbar={false}>
      <Text style={{ fontSize: 10, letterSpacing: 1, color: t.text3 }}>任务 · RUN #12</Text>
      <For of={tasks} by={(task) => task.label}>
        {(task) => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: task.done ? alpha(t.work, 0.5) : t.line2,
              backgroundColor: task.done ? alpha(t.work, 0.16) : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {task.done ? <Icon name="check" size={9} color={t.work} width={2.2} /> : null}
          </View>
          <Text style={{ flex: 1, fontSize: 12, color: task.done ? t.text2 : t.text }}>{task.label}</Text>
        </View>
        )}
      </For>
      <View style={{ height: 1, backgroundColor: t.line, marginVertical: 4 }} />
      <Text style={{ fontSize: 10, letterSpacing: 1, color: t.text3 }}>阶段</Text>
      <For of={PHASES} by={(p) => p}>
        {(p, i) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StatusDot tone={i < 3 ? "work" : "wait"} size={5} t={t} />
            <Text style={{ flex: 1, fontSize: 12, color: t.text2 }}>{p}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.text3 }}>{i < 3 ? "完成" : "待执行"}</Text>
          </View>
        )}
      </For>
    </Scroll>
  );
}

function DetailsPane(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const rows = [
    ["Run", "#12"],
    ["分支", "fix/ws-dedupe → main"],
    ["意图", "simple"],
    ["运行时", "pi · claude-sonnet-4"],
    ["尝试", "第 2 次"],
    ["文件", "4 个 · +86 −23"],
    ["测试", "128 / 128 通过"],
    ["用时", "9 分 12 秒"],
  ];
  return (
    <Scroll style={{ flex: 1 }} contentStyle={{ padding: 14, gap: 10 }} scrollbar={false}>
      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: "hidden" }}>
        <For of={rows} by={([k]) => k}>
          {([k, v], i) => (
          <View
            style={{
              flexDirection: "row",
              paddingHorizontal: 11,
              height: 32,
              alignItems: "center",
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.line,
            }}
          >
            <Text style={{ width: 64, fontSize: 11, color: t.text3 }}>{k}</Text>
            <Text style={{ flex: 1, fontFamily: i > 1 ? FONT_MONO : undefined, fontSize: 11.5, color: t.text, numberOfLines: 1 }}>
              {v}
            </Text>
          </View>
          )}
        </For>
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Chip t={t} tone={t.work}>
          tests passed
        </Chip>
        <Chip t={t} tone={t.wait}>
          review
        </Chip>
        <Chip t={t}>pi</Chip>
      </View>
    </Scroll>
  );
}

function DecisionPane(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <Scroll style={{ flex: 1 }} contentStyle={{ padding: 14, gap: 10 }} scrollbar={false}>
      <View style={{ borderWidth: 1, borderColor: alpha(t.wait, 0.45), borderRadius: 12, backgroundColor: alpha(t.wait, 0.07), padding: 12, gap: 6 }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, letterSpacing: 0.5, color: t.wait }}>需要你决定 · 阻塞</Text>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: t.text }}>healthapp 数据库迁移</Text>
        <Text style={{ fontSize: 10.5, lineHeight: 15, color: t.text2 }}>批准后 Juno 派 1 个 Worker 执行。这是 Juno 唯一在等的事。</Text>
      </View>
      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: "hidden" }}>
        <For
          of={[
            ["workouts → sets", "41 万行"],
            ["在线迁移", "约 20 分钟 · 不停服"],
            ["停机迁移", "约 3 分钟 · 停服"],
            ["影响", "iPhone 同步暂停"],
          ] as [string, string][]}
          by={([k]) => k}
        >
          {([k, v], i) => (
            <View style={{ flexDirection: "row", alignItems: "center", height: 30, paddingHorizontal: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.line }}>
              <Text style={{ width: 110, fontSize: 10.5, color: t.text3 }}>{k}</Text>
              <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10, color: t.text }}>{v}</Text>
            </View>
          )}
        </For>
      </View>
      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 11, gap: 6, backgroundColor: t.card, flexDirection: "row" }}>
        <Avatar who="juno" size={20} t={t} orbit={false} halo={false} />
        <Text style={{ flex: 1, fontSize: 10.5, lineHeight: 15, color: t.text2 }}>
          <Text style={{ fontWeight: "bold", color: t.text }}>Juno</Text> 建议在线迁移：今天是工作日白天，停机 3 分钟会打断手机端同步。
        </Text>
      </View>
    </Scroll>
  );
}

function IdlePane(props: { t: Theme }): JSX.Element {
  const t = props.t;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
      <Avatar who="vega" size={44} t={t} />
      <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: t.text }}>没有进行中的 Run</Text>
      <Text style={{ fontSize: 10.5, lineHeight: 15, color: t.text3, textAlign: "center" }}>上次汇报是 3 小时前。检查依赖更新、跑测试，或直接布置一个新任务。</Text>
    </View>
  );
}

export function Inspector(props: { t: Theme; onClose: () => void; tab: string; setTab: (v: string) => void; conv: ConvId }): JSX.Element {
  const t = props.t;
  const run = () => props.conv === "atlas" || props.conv === "chief";
  return (
    <View style={{ width: 404, flexShrink: 0, borderLeftWidth: 1, borderLeftColor: t.line, backgroundColor: t.side }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
        {run() ? (
          <Segmented t={t} value={props.tab} onChange={props.setTab} items={["改动", "任务", "详情"]} />
        ) : (
          <Text style={{ flex: 1, fontSize: 12, fontWeight: "bold", color: t.text }}>{props.conv === "juno" ? "等你决定" : "概览"}</Text>
        )}
        <View style={{ flex: 1 }} />
        <IconButton name="close" t={t} label="关闭检查器" size={13} box={26} onPress={props.onClose} />
      </View>
      {!run() ? (props.conv === "juno" ? <DecisionPane t={t} /> : <IdlePane t={t} />) : null}
      {run() && props.tab === "改动" ? <ChangePane t={t} /> : null}
      {run() && props.tab === "任务" ? <TasksPane t={t} /> : null}
      {run() && props.tab === "详情" ? <DetailsPane t={t} /> : null}
    </View>
  );
}
