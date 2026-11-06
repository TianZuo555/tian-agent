import { Text, View, signal } from 'nsh';
import { TextView } from 'nsh/base';
import { DAWN, palette } from './theme';
import { look, migration, reduceMotion } from './state';
import { MONO, SANS, SERIF } from './fonts';
import {
  Author,
  Btn,
  Card,
  CardLabel,
  Dot,
  Icon,
  MiniRail,
  Orb,
  Planet,
  Tag,
} from './ui';

export function Md(props: { markdown: string; streaming?: boolean }) {
  const t = palette(look());
  return (
    <TextView
      markdown={props.markdown}
      selectable
      options={{ streaming: props.streaming ?? false }}
      styles={{
        root: {
          fontFamily: SANS,
          fontSize: 15,
          lineHeight: 25.5,
          color: t.text,
        },
        paragraph: { marginBottom: 10 },
        heading3: {
          fontFamily: SERIF,
          fontSize: 24,
          lineHeight: 28.8,
          color: t.text,
          fontWeight: 400,
          marginTop: 4,
          marginBottom: 8,
        },
        heading2: {
          fontFamily: SERIF,
          fontSize: 28,
          lineHeight: 33,
          color: t.text,
          fontWeight: 400,
        },
        strong: { fontWeight: 600, color: t.text },
        code: {
          fontFamily: MONO,
          fontSize: 12.9,
          color: t.text,
          backgroundColor: t.code,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 6,
          paddingHorizontal: 5,
          paddingVertical: 1,
        },
        listMarker: { fontFamily: MONO, fontSize: 12.75, color: t.text3 },
        listItem: { marginBottom: 3 },
        codeBlock: {
          backgroundColor: t.code,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          marginVertical: 4,
        },
        codeBlockCode: {
          fontFamily: MONO,
          fontSize: 12.5,
          lineHeight: 20.6,
          color: t.text,
        },
        blockquote: {
          borderLeftWidth: 2,
          borderLeftColor: '#ff6f91',
          paddingLeft: 14,
          color: t.text2,
          marginBottom: 12,
        },
        table: { marginVertical: 4 },
        tableRow: { borderBottomWidth: 1, borderBottomColor: t.line },
        tableHeaderCell: {
          fontFamily: MONO,
          fontSize: 10.5,
          color: t.text3,
          paddingHorizontal: 10,
          paddingVertical: 6,
        },
        tableCell: {
          fontSize: 13,
          color: t.text,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        rule: { borderTopWidth: 1, borderTopColor: t.line, marginVertical: 12 },
        link: {
          color: t.text,
          textDecorationLine: 'underline',
          textDecorationColor: t.text3,
        },
        summary: { fontSize: 13, color: t.text2 },
      }}
    />
  );
}

export function Agent(props: { name: string; meta: string; children?: any }) {
  return (
    <View style={{ gap: 0 }}>
      <Author name={props.name} meta={props.meta} />
      <View style={{ gap: 10 }}>{props.children}</View>
    </View>
  );
}

export function UserBubble(props: {
  text: string;
  meta?: string;
  children?: any;
}) {
  const t = palette(look());
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth: '78%',
        alignItems: 'flex-end',
        gap: 6,
      }}
    >
      {props.children}
      <View
        style={{
          backgroundColor: t.bubble,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 20,
          borderBottomRightRadius: 6,
        }}
      >
        <Text style={{ fontSize: 14.5, lineHeight: 22.5, color: t.bubbleText }}>
          {props.text}
        </Text>
      </View>
      {props.meta ? (
        <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
          {props.meta}
        </Text>
      ) : null}
    </View>
  );
}

