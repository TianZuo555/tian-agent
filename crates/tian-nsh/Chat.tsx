import { effect, Scroll, Text, View, type ScrollRef } from 'nsh';
import { palette, HUES } from './theme';
import { goTo, inspector, look, paletteOpen, selected, sent } from './state';
import {
  Agent,
  ApprovalCard,
  CodeBlock,
  HandoffCard,
  Md,
  MiniRunCard,
  ProgressCard,
  RunSummary,
  Shot,
  StreamingCaret,
  UserBubble,
} from './blocks';
import { Dot, Divider, Icon, IconButton, Orb, Planet } from './ui';
import { Composer } from './Composer';
import { SERIF } from './fonts';

function fade(hex: string) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0)`;
}

function Header() {
  const t = palette(look());
  return (
    <View
      desktop={{ windowDrag: true }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        zIndex: 5,
        backgroundColor: t.winSolid,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 24,
        paddingRight: 18,
      }}
    >
      <If when={selected() === 'chief'}>
        <Orb size={30} thinking />
      </If>
      <If when={selected() === 'atlas'}>
        <Planet hue={HUES.atlas} size={30} state="work" moons={2} />
      </If>
      <If when={selected() === 'juno'}>
        <Planet hue={HUES.juno} size={30} state="wait" moons={0} />
      </If>
      <If when={selected() === 'vega'}>
        <Planet hue={HUES.vega} size={30} state="idle" moons={0} />
      </If>
      <View style={{ gap: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
          {selected() === 'chief'
            ? 'Chief'
            : selected() === 'atlas'
              ? 'Atlas'
              : selected() === 'juno'
                ? 'Juno'
                : 'Vega'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Dot
            state={
              selected() === 'chief' || selected() === 'atlas'
                ? 'work'
                : selected() === 'juno'
                  ? 'wait'
                  : 'idle'
            }
          />
          <Text style={{ fontSize: 11.5, color: t.text3 }}>
            {selected() === 'chief'
              ? '工作中 · 全局 · claude-opus-4 · 思考 高'
              : selected() === 'atlas'
                ? 'Manager · tian-agent · claude-sonnet-4 · 2 个 Worker'
                : selected() === 'juno'
                  ? 'Manager · healthapp · 等待你决定'
                  : 'Manager · d2r-mobile · 空闲'}
          </Text>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <IconButton
        name="search"
        label="搜索对话"
        onPress={() => paletteOpen.set(true)}
      />
      <IconButton
        name="sidebar"
        label={inspector() ? '收起检查器' : '打开检查器'}
        onPress={() => inspector.set(!inspector())}
      />
    </View>
  );
}

const GREETING = `### 早上好，Tian。

今天有三件事值得你看一眼：

1. **Atlas** 昨晚完成了 \`Run #11\`，已经 Land 到 \`main\`。
2. **Juno** 在等你决定 healthapp 的数据库迁移方式。
3. 目标「每周训练三次」本周进度 **2 / 3**，周日前还差一次。

| 项目 | Manager | 状态 | 下一步 |
| --- | --- | --- | --- |
| tian-agent | Atlas | 空闲 | — |
| healthapp | Juno | 等你 | 迁移方式 |
| d2r-mobile | Vega | 空闲 | — |
`;

function ChiefConversation() {
  return (
    <View style={{ gap: 22 }}>
      <Divider label="今天 · 11 月 6 日 周五" />
      <Agent name="Chief" meta="09:00 · 主动">
        <Md markdown={GREETING} />
      </Agent>
      <UserBubble
        text="手机上收到的消息重复了，截图在这。让 Atlas 看一下。"
        meta="10:24 · iPhone"
      >
        <Shot />
      </UserBubble>
      <Agent name="Chief" meta="10:25">
        <Md markdown="看到了：截图里同一条消息出现了两次，时间相同。这像是重连后服务端重放了事件，客户端没有去重。我把它交给 Atlas。" />
        <HandoffCard onOpen={() => goTo('atlas')} />
      </Agent>
      <Agent name="Chief" meta="10:42 · Atlas 汇报">
        <Md markdown="Atlas 汇报：`Run #12` 完成，测试全部通过。根因是 resume 时客户端没有按 `messageId` 去重。改动等你审阅。" />
        <RunSummary
          title="Run #12 · 修复重连后消息重复"
          branch="fix/ws-dedupe → main · 第 2 次尝试"
          onOpenDiff={() => {
            inspector.set(true);
            goTo('atlas');
          }}
        />
      </Agent>
      <Agent name="Chief" meta="10:58">
        <Md markdown="Atlas 顺手开了两个 Run，补测试和文档。只看状态：" />
        <MiniRunCard />
      </Agent>
      <Agent name="Chief" meta="11:06 · 输出中">
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Text
              style={{
                fontSize: 15,
                lineHeight: 25.5,
                color: palette(look()).text,
              }}
            >
              选好之后，Juno 会直接派 Worker 执行，结束后我再告诉你。
            </Text>
            <StreamingCaret />
          </View>
          <View
            role="button"
            accessibilityLabel="去 Juno 那里决定"
            onPress={() => goTo('juno')}
            focusable
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 9,
              borderWidth: 1,
              borderColor: palette(look()).line2,
            }}
            hoverStyle={{ backgroundColor: palette(look()).card2 }}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: palette(look()).text,
              }}
            >
              去 Juno 那里决定
            </Text>
            <Icon name="chevronRight" size={11} color={palette(look()).text3} />
          </View>
        </View>
      </Agent>
      <Each of={sent()}>
        {(text) => <UserBubble text={text()} meta="现在 · 这台 Mac" />}
      </Each>
    </View>
  );
}

