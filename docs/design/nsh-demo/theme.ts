import { signal } from "nsh";
/**
 * The Tian Sky tokens, ported from docs/design/client-mockup.html.
 *
 * Two axes:
 *   - mode:   night | day
 *   - finish: glow  | matte   (client-mockup-no-glow.html)
 *
 * In matte mode the light leaves the page: solid wall, opaque window, no rim,
 * no coloured shadow. Only status and focus keep colour.
 */

export type Mode = "night" | "day";
export type Finish = "glow" | "matte";

export const FONT_UI = "Geist, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif";
export const FONT_MONO = "Geist Mono, 'SF Mono', Menlo, monospace";
export const FONT_DISPLAY = "Instrument Serif, 'Songti SC', 'Noto Serif SC', serif";

export const DAWN = "linear-gradient(135deg, #ffb86b 0%, #ff6f91 48%, #8b7cff 100%)";
export const INK = "#e8b93a";

export interface Theme {
  mode: Mode;
  glow: boolean;
  page: string;
  wall: string;
  wallImage?: string;
  win: string;
  winSolid: string;
  side: string;
  card: string;
  card2: string;
  line: string;
  line2: string;
  text: string;
  text2: string;
  text3: string;
  bubble: string;
  bubbleText: string;
  glass: string;
  glassLine: string;
  code: string;
  add: string;
  addBg: string;
  del: string;
  delBg: string;
  work: string;
  wait: string;
  fail: string;
  screen: string;
  shadow: string;
  e3: string;
  e4: string;
  rim: string;
  rimStrong: string;
  spotlight: string;
}

const night: Omit<Theme, "mode" | "glow"> = {
  page: "#06070b",
  wall: "#06070b",
  wallImage:
    "radial-gradient(circle at 78% 108%, rgba(255,111,145,0.30), transparent 55%)," +
    "radial-gradient(circle at 8% -12%, rgba(94,200,255,0.20), transparent 50%)," +
    "radial-gradient(circle at 45% 40%, rgba(139,124,255,0.10), transparent 60%)," +
    "linear-gradient(180deg, #0b1022, #05060a)",
  win: "rgba(14,16,23,0.80)",
  winSolid: "#10121a",
  side: "rgba(255,255,255,0.03)",
  card: "rgba(255,255,255,0.045)",
  card2: "rgba(255,255,255,0.075)",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.15)",
  text: "#eeece6",
  text2: "#a9a8b3",
  text3: "#6f6f7d",
  bubble: "#eeece6",
  bubbleText: "#111217",
  glass: "rgba(30,32,44,0.55)",
  glassLine: "rgba(255,255,255,0.14)",
  code: "rgba(0,0,0,0.32)",
  add: "#52d6a0",
  addBg: "rgba(63,205,150,0.12)",
  del: "#ff8a80",
  delBg: "rgba(255,110,100,0.12)",
  work: "#5ee6c9",
  wait: "#ffc25c",
  fail: "#ff7a6b",
  screen: "#08090d",
  shadow: "0 50px 140px -30px rgba(0,0,0,0.80), 0 0 0 1px rgba(255,255,255,0.07)",
  e3: "0 20px 50px -28px rgba(0,0,0,0.75)",
  e4: "0 30px 80px -20px rgba(0,0,0,0.82)",
  rim: "inset 0 1px 0 rgba(255,255,255,0.07)",
  rimStrong: "inset 0 1px 0 rgba(255,255,255,0.16)",
  spotlight: "rgba(255,255,255,0.06)",
};

