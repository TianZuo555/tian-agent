import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation } from '@earendil-works/pi-durable';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type {
  Credentials,
  IncomingMessage,
  QrLoginCallbacks,
} from '@wechatbot/wechatbot';
import { Service } from '../src/worker/service';
import {
  WechatAdapter,
  wechatAllowedFromEnv,
  type WechatClient,
} from '../src/worker/wechat';
import type { WechatStatus } from '../src/shared/types';

const USER = 'wxid_alice@im.wechat';
const OTHER = 'wxid_bob@im.wechat';
const ACCOUNT = 'e06c1ceea05e@im.bot';

type Handler = (value: never) => void;

/** Stands in for the iLink SDK: scripted QR login, scripted inbound messages. */
class FakeClient implements WechatClient {
  handlers = new Map<string, Handler[]>();
  sent: { userId: string; text: string }[] = [];
  /** Sends fail while this is set, like an expired 24h window. */
  reject = false;
  loggedIn: Credentials | undefined;
  started = false;
  stopped = false;
  logins = 0;
  isRunning = false;

  constructor(
    private loginWith: (callbacks?: unknown) => Promise<Credentials>,
  ) {}

  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  async login(callbacks?: unknown): Promise<Credentials> {
    this.logins += 1;
    this.loggedIn = await this.loginWith(callbacks);
    return this.loggedIn;
  }

  getCredentials(): Credentials | undefined {
    return this.loggedIn;
  }

  async start(): Promise<void> {
    this.started = true;
    this.isRunning = true;
  }

  stop(): void {
    this.stopped = true;
    this.isRunning = false;
  }

  async send(userId: string, text: string): Promise<void> {
    if (this.reject) throw new Error('iLink rejected the message: ret=-2');
    this.sent.push({ userId, text });
  }

  /** Deliver one inbound message the way the SDK would. */
  deliver(message: IncomingMessage): void {
    for (const handler of this.handlers.get('message') ?? [])
      (handler as (v: unknown) => void)(message);
  }
}

function incoming(
  text: string,
  messageId: number,
  userId = USER,
): IncomingMessage {
  return {
    userId,
    text,
    type: 'text',
    timestamp: new Date(),
    images: [],
    voices: [],
    files: [],
    videos: [],
    raw: {
      message_id: messageId,
      from_user_id: userId,
      to_user_id: ACCOUNT,
      client_id: `client-${messageId}`,
      create_time_ms: Date.now(),
      message_type: 1,
      message_state: 2,
      context_token: `ctx-${messageId}`,
      item_list: [{ type: 1, text_item: { text } }],
    },
    _contextToken: `ctx-${messageId}`,
  };
}

function credentials(): Credentials {
  return {
    token: 'test-token',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    accountId: ACCOUNT,
    userId: 'wxid_self@im.wechat',
    savedAt: new Date().toISOString(),
  };
}

interface Fixture {
  root: string;
  client: FakeClient;
  service: Service;
  /** The service's WeChat adapter, created during init(). */
  readonly adapter: WechatAdapter;
  init(): Promise<void>;
  close(): Promise<void>;
}

