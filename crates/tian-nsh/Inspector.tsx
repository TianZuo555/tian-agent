import { Scroll, Text, View } from 'nsh';
import { DiffView } from 'nsh/base';
import { palette } from './theme';
import { inspectorTab, look, type InspTab } from './state';
import { details, diffFiles, diffPatch, tasks } from './data';
import { Btn, Dot, Icon, IconButton, Tag } from './ui';
import { MONO } from './fonts';

const TABS: { id: InspTab; label: string }[] = [
  { id: 'changes', label: '改动' },
  { id: 'tasks', label: '任务' },
  { id: 'details', label: '详情' },
];

export function Inspector() {
  const t = palette(look());
  return (
    <View
      style={{
        width: 404,
        flexShrink: 0,
        borderLeftWidth: 1,
        borderLeftColor: t.line,
        backgroundColor: t.side,
        flexDirection: 'column',
      }}
    >
      <View
        desktop={{ windowDrag: true }}
        style={{
          height: 64,
          flexShrink: 0,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: t.card2,
            borderRadius: 9,
            padding: 2,
          }}
        >
          {TABS.map((tab) => (
            <View
              role="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: inspectorTab() === tab.id }}
              focusable
              onPress={() => inspectorTab.set(tab.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 7,
                backgroundColor:
                  inspectorTab() === tab.id ? t.card : 'transparent',
              }}
              hoverStyle={{
                backgroundColor: inspectorTab() === tab.id ? t.card : t.line,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: inspectorTab() === tab.id ? 600 : 400,
                  color: inspectorTab() === tab.id ? t.text : t.text2,
                }}
              >
                {tab.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <IconButton name="dots" label="检查器菜单" size={15} />
      </View>

      <If when={inspectorTab() === 'changes'}>
        <Changes />
      </If>
      <If when={inspectorTab() === 'tasks'}>
        <Tasks />
      </If>
      <If when={inspectorTab() === 'details'}>
        <Details />
      </If>
    </View>
  );
}

function Changes() {
  const t = palette(look());
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 6,
          paddingBottom: 12,
          gap: 3,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            Run #12
          </Text>
          <Tag>待审阅</Tag>
        </View>
        <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}>
          fix/ws-dedupe → main · 4 个文件 · +86 −23
        </Text>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: t.line }}>
        <Each of={diffFiles}>
          {(file) => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 18,
                paddingVertical: 9,
                borderBottomWidth: 1,
                borderBottomColor: t.line,
              }}
              hoverStyle={{ backgroundColor: t.card2 }}
            >
              <Icon name="fileCode" size={13} color={t.text3} />
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: t.text,
                  flex: 1,
                }}
              >
                {file().path}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.add }}>
                {file().add}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10.5, color: t.del }}>
                {file().del}
              </Text>
            </View>
          )}
        </Each>
      </View>

      <View
        style={{ height: 360, borderBottomWidth: 1, borderBottomColor: t.line }}
      >
        <DiffView
          patch={diffPatch}
          style={{ flex: 1 }}
          layout="unified"
          fontSize={11}
          lineHeight={17}
          contextLines={2}
          styles={{
            side: { backgroundColor: 'transparent' },
            gutter: { backgroundColor: t.code },
            lineNumber: { color: t.text3, fontSize: 10 },
            lineNumberAdded: { color: t.add },
            lineNumberDeleted: { color: t.del },
            line: { backgroundColor: 'transparent' },
            lineAdded: { backgroundColor: t.addBg },
            lineDeleted: { backgroundColor: t.delBg },
            wordAdded: { backgroundColor: t.addBg },
            wordDeleted: { backgroundColor: t.delBg },
            separator: {
              backgroundColor: t.card2,
              color: t.text3,
              fontFamily: MONO,
              fontSize: 10,
            },
            fileHeader: {
              backgroundColor: t.winSolid,
              color: t.text2,
              fontFamily: MONO,
              fontSize: 10.5,
            },
          }}
        />
      </View>

      <View style={{ paddingHorizontal: 18, paddingVertical: 10, gap: 3 }}>
        <Text style={{ fontSize: 12, lineHeight: 18, color: t.text2 }}>
          点行号可以留言。留言会作为追问发给 Atlas，生成新的 Attempt。
        </Text>
        <Text style={{ fontSize: 11, color: t.text3 }}>
          大文件按需加载。点开时才向服务端请求这个文件的 patch。
        </Text>
      </View>

      <View
        style={{
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: t.line,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: t.winSolid,
        }}
      >
        <Btn variant="danger">Discard</Btn>
        <View style={{ flex: 1 }} />
        <Btn>Ship</Btn>
        <Btn variant="primary">Land</Btn>
      </View>
    </View>
  );
}

function Tasks() {
  const t = palette(look());
  return (
    <Scroll
      style={{ flex: 1 }}
      contentStyle={{
        paddingHorizontal: 18,
        paddingTop: 6,
        paddingBottom: 24,
        gap: 2,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 1.2,
          color: t.text3,
          marginBottom: 8,
        }}
      >
        待办 · 4
      </Text>
      <Each of={tasks}>
        {(task) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 11,
              borderBottomWidth: 1,
              borderBottomColor: t.line,
            }}
            hoverStyle={{ backgroundColor: t.card2 }}
          >
            <Dot state={task().state} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 13.5, fontWeight: 500, color: t.text }}>
                {task().title}
              </Text>
              <Text
                style={{ fontFamily: MONO, fontSize: 10.5, color: t.text3 }}
              >
                {task().meta}
              </Text>
            </View>
            <Icon name="chevronRight" size={12} color={t.text3} />
          </View>
        )}
      </Each>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Btn variant="primary">新建任务</Btn>
        <Btn variant="ghost">查看全部</Btn>
      </View>
    </Scroll>
  );
}

function Details() {
  const t = palette(look());
  return (
    <Scroll
      style={{ flex: 1 }}
      contentStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 1.2,
          color: t.text3,
          marginBottom: 12,
        }}
      >
        本次对话
      </Text>
      <Each of={details}>
        {(row) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 11,
              borderBottomWidth: 1,
              borderBottomColor: t.line,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: t.text2 }}>{row().label}</Text>
            <Text style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>
              {row().value}
            </Text>
          </View>
        )}
      </Each>
      <View
        style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.line,
          backgroundColor: t.card,
          gap: 6,
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
          本次 RUN
        </Text>
        <Text style={{ fontSize: 13, color: t.text }}>文件 4 · 行 +86 −23</Text>
        <Text style={{ fontSize: 13, color: t.text }}>
          测试 128/128 · 第 2 次尝试
        </Text>
      </View>
    </Scroll>
  );
}