export function Shot() {
  return (
    <View
      role="image"
      accessibilityLabel="截图：手机上同一条消息出现两次"
      style={{
        width: 240,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#3a3b46',
        backgroundColor: '#101117',
        overflow: 'hidden',
        boxShadow: '0 10px 30px -12px rgba(0, 0, 0, 0.5)',
      }}
    >
      <View
        style={{
          height: 20,
          backgroundColor: '#1a1b23',
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          gap: 4,
        }}
      >
        {[0, 1, 2].map(() => (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: '#3a3b46',
            }}
          />
        ))}
      </View>
      <View style={{ padding: 10, gap: 6 }}>
        <View
          style={{
            height: 18,
            width: '55%',
            alignSelf: 'flex-end',
            borderRadius: 9,
            backgroundColor: '#d9d7d0',
          }}
        />
        <View
          style={{
            height: 18,
            width: '75%',
            borderRadius: 9,
            backgroundColor: '#2a2b35',
          }}
        />
        <View
          style={{
            height: 18,
            width: '70%',
            borderRadius: 9,
            backgroundColor: '#2a2b35',
            outlineWidth: 1.5,
            outlineColor: '#ff6b6b',
            outlineOffset: 2,
          }}
        />
        <View
          style={{
            height: 18,
            width: '70%',
            borderRadius: 9,
            backgroundColor: '#2a2b35',
            outlineWidth: 1.5,
            outlineColor: '#ff6b6b',
            outlineOffset: 2,
          }}
        />
        <View
          style={{
            height: 18,
            width: '40%',
            alignSelf: 'flex-end',
            borderRadius: 9,
            backgroundColor: '#d9d7d0',
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          top: 150,
          right: 8,
          backgroundColor: 'rgba(0,0,0,0.6)',
          borderRadius: 5,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 9, color: '#ff8a80' }}>
          ×2 同一条
        </Text>
      </View>
    </View>
  );
}

export function HandoffCard(props: { onOpen: () => void }) {
  const t = palette(look());
  return (
    <Card
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginTop: 2,
      }}
    >
      <Orb size={26} glow={false} />
      <Icon name="chevronRight" size={13} color={t.text3} />
      <Planet hue="#5ee6c9" size={34} moons={2} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <CardLabel>委派 · tian-agent</CardLabel>
        <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
          修复 WebSocket 重连后消息重复
        </Text>
        <Text style={{ fontSize: 12.5, color: t.text2 }}>
          附 1 张截图 · 完成后向 Chief 汇报
        </Text>
      </View>
      <Btn
        variant="ghost"
        onPress={props.onOpen}
        accessibilityLabel="打开 Atlas"
      >
        打开 Atlas
      </Btn>
    </Card>
  );
}

