import { Text, View } from 'nsh';
import { Input } from 'nsh/base';
import { palette, DAWN } from './theme';
import { draft, look, selected, send, captureSuggest } from './state';
import { Icon, IconButton } from './ui';
import { MONO, SANS } from './fonts';

function fade(hex: string) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0)`;
}

const PLACEHOLDERS: Record<string, string> = {
  chief: '消息',
  atlas: '给 Atlas 布置任务…',
  juno: '回答 Juno…',
  vega: '给 Vega 布置任务…',
};

export function Composer() {
  const t = palette(look());
  const empty = () => draft().trim().length === 0;
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 28,
        paddingHorizontal: 32,
        paddingBottom: 22,
        backgroundImage: `linear-gradient(${fade(t.winSolid)} 0%, ${t.winSolid} 34%)`,
      }}
    >
      <View
        style={{
          maxWidth: 720,
          width: '100%',
          alignSelf: 'center',
          borderRadius: 22,
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.line2,
          backdropFilter: 'blur(20px)',
          boxShadow: `${t.rimStrong}, ${t.e3}`,
          overflow: 'hidden',
        }}
      >
        {captureSuggest() && selected() === 'chief' ? (
          <View
            style={{
              marginTop: 8,
              marginHorizontal: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: t.card2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <View
              style={{
                width: 30,
                height: 40,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: t.line2,
                backgroundColor: '#101117',
                overflow: 'hidden',
                gap: 2,
                padding: 4,
              }}
            >
              <View
                style={{
                  height: 4,
                  width: '60%',
                  alignSelf: 'flex-end',
                  borderRadius: 2,
                  backgroundColor: '#d9d7d0',
                }}
              />
              <View
                style={{
                  height: 4,
                  width: '80%',
                  borderRadius: 2,
                  backgroundColor: '#2a2b35',
                }}
              />
              <View
                style={{
                  height: 4,
                  width: '80%',
                  borderRadius: 2,
                  backgroundColor: '#2a2b35',
                  outlineWidth: 1,
                  outlineColor: '#ff6b6b',
                }}
              />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ fontSize: 12.5, color: t.text }}>
                <Text style={{ fontWeight: 600 }}>刚截的图</Text>
                <Text style={{ color: t.text3 }}>
                  {' '}
                  · 1 分钟前 · 1170 × 2532
                </Text>
              </Text>
            </View>
            <View
              role="button"
              accessibilityLabel="附加刚截的图"
              focusable
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: t.line2,
              }}
              hoverStyle={{ backgroundColor: t.card2 }}
            >
              <Text style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                附加
              </Text>
            </View>
          </View>
        ) : null}

        <View
          style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}
        >
          <Input
            value={draft()}
            placeholder={PLACEHOLDERS[selected()]}
            multiline
            submitBehavior="submit"
            onChange={(e) => draft.set(e.value)}
            onSubmit={() => send()}
            accessibilityLabel="消息"
            style={{
              height: 44,
              fontFamily: SANS,
              fontSize: 14,
              lineHeight: 21,
              color: t.text,
              placeholderColor: t.text3,
              backgroundColor: 'transparent',
              selectionColor: '#ff8fa8',
            }}
          />
        </View>

        <View
          style={{
            paddingHorizontal: 10,
            paddingBottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconButton name="attach" label="附加文件" size={15} />
          <IconButton name="camera" label="截图" size={15} />
          <View
            role="button"
            accessibilityLabel="模型：claude-opus-4 · 高"
            style={{
              height: 26,
              paddingHorizontal: 9,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.line2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
            hoverStyle={{ backgroundColor: t.card2 }}
          >
            <Icon name="sparkle" size={11} color={t.text2} />
            <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text2 }}>
              claude-opus-4 · 高
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: SANS, fontSize: 10, color: t.text3 }}>
            ↵ 发送 · ⇧↵ 换行
          </Text>
          <View
            role="button"
            accessibilityLabel="发送"
            accessibilityState={{ disabled: empty() }}
            disabled={empty()}
            onPress={() => send()}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundImage: DAWN,
              opacity: empty() ? 0.4 : 1,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 6,
            }}
            hoverStyle={{ filter: 'brightness(1.08)' }}
            activeStyle={{ opacity: 0.75 }}
          >
            <Icon name="send" size={15} color="#ffffff" />
          </View>
        </View>
      </View>
    </View>
  );
}
