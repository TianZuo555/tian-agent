import { Canvas, type CanvasRenderingContext2D, Image, Text, View, type JSX, type ViewStyle } from "nsh";
import chiefPng from "./assets/avatars/chief.png";
import atlasPng from "./assets/avatars/atlas.png";
import junoPng from "./assets/avatars/juno.png";
import vegaPng from "./assets/avatars/vega.png";
import { alpha, FONT_DISPLAY, FONT_MONO, FONT_UI, IDENTITY, type Theme } from "./theme";

/* ------------------------------------------------------------------ icons */

export type IconName =
  | "search"
  | "plus"
  | "gear"
  | "panel"
  | "chevron-right"
  | "chevron-down"
  | "chevron-left"
  | "check"
  | "copy"
  | "diff"
  | "clip"
  | "sliders"
  | "mic"
  | "arrow-up"
  | "close"
  | "moon"
  | "sun"
  | "sparkle"
  | "more"
  | "image"
  | "refresh"
  | "play"
  | "layers"
  | "lock"
  | "wifi"
  | "battery"
  | "signal";

const ring = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
};
const line = (c: CanvasRenderingContext2D, pts: number[]) => {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
};
const box = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
  c.stroke();
};
const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
};

const glyphs: Record<IconName, (c: CanvasRenderingContext2D) => void> = {
  search: (c) => {
    ring(c, 8.8, 8.8, 5.4);
    line(c, [13, 13, 17, 17]);
  },
  plus: (c) => line(c, [10, 4, 10, 16, 4, 10, 16, 10]),
  gear: (c) => {
    ring(c, 10, 10, 3.2);
    ring(c, 10, 10, 6.6);
    line(c, [10, 1.6, 10, 3.4]);
    line(c, [10, 16.6, 10, 18.4]);
    line(c, [1.6, 10, 3.4, 10]);
    line(c, [16.6, 10, 18.4, 10]);
    line(c, [4.1, 4.1, 5.4, 5.4]);
    line(c, [14.6, 14.6, 15.9, 15.9]);
    line(c, [4.1, 15.9, 5.4, 14.6]);
    line(c, [14.6, 5.4, 15.9, 4.1]);
  },
  panel: (c) => {
    box(c, 2.5, 3.5, 15, 13, 2.6);
    line(c, [12.6, 3.5, 12.6, 16.5]);
  },
  "chevron-right": (c) => line(c, [7.5, 4.5, 13, 10, 7.5, 15.5]),
  "chevron-down": (c) => line(c, [4.5, 7.5, 10, 13, 15.5, 7.5]),
  "chevron-left": (c) => line(c, [12.5, 4.5, 7, 10, 12.5, 15.5]),
  check: (c) => line(c, [4, 10.5, 8.2, 14.5, 16, 5.8]),
  copy: (c) => {
    box(c, 7, 2.5, 10.5, 11.5, 2);
    box(c, 2.5, 6, 10.5, 11.5, 2);
  },
  diff: (c) => {
    box(c, 2.5, 3, 6, 14, 1.6);
    box(c, 11.5, 3, 6, 14, 1.6);
    line(c, [4.4, 7, 6.6, 7]);
    line(c, [5.5, 5.9, 5.5, 8.1]);
    line(c, [13.4, 13, 15.6, 13]);
  },
  clip: (c) => {
    c.beginPath();
    c.moveTo(14.6, 9.2);
    c.lineTo(9.1, 14.7);
    c.arcTo(6.4, 14.7, 5.3, 13.6, 2.9);
    c.lineTo(8.1, 8.4);
    c.arcTo(8.9, 5.6, 10, 6.7, 2.3);
    c.lineTo(14.4, 6.1);
    c.arcTo(15.7, 7.4, 14.6, 8.5, 2.3);
    c.closePath();
    c.stroke();
  },
  sliders: (c) => {
    line(c, [3, 6, 17, 6]);
    line(c, [3, 14, 17, 14]);
    c.fillStyle = c.strokeStyle as string;
    dot(c, 7.5, 6, 2.1);
    dot(c, 13, 14, 2.1);
  },
  mic: (c) => {
    box(c, 7.6, 2.6, 4.8, 8.6, 2.4);
    line(c, [4.4, 9.5, 4.4, 10.5]);
    c.beginPath();
    c.arc(10, 10.4, 5.6, 0, Math.PI);
    c.stroke();
    line(c, [10, 16, 10, 18]);
  },
  "arrow-up": (c) => line(c, [10, 16, 10, 4, 4.6, 9.4]),
  close: (c) => {
    line(c, [5, 5, 15, 15]);
    line(c, [15, 5, 5, 15]);
  },
  moon: (c) => {
    c.beginPath();
    c.arc(10, 10, 6.6, -0.55, 2.2);
    c.stroke();
    c.beginPath();
    c.arc(13.2, 6.6, 6.2, 2.9, 5.4);
    c.stroke();
  },
  sun: (c) => {
    ring(c, 10, 10, 3.6);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      line(c, [10 + Math.cos(a) * 5.8, 10 + Math.sin(a) * 5.8, 10 + Math.cos(a) * 7.4, 10 + Math.sin(a) * 7.4]);
    }
  },
  sparkle: (c) => {
    c.beginPath();
    c.moveTo(10, 2.5);
    c.quadraticCurveTo(11, 9, 17.5, 10);
    c.quadraticCurveTo(11, 11, 10, 17.5);
    c.quadraticCurveTo(9, 11, 2.5, 10);
    c.quadraticCurveTo(9, 9, 10, 2.5);
    c.closePath();
    c.stroke();
  },
  more: (c) => {
    c.fillStyle = c.strokeStyle as string;
    dot(c, 4.5, 10, 1.5);
    dot(c, 10, 10, 1.5);
    dot(c, 15.5, 10, 1.5);
  },
  image: (c) => {
    box(c, 2.5, 3.5, 15, 13, 2.4);
    ring(c, 12.8, 7.4, 1.4);
    line(c, [3.5, 14.5, 8, 9.5, 11, 12.5, 13, 10.5, 16.5, 14.5]);
  },
  refresh: (c) => {
    c.beginPath();
    c.arc(10, 10, 6.4, -0.6, 4.2);
    c.stroke();
    line(c, [15.6, 3.4, 16.2, 7.4, 12.2, 7.6]);
  },
  play: (c) => {
    c.beginPath();
    c.moveTo(7, 4.4);
    c.lineTo(15.6, 10);
    c.lineTo(7, 15.6);
    c.closePath();
    c.stroke();
  },
  layers: (c) => {
    c.beginPath();
    c.moveTo(10, 2.6);
    c.lineTo(17.4, 6.4);
    c.lineTo(10, 10.2);
    c.lineTo(2.6, 6.4);
    c.closePath();
    c.stroke();
    line(c, [2.6, 11.2, 10, 15, 17.4, 11.2]);
    line(c, [2.6, 14.2, 10, 18, 17.4, 14.2]);
  },
  lock: (c) => {
    box(c, 4, 8.5, 12, 9, 2.2);
    c.beginPath();
    c.arc(10, 8.5, 3.6, Math.PI, 0);
    c.stroke();
  },
  wifi: (c) => {
    c.beginPath();
    c.arc(10, 15.4, 8.6, -2.5, -0.64);
    c.stroke();
    c.beginPath();
    c.arc(10, 15.4, 5.2, -2.4, -0.74);
    c.stroke();
    c.fillStyle = c.strokeStyle as string;
    dot(c, 10, 15.2, 1.3);
  },
  battery: (c) => {
    box(c, 2.5, 6.5, 13, 7, 2);
    c.fillStyle = c.strokeStyle as string;
    c.fillRect(17, 8.5, 2, 3);
    c.fillRect(4.2, 8.2, 7.4, 3.6);
  },
  signal: (c) => {
    c.fillStyle = c.strokeStyle as string;
    c.fillRect(3, 12, 2.6, 4);
    c.fillRect(7.1, 9, 2.6, 7);
    c.fillRect(11.2, 6, 2.6, 10);
    c.fillRect(15.3, 3, 2.6, 13);
  },
};