const day: Omit<Theme, "mode" | "glow"> = {
  page: "#ece8e1",
  wall: "#ece8e1",
  wallImage:
    "radial-gradient(circle at 80% 110%, rgba(255,140,120,0.38), transparent 55%)," +
    "radial-gradient(circle at 5% -10%, rgba(120,190,255,0.38), transparent 50%)," +
    "linear-gradient(180deg, #f6efe6, #e9e3f0)",
  win: "rgba(253,251,247,0.82)",
  winSolid: "#f8f6f2",
  side: "rgba(20,20,40,0.025)",
  card: "rgba(255,255,255,0.78)",
  card2: "rgba(20,20,40,0.045)",
  line: "rgba(20,20,40,0.09)",
  line2: "rgba(20,20,40,0.17)",
  text: "#15161b",
  text2: "#5c5d68",
  text3: "#9898a3",
  bubble: "#15161b",
  bubbleText: "#f4f2ed",
  glass: "rgba(255,255,255,0.62)",
  glassLine: "rgba(255,255,255,0.80)",
  code: "rgba(20,20,40,0.05)",
  add: "#0f8a5a",
  addBg: "rgba(20,160,100,0.10)",
  del: "#c2392d",
  delBg: "rgba(220,60,50,0.09)",
  work: "#0b9e80",
  wait: "#c98200",
  fail: "#d9483b",
  screen: "#f5f2ec",
  shadow: "0 50px 120px -40px rgba(60,40,80,0.45), 0 0 0 1px rgba(20,20,40,0.08)",
  e3: "0 20px 50px -28px rgba(60,40,80,0.32)",
  e4: "0 30px 80px -24px rgba(60,40,80,0.42)",
  rim: "inset 0 1px 0 rgba(255,255,255,0.90)",
  rimStrong: "inset 0 1px 0 #ffffff",
  spotlight: "rgba(255,170,150,0.16)",
};

const matteNight: Partial<Theme> = {
  page: "#111113",
  wall: "#1c1c1f",
  winSolid: "#18181b",
  side: "#151517",
  card: "#202023",
  card2: "#29292d",
  line: "#303034",
  line2: "#444449",
  text: "#eeece6",
  text2: "#b0afb6",
  text3: "#8a8992",
  glass: "rgba(32,32,35,0.96)",
  glassLine: "#444449",
  screen: "#18181b",
  shadow: "0 24px 64px -24px rgba(0,0,0,0.60), 0 0 0 1px #303034",
  e3: "0 8px 24px -12px rgba(0,0,0,0.45)",
  e4: "0 16px 40px -16px rgba(0,0,0,0.55)",
};

const matteDay: Partial<Theme> = {
  page: "#f4f3ef",
  wall: "#e6e5e1",
  winSolid: "#faf9f6",
  side: "#f0efeb",
  card: "#ffffff",
  card2: "#eae9e5",
  line: "#ddddd7",
  line2: "#c5c5bf",
  text: "#202022",
  text2: "#626267",
  text3: "#76767b",
  glass: "rgba(250,249,246,0.96)",
  glassLine: "#d2d2cc",
  screen: "#f4f3ef",
  shadow: "0 24px 64px -24px rgba(0,0,0,0.18), 0 0 0 1px #ddddd7",
  e3: "0 8px 24px -12px rgba(0,0,0,0.14)",
  e4: "0 16px 40px -16px rgba(0,0,0,0.20)",
};

export function theme(mode: Mode, finish: Finish): Theme {
  const base = mode === "night" ? night : day;
  const glow = finish === "glow";
  const matte = mode === "night" ? matteNight : matteDay;
  const t: Theme = {
    ...(base as Theme),
    ...(glow ? {} : matte),
    mode,
    glow,
    win: glow ? base.win : (matte.winSolid ?? base.winSolid),
    wallImage: glow ? base.wallImage : undefined,
    rim: glow ? base.rim : "none",
    rimStrong: glow ? base.rimStrong : "none",
    spotlight: glow ? base.spotlight : "transparent",
  };
  return t;
}

/** A colour with alpha, from a #rrggbb value. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const IDENTITY = {
  chief: "#ffd166",
  atlas: "#5ee6c9",
  juno: "#ffc25c",
  vega: "#a99bff",
};

/* The live theme.
 *
 * NSH runs a component once and re-evaluates the JSX expressions that read a
 * signal; a theme object built in the component body would never change.
 * `live` reads the signals on every property access, so `style={{ backgroundColor: t.card }}`
 * subscribes that expression to the mode and finish.
 */
export const modeSignal = signal<Mode>("night");
export const finishSignal = signal<Finish>("glow");

const cache = new Map<string, Theme>();

export function currentTheme(): Theme {
  const mode = modeSignal();
  const finish = finishSignal();
  const key = `${mode}:${finish}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = theme(mode, finish);
  cache.set(key, made);
  return made;
}

export const live: Theme = new Proxy({} as Theme, {
  get(_target, key) {
    return (currentTheme() as unknown as Record<string | symbol, unknown>)[key];
  },
});
