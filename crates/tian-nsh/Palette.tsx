import { Scroll, Text, View } from 'nsh';
import { Input } from 'nsh/base';
import { palette } from './theme';
import { goTo, look, openSettings, paletteOpen, paletteQuery } from './state';
import { paletteItems } from './data';
import { Icon, Kbd, Orb, Planet } from './ui';
import { HUES } from './theme';
import { MONO } from './fonts';

export function Palette() {
  const t = palette(look());
  const query = () => paletteQuery().trim().toLowerCase();
  const results = () =>
    paletteItems.filter(
      (item) => !query() || item.label.toLowerCase().includes(query()),
    );
  const groups = () => {
    const names: string[] = [];
    for (const item of results())
      if (!names.includes(item.group)) names.push(item.group);
    return names;
  };
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        alignItems: 'center',
        paddingTop: 110,
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
      }}
    >
      <View
        style={{
          width: 560,
          borderRadius: 18,
          backgroundColor: t.float,
          backdropFilter: 'blur(24px) saturate(1.4)',
          borderWidth: 1,
          borderColor: t.glassLine,
          boxShadow: `${t.rimStrong}, ${t.e4}`,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: t.line,
          }}
        >
          <Icon name="search" size={15} color={t.text3} />
          <Input
            value={paletteQuery()}
            placeholder="搜索或跳转"
            onChange={(e) => paletteQuery.set(e.value)}
            accessibilityLabel="搜索或跳转"
            style={{
              flex: 1,
              height: 24,
              fontSize: 14,
              color: t.text,
              placeholderColor: t.text3,
              backgroundColor: 'transparent',
            }}
          />
          <Kbd>esc</Kbd>
        </View>
        <Scroll style={{ maxHeight: 380 }} contentStyle={{ padding: 6 }}>
          <Each of={groups()}>
            {(group) => (
              <View style={{ marginBottom: 4 }}>
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    letterSpacing: 1,
                    color: t.text3,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  {group().toUpperCase()}
                </Text>
                <Each of={results().filter((item) => item.group === group())}>
                  {(item) => (
                    <View
                      role="button"
                      accessibilityLabel={item().label}
                      focusable
                      onPress={() => {
                        if (item().conv) goTo(item().conv!);
                        else if (item().label === '设置') openSettings();
                        paletteOpen.set(false);
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 9,
                      }}
                      hoverStyle={{ backgroundColor: t.card2 }}
                    >
                      {item().conv ? (
                        item().conv === 'chief' ? (
                          <Orb size={18} />
                        ) : (
                          <Planet
                            hue={
                              item().conv === 'atlas'
                                ? HUES.atlas
                                : item().conv === 'juno'
                                  ? HUES.juno
                                  : HUES.vega
                            }
                            size={18}
                            state="idle"
                            moons={0}
                          />
                        )
                      ) : (
                        <Icon name="command" size={14} color={t.text3} />
                      )}
                      <Text style={{ fontSize: 13, color: t.text, flex: 1 }}>
                        {item().label}
                      </Text>
                      {item().hint ? <Kbd>{item().hint}</Kbd> : null}
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
          <View style={{ paddingHorizontal: 10, paddingVertical: 10 }}>
            <Text style={{ fontSize: 11.5, color: t.text3 }}>
              {results().length} 个结果 · 全部是示例数据
            </Text>
          </View>
        </Scroll>
      </View>
    </View>
  );
}
