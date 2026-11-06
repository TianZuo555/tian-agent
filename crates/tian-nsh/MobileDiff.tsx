import { Scroll, signal, View, safeArea } from 'nsh';
import { AlertDialog, DiffView, Input } from 'nsh/base';
import { diffPatch } from './data';
import { palette } from './theme';
import { look } from './state';
import { MONO } from './fonts';
import { Action, Heading, Label, Surface } from './MobileUI';
import {
  copy,
  messages,
  navigation,
  notice,
  review,
  type MobileKey,
} from './mobile-state';

const files = [
  { name: 'src/service/client.ts', patch: diffPatch },
  {
    name: 'tests/reconnect.test.ts',
    patch: `diff --git a/tests/reconnect.test.ts b/tests/reconnect.test.ts
--- a/tests/reconnect.test.ts
+++ b/tests/reconnect.test.ts
@@ -1,1 +1,5 @@
 import { test } from 'node:test';
+test('replayed events appear once', () => {
+  client.receive({ messageId: 'm1' });
+  client.receive({ messageId: 'm1' });
+  assert.equal(messages.length, 1);
+});
`,
  },
  {
    name: 'src/service/protocol.ts',
    patch: `diff --git a/src/service/protocol.ts b/src/service/protocol.ts
--- a/src/service/protocol.ts
+++ b/src/service/protocol.ts
@@ -1,3 +1,4 @@
 export interface Resume {
   cursor: string;
+  dedupe: boolean;
 }
`,
  },
  {
    name: 'src/shared/types.ts',
    patch: `diff --git a/src/shared/types.ts b/src/shared/types.ts
--- a/src/shared/types.ts
+++ b/src/shared/types.ts
@@ -1,3 +1,2 @@
 export interface Message {
-  legacyReplayId?: string;
 }
`,
  },
];
export function MobileDiff() {
  const fileIndex = signal(0);
  const note = signal('');
  const line = signal<number | null>(null);
  const confirm = async (action: 'land' | 'ship' | 'discard') => {
    const result = await AlertDialog.show({
      title: copy('confirmReview'),
      description: `${copy(action)} · ${copy('reviewConsequence')}`,
      actions: [
        { id: 'cancel', label: copy('cancel'), role: 'cancel' },
        {
          id: action,
          label: copy(action),
          role: action === 'discard' ? 'destructive' : 'default',
        },
      ],
    });
    if (result.action !== action || review() !== 'pending') return;
    review.set(
      action === 'land'
        ? 'landed'
        : action === 'ship'
          ? 'shipped'
          : 'discarded',
    );
  };
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette(look()).winSolid,
        backgroundImage: palette(look()).inside,
      }}
    >
      <Heading title="Run #12" subtitle={copy('branch')} />
      <Scroll
        horizontal
        style={{ height: 60, flexGrow: 0 }}
        contentStyle={{ flexDirection: 'row', padding: 8, gap: 8 }}
      >
        {files.map((file, index) => (
          <Action
            label={`${fileIndex() === index ? '● ' : ''}${file.name}`}
            onPress={() => {
              fileIndex.set(index);
              line.set(null);
            }}
          />
        ))}
      </Scroll>
      <View style={{ flex: 1 }}>
        <Each of={[fileIndex()]}>
          {(index) => (
            <DiffView
              testID="mobile-diff"
              patch={files[index()].patch}
              layout="unified"
              softWrap={false}
              fontFamily={MONO}
              fontSize={11}
              lineHeight={20}
              lineNumbers
              style={{ flex: 1, backgroundColor: palette(look()).code }}
              onLineNumberPress={(e) => line.set(e.line.line + 1)}
            />
          )}
        </Each>
      </View>
      <Surface style={{ borderRadius: 0, padding: 12 }}>
        <Label mono secondary size={9}>
          {files[fileIndex()].name}
          {line() ? `:${line()}` : ''}
        </Label>
        <Input
          accessibilityLabel={copy('followup')}
          value={note()}
          onChange={(e) => note.set(e.value)}
          placeholder={copy('followup')}
          style={{
            minHeight: 44,
            color: palette(look()).text,
            placeholderColor: palette(look()).text3,
            paddingHorizontal: 8,
          }}
        />
        <Action
          label={copy('addNote')}
          disabled={!note().trim()}
          onPress={() => {
            const text = `${files[fileIndex()].name}${line() ? `:${line()}` : ''}\n${note().trim()}`;
            messages.update((rows) => ({
              ...rows,
              atlas: [...rows.atlas, { id: Date.now(), text, images: [] }],
            }));
            note.set('');
            notice.set(copy('noteAdded'));
          }}
        />
      </Surface>
      <View
        style={{
          padding: 12,
          paddingBottom: Math.max(safeArea().bottom, 12),
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: palette(look()).line,
        }}
      >
        <If when={review() === 'pending'}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            {(['discard', 'ship', 'land'] as const).map((action) => (
              <Action
                label={copy(action)}
                danger={action === 'discard'}
                primary={action === 'land'}
                onPress={() => {
                  void confirm(action);
                }}
              />
            ))}
          </View>
        </If>
        <If when={review() !== 'pending'}>
          <Label>{copy(review() as MobileKey)}</Label>
          <Action label={copy('back')} onPress={() => navigation.pop()} />
        </If>
      </View>
    </View>
  );
}
