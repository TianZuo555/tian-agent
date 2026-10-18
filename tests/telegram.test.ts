import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation } from '@earendil-works/pi-durable';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { Service } from '../src/worker/service';
import {
  splitMessage,
  telegramConfigFromEnv,
  type TelegramBotApi,
  type TelegramUpdate,
} from '../src/worker/telegram';

const CHAT = 100;

class FakeBotApi implements TelegramBotApi {
  queue: TelegramUpdate[] = [];
  sent: { chatId: string; text: string }[] = [];
  failures = 0;
  offsets: number[] = [];
  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    this.offsets.push(offset);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('network unreachable');
    }
    const due = this.queue.filter((update) => update.update_id >= offset);
    this.queue = this.queue.filter((update) => update.update_id < offset);
    return due;
  }
  async sendMessage(chatId: string, text: string): Promise<void> {
    this.sent.push({ chatId, text });
  }
  push(update: TelegramUpdate): void {
    this.queue.push(update);
  }
}

interface Fixture {
  root: string;
  api: FakeBotApi;
  start(): Promise<Service>;
  /** Detach a manually closed service so the next start() may run. */
  forget(): void;
}

async function fixture(
  t: TestContext,
  options: { token?: string | null; allowed?: string } = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'tian-telegram-'));
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  const setEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  setEnv(
    'TELEGRAM_BOT_TOKEN',
    options.token === null ? undefined : (options.token ?? 'test-token'),
  );
  setEnv('TELEGRAM_ALLOWED_CHAT_IDS', options.allowed ?? String(CHAT));
  t.after(() => {
    for (const [key, value] of saved) setEnv(key, value);
  });
  const api = new FakeBotApi();
  let service: Service | null = null;
  t.after(async () => {
    if (service) await service.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    api,
    start: async () => {
      assert.equal(service, null, 'close the previous service first');
      const instance = new Service(join(root, 'data'), () => {}, {
        api,
        options: { pollTimeoutMs: 0, backoffMs: 5, maxUpdateAttempts: 3 },
      });
      await instance.init();
      service = instance;
      return instance;
    },
    forget: () => {
      service = null;
    },
  };
}

const agents = (service: Service) =>
  (
    service as unknown as {
      agents: { conversation(id: string): Promise<Conversation> };
    }
  ).agents;

async function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 5_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Telegram condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function message(
  updateId: number,
  messageId: number,
  chatId: number,
  text: string,
): TelegramUpdate {
  return {
    update_id: updateId,
    message: { message_id: messageId, chat: { id: chatId }, text },
  };
}

async function userEntries(
  service: Service,
  conversationId: string,
): Promise<number> {
  const conversation = await agents(service).conversation(conversationId);
  const page = await conversation.entries(
    { order: 'ascending' },
    100,
    undefined,
    BACKGROUND_CONTEXT,
  );
  return page.items.filter((entry) => entry.kind === 'pi.user').length;
}

/** Append a completed assistant entry, the way a model turn would. */
async function reply(
  service: Service,
  conversationId: string,
  text: string,
): Promise<void> {
  const conversation = await agents(service).conversation(conversationId);
  const turn = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } satisfies AssistantMessage;
  await conversation.commit(
    (tx) =>
      tx.appendEntry(conversation.id, {
        kind: 'pi.assistant',
        model: [turn],
      }),
    BACKGROUND_CONTEXT,
  );
}

/** Send one inbound message and resolve with the conversation it created. */
async function bindChat(f: Fixture, service: Service): Promise<string> {
  f.api.push(message(1, 11, CHAT, '你好'));
  await until(() => service.listConversations().length === 1);
  return service.listConversations()[0].conversationId;
}

test('updates from chats outside the allow-list are ignored', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  f.api.push(message(1, 11, 999, '陌生人'));
  await until(() => f.api.offsets.at(-1) === 2);
  assert.equal(service.listConversations().length, 0);
  assert.equal(f.api.sent.length, 0);
});

test('an allow-listed message creates a stable binding and submits once per update', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const update = message(1, 11, CHAT, '帮我看看任务');
  f.api.push(update);
  f.api.push({ ...update }); // the same update delivered twice
  let conversationId = '';
  await until(async () => {
    const conversations = service.listConversations();
    if (conversations.length !== 1) return false;
    conversationId = conversations[0].conversationId;
    return (await userEntries(service, conversationId)) === 1;
  });
  const binding = {
    channel: 'telegram',
    externalId: String(CHAT),
    scopeId: 'global',
  };
  assert.equal(
    service.db.channelSession(binding)?.conversationId,
    conversationId,
  );
  f.api.push(message(2, 12, CHAT, '第二条'));
  await until(async () => (await userEntries(service, conversationId)) === 2);
  assert.equal(
    service.db.channelSession(binding)?.conversationId,
    conversationId,
  );
  assert.equal(service.listConversations().length, 1);
});

test('the getUpdates offset persists across restart so updates are not reprocessed', async (t) => {
  const f = await fixture(t);
  let service = await f.start();
  const conversationId = await bindChat(f, service);
  f.api.push(message(5, 51, CHAT, '重启前'));
  await until(async () => (await userEntries(service, conversationId)) === 1);
  await until(() => f.api.offsets.at(-1) === 6);
  await service.close();
  f.forget();
  f.api.offsets = [];
  service = await f.start();
  await until(() => f.api.offsets.length > 0);
  assert.equal(f.api.offsets[0], 6); // resumed from the persisted offset
  f.api.push(message(6, 52, CHAT, '重启后'));
  await until(async () => (await userEntries(service, conversationId)) === 2);
  assert.ok(f.api.offsets.every((offset) => offset >= 6));
});