export function Icon(props: { name: IconName; size?: number; color: string; width?: number }): JSX.Element {
  const size = props.size ?? 16;
  const k = size / 20;
  return (
    <Canvas
      style={{ width: size, height: size }}
      draw={(c) => {
        c.strokeStyle = props.color;
        c.fillStyle = props.color;
        c.lineWidth = (props.width ?? 1.6) * 1;
        c.lineCap = "round";
        c.lineJoin = "round";
        c.scale(k, k);
        glyphs[props.name](c);
      }}
    />
  );
}

/* ---------------------------------------------------------------- avatars */

const AVATARS = { chief: chiefPng, atlas: atlasPng, juno: junoPng, vega: vegaPng } as const;
export type Who = keyof typeof AVATARS;

export function Avatar(props: {
  who: Who;
  size: number;
  t: Theme;
  working?: boolean;
  orbit?: boolean;
  halo?: boolean;
  face?: boolean;
}): JSX.Element {
  const size = props.size;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {props.t.glow && (props.halo ?? props.who === "chief") ? (
        <View
          style={{
            position: "absolute",
            width: size * 1.9,
            height: size * 1.9,
            borderRadius: size,
            backgroundImage: `radial-gradient(circle, ${alpha(IDENTITY[props.who], 0.30)} 0%, ${alpha(IDENTITY[props.who], 0.10)} 45%, rgba(0,0,0,0) 72%)`,
          }}
        />
      ) : null}
      {(props.orbit ?? props.who !== "chief") ? (
        <View
          style={{
            position: "absolute",
            width: size * 1.16,
            height: size * 1.16,
            borderRadius: size,
            borderWidth: 1,
            borderColor: alpha(IDENTITY[props.who], 0.32),
            animationName: props.working ? "spin" : "none",
            animationDuration: Math.max(6, size / 4),
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }}
        >
          <View
            style={{
              position: "absolute",
              top: -2,
              left: size * 0.58 - 3,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: props.working ? IDENTITY[props.who] : alpha(IDENTITY[props.who], 0.7),
            }}
          />
          <View
            style={{
              position: "absolute",
              bottom: size * 1.16 * 0.15,
              right: -1,
              width: 3,
              height: 3,
              borderRadius: 2,
              backgroundColor: alpha(IDENTITY[props.who], 0.5),
            }}
          />
        </View>
      ) : null}
      <Image src={AVATARS[props.who]} style={{ width: size, height: size }} />
    </View>
  );
}

