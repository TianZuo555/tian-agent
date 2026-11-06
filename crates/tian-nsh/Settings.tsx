import { Scroll, Text, View } from 'nsh';
import { Slider, Switch } from 'nsh/base';
import { palette } from './theme';
import {
  BANDS,
  PAGE_TITLES,
  ambientLight,
  captureDefault,
  captureSuggest,
  chatSize,
  codeWrap,
  followSystem,
  glass,
  look,
  pointerLight,
  reduceMotion,
  settingsOpen,
  settingsPage,
} from './state';
import {
  devices,
  improvements,
  intents,
  providers,
  skills,
  usage,
} from './data';
import { Btn, Card, Dot, Icon, IconButton, Kbd, Serif, Tag } from './ui';
import { MONO } from './fonts';

function Group(props: { title: string; children?: any; note?: string }) {
  const t = palette(look());
  return (
    <View style={{ gap: 8, marginBottom: 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.2,
            color: t.text3,
          }}
        >
          {props.title.toUpperCase()}
        </Text>
        {props.note ? (
          <Text style={{ fontSize: 11.5, color: t.text3 }}>{props.note}</Text>
        ) : null}
      </View>
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.card,
          boxShadow: t.rim,
          overflow: 'hidden',
        }}
      >
        {props.children}
      </View>
    </View>
  );
}

function Row(props: {
  label: string;
  note?: string;
  children?: any;
  last?: boolean;
}) {
  const t = palette(look());
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: props.last ? 0 : 1,
        borderBottomColor: t.line,
        minHeight: 48,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13, color: t.text }}>{props.label}</Text>
        {props.note ? (
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: t.text3 }}>
            {props.note}
          </Text>
        ) : null}
      </View>
      {props.children}
    </View>
  );
}

