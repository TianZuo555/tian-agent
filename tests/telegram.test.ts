import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation } from '@earendil-works/pi-durable';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { Service } from '../src/worker/service';
import { ResidentServer } from '../src/service/server';
import { servicePaths } from '../src/shared/service-paths';
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
  /** Resolve to make the next getUpdates hang until aborted (long poll). */
  hold = false;
  aborted = 0;
  async getUpdates(
    offset: number,
    _timeout: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    this.offsets.push(offset);
    if (this.hold) {
      // Long poll: hang until aborted, then fail like an aborted fetch and
      // leave the queue untouched so the update is delivered again later.
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve());
        setTimeout(resolve, 100);
      });
      this.aborted += 1;
      throw new Error('aborted');
    }
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
  /** Start another service on the same data dir, e.g. with a new allow-list. */
  restart(allowed: string): Promise<Service>;
}

async function fixture(
  t: TestContext,
  options: { token?: string | null; allowed?: string } = {},
): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'tian-telegram-'));
  const api = new FakeBotApi();
  let service: Service | null = null;
  const build = async (allowed: string) => {
    assert.equal(service, null, 'close the previous service first');
    const config =
      options.token === null
        ? null
        : { token: options.token ?? 'test-token', allowedChatIds: [allowed] };
    const instance = new Service(join(root, 'data'), () => {}, {
      config,
      api,
      options: { pollTimeoutMs: 0, backoffMs: 5, maxUpdateAttempts: 3 },
    });
    await instance.init();
    service = instance;
    return instance;
  };
  t.after(async () => {
    if (service) await service.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    api,
    start: () => build(options.allowed ?? String(CHAT)),
    restart: (allowed) => build(allowed),
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

test('a service created without telegram setup never reads the environment', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tian-telegram-'));
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.TELEGRAM_BOT_TOKEN = 'environment-token';
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = String(CHAT);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  // No telegram option: the adapter must stay off even with a token in env.
  const service = new Service(join(root, 'data'), () => {});
  t.after(() => service.close());
  await service.init();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const adapter = (service as unknown as { telegram: unknown }).telegram;
  assert.equal(adapter, null);
  assert.equal(service.listConversations().length, 0);
});

test('a resident server without telegram options never calls the Bot API', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'tian-telegram-'));
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'];
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.TELEGRAM_BOT_TOKEN = 'environment-token';
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = String(CHAT);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  // Any real Bot API call would fail against this token; the fake proves that
  // the server never even reaches an adapter when the entry passed no config.
  const paths = {
    ...servicePaths(join(root, 'data')),
    socketPath: join(root, 'agent.sock'),
  };
  const server = new ResidentServer(paths);
  t.after(() => server.close());
  await server.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const adapter = (server.service as unknown as { telegram: unknown }).telegram;
  assert.equal(adapter, null);
});

// Review 1 item 1: the gateway stops before the idle check, so no submit can
// slip in after it, and a refused maintenance restarts the gateway.
test('maintenance stops the gateway before the idle check so no submit slips in', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const conversationId = await bindChat(f, service);
  // Hold the adapter's in-flight long poll, then make the idle check (activity)
  // take long enough that a still-running poll loop would submit in the window.
  f.api.hold = true;
  const polls = f.api.offsets.length;
  await until(() => f.api.offsets.length > polls);
  f.api.push(message(2, 21, CHAT, '维护窗口里不该提交'));
  const originalActivity = service.activity.bind(service);
  let releaseIdle = () => {};
  const idleGate = new Promise<void>((resolve) => {
    releaseIdle = resolve;
  });
  let idleEntered = false;
  service.activity = async () => {
    if (!idleEntered) {
      idleEntered = true;
      releaseIdle();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return originalActivity();
  };
  const maintenance = service.beginMaintenance();
  await idleGate;
  // The idle check is running: the gateway must already be stopped.
  const adapter = (service as unknown as { telegram: { running: boolean } })
    .telegram;
  assert.equal(adapter.running, false, 'gateway stopped before the idle check');
  await maintenance;
  assert.equal((await service.activity()).maintenance, true);
  const submitted = await userEntries(service, conversationId);
  assert.equal(submitted, 1, 'the update during maintenance was not submitted');
  f.api.hold = false;
  await service.finishMaintenance();
  await until(() => f.api.offsets.length > polls); // polling again
  await until(
    async () => (await userEntries(service, conversationId)) === submitted + 1,
  );
});

