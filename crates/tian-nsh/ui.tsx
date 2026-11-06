import { Text, View } from 'nsh';
import { DAWN_CONIC, palette } from './theme';
import { look, pointerLight, reduceMotion } from './state';
import { ICON_FONT, MONO, SANS, SERIF } from './fonts';
import { GLYPHS, type IconName } from './icons';

export type RunState = 'work' | 'wait' | 'idle' | 'done' | 'fail';

export function Icon(props: { name: IconName; size?: number; color?: string }) {
  const size = props.size ?? 16;
  return (
    <Text
      accessibilityElementsHidden
      style={{
        fontFamily: ICON_FONT,
        fontSize: size,
        lineHeight: size + 2,
        color: props.color ?? palette(look()).text2,
      }}
    >
      {GLYPHS[props.name]}
    </Text>
  );
}

export function Mono(props: {
  children?: any;
  size?: number;
  color?: string;
  weight?: number;
}) {
  const t = palette(look());
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: props.size ?? 10.5,
        lineHeight: (props.size ?? 10.5) * 1.5,
        color: props.color ?? t.text3,
        fontWeight: props.weight ?? 400,
      }}
    >
      {props.children}
    </Text>
  );
}

export function Serif(props: {
  children?: any;
  size?: number;
  color?: string;
}) {
  const t = palette(look());
  return (
    <Text
      style={{
        fontFamily: SERIF,
        fontSize: props.size ?? 26,
        lineHeight: (props.size ?? 26) * 1.05,
        letterSpacing: -0.26,
        color: props.color ?? t.text,
        fontWeight: 400,
      }}
    >
      {props.children}
    </Text>
  );
}

export function Orb(props: {
  size: number;
  thinking?: boolean;
  glow?: boolean;
}) {
  const size = props.size;
  const halo = props.thinking ? 1.6 : 4.2;
  return (
    <View
      style={{ width: size, height: size, flexShrink: 0, overflow: 'visible' }}
    >
      <View
        style={{
          position: 'absolute',
          top: -size * 0.16,
          left: -size * 0.16,
          width: size * 1.32,
          height: size * 1.32,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: 'rgba(255, 150, 175, 0.35)',
          borderStyle: props.thinking ? 'dashed' : 'solid',
          opacity: 0.55,
          animationName: reduceMotion() ? 'none' : 'pulse',
          animationDuration: `${halo}s`,
          animationIterationCount: 'infinite',
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: 999,
          backgroundImage: DAWN_CONIC,
          boxShadow:
            props.glow === false
              ? undefined
              : `0 0 ${size * 0.55}px rgba(255, 111, 145, 0.32)`,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 999,
            backgroundImage:
              'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.20) 20%, transparent 44%), radial-gradient(circle at 72% 82%, rgba(12,10,40,0.55), transparent 62%)',
          }}
        />
      </View>
      <View style={{ width: size, height: size }} />
    </View>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Planet(props: {
  hue: string;
  size?: number;
  state?: RunState;
  moons?: number;
}) {
  const size = props.size ?? 34;
  const state = props.state ?? 'work';
  const idle = state === 'idle';
  const moons = props.moons ?? 1;
  const dot = (top: number, left: number) => (
    <View
      style={{
        position: 'absolute',
        top,
        left,
        width: 5,
        height: 5,
        borderRadius: 999,
        backgroundColor: props.hue,
        boxShadow: `0 0 8px ${props.hue}`,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 999,
          borderWidth: 1,
          borderStyle: idle ? 'solid' : 'dashed',
          borderColor: withAlpha(props.hue, idle ? 0.22 : 0.4),
          opacity: idle ? 0.45 : 1,
          animationName: idle || reduceMotion() ? 'none' : 'spin',
          animationDuration: '7s',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        }}
      >
        {moons >= 1 ? dot(-2.5, size / 2 - 2.5) : null}
        {moons >= 2 ? dot(size - 2.5, size / 2 - 2.5) : null}
        {moons >= 3 ? dot(size / 2 - 2.5, -2.5) : null}
      </View>
      <View
        style={{
          position: 'absolute',
          top: size * 0.24,
          left: size * 0.24,
          width: size * 0.52,
          height: size * 0.52,
          borderRadius: 999,
          backgroundImage: `radial-gradient(circle at 34% 28%, #fff 0%, ${props.hue} 38%, ${withAlpha(props.hue, 0.35)} 100%)`,
          filter: idle ? 'saturate(0.4)' : undefined,
          boxShadow: idle
            ? undefined
            : state === 'wait'
              ? `0 0 0 4px ${withAlpha(props.hue, 0.22)}`
              : `0 0 14px ${withAlpha(props.hue, 0.55)}`,
        }}
      />
    </View>
  );
}

export function Dot(props: { state?: RunState; size?: number }) {
  const t = palette(look());
  const state = props.state ?? 'idle';
  const size = props.size ?? 7;
  const color =
    state === 'work'
      ? t.work
      : state === 'wait'
        ? t.wait
        : state === 'fail'
          ? t.fail
          : state === 'done'
            ? t.text2
            : t.text3;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        flexShrink: 0,
        backgroundColor: color,
        animationName: state === 'work' && !reduceMotion() ? 'ping' : 'none',
        animationDuration: '2s',
        animationIterationCount: 'infinite',
      }}
    />
  );
}