export function RunSummary(props: {
  title: string;
  branch: string;
  onOpenDiff: () => void;
}) {
  const t = palette(look());
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            backgroundColor: t.bubble,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="check" size={14} color={t.bubbleText} />
        </View>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            {props.title}
          </Text>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>
            {props.branch}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: 1,
          backgroundColor: t.line,
          borderRadius: 12,
          marginVertical: 14,
          overflow: 'hidden',
        }}
      >
        {[
          { k: '文件', v: '4' },
          { k: '行', v: '+86 −23' },
          { k: '测试', v: '128/128' },
          { k: '用时', v: '9 分' },
        ].map((stat) => (
          <View
            style={{
              flex: 1,
              backgroundColor: t.winSolid,
              paddingHorizontal: 10,
              paddingVertical: 8,
              gap: 1,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 9.5,
                letterSpacing: 0.95,
                color: t.text3,
              }}
            >
              {stat.k.toUpperCase()}
            </Text>
            <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              {stat.v}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View
          role="button"
          accessibilityLabel="查看改动"
          onPress={props.onOpenDiff}
          style={{
            height: 32,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: t.bubble,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
          hoverStyle={{ filter: 'brightness(1.08)' }}
        >
          <Icon name="fileCode" size={14} color={t.bubbleText} />
          <Text
            style={{ fontSize: 12.5, fontWeight: 600, color: t.bubbleText }}
          >
            查看改动
          </Text>
        </View>
        <Btn>Land</Btn>
        <Btn>Ship</Btn>
        <View style={{ flex: 1 }} />
        <Btn variant="danger">Discard</Btn>
      </View>
    </Card>
  );
}

const PHASES = ['理解', '修改', '验证', '汇报'];

export function ProgressCard(props: {
  id: string;
  title: string;
  elapsed: string;
  stage: number;
  line: string;
  meta: string;
  milestones: { time: string; text: string; bad: boolean }[];
  steps: number;
}) {
  const t = palette(look());
  const open = signal(false);
  return (
    <Card style={{ paddingTop: 16, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundImage: `linear-gradient(90deg, transparent, ${t.work}, transparent)`,
          opacity: 0.8,
          animationName: reduceMotion() ? 'none' : 'pulse',
          animationDuration: '2.4s',
          animationIterationCount: 'infinite',
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Planet hue="#5ee6c9" size={22} moons={1} />
        <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>
          {props.id}
        </Text>
        <Text
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: t.text,
            flex: 1,
            numberOfLines: 1,
          }}
        >
          {props.title}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: t.text3 }}>
          {props.elapsed}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', marginTop: 16, marginBottom: 12 }}>
        {PHASES.map((phase, i) => {
          const done = i < props.stage - 1;
          const now = i === props.stage - 1;
          return (
            <View style={{ flex: 1, paddingTop: 18, position: 'relative' }}>
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 0,
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: now ? t.work : done ? t.text2 : t.line2,
                  backgroundColor: now ? t.work : done ? t.text2 : t.winSolid,
                  boxShadow: now ? `0 0 0 4px ${t.work}33` : undefined,
                }}
              />
              {i < PHASES.length - 1 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 12,
                    right: 4,
                    height: 1.5,
                    backgroundColor: done ? t.text2 : t.line2,
                  }}
                />
              ) : null}
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: now ? 600 : 400,
                  color: now ? t.text : done ? t.text2 : t.text3,
                }}
              >
                {phase}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Dot state="work" />
        <Text style={{ fontSize: 14, color: t.text, flex: 1 }}>
          {props.line}
        </Text>
      </View>
      <Text
        style={{ fontFamily: MONO, fontSize: 11, color: t.text3, marginTop: 6 }}
      >
        {props.meta}
      </Text>

      <View
        role="button"
        accessibilityLabel={`经过 ${props.steps} 步`}
        accessibilityState={{ expanded: open() }}
        onPress={() => open.set(!open())}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          marginTop: 10,
        }}
      >
        <View style={{ transform: [{ rotate: open() ? '90deg' : '0deg' }] }}>
          <Icon name="chevronRight" size={11} color={t.text2} />
        </View>
        <Text style={{ fontSize: 12, color: t.text2 }}>
          经过 · {props.steps} 步
        </Text>
      </View>

      {open() ? (
        <View
          style={{
            marginTop: 10,
            paddingLeft: 12,
            borderLeftWidth: 1,
            borderLeftColor: t.line2,
            gap: 6,
          }}
        >
          {props.milestones.map((step) => (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Text
                style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}
              >
                {step.time}
              </Text>
              <Text
                style={{
                  fontSize: 12.5,
                  color: step.bad ? t.del : t.text2,
                  flex: 1,
                }}
              >
                {step.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function MiniRunCard() {
  const t = palette(look());
  return (
    <Card style={{ gap: 10 }}>
      {[
        {
          id: '#13',
          title: '断网重连测试',
          phase: '验证中 · 第 2 次',
          stage: 3,
        },
        { id: '#14', title: '更新协议文档', phase: '理解中', stage: 1 },
      ].map((run) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Planet hue="#5ee6c9" size={22} moons={1} />
          <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
            {run.id}
          </Text>
          <Text style={{ fontSize: 13, color: t.text }}>{run.title}</Text>
          <Text style={{ fontSize: 12, color: t.text2, marginLeft: 'auto' }}>
            {run.phase}
          </Text>
          <View style={{ width: 8 }} />
          <MiniRail stage={run.stage} />
        </View>
      ))}
    </Card>
  );
}

export function CodeBlock() {
  const t = palette(look());
  const day = look() === 'day';
  const kw = day ? '#c2185b' : '#ff8fb0';
  const fn = day ? '#3949ab' : '#9fb8ff';
  const comment = t.text3;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 12,
        backgroundColor: t.code,
        overflow: 'hidden',
        marginVertical: 4,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: t.line,
        }}
      >
        <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
          ts · client.ts:139
        </Text>
        <Icon name="copy" size={12} color={t.text3} />
      </View>
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 20.6 }}>
          <Text style={{ color: kw }}>private</Text>
          <Text style={{ color: t.text }}> </Text>
          <Text style={{ color: fn }}>onFrame</Text>
          <Text style={{ color: t.text }}>{'(frame: ServerFrame) {'}</Text>
        </Text>
        <View style={{ flexDirection: 'row' }}>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 12.5,
              lineHeight: 20.6,
              color: comment,
              width: 16,
            }}
          >
            //
          </Text>
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 12.5,
              lineHeight: 20.6,
              color: comment,
            }}
          >
            replayed frames reach emit() twice
          </Text>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 20.6 }}>
          <Text style={{ color: kw }}>this</Text>
          <Text style={{ color: t.text }}>.</Text>
          <Text style={{ color: fn }}>emit</Text>
          <Text style={{ color: t.text }}>{'(frame.event);'}</Text>
        </Text>
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            lineHeight: 20.6,
            color: t.text,
          }}
        >
          {'}'}
        </Text>
      </View>
    </View>
  );
}