/* ------------------------------------------------------------------- dots */

export type Tone = "work" | "wait" | "done" | "fail" | "idle";

export function StatusDot(props: { tone: Tone; size?: number; t: Theme }): JSX.Element {
  const size = props.size ?? 6;
  const color = () =>
    props.tone === "work"
      ? props.t.work
      : props.tone === "wait"
        ? props.t.wait
        : props.tone === "fail"
          ? props.t.fail
          : props.tone === "idle"
            ? props.t.text3
            : props.t.work;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color(),
        animationName: props.tone === "work" ? "pulse" : "none",
        animationDuration: 1600,
        animationIterationCount: "infinite",
      }}
    />
  );
}

/* ------------------------------------------------------------------ atoms */

export function Kbd(props: { children: string; t: Theme; small?: boolean }): JSX.Element {
  return (
    <View
      style={{
        paddingHorizontal: props.small ? 4 : 5,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: props.t.line,
        backgroundColor: props.t.mode === "night" ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.5)",
      }}
    >
      <Text style={{ fontFamily: FONT_MONO, fontSize: props.small ? 9 : 10, color: props.t.text3 }}>{props.children}</Text>
    </View>
  );
}

export function Press(props: {
  onPress?: () => void;
  onLongPress?: () => void;
  role?: "button" | "tab" | "link" | "switch";
  label?: string;
  style?: ViewStyle;
  hover?: ViewStyle;
  active?: ViewStyle;
  disabled?: boolean;
  selected?: boolean;
  children: JSX.Element | JSX.Element[];
}): JSX.Element {
  return (
    <View
      role={props.role ?? "button"}
      accessibilityLabel={props.label}
      accessibilityState={props.selected === undefined ? undefined : { selected: props.selected }}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      disabled={props.disabled}
      style={props.style}
      hoverStyle={props.hover}
      activeStyle={props.active ?? { opacity: 0.72 }}
    >
      {props.children}
    </View>
  );
}

export function IconButton(props: {
  name: IconName;
  t: Theme;
  label: string;
  size?: number;
  box?: number;
  onPress?: () => void;
  active?: boolean;
}): JSX.Element {
  const box = props.box ?? 28;
  const icon = props.size ?? 16;
  return (
    <Press
      onPress={props.onPress}
      label={props.label}
      role="button"
      style={{
        width: box,
        height: box,
        borderRadius: box / 2.4,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.active ? props.t.card2 : "transparent",
      }}
      hover={{ backgroundColor: props.t.card2 }}
    >
      <Icon name={props.name} size={icon} color={props.active ? props.t.text : props.t.text2} />
    </Press>
  );
}