test('refused maintenance restarts the gateway', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const conversationId = await bindChat(f, service);
  service.db.addRun({
    id: 'busy',
    projectId: 'project',
    conversationId: null,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'busy',
    currentPrompt: 'busy',
    rootPath: '/tmp',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'running',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    deadlineAt: '',
  });
  await assert.rejects(service.beginMaintenance(), /still running/);
  assert.equal((await service.activity()).maintenance, false);
  const polls = f.api.offsets.length;
  f.api.push(message(2, 21, CHAT, '维护被拒绝后仍然工作'));
  await until(async () => (await userEntries(service, conversationId)) === 2);
  assert.ok(f.api.offsets.length > polls);
});

// Review 1 item 2: the allow-list gates the outbound path itself, not only
// the catch-up sweep, so a de-authorized chat stops receiving messages.
test('a chat removed from the allow-list stops receiving assistant output', async (t) => {
  const f = await fixture(t);
  let service = await f.start();
  const conversationId = await bindChat(f, service);
  await reply(service, conversationId, '允许时的回复');
  await until(() => f.api.sent.length === 1);
  await service.close();
  f.forget();
  service = await f.restart('999'); // CHAT is no longer allow-listed
  await until(() => f.api.offsets.length > 0);
  await reply(service, conversationId, '不再允许的回复');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(f.api.sent.length, 1);
  assert.equal(f.api.sent[0].text, '允许时的回复');
  assert.equal(service.listConversations().length, 1); // binding kept, output gated
});

// Review 1 item 4: watch triggers coalesce, so a burst of view changes runs one
// forward pass plus at most one queued re-run instead of a page read each.
test('rapid watch triggers coalesce into one running plus one pending forward pass', async (t) => {
  const f = await fixture(t);
  const service = await f.start();
  const conversationId = await bindChat(f, service);
  const adapter = (
    service as unknown as {
      telegram: {
        forwardChat(chatId: string, conversationId: string): Promise<void>;
        forwardRuns: Map<string, Promise<void>>;
      };
    }
  ).telegram;
  // Count entries() reads and block the first pass inside it, so every later
  // trigger arrives while a pass is running.
  const runtime = (
    service as unknown as {
      agents: { conversation(id: string): Promise<Conversation> };
    }
  ).agents;
  const open = runtime.conversation.bind(runtime);
  let reads = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  runtime.conversation = async (id: string) => {
    const handle = await open(id);
    const entries = handle.entries.bind(handle);
    handle.entries = (async (...args: Parameters<typeof entries>) => {
      reads += 1;
      if (!blocked) {
        blocked = true;
        await gate;
      }
      return entries(...args);
    }) as typeof handle.entries;
    return handle;
  };
  await reply(service, conversationId, '被合并的回复');
  await until(() => reads === 1); // the poll-driven pass is now blocked
  const triggers = Array.from({ length: 20 }, () =>
    adapter.forwardChat(String(CHAT), conversationId),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(reads, 1); // triggers did not each queue a read
  assert.equal(adapter.forwardRuns.size, 1);
  release();
  await Promise.all(triggers);
  await until(() => adapter.forwardRuns.size === 0);
  assert.ok(reads <= 3, `expected coalesced reads, got ${reads}`);
  assert.deepEqual(
    f.api.sent.map((sent) => sent.text),
    ['被合并的回复'],
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
