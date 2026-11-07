import { View, type JSX, signal } from "nsh";
import type { ConvId } from "./data";
import type { Theme } from "./theme";
import { Chat } from "./mac/Chat";
import { Inspector } from "./mac/Inspector";
import { Settings } from "./mac/Settings";
import { Sidebar } from "./mac/Sidebar";

export function MacView(props: { t: Theme }): JSX.Element {
  const t = props.t;
  const conv = signal<ConvId>("chief");
  const inspector = signal(true);
  const tab = signal("改动");
  const settings = signal(false);
  const wide = signal(true);

  const goto = (id: ConvId) => conv.set(id);
  const openDiff = () => {
    inspector.set(true);
    tab.set("改动");
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 22, paddingTop: 6, paddingBottom: 22 }}>
      <View
        onLayout={(e) => {
          const w = e.bounds.size.width >= 1100;
          if (w !== wide()) wide.set(w);
        }}
        style={{
          width: "100%",
          maxWidth: 1336,
          height: "100%",
          maxHeight: 812,
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: t.win,
          backdropFilter: t.glow ? "blur(50px) saturate(1.5)" : undefined,
          boxShadow: t.glow ? `${t.rimStrong}, ${t.shadow}` : t.shadow,
          flexDirection: "row",
          borderWidth: t.glow ? 0 : 1,
          borderColor: t.line,
        }}
      >
        <Sidebar t={t} conv={conv()} onSelect={goto} onSettings={() => settings.set(true)} />
        <Chat
          t={t}
          conv={conv()}
          inspectorOpen={inspector()}
          onToggleInspector={() => inspector.update((v) => !v)}
          onOpenDiff={openDiff}
          onGoto={goto}
        />
        {inspector() && wide() ? <Inspector t={t} onClose={() => inspector.set(false)} tab={tab()} setTab={tab.set} conv={conv()} /> : null}
      </View>

      {settings() ? (
        <Settings t={t} onClose={() => settings.set(false)} />
      ) : null}
    </View>
  );
}
