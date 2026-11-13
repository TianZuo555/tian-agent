import { Scroll, Text, View } from 'nsh';
import { palette } from './theme';
import {
  goTo,
  look,
  openSettings,
  paletteOpen,
  selected,
  toggleLook,
} from './state';
import { managers } from './data';
import { Dot, Icon, IconButton, Kbd, MiniRail, Orb, Planet, Serif } from './ui';
import { MONO } from './fonts';

export function Sidebar() {
  const t = palette(look());
  return (
    <View
      style={{
        width: 284,
        flexShrink: 0,
        backgroundColor: t.side,
        borderRightWidth: 1,
        borderRightColor: t.line,
        flexDirection: 'column',
      }}
    >
      <View
        desktop={{ windowDrag: true }}
        style={{ height: 52, flexShrink: 0 }}
      />

      <View
        role="search"
        accessibilityLabel="搜索或跳转"
        onPress={() => paletteOpen.set(true)}
        style={{
          marginHorizontal: 14,
          marginBottom: 12,
          height: 32,
          borderRadius: 9,
          backgroundColor: t.card2,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 10,
        }}
        hoverStyle={{ backgroundColor: t.line }}
      >
        <Icon name="search" size={13} color={t.text3} />
        <Text style={{ fontSize: 12.5, color: t.text3, flex: 1 }}>
          搜索或跳转
        </Text>
        <Kbd>⌘K</Kbd>
      </View>

      <View
        role="button"
        accessibilityLabel="Chief 对话"
        accessibilityState={{ selected: selected() === 'chief' }}
        onPress={() => goTo('chief')}
        style={{
          marginHorizontal: 10,
          padding: 14,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: selected() === 'chief' ? t.line : 'transparent',
          backgroundColor: selected() === 'chief' ? t.card : 'transparent',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          overflow: 'hidden',
        }}
        hoverStyle={{
          backgroundColor: selected() === 'chief' ? t.card : t.card2,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              'radial-gradient(circle at 0% 0%, rgba(255, 111, 145, 0.16), transparent 70%)',
          }}
        />
        <Orb size={46} thinking />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Serif size={26}>Chief</Serif>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Dot state="work" />
            <Text style={{ fontSize: 12, color: t.text2 }}>
              汇总 Atlas 的报告
            </Text>
          </View>
        </View>
        <View
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 5,
            borderRadius: 9,
            backgroundColor: t.bubble,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{ fontSize: 10.5, fontWeight: 600, color: t.bubbleText }}
          >
            2
          </Text>
        </View>
      </View>

      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.2,
            color: t.text3,
          }}
        >
          项目 · MANAGER
        </Text>
        <IconButton name="plus" label="添加项目" size={13} />
      </View>

      <Scroll
        style={{ flex: 1 }}
        contentStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 2 }}
      >
        <Each of={managers}>
          {(manager) => (
            <View>
              <View
                role="button"
                accessibilityLabel={`${manager().name} 对话`}
                accessibilityState={{ selected: selected() === manager().id }}
                onPress={() => goTo(manager().id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  borderRadius: 12,
                  backgroundColor:
                    selected() === manager().id ? t.card : 'transparent',
                  boxShadow:
                    selected() === manager().id
                      ? `0 0 0 1px ${t.line}`
                      : undefined,
                }}
                hoverStyle={{
                  backgroundColor:
                    selected() === manager().id ? t.card : t.card2,
                }}
              >
                <Planet
                  hue={manager().hue}
                  size={34}
                  state={manager().state}
                  moons={manager().moons}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}
                    >
                      {manager().name}
                    </Text>
                    <Text
                      style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}
                    >
                      {manager().project}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Dot state={manager().state} />
                    <Text style={{ fontSize: 12, color: t.text2 }}>
                      {manager().presence}
                    </Text>
                  </View>
                </View>
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10.5,
                    color: t.text3,
                    alignSelf: 'flex-start',
                    marginTop: 3,
                  }}
                >
                  {manager().time}
                </Text>
              </View>

              {manager().runs.length > 0 ? (
                <View
                  style={{
                    marginLeft: 56,
                    marginTop: 2,
                    marginBottom: 6,
                    gap: 4,
                  }}
                >
                  <Each of={manager().runs}>
                    {(run) => (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 10.5,
                            color: t.text3,
                          }}
                        >
                          {run().id}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11.5,
                            color: t.text2,
                            flex: 1,
                            numberOfLines: 1,
                          }}
                        >
                          {run().title}
                        </Text>
                        <MiniRail stage={run().stage} review={run().review} />
                      </View>
                    )}
                  </Each>
                </View>
              ) : null}
            </View>
          )}
        </Each>
      </Scroll>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.line,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Dot state="work" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 11.5, color: t.text2 }}>
            Pi Server · mac-studio
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, color: t.text3 }}>
            tailnet · 已同步 11:06
          </Text>
        </View>
        <IconButton
          name={look() === 'night' ? 'moon' : 'sun'}
          label="切换昼夜"
          onPress={toggleLook}
          size={15}
        />
        <IconButton
          name="gear"
          label="设置"
          onPress={() => openSettings()}
          size={15}
        />
      </View>
    </View>
  );
}
