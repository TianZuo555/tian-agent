import { Image, View, reduceMotion as systemReduceMotion } from 'nsh';
import { avatarSources } from './avatar-sources';
import { ambientLight, reduceMotion } from './state';

export type Identity = 'chief' | 'atlas' | 'juno' | 'vega';
export function Avatar(props: {
  id: Identity;
  size?: number;
  state?: string;
  glow?: boolean;
}) {
  const size = props.size ?? 44;
  const state = props.state ?? 'idle';
  const moving = [
    'thinking',
    'working',
    'verifying',
    'reading',
    'streaming',
    'connecting',
  ].includes(state);
  return (
    <View
      accessibilityElementsHidden
      style={{ width: size, height: size, flexShrink: 0, overflow: 'visible' }}
    >
      <If when={props.id === 'chief' && props.glow !== false && ambientLight()}>
        <View
          style={{
            position: 'absolute',
            top: -size * 0.4,
            bottom: -size * 0.4,
            left: -size * 0.4,
            right: -size * 0.4,
            borderRadius: 999,
            backgroundImage:
              'radial-gradient(circle, rgba(255,160,110,.19), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
      </If>
      <Image
        src={
          avatarSources[`${props.id}-${state}`] ??
          avatarSources[`${props.id}-idle`]
        }
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          animationName:
            moving && !reduceMotion() && !systemReduceMotion()
              ? 'pulse'
              : 'none',
          animationDuration: '3.6s',
          animationIterationCount: 'infinite',
        }}
      />
    </View>
  );
}
