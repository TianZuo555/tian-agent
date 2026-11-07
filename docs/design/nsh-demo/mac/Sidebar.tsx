import { Scroll, Text, View, type JSX } from "nsh";
import { CONVS, MINI_RUNS, type Conv, type ConvId } from "../data";
import { FONT_DISPLAY, FONT_MONO, type Theme } from "../theme";
import { Avatar, Icon, IconButton, Kbd, RailMini, StatusDot } from "../ui";

function Traffic(): JSX.Element {
  const colors = ["#ff5f57", "#febc2e", "#28c840"];
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
      <Each of={colors} key="index">
        {(c) => <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c() }} />}
      </Each>
    </View>
  );
}

function MiniRun(props: { id: string; title: string; at: number; t: Theme }): JSX.Element {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 20, paddingLeft: 46, paddingRight: 12, gap: 6 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: props.t.text3 }}>{props.id}</Text>
      <Text style={{ flex: 1, fontSize: 11, color: props.t.text2, numberOfLines: 1 }}>
        {props.title}
      </Text>
      <RailMini at={props.at} t={props.t} />
    </View>
  );
}

export function Sidebar(props: {
  t: Theme;
  conv: ConvId;
  onSelect: (id: ConvId) => void;
  onSettings: () => void;
}): JSX.Element {
  const t = props.t;
  const chief = CONVS[0];
  const managers = CONVS.slice(1);
  return (
    <View
      style={{
        width: 284,
        flexShrink: 0,
        backgroundColor: t.side,
        borderRightWidth: 1,
        borderRightColor: t.line,
      }}
    >
      <View style={{ height: 46, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Traffic />
        <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: t.text3 }}>Tian</Text>
      </View>

      <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
        <View
          role="button"
          accessibilityLabel="搜索或跳转"
          style={{
            height: 32,
            borderRadius: 9,
            backgroundColor: t.card,
            borderWidth: 1,
            borderColor: t.line,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 9,
            gap: 7,
          }}
        >
          <Icon name="search" size={13} color={t.text3} />
          <Text style={{ flex: 1, fontSize: 12, color: t.text3 }}>搜索或跳转</Text>
          <Kbd t={t} small>
            ⌘K
          </Kbd>
        </View>
      </View>

      <View style={{ paddingHorizontal: 10 }}>
        <View
          role="button"
          accessibilityLabel="与 Chief 对话"
          accessibilityState={{ selected: props.conv === "chief" }}
          onPress={() => props.onSelect("chief")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 10,
            borderRadius: 14,
            backgroundColor: props.conv === "chief" ? t.card : "transparent",
            borderWidth: 1,
            borderColor: props.conv === "chief" ? t.line2 : "transparent",
          }}
          hoverStyle={{ backgroundColor: t.card }}
        >
          <Avatar who="chief" size={46} t={t} working />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 23, lineHeight: 26, color: t.text }}>Chief</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <StatusDot tone="work" t={t} />
              <Text style={{ fontSize: 11.5, color: t.text2, numberOfLines: 1 }}>
                {chief.presence}
              </Text>
            </View>
          </View>
          <View
            style={{
              minWidth: 20,
              height: 20,
              paddingHorizontal: 5,
              borderRadius: 10,
              backgroundColor: t.text,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: t.mode === "night" ? "#111217" : "#f4f2ed" }}>2</Text>
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 18,
          paddingTop: 14,
          paddingBottom: 6,
        }}
      >
        <Text style={{ flex: 1, fontSize: 9.5, letterSpacing: 1, color: t.text3 }}>项目 · MANAGER</Text>
        <IconButton name="plus" t={t} label="添加项目" size={12} box={20} />
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ gap: 1, paddingBottom: 12 }} scrollbar={false}>
        <Each of={managers} key={(c) => c.id}>
          {(c) => (
          <View>
            <View
              role="button"
              accessibilityLabel={`与 ${c().name} 对话`}
              accessibilityState={{ selected: props.conv === c().id }}
              onPress={() => props.onSelect(c().id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 8,
                paddingHorizontal: 12,
                marginHorizontal: 8,
                borderRadius: 11,
                backgroundColor: props.conv === c().id ? t.card : "transparent",
              }}
              hoverStyle={{ backgroundColor: t.card }}
            >
              <Avatar who={c().who} size={32} t={t} working={c().tone === "work"} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "500", color: t.text }}>{c().name}</Text>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>{c().scope}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <StatusDot tone={c().tone} t={t} size={5} />
                  <Text style={{ flex: 1, fontSize: 11, color: t.text2, numberOfLines: 1 }}>
                    {c().presence}
                  </Text>
                </View>
              </View>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: t.text3 }}>{c().time}</Text>
            </View>
            {c().id === "atlas" ? (
              <Each of={MINI_RUNS} key={(r) => r.id}>
                {(r) => <MiniRun id={r().id} title={r().title} at={r().at} t={t} />}
              </Each>
            ) : null}
          </View>
          )}
        </Each>
      </Scroll>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.line,
          paddingHorizontal: 12,
          paddingVertical: 11,
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
        }}
      >
        <StatusDot tone="work" size={7} t={t} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 11, color: t.text2 }}>Pi Server · mac-studio</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>tailnet · 已同步 11:06</Text>
        </View>
        <IconButton name="gear" t={t} label="设置（⌘,）" size={15} box={28} onPress={props.onSettings} />
      </View>
    </View>
  );
}
