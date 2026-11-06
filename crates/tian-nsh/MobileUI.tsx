import { Text, View, type ViewStyle, type JSX } from 'nsh';
import { Button } from 'nsh/base';
import { palette } from './theme';
import { Avatar, type Identity } from './Avatar';
import { glass, look } from './state';
import { MONO, SANS, SERIF } from './fonts';
import { Icon } from './ui';
import type { IconName } from './icons';
import { copy, navigation } from './mobile-state';

export function Label(props: {
  children?: JSX.Element;
  secondary?: boolean;
  mono?: boolean;
  serif?: boolean;
  size?: number;
  color?: string;
  weight?: number;
}) {
  return (
    <Text
      style={{
        fontFamily: props.mono ? MONO : props.serif ? SERIF : SANS,
        fontSize: props.size ?? 14,
        lineHeight: (props.size ?? 14) * (props.serif ? 1.15 : 1.55),
        color:
          props.color ??
          (props.secondary ? palette(look()).text2 : palette(look()).text),
        fontWeight: props.weight ?? 400,
        flexShrink: 1,
      }}
    >
      {props.children}
    </Text>
  );
}
export function Action(props: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  compact?: boolean;
  testID?: string;
}) {
  const t = palette(look());
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        minWidth: 44,
        minHeight: 44,
        paddingHorizontal: props.compact ? 10 : 16,
        borderRadius: 14,
        borderWidth: props.primary ? 0 : 1,
        borderColor: t.line2,
        backgroundColor: props.primary ? t.bubble : t.card,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 7,
        opacity: props.disabled ? 0.4 : 1,
      }}
    >
      {props.icon ? (
        <Icon
          name={props.icon}
          size={17}
          color={props.primary ? t.bubbleText : props.danger ? t.fail : t.text2}
        />
      ) : null}
      <Label
        size={13}
        weight={600}
        color={props.primary ? t.bubbleText : props.danger ? t.fail : t.text}
      >
        {props.label}
      </Label>
    </Button>
  );
}
export function Round(props: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={props.icon} size={22} />
    </Button>
  );
}
export function Surface(props: { children?: JSX.Element; style?: ViewStyle }) {
  const t = palette(look());
  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: t.card,
        boxShadow: t.rim,
        ...props.style,
      }}
    >
      {props.children}
    </View>
  );
}
export function Floating(props: { children?: JSX.Element; style?: ViewStyle }) {
  const t = palette(look());
  return (
    <View
      style={{
        borderRadius: 26,
        padding: 10,
        gap: 8,
        borderWidth: 1,
        borderColor: t.glassLine,
        backgroundColor: glass() === 0 ? t.winSolid : t.glass,
        glassEffect: glass() === 0 ? 'none' : 'regular',
        backdropFilter:
          glass() === 0 ? undefined : `blur(${Math.round(glass() * 0.34)}px)`,
        boxShadow: `${t.rimStrong}, ${t.e3}`,
        ...props.style,
      }}
    >
      {props.children}
    </View>
  );
}
export function Heading(props: {
  title: string;
  subtitle?: string;
  trailing?: JSX.Element;
  back?: boolean;
  identity?: Identity;
}) {
  return (
    <View
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        backgroundColor: palette(look()).winSolid,
        borderBottomWidth: 1,
        borderBottomColor: palette(look()).line,
      }}
    >
      <View
        style={{
          height: 64,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {props.back !== false ? (
          <Round
            label={copy('back')}
            icon="arrowLeft"
            onPress={() => navigation.pop()}
          />
        ) : null}
        {props.identity ? (
          <Avatar
            id={props.identity}
            size={38}
            state={
              props.identity === 'juno'
                ? 'waiting'
                : props.identity === 'vega'
                  ? 'sleeping'
                  : 'working'
            }
          />
        ) : null}
        <View style={{ flex: 1, gap: 1 }}>
          <Label size={20} serif>
            {props.title}
          </Label>
          {props.subtitle ? (
            <Label size={10} secondary mono>
              {props.subtitle}
            </Label>
          ) : null}
        </View>
        {props.trailing}
      </View>
    </View>
  );
}
export function Section(props: { children?: JSX.Element }) {
  return (
    <View style={{ marginTop: 16, marginBottom: 8, paddingHorizontal: 4 }}>
      <Label mono secondary size={10}>
        {props.children}
      </Label>
    </View>
  );
}