test('assistant replies are forwarded exactly once, including across restart', async (t) => {
  const f = await fixture(t);
  let service = await f.start();
  const conversationId = await bindChat(f, service);
  await reply(service, conversationId, '这是回复');
  await until(() => f.api.sent.length === 1);
  assert.equal(f.api.sent[0].chatId, String(CHAT));
  assert.equal(f.api.sent[0].text, '这是回复');
  const polls = f.api.offsets.length;
  await until(() => f.api.offsets.length >= polls + 5);
  assert.equal(f.api.sent.length, 1);
  await service.close();
  f.forget();
  service = await f.start();
  await until(() => f.api.offsets.length > 0); // the catch-up pass has run
  assert.equal(f.api.sent.length, 1); // no duplicate after restart
  await reply(service, conversationId, '重启后的回复');
  await until(() => f.api.sent.length === 2);
  assert.equal(f.api.sent[1].text, '重启后的回复');
});

test('a proactive assistant turn is forwarded without an inbound message', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const conversationId = await bindChat(f, service);
  await reply(service, conversationId, '主动汇报：Run 已完成');
  await until(() =>
    f.api.sent.some((sent) => sent.text === '主动汇报：Run 已完成'),
  );
});

test('/scope switches to a separate project conversation and persists', async (t) => {
  const f = await fixture(t);
  let service = await f.start();
  const project = join(f.root, 'project');
  mkdirSync(project);
  const projectId = service
    .addProject('demo', project)
    .find((scope) => scope.kind === 'project')!.id;
  const globalConversation = await bindChat(f, service);
  f.api.push(message(2, 21, CHAT, '/scope demo'));
  await until(() => f.api.sent.some((sent) => sent.text.includes('demo')));
  f.api.push(message(3, 31, CHAT, '在项目 scope 里说话'));
  let projectConversation = '';
  await until(async () => {
    const scoped = service
      .listConversations()
      .find((row) => row.scopeId === projectId);
    if (!scoped) return false;
    projectConversation = scoped.conversationId;
    return (await userEntries(service, projectConversation)) === 1;
  });
  assert.notEqual(projectConversation, globalConversation);
  assert.equal(
    service.db.channelSession({
      channel: 'telegram',
      externalId: String(CHAT),
      scopeId: projectId,
    })?.conversationId,
    projectConversation,
  );
  await service.close();
  f.forget();
  service = await f.start();
  f.api.push(message(4, 41, CHAT, '重启后仍在项目 scope'));
  await until(
    async () => (await userEntries(service, projectConversation)) === 2,
  );
  assert.equal(await userEntries(service, globalConversation), 1);
});

test('commands answer with help, status, and scope errors', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  await bindChat(f, service);
  service.addTaskItem('global', '整理周报', null);
  f.api.push(message(2, 21, CHAT, '/unknown'));
  await until(() =>
    f.api.sent.some((sent) => sent.text.includes('不是可用命令')),
  );
  f.api.push(message(3, 31, CHAT, '/status'));
  await until(() => f.api.sent.some((sent) => sent.text.includes('整理周报')));
  f.api.push(message(4, 41, CHAT, '/scope'));
  await until(() =>
    f.api.sent.some((sent) => sent.text.includes('当前 scope：global')),
  );
  f.api.push(message(5, 51, CHAT, '/scope 不存在的项目'));
  await until(() =>
    f.api.sent.some((sent) => sent.text.includes('未知 scope')),
  );
  assert.ok(f.api.sent.some((sent) => sent.text.includes('/scope [名称]')));
});

test('long replies are split on line boundaries into messages of at most 4096 characters', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const conversationId = await bindChat(f, service);
  const long = Array.from(
    { length: 400 },
    (_, i) => `第 ${i} 行：这里是一些内容`,
  ).join('\n');
  await reply(service, conversationId, long);
  await until(() => f.api.sent.length >= 2);
  assert.ok(f.api.sent.every((sent) => sent.text.length <= 4096));
  assert.equal(f.api.sent.map((sent) => sent.text).join(''), long);
});

test('without a token the adapter stays disabled and nothing fails', async (t) => {
  const f = await fixture(t, { token: null });
  const service = await f.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.api.offsets.length, 0); // never polled
  assert.equal(service.listConversations().length, 0);
  assert.equal(telegramConfigFromEnv({}), null);
  assert.deepEqual(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't' }), {
    token: 't',
    allowedChatIds: [],
  });
  assert.deepEqual(
    telegramConfigFromEnv({
      TELEGRAM_BOT_TOKEN: ' t ',
      TELEGRAM_ALLOWED_CHAT_IDS: ' 1 , 2,',
    }),
    { token: 't', allowedChatIds: ['1', '2'] },
  );
});

test('network errors back off without throwing or blocking the service', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  f.api.failures = 3;
  const conversationId = await bindChat(f, service);
  f.api.push(message(2, 21, CHAT, '网络恢复了吗'));
  await until(async () => (await userEntries(service, conversationId)) === 2);
  assert.ok(f.api.offsets.length >= 5); // initial polls plus failed attempts
  assert.equal((await service.activity()).maintenance, false);
});

test('splitMessage prefers line boundaries and never exceeds the limit', () => {
  assert.deepEqual(splitMessage('短消息'), ['短消息']);
  assert.deepEqual(splitMessage(''), []);
  const noNewlines = 'x'.repeat(9_000);
  assert.deepEqual(splitMessage(noNewlines), [
    'x'.repeat(4096),
    'x'.repeat(4096),
    'x'.repeat(808),
  ]);
  const withLines = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}\n${'c'.repeat(3000)}`;
  const parts = splitMessage(withLines);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.length <= 4096));
  assert.equal(parts.join(''), withLines);
});