export function Kbd(props: { children?: any }) {
  const t = palette(look());
  return (
    <View
      style={{
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: t.line2,
        backgroundColor: t.card2,
      }}
    >
      <Text style={{ fontFamily: SANS, fontSize: 10, color: t.text2 }}>
        {props.children}
      </Text>
    </View>
  );
}

export function MiniRail(props: { stage: number; review?: boolean }) {
  const t = palette(look());
  return (
    <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
      {[0, 1, 2, 3].map((i) => (
        <View
          style={{
            width: 9,
            height: 3,
            borderRadius: 2,
            backgroundColor:
              props.review || i < props.stage - 1
                ? t.text2
                : i === props.stage - 1
                  ? t.work
                  : t.line2,
            animationName:
              !props.review && i === props.stage - 1 && !reduceMotion()
                ? 'pulse'
                : 'none',
            animationDuration: '1.4s',
            animationIterationCount: 'infinite',
          }}
        />
      ))}
    </View>
  );
}

export function Btn(props: {
  children?: any;
  variant?: 'primary' | 'default' | 'ghost' | 'danger' | 'dawn';
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const t = palette(look());
  const variant = props.variant ?? 'default';
  const background =
    variant === 'primary'
      ? t.bubble
      : variant === 'dawn'
        ? undefined
        : variant === 'ghost'
          ? 'transparent'
          : t.winSolid;
  return (
    <View
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      focusable
      style={{
        height: 32,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: variant === 'ghost' || variant === 'dawn' ? 0 : 1,
        borderColor:
          variant === 'danger'
            ? withAlpha(t.del, 0.35)
            : variant === 'primary'
              ? 'transparent'
              : t.line2,
        backgroundColor: background,
        backgroundImage: variant === 'dawn' ? DAWN_CONIC : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
      hoverStyle={{
        filter: variant === 'primary' ? 'brightness(1.08)' : 'brightness(1.06)',
      }}
      activeStyle={{ opacity: 0.8 }}
    >
      {typeof props.children === 'string' ? (
        <Text
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color:
              variant === 'primary'
                ? t.bubbleText
                : variant === 'danger'
                  ? t.del
                  : variant === 'ghost'
                    ? t.text2
                    : variant === 'dawn'
                      ? '#fff'
                      : t.text,
          }}
        >
          {props.children}
        </Text>
      ) : (
        props.children
      )}
    </View>
  );
}

export function IconButton(props: {
  name: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
}) {
  const t = palette(look());
  return (
    <View
      role="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      focusable
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      hoverStyle={{ backgroundColor: t.card2 }}
      activeStyle={{ opacity: 0.7 }}
    >
      <Icon name={props.name} size={props.size ?? 16} color={t.text2} />
    </View>
  );
}

export function Card(props: {
  children?: any;
  style?: any;
  glow?: boolean;
  borderColor?: string;
}) {
  const t = palette(look());
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: props.borderColor ?? t.line,
          backgroundColor: t.card,
          borderRadius: 18,
          paddingHorizontal: 16,
          paddingVertical: 14,
          boxShadow: t.rim,
          gap: 0,
        },
        props.style,
      ]}
      hoverStyle={
        props.glow === false || !pointerLight()
          ? undefined
          : {
              backgroundImage: `radial-gradient(circle at 34% 0%, ${t.spot}, transparent 65%)`,
            }
      }
    >
      {props.children}
    </View>
  );
}

export function CardLabel(props: { children?: any; color?: string }) {
  const t = palette(look());
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: props.color ?? t.text3,
      }}
    >
      {props.children}
    </Text>
  );
}

export function Tag(props: { children?: any; color?: string }) {
  const t = palette(look());
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: t.line2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 9.5,
          color: props.color ?? t.text2,
        }}
      >
        {props.children}
      </Text>
    </View>
  );
}

export function Bullet(props: {
  color?: string;
  children?: any;
  size?: number;
}) {
  const t = palette(look());
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <View
        style={{
          width: props.size ?? 5,
          height: props.size ?? 5,
          borderRadius: 999,
          backgroundColor: props.color ?? t.text3,
          marginTop: 7,
        }}
      />
      <Text
        style={{ fontSize: 13, lineHeight: 19, color: t.text, flexShrink: 1 }}
      >
        {props.children}
      </Text>
    </View>
  );
}

export function Divider(props: { label: string }) {
  const t = palette(look());
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: 0.6,
          color: t.text3,
        }}
      >
        {props.label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.line }} />
    </View>
  );
}

export function Author(props: { name: string; meta: string }) {
  const t = palette(look());
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>
        {props.name}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
        {props.meta}
      </Text>
    </View>
  );
}