function fixture(
  t: TestContext,
  options: {
    allowed?: string;
    login?: (callbacks?: unknown) => Promise<Credentials>;
    failLogin?: boolean;
  } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'tian-wechat-'));
  const client = new FakeClient(
    options.login ??
      (async () => {
        if (options.failLogin) throw new Error('QR login aborted');
        return credentials();
      }),
  );
  const allowed = options.allowed ?? USER;
  const service = new Service(
    join(root, 'data'),
    () => {},
    {},
    {
      config: { allowedUserIds: allowed ? allowed.split(',') : [] },
      storageDir: join(root, 'data', 'wechat'),
      createClient: () => client,
    },
  );
  const state: Fixture = {
    root,
    client,
    service,
    get adapter() {
      return (service as unknown as { wechat: WechatAdapter }).wechat;
    },
    init: () => service.init(),
    close: async () => {
      await service.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  t.after(async () => {
    await state.close().catch(() => {});
  });
  return state;
}

const window = (f: Fixture) =>
  f.adapter as unknown as {
    keepalive(): Promise<void>;
    windowState(userId: string): {
      lastInboundAt: number;
      lastOutboundAt: number;
      lastProbeAt: number;
      probes: number;
    };
    saveWindow(
      userId: string,
      state: {
        lastInboundAt: number;
        lastOutboundAt: number;
        lastProbeAt: number;
        probes: number;
      },
    ): void;
  };

async function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 5_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('WeChat condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Append a completed assistant entry, the way a model turn would. */
async function reply(
  service: Service,
  conversationId: string,
  text: string,
): Promise<void> {
  const conversation = await (
    service as unknown as {
      agents: { conversation(id: string): Promise<Conversation> };
    }
  ).agents.conversation(conversationId);
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
      tx.appendEntry(conversation.id, { kind: 'pi.assistant', model: [turn] }),
    BACKGROUND_CONTEXT,
  );
}

test('the allow-list comes from WECHAT_ALLOWED_USER_IDS', () => {
  assert.deepEqual(wechatAllowedFromEnv({} as NodeJS.ProcessEnv), []);
  assert.deepEqual(
    wechatAllowedFromEnv({
      WECHAT_ALLOWED_USER_IDS: ` ${USER} , ${OTHER} ,,`,
    } as NodeJS.ProcessEnv),
    [USER, OTHER],
  );
});

test('without an allow-list the adapter stays off', async (t) => {
  const f = fixture(t, { allowed: '' });
  await f.init();
  assert.equal(f.service.wechatStatus().enabled, false);
  assert.equal(f.service.wechatStatus().loggedIn, false);
  assert.equal(f.client.logins, 0);
  assert.equal(f.client.started, false);
  assert.equal(f.service.listConversations().length, 0);
});

test('the QR login runs and publishes its code until the scan', async (t) => {
  let statusDuringLogin: WechatStatus | null = null;
  const f = fixture(t, {
    login: async (callbacks) => {
      const typed =
        (callbacks as { callbacks?: QrLoginCallbacks } | undefined)
          ?.callbacks ?? {};
      typed.onQrUrl?.('https://liteapp.weixin.qq.com/q/test');
      statusDuringLogin = f.service.wechatStatus();
      typed.onScanned?.();
      return credentials();
    },
  });
  await f.init();
  assert.equal(
    (statusDuringLogin as WechatStatus | null)?.qrCodeUrl,
    'https://liteapp.weixin.qq.com/q/test',
  );
  const status = f.service.wechatStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.loggedIn, true);
  assert.equal(status.accountId, ACCOUNT);
  assert.equal(status.qrCodeUrl, null, 'the code is dropped once logged in');
  assert.equal(f.client.started, true);
});

test('a failed login is reported instead of crashing the service', async (t) => {
  const f = fixture(t, { failLogin: true });
  await f.init();
  const status = f.service.wechatStatus();
  assert.equal(status.loggedIn, false);
  assert.match(status.error ?? '', /QR login aborted/);
});

test('messages from users outside the allow-list are ignored', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('陌生人', 1, OTHER));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.service.listConversations().length, 0);
  assert.equal(f.client.sent.length, 0);
});

test('an allow-listed message opens one stable conversation and replies', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('你好', 1));
  await until(() => f.service.listConversations().length === 1);
  const [conversation] = f.service.listConversations();
  assert.equal(conversation.scopeId, 'global');
  const bound = (
    f.service as unknown as {
      db: {
        sqlite: {
          prepare(sql: string): {
            get(...args: unknown[]): { channel: string; external_id: string };
          };
        };
      };
    }
  ).db.sqlite
    .prepare(
      'SELECT channel, external_id FROM channel_sessions WHERE conversation_id = ?',
    )
    .get(conversation.conversationId);
  assert.equal(bound.channel, 'wechat');
  assert.equal(bound.external_id, USER);

  f.client.deliver(incoming('再来一句', 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.service.listConversations().length, 1);

  await reply(f.service, conversation.conversationId, '收到');
  await until(() => f.client.sent.some((m) => m.text === '收到'));
  assert.deepEqual(
    f.client.sent.map((m) => [m.userId, m.text]),
    [[USER, '收到']],
  );
});

