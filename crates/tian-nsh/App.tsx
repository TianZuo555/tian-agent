import {
  announce,
  cleanup,
  effect,
  mount,
  signal,
  Text,
  View,
  Scroll,
  type Accessor,
} from 'nsh';
import { Button, TextView } from 'nsh/base';
import { Window } from 'nsh/desktop';
import { Service } from 'tian/native';
import type { MessageRow } from '../../src/shared/messages';
import type { MessageKey } from '../../src/renderer/i18n/en';
import { t, loadLanguage, setLanguage } from './i18n';
import { createStore, initialState, type Nav } from './store';

const destinations: Nav[] = ['chat', 'goals', 'skills', 'inbox', 'settings'];
const control =
  'rounded-md px-3 py-2 hover:bg-accent focus:bg-accent active:opacity-70';

function Message(props: { row: Accessor<MessageRow> }) {
  return (
    <View
      class="gap-2 border-b border-border py-4"
      testID={`message-${props.row().id}`}
    >
      <Text class="text-xs text-muted-foreground">
        {t(
          props.row().role === 'user'
            ? 'chat.userMessage'
            : props.row().role === 'assistant'
              ? 'chat.assistantMessage'
              : 'chat.notification',
        )}
      </Text>
      <If
        when={
          props.row().role === 'assistant' || props.row().variant === 'notice'
        }
        else={<Text class="select-text text-sm">{props.row().text}</Text>}
      >
        <TextView
          markdown={props.row().text}
          selectable
          options={{ streaming: Boolean(props.row().streaming) }}
        />
      </If>
      <Each of={props.row().toolCalls ?? []} key={(call) => call.callId}>
        {(call) => (
          <Text class="select-text font-mono text-xs text-muted-foreground">
            {call().name} · {call().status}
          </Text>
        )}
      </Each>
    </View>
  );
}

function App() {
  const state = signal(initialState());
  const store = createStore(
    () => Service.connect(),
    state,
    (value) => state.set(value),
  );
  cleanup(() => store.close());
  store.start();
  void loadLanguage();
  Window.setTitle(t('nsh.title'));
  Window.setFrame({ size: { width: 1280, height: 840 } });
  effect(() => {
    if (state().error) announce(t('boot.unreachable'));
  });
  const selected = () =>
    state().conversations.find(
      (item) => item.conversationId === state().selected,
    );
  return (
    <View class="flex-1 flex-row bg-background text-foreground" testID="shell">
      <View
        class="w-64 shrink-0 border-r border-border bg-sidebar p-3 gap-3"
        accessibilityLabel={t('sidebar.navigation')}
      >
        <Text class="px-3 py-3 text-lg font-semibold">{t('nsh.title')}</Text>
        <Each of={destinations}>
          {(nav) => (
            <Button
              class={control}
              selected={state().nav === nav()}
              onPress={() => store.navigate(nav())}
              accessibilityLabel={t(`nav.${nav()}`)}
              testID={`nav-${nav()}`}
            >
              <Text>{t(`nav.${nav()}`)}</Text>
            </Button>
          )}
        </Each>
        <Scroll class="flex-1" contentClass="gap-1">
          <Each
            of={state().conversations}
            key={(conversation) => conversation.conversationId}
          >
            {(conversation) => (
              <Button
                class={control}
                selected={state().selected === conversation().conversationId}
                accessibilityLabel={t('sidebar.conversationLabel', {
                  title: conversation().title ?? t('common.newConversation'),
                })}
                testID={`conversation-${conversation().conversationId}`}
                onPress={() =>
                  store.select(
                    conversation().conversationId,
                    conversation().scopeId,
                  )
                }
              >
                <Text class="line-clamp-2">
                  {conversation().title ?? t('common.newConversation')}
                </Text>
                <Text class="text-xs text-muted-foreground">
                  {state().scopes.find(
                    (scope) => scope.id === conversation().scopeId,
                  )?.name ?? conversation().scopeId}
                </Text>
              </Button>
            )}
          </Each>
          <If
            when={
              state().status === 'ready' && state().conversations.length === 0
            }
          >
            <Text class="p-3 text-sm text-muted-foreground">
              {t('sidebar.noConversations')}
            </Text>
          </If>
        </Scroll>
        <Text
          testID="connection-status"
          class="px-3 text-xs text-muted-foreground"
        >
          {t(
            state().status === 'ready'
              ? 'service.connected'
              : state().status === 'starting'
                ? 'service.connecting'
                : 'service.unavailable',
          )}
        </Text>
      </View>
      <View class="flex-1 min-w-0">
        <View class="h-14 border-b border-border px-5 justify-center">
          <Text class="font-semibold">
            {state().nav === 'chat'
              ? (selected()?.title ?? t('chat.conversation'))
              : t(`nav.${state().nav}` as MessageKey)}
          </Text>
        </View>
        <If when={state().error}>
          <View class="p-4 gap-2 bg-destructive/10" testID="connection-error">
            <Text>{t('boot.unreachable')}</Text>
            <Text class="select-text text-sm">{state().error}</Text>
            <Text class="text-sm">{t('nsh.connectionHelp')}</Text>
          </View>
        </If>
        <If
          when={state().nav === 'chat'}
          else={
            <View class="p-6 gap-4">
              <Text>{t('nsh.viewPending')}</Text>
              <If when={state().nav === 'settings'}>
                <Button class={control} onPress={() => setLanguage('en')}>
                  <Text>{t('nsh.languageEnglish')}</Text>
                </Button>
                <Button class={control} onPress={() => setLanguage('zh')}>
                  <Text>{t('nsh.languageChinese')}</Text>
                </Button>
                <Button class={control} onPress={() => store.closeSettings()}>
                  <Text>{t('common.back')}</Text>
                </Button>
              </If>
            </View>
          }
        >
          <Scroll
            class="flex-1"
            contentClass="px-6 py-2"
            accessibilityLabel={t('chat.messages')}
            testID="transcript"
          >
            <Each of={state().view?.rows ?? []} key={(row) => row.id}>
              {(row) => <Message row={row} />}
            </Each>
            <If when={!state().selected}>
              <Text class="p-6 text-muted-foreground">
                {t('chat.welcomeBody')}
              </Text>
            </If>
          </Scroll>
          <Text class="border-t border-border px-6 py-3 text-xs text-muted-foreground">
            {t('nsh.readOnly')}
          </Text>
        </If>
      </View>
      <View
        class="w-72 shrink-0 border-l border-border p-5 gap-4"
        testID="context-pane"
      >
        <Text class="font-semibold">{t('nsh.context')}</Text>
        <Text class="text-sm text-muted-foreground">
          {t('nsh.contextPending')}
        </Text>
      </View>
    </View>
  );
}

mount(App);