function Seg(props: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = palette(look());
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.card2,
        borderRadius: 9,
        padding: 2,
      }}
    >
      {props.options.map((option) => (
        <View
          role="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: props.value === option.id }}
          focusable
          onPress={() => props.onChange(option.id)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 7,
            backgroundColor:
              props.value === option.id ? t.bubble : 'transparent',
          }}
          hoverStyle={{
            backgroundColor: props.value === option.id ? t.bubble : t.line,
          }}
        >
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: props.value === option.id ? 600 : 400,
              color: props.value === option.id ? t.bubbleText : t.text2,
            }}
          >
            {option.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Sw(props: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  const t = palette(look());
  return (
    <Switch
      checked={props.on}
      onChange={(e) => props.onChange(e.checked)}
      accessibilityLabel={props.label}
      trackStyle={{
        width: 34,
        height: 20,
        borderRadius: 999,
        backgroundColor: props.on ? t.text : t.card2,
        borderWidth: 1,
        borderColor: props.on ? t.text : t.line2,
      }}
      thumbStyle={{
        width: 14,
        height: 14,
        borderRadius: 999,
        backgroundColor: props.on ? t.bubbleText : t.text3,
        margin: 2,
        transform: [{ translateX: props.on ? 14 : 0 }],
      }}
    />
  );
}

function PageHead(props: { title: string; note?: string }) {
  return (
    <View style={{ gap: 6, marginBottom: 24 }}>
      <Serif size={32}>{props.title}</Serif>
      {props.note ? (
        <Text style={{ fontSize: 13, color: palette(look()).text2 }}>
          {props.note}
        </Text>
      ) : null}
    </View>
  );
}

export function Settings() {
  const t = palette(look());
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        backgroundColor:
          look() === 'day'
            ? 'rgba(250, 248, 244, 0.95)'
            : 'rgba(10, 11, 16, 0.95)',
        backdropFilter: 'blur(30px) saturate(1.4)',
        flexDirection: 'row',
      }}
    >
      <View
        style={{
          width: 284,
          flexShrink: 0,
          borderRightWidth: 1,
          borderRightColor: t.line,
          backgroundColor: t.side,
        }}
      >
        <View
          desktop={{ windowDrag: true }}
          style={{
            height: 64,
            paddingHorizontal: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="gear" size={16} color={t.text2} />
          <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            设置
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton
            name="x"
            label="关闭设置"
            onPress={() => settingsOpen.set(false)}
            size={15}
          />
        </View>
        <Scroll
          style={{ flex: 1 }}
          contentStyle={{ paddingHorizontal: 10, paddingBottom: 20 }}
        >
          <Each of={BANDS}>
            {(band) => (
              <View style={{ marginBottom: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingTop: 14,
                    paddingBottom: 6,
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
                    {band().label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: t.text3 }}>
                    {band().note}
                  </Text>
                </View>
                <Each of={band().pages}>
                  {(page) => (
                    <View
                      role="button"
                      accessibilityLabel={page().label}
                      accessibilityState={{
                        selected: settingsPage() === page().id,
                      }}
                      focusable
                      onPress={() => settingsPage.set(page().id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 10,
                        backgroundColor:
                          settingsPage() === page().id ? t.card : 'transparent',
                      }}
                      hoverStyle={{
                        backgroundColor:
                          settingsPage() === page().id ? t.card : t.card2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          flex: 1,
                          color:
                            settingsPage() === page().id ? t.text : t.text2,
                          fontWeight: settingsPage() === page().id ? 600 : 400,
                        }}
                      >
                        {page().label}
                      </Text>
                      {page().badge ? (
                        <Text
                          style={{
                            fontFamily: MONO,
                            fontSize: 9.5,
                            color: t.text3,
                          }}
                        >
                          {page().badge}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
        </Scroll>
        <View
          style={{
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: t.line,
          }}
        >
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
            Tian Agent 1.1.0 · 服务器 1.1.0
          </Text>
        </View>
      </View>

      <Scroll
        style={{ flex: 1 }}
        contentStyle={{
          paddingHorizontal: 48,
          paddingTop: 56,
          paddingBottom: 80,
        }}
      >
        <View style={{ maxWidth: 620, width: '100%', alignSelf: 'center' }}>
          <If when={settingsPage() === 'appearance'}>
            <Appearance />
          </If>
          <If when={settingsPage() === 'general'}>
            <General />
          </If>
          <If when={settingsPage() === 'capture'}>
            <Capture />
          </If>
          <If when={settingsPage() === 'notify'}>
            <Notify />
          </If>
          <If when={settingsPage() === 'model'}>
            <Model />
          </If>
          <If when={settingsPage() === 'providers'}>
            <Providers />
          </If>
          <If when={settingsPage() === 'workers'}>
            <Workers />
          </If>
          <If when={settingsPage() === 'skills'}>
            <Skills />
          </If>
          <If when={settingsPage() === 'server'}>
            <Server />
          </If>
          <If when={settingsPage() === 'channels'}>
            <Channels />
          </If>
          <If when={settingsPage() === 'usage'}>
            <Usage />
          </If>
          <If when={settingsPage() === 'improve'}>
            <Improve />
          </If>
        </View>
      </Scroll>
    </View>
  );
}

function Appearance() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="外观" note={PAGE_TITLES.appearance.note} />
      <Group title="主题">
        <Row label="外观" note="跟随系统读取 macOS 的外观设置。" last>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: t.card2,
              borderRadius: 9,
              padding: 2,
            }}
          >
            {[
              { id: 'system', label: '跟随系统', icon: 'monitor' as const },
              { id: 'night', label: '夜', icon: 'moon' as const },
              { id: 'day', label: '昼', icon: 'sun' as const },
            ].map((option) => {
              const active = () =>
                option.id === 'system'
                  ? followSystem()
                  : !followSystem() && look() === option.id;
              return (
                <View
                  role="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: active() }}
                  focusable
                  onPress={() => {
                    if (option.id === 'system') {
                      followSystem.set(true);
                    } else {
                      followSystem.set(false);
                      look.set(option.id as 'night' | 'day');
                    }
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    borderRadius: 7,
                    backgroundColor: active() ? t.bubble : 'transparent',
                  }}
                  hoverStyle={{ backgroundColor: active() ? t.bubble : t.line }}
                >
                  <Icon
                    name={option.icon}
                    size={11}
                    color={active() ? t.bubbleText : t.text2}
                  />
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: active() ? 600 : 400,
                      color: active() ? t.bubbleText : t.text2,
                    }}
                  >
                    {option.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </Row>
      </Group>

      <Group title="光影" note="只影响这台设备。">
        <Row
          label="玻璃强度"
          note="0 时所有表面不透明，适合低电量或「降低透明度」。"
        >
          <View
            style={{
              width: 190,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Slider
              style={{ flex: 1 }}
              value={glass()}
              min={0}
              max={100}
              step={10}
              onChange={(e) =>
                glass.set(Array.isArray(e.value) ? e.value[0] : e.value)
              }
              accessibilityLabel="玻璃强度"
              trackStyle={{ flex: 1, height: 20, justifyContent: 'center' }}
              indicatorStyle={{
                height: 4,
                borderRadius: 999,
                backgroundColor: t.line2,
              }}
              rangeStyle={{
                height: 4,
                borderRadius: 999,
                backgroundColor: t.text2,
              }}
              thumbStyle={{
                width: 14,
                height: 14,
                borderRadius: 999,
                backgroundColor: t.text,
              }}
            />
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: t.text3,
                width: 24,
                textAlign: 'right',
              }}
            >
              {glass()}
            </Text>
          </View>
        </Row>
        <Row label="指针光" note="悬停卡片时跟随指针的柔光。">
          <Sw
            on={pointerLight()}
            onChange={(on) => pointerLight.set(on)}
            label="指针光"
          />
        </Row>
        <Row label="Chief 环境光" note="Chief 光球投到窗口左上的暖光。">
          <Sw
            on={ambientLight()}
            onChange={(on) => ambientLight.set(on)}
            label="Chief 环境光"
          />
        </Row>
        <Row label="减少动效" note="开启后动画停止，状态只用颜色表示。" last>
          <Sw
            on={reduceMotion()}
            onChange={(on) => reduceMotion.set(on)}
            label="减少动效"
          />
        </Row>
      </Group>

      <Group title="文字">
        <Row label="对话字号" note="只改消息正文，界面文字不变。">
          <Seg
            options={[
              { id: '14', label: '14 px' },
              { id: '15', label: '15 px' },
              { id: '16', label: '16 px' },
            ]}
            value={String(chatSize())}
            onChange={(id) => chatSize.set(Number(id))}
          />
        </Row>
        <Row label="代码换行" note="代码块和改动视图默认不换行。" last>
          <Sw
            on={codeWrap()}
            onChange={(on) => codeWrap.set(on)}
            label="代码换行"
          />
        </Row>
      </Group>
    </View>
  );
}

function Capture() {
  const t = palette(look());
  const keys = [
    {
      label: '框选区域发给 Tian',
      note: '调用系统的框选界面，然后弹出发送浮层。',
      keys: ['⌥', '⇧', 'S'],
    },
    { label: '截取窗口发给 Tian', note: '', keys: ['⌥', '⇧', 'W'] },
  ];
  return (
    <View>
      <PageHead title="截图" note={PAGE_TITLES.capture.note} />
      <Group title="快捷键">
        {keys.map((key, index) => (
          <Row
            label={key.label}
            note={key.note}
            last={index === keys.length - 1}
          >
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {key.keys.map((k) => (
                <Kbd>{k}</Kbd>
              ))}
            </View>
          </Row>
        ))}
      </Group>
      <Group title="默认">
        <Row label="默认发给" note="浮层里可以临时改。">
          <Seg
            options={[
              { id: 'conversation', label: '当前对话' },
              { id: 'chief', label: 'Chief' },
            ]}
            value={captureDefault()}
            onChange={(id) =>
              captureDefault.set(id === 'chief' ? 'chief' : 'conversation')
            }
          />
        </Row>
        <Row
          label="「刚截的图」"
          note="在输入框上方提示新截图。只提示，不自动上传。"
        >
          <Sw
            on={captureSuggest()}
            onChange={(on) => captureSuggest.set(on)}
            label="刚截的图"
          />
        </Row>
        <Row label="时间窗口">
          <Seg
            options={[
              { id: '1', label: '1 分钟' },
              { id: '5', label: '5 分钟' },
              { id: '15', label: '15 分钟' },
            ]}
            value="5"
            onChange={() => {}}
          />
        </Row>
        <Row label="截图目录" note="读取系统截图设置。">
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text2 }}>
            ~/Desktop
          </Text>
        </Row>
        <Row
          label="上传前缩小"
          note="长边超过 2560 px 时缩小，节省 token。"
          last
        >
          <Sw on onChange={() => {}} label="上传前缩小" />
        </Row>
      </Group>
      <Group title="系统权限">
        <Row label="屏幕录制" note="截取其他 App 的窗口需要这个权限。">
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: t.card2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Dot state="done" size={6} />
            <Text style={{ fontSize: 11, color: t.text }}>已授权</Text>
          </View>
        </Row>
      </Group>
    </View>
  );
}

function Notify() {
  return (
    <View>
      <PageHead title="通知" note={PAGE_TITLES.notify.note} />
      <Group title="状态">
        <Row label="等你" note="审批、提问、需要你决定的事。">
          <Sw on onChange={() => {}} label="等你" />
        </Row>
        <Row label="失败">
          <Sw on onChange={() => {}} label="失败" />
        </Row>
        <Row label="完成" note="Run 待审阅、任务完成。">
          <Sw on onChange={() => {}} label="完成" />
        </Row>
        <Row label="工作中" note="从不通知。">
          <Sw on={false} onChange={() => {}} label="工作中" />
        </Row>
      </Group>
      <Group title="Chief 主动消息" note="早报、提醒、主动建议。">
        <Row label="频率">
          <Seg
            options={[
              { id: 'off', label: '关' },
              { id: 'less', label: '少' },
              { id: 'more', label: '多' },
            ]}
            value="less"
            onChange={() => {}}
          />
        </Row>
        <Row label="勿扰时段" note="期间只记入对话，不发通知。" last>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: palette(look()).text2,
            }}
          >
            23:00 – 08:00
          </Text>
        </Row>
      </Group>
    </View>
  );
}

function General() {
  return (
    <View>
      <PageHead title="通用" />
      <Group title="应用">
        <Row label="语言">
          <Seg
            options={[
              { id: 'zh', label: '简体中文' },
              { id: 'en', label: 'English' },
            ]}
            value="zh"
            onChange={() => {}}
          />
        </Row>
        <Row label="登录时打开">
          <Sw on onChange={() => {}} label="登录时打开" />
        </Row>
        <Row label="菜单栏图标" note="显示 Chief 状态和正在工作的 Worker 数。">
          <Sw on onChange={() => {}} label="菜单栏图标" />
        </Row>
        <Row label="快速问 Chief">
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Kbd>⌥</Kbd>
            <Kbd>Space</Kbd>
          </View>
        </Row>
        <Row label="发送" last>
          <Seg
            options={[
              { id: 'enter', label: '↵ 发送' },
              { id: 'cmd', label: '⌘↵ 发送' },
            ]}
            value="enter"
            onChange={() => {}}
          />
        </Row>
      </Group>
    </View>
  );
}

function Model() {
  const t = palette(look());
  const rows = [
    { label: 'Chief', note: '全局对话的默认值。', value: 'claude-opus-4 · 高' },
    {
      label: 'Manager',
      note: '所有项目的默认值；项目设置可以覆盖。',
      value: 'claude-sonnet-4 · 中',
    },
  ];
  return (
    <View>
      <PageHead title="模型" note={PAGE_TITLES.model.note} />
      <Group title="默认模型">
        {rows.map((row, i) => (
          <Row label={row.label} note={row.note} last={i === rows.length - 1}>
            <View
              role="button"
              accessibilityLabel={`${row.label} 模型`}
              focusable
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: t.line2,
              }}
              hoverStyle={{ backgroundColor: t.card2 }}
            >
              <Text
                style={{ fontFamily: MONO, fontSize: 10.5, color: t.text2 }}
              >
                {row.value}
              </Text>
              <Icon name="caretDown" size={10} color={t.text3} />
            </View>
          </Row>
        ))}
      </Group>
      <Group title="记忆提取" note="后台 Memory Worker。">
        <Row label="模式" note="启发式不调用模型。">
          <Seg
            options={[
              { id: 'heuristic', label: '启发式' },
              { id: 'model', label: '模型' },
            ]}
            value="heuristic"
            onChange={() => {}}
          />
        </Row>
      </Group>
    </View>
  );
}

