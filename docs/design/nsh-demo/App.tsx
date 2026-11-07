import { Text, View, mount, signal, type JSX } from "nsh";
import "./assets/fonts/Geist-400.ttf";
import "./assets/fonts/Geist-500.ttf";
import "./assets/fonts/Geist-600.ttf";
import "./assets/fonts/Geist-700.ttf";
import "./assets/fonts/GeistMono-400.ttf";
import "./assets/fonts/GeistMono-500.ttf";
import "./assets/fonts/InstrumentSerif-400.ttf";
import { FONT_DISPLAY, FONT_MONO, finishSignal, live, modeSignal, type Finish, type Mode, type Theme } from "./theme";
import { MacView } from "./MacView";
import { PhoneView } from "./phone/PhoneView";
import { KitView } from "./kit/KitView";
import { Icon, Press } from "./ui";

type Tab = "mac" | "ios" | "kit";

function TabButton(props: { id: Tab; label: string; tab: Tab; onSelect: (t: Tab) => void; t: Theme }): JSX.Element {
  return (
    <Press
      label={props.label}
      role="tab"
      selected={props.tab === props.id}
      onPress={() => props.onSelect(props.id)}
      style={{
        height: 26,
        paddingHorizontal: 16,
        borderRadius: 13,
        justifyContent: "center",
        backgroundColor: props.tab === props.id ? props.t.text : "transparent",
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: props.tab === props.id ? "500" : "normal",
          color: props.tab === props.id ? props.t.winSolid : props.t.text2,
        }}
      >
        {props.label}
      </Text>
    </Press>
  );
}

function App(): JSX.Element {
  const tab = signal<Tab>("mac");
  const t = live;
  const mode = modeSignal;
  const finish = finishSignal;

  return (
    <View style={{ flex: 1, backgroundColor: t.page, backgroundImage: t.wallImage }}>
      <View style={{ height: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: 20, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundImage: "linear-gradient(135deg, #ffb86b, #ff6f91 55%, #8b7cff)" }} />
          <Text style={{ fontFamily: FONT_DISPLAY, fontSize: 17, color: t.text }}>天色</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: t.text3 }}>Tian · NSH web demo</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View
          style={{
            flexDirection: "row",
            padding: 3,
            borderRadius: 16,
            backgroundColor: t.mode === "night" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.55)",
            borderWidth: 1,
            borderColor: t.line,
            gap: 2,
          }}
        >
          <TabButton id="mac" label="macOS" tab={tab()} onSelect={tab.set} t={t} />
          <TabButton id="ios" label="iOS" tab={tab()} onSelect={tab.set} t={t} />
          <TabButton id="kit" label="组件" tab={tab()} onSelect={tab.set} t={t} />
        </View>
        <View style={{ flex: 1 }} />
        <Press
          label={finish() === "glow" ? "切换为哑光" : "切换为光晕"}
          onPress={() => finish.update((f) => (f === "glow" ? "matte" : "glow"))}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            height: 28,
            paddingHorizontal: 10,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.mode === "night" ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)",
          }}
          hover={{ backgroundColor: t.card2 }}
        >
          <Icon name="sparkle" size={12} color={t.text2} />
          <Text style={{ fontSize: 11, color: t.text2 }}>{finish() === "glow" ? "光晕" : "哑光"}</Text>
        </Press>
        <Press
          label={mode() === "night" ? "切换到昼" : "切换到夜"}
          onPress={() => mode.update((m) => (m === "night" ? "day" : "night"))}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.mode === "night" ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.5)",
          }}
          hover={{ backgroundColor: t.card2 }}
        >
          <Icon name={mode() === "night" ? "moon" : "sun"} size={13} color={t.text2} />
        </Press>
      </View>

      {tab() === "mac" ? <MacView t={t} /> : null}
      {tab() === "ios" ? <PhoneView t={t} /> : null}
      {tab() === "kit" ? <KitView t={t} /> : null}
    </View>
  );
}

mount(App);
