import { Text, View } from 'nsh';
import { DAWN_CONIC, palette } from './theme';
import { Avatar } from './Avatar';
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
  return (
    <Avatar
      id="chief"
      size={props.size}
      state={props.thinking ? 'thinking' : 'idle'}
      glow={props.glow}
    />
  );
}

export function Planet(props: {
  hue: string;
  size?: number;
  state?: RunState;
  moons?: number;
}) {
  const id =
    props.hue === '#ffc25c'
      ? 'juno'
      : props.hue === '#a99bff'
        ? 'vega'
        : 'atlas';
  const state =
    props.state === 'idle'
      ? 'sleeping'
      : props.state === 'wait'
        ? 'waiting'
        : props.state === 'fail'
          ? 'blocked'
          : props.state === 'done'
            ? 'success'
            : 'working';
  return (
    <View
      style={{
        width: props.size ?? 34,
        height: props.size ?? 34,
        flexShrink: 0,
      }}
    >
      <Avatar id={id} size={props.size ?? 34} state={state} />
      <If when={(props.moons ?? 0) > 0}>
        <View
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            flexDirection: 'row',
            gap: 2,
          }}
        >
          {Array.from({ length: props.moons ?? 0 }, () => (
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: props.hue,
              }}
            />
          ))}
        </View>
      </If>
    </View>
  );
}

function withAlpha(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
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