function Providers() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="提供方" note={PAGE_TITLES.providers.note} />
      <Group title="已配置">
        {providers.map((provider, i) => (
          <Row
            label={provider.name}
            note={provider.note}
            last={i === providers.length - 1}
          >
            {provider.state === '添加' ? (
              <Btn variant="ghost">添加</Btn>
            ) : (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Dot state="done" size={6} />
                <Text style={{ fontSize: 11.5, color: t.text2 }}>
                  {provider.state}
                </Text>
              </View>
            )}
          </Row>
        ))}
      </Group>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn variant="primary">添加提供方</Btn>
        <Btn variant="ghost">从服务器同步</Btn>
      </View>
    </View>
  );
}

function Workers() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="Worker 与 Intent" note={PAGE_TITLES.workers.note} />
      <Group title="Intent">
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 16,
            paddingVertical: 8,
            gap: 8,
          }}
        >
          {['名字', 'Runtime', '模型', '思考'].map((h) => (
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                letterSpacing: 0.9,
                color: t.text3,
                width: h === '名字' ? 90 : 76,
              }}
            >
              {h.toUpperCase()}
            </Text>
          ))}
        </View>
        {intents.map((intent) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: t.line,
            }}
          >
            <View
              style={{
                width: 90,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 11.5, color: t.text }}>
                {intent.name}
              </Text>
              {intent.def ? <Tag>默认</Tag> : null}
            </View>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: t.text2,
                width: 76,
              }}
            >
              {intent.runtime}
            </Text>
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: t.text2,
                width: 76,
              }}
            >
              {intent.model}
            </Text>
            <Text style={{ fontSize: 11.5, color: t.text2, width: 76 }}>
              {intent.thinking}
            </Text>
          </View>
        ))}
        <View
          style={{ padding: 12, borderTopWidth: 1, borderTopColor: t.line }}
        >
          <Btn variant="ghost">新建 Intent</Btn>
        </View>
      </Group>
      <Group title="执行">
        <Row label="同时运行的 Worker" note="超过时排队。">
          <Text style={{ fontFamily: MONO, fontSize: 11.5, color: t.text }}>
            3
          </Text>
        </Row>
        <Row
          label="Seatbelt 沙箱"
          note="新项目的默认模式。每个项目可以在项目设置里改（D22）。"
          last
        >
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text2 }}>
            workspace-write
          </Text>
        </Row>
      </Group>
    </View>
  );
}