function AtlasConversation() {
  return (
    <View style={{ gap: 22 }}>
      <Divider label="Chief 委派 · 10:25" />
      <Agent name="Atlas" meta="10:26">
        <Md markdown="收到。我读了 `src/service/client.ts` 的重连逻辑：resume 时服务端重放 cursor 之后的事件，客户端没有按 `messageId` 去重。关键在这里：" />
        <CodeBlock />
        <Md markdown="我拆成一个 Run 修复，intent 用 `simple`。" />
      </Agent>
      <View>
        <RunSummary
          title="Run #12 · 修复重连后消息重复"
          branch="fix/ws-dedupe → main · pi · claude-sonnet-4 · intent simple"
          onOpenDiff={() => inspector.set(true)}
        />
      </View>
      <UserBubble
        text="再开一个 Run 补测试，覆盖断网 30 秒以上的情况。协议文档也顺手更新。"
        meta="10:44 · Mac"
      />
      <Agent name="Atlas" meta="10:45">
        <Md
          markdown={
            '好。\n\n- `#13` 补测试，intent `review`；\n- `#14` 更新 `docs/spec/protocol.md` 的 resume 说明。'
          }
        />
      </Agent>
      <ProgressCard
        id="#13"
        title="断网 30 秒以上的重连测试"
        elapsed="04:12"
        stage={3}
        line="正在跑测试 · 第 2 次尝试"
        meta="2 个文件 · +64 −3 · pi · claude-sonnet-4 · intent review"
        steps={5}
        milestones={[
          { time: '10:46', text: '读了 5 个文件，找到重连的入口', bad: false },
          { time: '10:48', text: '新增 tests/reconnect.test.ts', bad: false },
          { time: '10:49', text: '第 1 次测试失败：2 个用例超时', bad: true },
          { time: '10:50', text: '把假时钟换成可控的 FakeTimers', bad: false },
          { time: '10:50', text: '第 2 次测试进行中', bad: false },
        ]}
      />
      <ProgressCard
        id="#14"
        title="更新协议文档的 resume 说明"
        elapsed="00:38"
        stage={1}
        line="读了 docs/spec/protocol.md 和 2 个相关文件"
        meta="pi · claude-haiku-4 · intent docs"
        steps={2}
        milestones={[
          { time: '10:51', text: '读了 3 个文件', bad: false },
          { time: '10:51', text: '起草 resume 一节的改动', bad: false },
        ]}
      />
    </View>
  );
}

function JunoConversation() {
  return (
    <View style={{ gap: 22 }}>
      <Divider label="今天 10:58" />
      <Agent name="Juno" meta="10:58">
        <Md markdown="`workouts` 表要拆出 `sets`，当前 41 万行。两种方式都能做，差别在停服时间：" />
        <ApprovalCard onAsk={() => {}} />
      </Agent>
    </View>
  );
}

function VegaEmpty() {
  const t = palette(look());
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
      }}
    >
      <View style={{ alignItems: 'center', gap: 12, maxWidth: 420 }}>
        <Planet hue={HUES.vega} size={64} state="idle" moons={0} />
        <Text style={{ fontSize: 24, color: t.text, fontFamily: SERIF }}>
          Vega 在待命
        </Text>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: t.text2,
            textAlign: 'center',
          }}
        >
          d2r-mobile 没有进行中的 Run。上次汇报是 3 小时前。
        </Text>
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 4,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {['检查依赖更新', '跑一遍测试', '总结本周改动'].map((label) => (
            <View
              role="button"
              accessibilityLabel={label}
              focusable
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: t.line2,
              }}
              hoverStyle={{ backgroundColor: t.card2 }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: 500, color: t.text }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

let streamRef: ScrollRef | null = null;
let lastSent = 0;
let lastSelected = 'chief';

export function Chat() {
  const t = palette(look());

  effect(() => {
    const id = selected();
    if (id !== lastSelected) {
      lastSelected = id;
      streamRef?.scrollTo({ y: 0, animated: false });
    }
  });

  effect(() => {
    const count = sent().length;
    if (count > lastSent) {
      lastSent = count;
      streamRef?.scrollToEnd({ animated: true });
    }
  });
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Header />
      <Scroll
        testID="stream"
        ref={(ref) => {
          streamRef = ref;
        }}
        style={{ flex: 1 }}
        contentStyle={{ paddingTop: 76, paddingBottom: 210 }}
      >
        <View
          style={{
            maxWidth: 720,
            width: '100%',
            alignSelf: 'center',
            paddingHorizontal: 32,
          }}
        >
          <If when={selected() === 'chief'}>
            <ChiefConversation />
          </If>
          <If when={selected() === 'atlas'}>
            <AtlasConversation />
          </If>
          <If when={selected() === 'juno'}>
            <JunoConversation />
          </If>
          <If when={selected() === 'vega'}>
            <VegaEmpty />
          </If>
        </View>
      </Scroll>
      <View
        style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          height: 28,
          backgroundImage: `linear-gradient(${t.winSolid}, ${fade(t.winSolid)})`,
        }}
      />
      <Composer />
    </View>
  );
}