test('a rejected send is retried once the user writes again', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('你好', 1));
  await until(() => f.service.listConversations().length === 1);
  const [conversation] = f.service.listConversations();

  // The 24h window spent: iLink rejects the reply.
  f.client.reject = true;
  await reply(f.service, conversation.conversationId, '窗口已关闭');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(f.client.sent.length, 0);

  // The user writes again, opening a fresh window: the pending reply lands.
  f.client.reject = false;
  f.client.deliver(incoming('还在吗', 2));
  await until(() => f.client.sent.some((m) => m.text === '窗口已关闭'));
  assert.deepEqual(
    f.client.sent.map((m) => m.text),
    ['窗口已关闭'],
  );
});

test('keepalive sends at most two heartbeats per window', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('你好', 1));
  await until(() => f.service.listConversations().length === 1);
  const state = window(f);
  f.client.sent.length = 0;

  // Fresh window: nothing sent.
  await state.keepalive();
  assert.equal(f.client.sent.length, 0);

  // Quiet for 12 hours: one heartbeat.
  const quiet = Date.now() - 12 * 60 * 60 * 1_000;
  state.saveWindow(USER, {
    lastInboundAt: quiet,
    lastOutboundAt: quiet,
    lastProbeAt: 0,
    probes: 0,
  });
  await state.keepalive();
  assert.deepEqual(
    f.client.sent.map((m) => m.text),
    ['.'],
  );
  assert.equal(state.windowState(USER).probes, 1);

  // Second heartbeat a few hours later.
  state.saveWindow(USER, {
    lastInboundAt: quiet,
    lastOutboundAt: Date.now() - 5 * 60 * 60 * 1_000,
    lastProbeAt: Date.now() - 5 * 60 * 60 * 1_000,
    probes: 1,
  });
  await state.keepalive();
  assert.equal(f.client.sent.length, 2);

  // The budget for this window is spent.
  state.saveWindow(USER, {
    lastInboundAt: quiet,
    lastOutboundAt: Date.now() - 60 * 60 * 1_000,
    lastProbeAt: Date.now() - 60 * 60 * 1_000,
    probes: 2,
  });
  await state.keepalive();
  assert.equal(f.client.sent.length, 2);

  // A new inbound message opens a fresh window and resets the budget.
  f.client.deliver(incoming('我回来了', 2));
  await until(() => state.windowState(USER).probes === 0);
  assert.equal(state.windowState(USER).probes, 0);
});

test('a rejected heartbeat is not repeated until the user writes', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('你好', 1));
  await until(() => f.service.listConversations().length === 1);
  const state = window(f);
  const quiet = Date.now() - 12 * 60 * 60 * 1_000;
  state.saveWindow(USER, {
    lastInboundAt: quiet,
    lastOutboundAt: quiet,
    lastProbeAt: 0,
    probes: 0,
  });
  f.client.reject = true;
  await state.keepalive();
  assert.equal(f.client.sent.length, 0);
  assert.equal(state.windowState(USER).probes, 2, 'budget is spent');

  f.client.reject = false;
  await state.keepalive();
  assert.equal(f.client.sent.length, 0, 'no retry in the same window');
});

test('commands answer over WeChat without submitting a turn', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('/scope', 1));
  await until(() => f.client.sent.some((m) => m.text.includes('当前 scope')));
  f.client.deliver(incoming('/scope 不存在', 2));
  await until(() => f.client.sent.some((m) => m.text.includes('未知 scope')));
  assert.equal(f.service.listConversations().length, 0);
});

test('stop() settles the adapter so the service can close', async (t) => {
  const f = fixture(t);
  await f.init();
  f.client.deliver(incoming('你好', 1));
  await until(() => f.service.listConversations().length === 1);
  await f.close();
  assert.equal(f.client.stopped, true);
});