function Skills() {
  return (
    <View>
      <PageHead title="技能" note={PAGE_TITLES.skills.note} />
      <Group title="已安装">
        {skills.map((skill, i) => (
          <Row
            label={skill.name}
            note={skill.note}
            last={i === skills.length - 1}
          >
            {skill.warn ? (
              <Btn variant="primary">批准</Btn>
            ) : (
              <Sw on onChange={() => {}} label={skill.name} />
            )}
          </Row>
        ))}
      </Group>
    </View>
  );
}

function Server() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="服务器与设备" note={PAGE_TITLES.server.note} />
      <Card
        style={{
          marginBottom: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: t.card2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundImage:
              'radial-gradient(circle at 0% 0%, rgba(255,111,145,0.18), transparent 70%)',
          }}
        >
          <Icon name="desktop" size={20} color={t.text2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            mac-studio
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
            wss://mac-studio.tail3c1.ts.net:8787 · Pi Server
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
            1.1.0 · 18 ms
          </Text>
        </View>
        <Btn>重新连接</Btn>
      </Card>
      <Group title="已配对的设备">
        {devices.map((device, i) => (
          <Row
            label={device.name}
            note={device.note}
            last={i === devices.length - 1}
          >
            <Text style={{ fontSize: 11.5, color: t.text3 }}>
              {device.meta}
            </Text>
          </Row>
        ))}
      </Group>
      <Group title="本机缓存">
        <Row label="离线缓存" note="上限 200 MiB，按对话淘汰。">
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text2 }}>
            86 MiB
          </Text>
        </Row>
        <Row label="清除缓存" last>
          <Btn variant="ghost">清除</Btn>
        </Row>
      </Group>
    </View>
  );
}