/** A 4-segment phase rail: done, current, and what is still ahead. */
export function PhaseRail(props: { steps: number; at: number; t: Theme; labels?: string[]; width?: number }): JSX.Element {
  const width = props.width ?? 300;
  const cell = width / props.steps;
  return (
    <View style={{ width, height: props.labels ? 30 : 4 }}>
      <View style={{ flexDirection: "row", width, height: 4 }}>
        <Each of={Array.from({ length: props.steps }, (_, i) => i)} key="index">
          {(i) => (
            <View
              style={{
                width: cell - 3,
                height: 4,
                borderRadius: 2,
                backgroundColor: i() < props.at ? props.t.work : i() === props.at ? alpha(props.t.work, 0.55) : props.t.line,
              }}
            />
          )}
        </Each>
      </View>
      {props.labels ? (
        <View style={{ flexDirection: "row", width, marginTop: 6 }}>
          <Each of={props.labels} key="index">
            {(label, i) => (
              <View style={{ width: cell }}>
                <Text
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 9,
                    color: i() === props.at ? props.t.text : props.t.text3,
                  }}
                >
                  {label()}
                </Text>
              </View>
            )}
          </Each>
        </View>
      ) : null}
    </View>
  );
}

/** A row of small status rail ticks (the sidebar's run mini rows). */
export function RailMini(props: { at: number; t: Theme; tone?: Tone }): JSX.Element {
  return (
    <View style={{ flexDirection: "row", gap: 2, alignItems: "center" }}>
      <Each of={[0, 1, 2, 3]} key="index">
        {(i) => (
          <View
            style={{
              width: 5,
              height: 2,
              borderRadius: 1,
              backgroundColor:
                i() < props.at
                  ? alpha(props.t.work, 0.85)
                  : i() === props.at
                    ? props.t.work
                    : alpha(props.t.text3, 0.28),
            }}
          />
        )}
      </Each>
    </View>
  );
}

export function Chip(props: { children: string; t: Theme; tone?: string }): JSX.Element {
  const tone = props.tone?.startsWith("#") ? props.tone : undefined;
  return (
    <View
      style={{
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: alpha(tone ?? props.t.text3, 0.35),
      }}
    >
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: tone ?? props.t.text3 }}>{props.children}</Text>
    </View>
  );
}

export function Spinner(props: { size?: number; t: Theme }): JSX.Element {
  const size = props.size ?? 14;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: alpha(props.t.text3, 0.3),
        borderTopColor: props.t.work,
        animationName: "spin",
        animationDuration: 800,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
      }}
    />
  );
}

export function Divider(props: { t: Theme; label: string }): JSX.Element {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 2 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: props.t.line }} />
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 0.4, color: props.t.text3 }}>{props.label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: props.t.line }} />
    </View>
  );
}

/** A soft halo behind identity colour, for the glow finish. */
export function Halo(props: { t: Theme; color: string; size: number; strength?: number }): JSX.Element {
  return (
    <View
      style={{
        position: "absolute",
        width: props.size,
        height: props.size,
        borderRadius: props.size,
        backgroundImage: props.t.glow
          ? `radial-gradient(circle, ${alpha(props.color, props.strength ?? 0.25)} 0%, rgba(0,0,0,0) 70%)`
          : undefined,
      }}
    />
  );
}

/** `Array.map` for JSX: NSH keeps rows by `Each`, and `key` is not a prop of elements. */
export function For<T>(props: {
  of: readonly T[];
  by?: "index" | ((item: T, index: number) => unknown);
  children: (item: T, index: number) => JSX.Element;
}): JSX.Element {
  return (
    <Each of={props.of} key={props.by ?? "index"}>
      {(item, index) => props.children(item(), index())}
    </Each>
  );
}

export function Mono(props: { children: string | number; t: Theme; size?: number; color?: string }): JSX.Element {
  return (
    <Text style={{ fontFamily: FONT_MONO, fontSize: props.size ?? 11, color: props.color ?? props.t.text3 }}>
      {String(props.children)}
    </Text>
  );
}

export function UiText(props: {
  children: string | number;
  t: Theme;
  size?: number;
  color?: string;
  weight?: "normal" | "bold" | number | `${number}`;
  mono?: boolean;
  display?: boolean;
  lines?: number;
  align?: "auto" | "left" | "center" | "right";
}): JSX.Element {
  return (
    <Text
      style={{
        fontFamily: props.display ? FONT_DISPLAY : props.mono ? FONT_MONO : FONT_UI,
        fontSize: props.size ?? 13,
        lineHeight: (props.size ?? 13) * 1.5,
        color: props.color ?? props.t.text,
        fontWeight: props.weight ?? "normal",
        textAlign: props.align ?? "auto",
        numberOfLines: props.lines ?? 0,
      }}
    >
      {String(props.children)}
    </Text>
  );
}