export function ApprovalCard(props: { onAsk: () => void }) {
  const t = palette(look());
  const choices = [
    {
      id: 'online' as const,
      title: '在线迁移',
      tag: '推荐',
      note: '不停服 · 约 20 分钟 · 双写期间多占 30% 存储',
    },
    {
      id: 'offline' as const,
      title: '停机迁移',
      tag: '',
      note: '停服约 3 分钟 · 步骤更少 · 期间手机端无法同步',
    },
  ];
  return (
    <Card
      borderColor={`${t.wait}66`}
      style={{
        backgroundImage: `linear-gradient(180deg, ${t.wait}14, transparent 60%)`,
        gap: 0,
      }}
    >
      <CardLabel color={t.wait}>需要你决定 · 阻塞 Juno</CardLabel>
      <Text
        style={{ fontSize: 15, fontWeight: 600, color: t.text, marginTop: 8 }}
      >
        healthapp 数据库迁移方式
      </Text>
      <Text
        style={{
          fontSize: 13,
          lineHeight: 19.5,
          color: t.text2,
          marginTop: 4,
          marginBottom: 12,
        }}
      >
        批准后，Juno 派 1 个 Worker 执行。拒绝后，这个操作不会再被提出。
      </Text>
      {choices.map((choice) => (
        <View
          role="radio"
          accessibilityLabel={choice.title}
          accessibilityState={{ checked: migration() === choice.id }}
          onPress={() => migration.set(choice.id)}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: migration() === choice.id ? t.text2 : t.line,
            backgroundColor:
              migration() === choice.id ? t.card2 : 'transparent',
            marginBottom: 8,
          }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: migration() === choice.id ? t.text : t.text3,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 2,
            }}
          >
            {migration() === choice.id ? (
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: t.text,
                }}
              />
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>
                {choice.title}
              </Text>
              {choice.tag ? <Tag>{choice.tag}</Tag> : null}
            </View>
            <Text style={{ fontSize: 12, color: t.text2 }}>{choice.note}</Text>
          </View>
        </View>
      ))}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
        }}
      >
        <Btn variant="primary">批准所选</Btn>
        <Btn variant="ghost" onPress={props.onAsk}>
          再问问
        </Btn>
        <View style={{ flex: 1 }} />
        <Btn variant="danger">拒绝</Btn>
      </View>
    </Card>
  );
}

export function StreamingCaret() {
  return (
    <View
      style={{
        width: 8,
        height: 16,
        borderRadius: 2,
        backgroundImage: DAWN,
        animationName: reduceMotion() ? 'none' : 'pulse',
        animationDuration: '1s',
        animationIterationCount: 'infinite',
      }}
    />
  );
}