function Channels() {
  const t = palette(look());
  const rows = [
    {
      name: 'Telegram',
      note: '@tian_chief_bot · 白名单 1 个 chat',
      action: '已连接',
    },
    {
      name: '微信 · ClawBot',
      note: '扫码登录，24 小时保活。',
      action: '扫码连接',
    },
    { name: 'Inbox 文件邮箱', note: '.tian/inbox', action: '启用' },
  ];
  return (
    <View>
      <PageHead title="渠道" note={PAGE_TITLES.channels.note} />
      <Group title="连接的渠道">
        {rows.map((row, i) => (
          <Row label={row.name} note={row.note} last={i === rows.length - 1}>
            {row.action === '已连接' ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Dot state="done" size={6} />
                <Text style={{ fontSize: 11.5, color: t.text2 }}>
                  {row.action}
                </Text>
              </View>
            ) : (
              <Btn variant="ghost">{row.action}</Btn>
            )}
          </Row>
        ))}
      </Group>
    </View>
  );
}

function Usage() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="用量" note="最近 26 周。" />
      <Group title="按模型">
        {usage.map((row, i) => (
          <View
            style={{
              padding: 16,
              borderBottomWidth: i === usage.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
              gap: 8,
            }}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}
            >
              <Text style={{ fontSize: 13, color: t.text }}>{row.name}</Text>
              <Text style={{ fontSize: 11.5, color: t.text3 }}>{row.note}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontFamily: MONO, fontSize: 11.5, color: t.text }}>
                {row.cost}
              </Text>
            </View>
            <View
              style={{
                height: 4,
                borderRadius: 999,
                backgroundColor: t.card2,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${row.share * 100}%`,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: t.text2,
                }}
              />
            </View>
          </View>
        ))}
      </Group>
      <Group title="每周用量">
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 3,
            height: 92,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          {Array.from({ length: 26 }).map((_, i) => {
            const h = 8 + Math.round(Math.abs(Math.sin(i * 1.7)) * 54);
            return (
              <View
                style={{
                  flex: 1,
                  height: h,
                  borderRadius: 2,
                  backgroundColor: i > 21 ? t.text2 : t.line2,
                }}
              />
            );
          })}
        </View>
      </Group>
    </View>
  );
}

function Improve() {
  const t = palette(look());
  return (
    <View>
      <PageHead title="改进日志" note={PAGE_TITLES.improve.note} />
      <Group title="最近">
        {improvements.map((entry, i) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderBottomWidth: i === improvements.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
            }}
          >
            <Dot state={entry.state} size={6} />
            <View style={{ flex: 1, gap: 2 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Tag>{entry.kind}</Tag>
                <Text style={{ fontSize: 13, color: t.text }}>
                  {entry.title}
                </Text>
              </View>
              <Text style={{ fontSize: 11.5, color: t.text3 }}>
                {entry.note}
              </Text>
            </View>
            <Icon name="chevronRight" size={12} color={t.text3} />
          </View>
        ))}
      </Group>
    </View>
  );
}
