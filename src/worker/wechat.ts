import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { EntryId } from '@earendil-works/pi-durable';
import {
  WeChatBot,
  type Credentials,
  type IncomingMessage,
  type QrLoginCallbacks,
} from '@wechatbot/wechatbot';
import type { WechatStatus } from '../shared/types.js';
import { GLOBAL_SCOPE } from './scopes.js';
import { assistantText, type ChannelHost } from './channel-host.js';
import type { IssueContext } from './improvements.js';

export const WECHAT_CHANNEL = 'wechat';

/**
 * Read the allow-list from the service environment. Credentials are not part of
 * the configuration: the SDK keeps them in storage after the QR login. An empty
 * list disables the adapter, so a fresh install never answers strangers.
 */
export function wechatAllowedFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return (env.WECHAT_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export interface WechatConfig {
  /** WeChat user IDs (`…@im.wechat`) that may talk to the bot. */
  allowedUserIds: string[];
}

/** The slice of `@wechatbot/wechatbot` the adapter drives; tests substitute a fake. */
export interface WechatClient {
  on(event: 'message', handler: (msg: IncomingMessage) => void): unknown;
  on(event: 'session:expired', handler: () => void): unknown;
  on(event: 'session:restored', handler: (creds: Credentials) => void): unknown;
  login(options: {
    force?: boolean;
    callbacks?: QrLoginCallbacks;
  }): Promise<Credentials>;
  start(): Promise<void>;
  stop(): void;
  send(userId: string, content: string): Promise<void>;
  getCredentials(): Credentials | undefined;
  readonly isRunning: boolean;
}

export interface WechatSetup {
  config?: WechatConfig | null;
  /** Where the SDK keeps credentials, the poll cursor and context tokens. */
  storageDir: string;
  /** iLink transport from the SDK; tests pass a fake. */
  createClient?: (options: { storageDir: string }) => WechatClient;
}

export type { WechatStatus };

export interface WechatOptions {
  /**
   * Idle time after which the adapter refreshes the conversation window with a
   * one-character heartbeat. The window itself is 24h; bots also get only ~10
   * proactive messages per window, so a shorter period would burn the quota.
   */
  keepaliveMs: number;
  /** Re-send the heartbeat this long before the window is estimated to close. */
  keepaliveLeadMs: number;
  /** iLink allows about ten bot messages per window; two is plenty to test it. */
  maxProbesPerWindow: number;
}

const DEFAULT_OPTIONS: WechatOptions = {
  keepaliveMs: 11 * 60 * 60 * 1_000,
  keepaliveLeadMs: 30 * 60 * 1_000,
  maxProbesPerWindow: 2,
};

const CONVERSATION_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const PAGE_SIZE = 50;
const QR_LIFETIME_MS = 5 * 60 * 1_000;
const HEARTBEAT_TEXT = '.';
const HELP_TEXT = [
  '可用命令：',
  '/scope [名称] — 查看或切换 scope（global 或项目名）',
  '/status — 当前 scope 的待办任务与运行中的 Run',
  '/help — 显示本帮助',
  '直接发送文字即可与总管对话。',
].join('\n');

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Default iLink transport: the official SDK, with file storage under the data dir. */
export function createWechatClient(options: {
  storageDir: string;
}): WechatClient {
  return new WeChatBot({
    storage: 'file',
    storageDir: options.storageDir,
    logLevel: 'warn',
    botAgent: 'TianAgent',
  });
}

interface UserRow {
  userId: string;
  scopeId: string;
  conversationId: string;
}

interface WatchEntry {
  conversationId: string;
  stop: () => Promise<unknown>;
}

interface ConversationState {
  /** Last inbound message: the start of the reply window. */
  lastInboundAt: number;
  /** Last successful outbound message, probe included. */
  lastOutboundAt: number;
  /** Last heartbeat we sent; capped per window. */
  lastProbeAt: number;
  /** Probes sent since the last inbound message. */
  probes: number;
}

/**
 * WeChat gateway over Tencent's iLink Bot protocol (the ClawBot plugin).
 *
 * It mirrors the Telegram adapter: allow-listed senders only, one stable
 * channel-bound conversation per user, completed assistant text forwarded back
 * exactly once across restarts. Two things are WeChat-specific:
 *
 * - iLink only delivers to a user through the `context_token` of their last
 *   inbound message, and only for 24 hours. Forwarding tolerates a failed send
 *   and retries it once the user writes again instead of stalling the cursor.
 * - A window refresh needs the user to write first, so the adapter sends at
 *   most two one-character heartbeats per window, spaced a few hours apart,
 *   and records whether the probe reached the user.
 *
 * Own tables (created here, not in db.ts): wechat_users (user -> scope),
 * wechat_forward_cursor (per-conversation forwarding cursor) and
 * wechat_windows (reply-window state per user).
 */
export class WechatAdapter {
  private readonly options: WechatOptions;
  private client: WechatClient | null = null;
  private running = false;
  private starting = false;
  private epoch = 0;
  private watches = new Map<string, WatchEntry>();
  private forwardRuns = new Map<string, Promise<void>>();
  private forwardDirty = new Set<string>();
  private retryWakes = new Map<string, () => void>();
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private sleepers = 0;
  private qrCodeUrl: string | null = null;
  private qrCodeAt = 0;
  private scanned = false;
  private accountId: string | null = null;
  private error: string | null = null;

  constructor(
    private host: ChannelHost,
    private config: WechatConfig,
    private setup: WechatSetup,
    options?: Partial<WechatOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ---- lifecycle

  /** Idempotent. Without credentials it starts the QR login and waits for the scan. */
  async start(): Promise<void> {
    if (this.running || this.starting) return;
    this.starting = true;
    const epoch = this.epoch;
    try {
      this.ensureSchema();
      this.client =
        this.setup.createClient?.({ storageDir: this.setup.storageDir }) ??
        createWechatClient({ storageDir: this.setup.storageDir });
      this.bindClient(epoch);
      const credentials = await this.client.login({
        callbacks: this.loginCallbacks(),
      });
      if (epoch !== this.epoch) return; // stopped while waiting for the scan
      this.accountId = credentials.accountId;
      this.qrCodeUrl = null;
      this.scanned = false;
      this.running = true;
      this.startKeepalive();
      void this.client.start().catch((reason) => {
        if (epoch !== this.epoch) return;
        this.report('wechat.poll', reason);
      });
      for (const user of this.listUsers()) {
        if (!this.allowed(user.userId)) continue;
        // Ordered on purpose: each user binds its own conversation.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await this.attachWatch(user.userId, user.conversationId);
      }
      await this.forwardAll();
    } catch (error) {
      if (epoch === this.epoch) {
        this.error = errorText(error);
        this.report('wechat.start', error);
      }
    } finally {
      this.starting = false;
    }
  }

  /** Stop forwarding and polling and settle every in-flight submit. */
  async stop(): Promise<void> {
    this.running = false;
    this.starting = false;
    this.epoch += 1;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    for (const wake of this.retryWakes.values()) wake();
    this.retryWakes.clear();
    this.client?.stop();
    this.client = null;
    await Promise.all(
      [...this.watches.values()].map((watch) => watch.stop().catch(() => {})),
    );
    this.watches.clear();
    while (this.forwardRuns.size > 0)
      await Promise.allSettled(this.forwardRuns.values());
  }

  status(): WechatStatus {
    return {
      enabled: this.config.allowedUserIds.length > 0,
      loggedIn: this.accountId !== null,
      accountId: this.accountId,
      qrCodeUrl:
        this.qrCodeUrl && Date.now() - this.qrCodeAt < QR_LIFETIME_MS
          ? this.qrCodeUrl
          : null,
      scanned: this.scanned,
      error: this.error,
    };
  }

  /** Start the QR login again, e.g. after the code expired. */
  async relogin(): Promise<WechatStatus> {
    await this.stop();
    this.scanned = false;
    this.error = null;
    void this.start();
    return this.status();
  }

  private loginCallbacks(): QrLoginCallbacks {
    return {
      onQrUrl: (url) => {
        this.qrCodeUrl = url;
        this.qrCodeAt = Date.now();
        this.scanned = false;
      },
      onScanned: () => {
        this.scanned = true;
      },
      onExpired: () => {
        this.qrCodeUrl = null;
      },
    };
  }

  private bindClient(epoch: number): void {
    const client = this.client!;
    client.on('message', (message) => {
      if (epoch === this.epoch) void this.handleMessage(message);
    });
    client.on('session:expired', () => {
      if (epoch !== this.epoch) return;
      this.report(
        'wechat.session',
        new Error('iLink session expired; run the WeChat login again'),
      );
    });
    client.on('session:restored', (credentials) => {
      // A re-login invalidates every cached reply window.
      if (epoch !== this.epoch) return;
      this.accountId = credentials.accountId;
      this.host.db.sqlite.prepare('DELETE FROM wechat_windows').run();
      this.qrCodeUrl = null;
    });
  }

  private allowed(userId: string): boolean {
    return this.config.allowedUserIds.includes(userId);
  }

  private report(
    area: string,
    error: unknown,
    context: IssueContext = {},
  ): void {
    if (this.host.reportIssue) this.host.reportIssue(area, error, context);
    else console.error(`${area}:`, errorText(error));
  }

  // ---- inbound

  private async handleMessage(message: IncomingMessage): Promise<void> {
    const userId = message.userId;
    if (!this.allowed(userId)) {
      console.log(`WeChat: ignoring unauthorized user ${userId}`);
      return;
    }
    this.touchInbound(userId);
    this.wakeForward(userId);
    const text = message.text.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      await this.handleCommand(userId, text);
      return;
    }
    await this.submitToUser(userId, text, this.requestId(message));
  }

  private requestId(message: IncomingMessage): string {
    const raw = message.raw;
    const stable = raw.message_id
      ? `m${raw.message_id}`
      : createHash('sha256')
          .update(`${raw.client_id}:${raw.create_time_ms}`)
          .digest('hex');
    return `wx:${raw.from_user_id}:${stable}`;
  }

  private async submitToUser(
    userId: string,
    text: string,
    requestId: string,
  ): Promise<void> {
    const scopeId = this.userScope(userId) ?? GLOBAL_SCOPE;
    this.bindUser(userId, scopeId);
    const conversation = await this.host.openSession({
      channel: WECHAT_CHANNEL,
      externalId: userId,
      scopeId,
    });
    await this.attachWatch(userId, conversation.conversationId);
    await this.host.submit(conversation.conversationId, text, requestId);
  }

  private async handleCommand(userId: string, text: string): Promise<void> {
    const [rawName, ...rest] = text.split(/\s+/);
    const name = rawName.replace(/@\w+$/, '');
    if (name === '/help') {
      await this.sendNow(userId, HELP_TEXT);
      return;
    }
    if (name === '/scope') {
      await this.sendNow(
        userId,
        await this.scopeCommand(userId, rest.join(' ')),
      );
      return;
    }
    if (name === '/status') {
      await this.sendNow(userId, this.statusCommand(userId));
      return;
    }
    await this.sendNow(userId, `${name} 不是可用命令。\n\n${HELP_TEXT}`);
  }

  private async scopeCommand(userId: string, arg: string): Promise<string> {
    const current = this.userScope(userId) ?? GLOBAL_SCOPE;
    if (!arg) return `当前 scope：${this.scopeLabel(current)}`;
    try {
      this.host.scopes.root(arg);
    } catch {
      return `未知 scope：${arg}。可用 "global" 或已注册的项目名。`;
    }
    const scopeId =
      arg === GLOBAL_SCOPE
        ? GLOBAL_SCOPE
        : (this.host.db.projectByName(arg) ?? this.host.db.getProject(arg))!.id;
    this.bindUser(userId, scopeId);
    const conversation = await this.host.openSession({
      channel: WECHAT_CHANNEL,
      externalId: userId,
      scopeId,
    });
    await this.attachWatch(userId, conversation.conversationId);
    return `已切换到 scope：${this.scopeLabel(scopeId)}`;
  }

  private statusCommand(userId: string): string {
    const scopeId = this.userScope(userId) ?? GLOBAL_SCOPE;
    const lines = [`当前 scope：${this.scopeLabel(scopeId)}`];
    const tasks = this.host.db
      .listTasks(scopeId)
      .filter((task) =>
        ['pending', 'running', 'waiting_approval', 'blocked'].includes(
          task.status,
        ),
      );
    lines.push(
      tasks.length ? `待办任务 ${tasks.length} 项：` : '没有待办任务。',
    );
    for (const task of tasks.slice(0, 10)) lines.push(`- ${task.title}`);
    const runs = this.host.db
      .activeRuns()
      .filter((run) => scopeId === GLOBAL_SCOPE || run.projectId === scopeId);
    lines.push(
      runs.length ? `运行中的 Run ${runs.length} 个：` : '没有运行中的 Run。',
    );
    for (const run of runs.slice(0, 10))
      lines.push(
        `- ${run.id}：${run.currentPrompt.split('\n')[0].slice(0, 60)}（${run.status}）`,
      );
    return lines.join('\n');
  }

  private scopeLabel(scopeId: string): string {
    if (scopeId === GLOBAL_SCOPE) return 'global';
    return this.host.db.getProject(scopeId)?.name ?? scopeId;
  }

  // ---- outbound forwarding

  private forwardUser(userId: string, conversationId: string): Promise<void> {
    if (!this.running || !this.allowed(userId)) return Promise.resolve();
    const running = this.forwardRuns.get(conversationId);
    if (running) {
      this.forwardDirty.add(conversationId);
      return running;
    }
    const run = this.forwardNow(userId, conversationId)
      .catch((error) =>
        this.report('wechat.forward', error, {
          scopeId: this.userScope(userId),
          conversationId: `conv:${conversationId}`,
          extra: `user ${userId}`,
        }),
      )
      .then(() => {
        this.forwardRuns.delete(conversationId);
        if (this.forwardDirty.delete(conversationId) && this.running)
          void this.forwardUser(userId, conversationId);
      });
    this.forwardRuns.set(conversationId, run);
    return run;
  }

  /**
   * Send every completed assistant text newer than the cursor. A send that the
   * iLink API rejects (the 24h window or its message cap is spent) leaves the
   * cursor in place and waits for the user's next message instead of spinning,
   * so a transient outage neither loses nor duplicates a reply.
   */
  private async forwardNow(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.host.conversation(conversationId);
    for (;;) {
      if (!this.running) return;
      const cursor = this.loadCursor(conversationId);
      const page = await conversation.entries(
        { order: 'ascending', minEntryId: (cursor + 1) as EntryId },
        PAGE_SIZE,
        undefined,
        BACKGROUND_CONTEXT,
      );
      for (const entry of page.items) {
        const text = assistantText(entry);
        if (text && !(await this.deliver(userId, conversationId, text))) return;
        this.saveCursor(conversationId, entry.id);
      }
      if (page.items.length < PAGE_SIZE) return;
    }
  }

  /**
   * Send one message, retrying a few times with backoff. Returns false when the
   * window is spent: the caller then keeps the cursor so the next inbound
   * message re-delivers the reply instead of dropping it.
   */
  private async deliver(
    userId: string,
    conversationId: string,
    text: string,
  ): Promise<boolean> {
    for (let attempt = 1; ; attempt += 1) {
      if (!this.running) return false;
      try {
        await this.sendNow(userId, text);
        return true;
      } catch (error) {
        if (attempt >= 3) {
          this.report('wechat.forward', error, {
            scopeId: this.userScope(userId),
            conversationId: `conv:${conversationId}`,
            extra: `undelivered until ${userId} writes again`,
          });
          return false;
        }
        await this.sleep(attempt * 1_000);
      }
    }
  }

  private async forwardAll(): Promise<void> {
    if (!this.running) return;
    // Sequential on purpose: forwarding advances a persisted per-user cursor
    // and a stop() between users must be able to interrupt it.
    for (const user of this.listUsers()) {
      if (!this.running) return;
      // react-doctor-disable-next-line react-doctor/async-await-in-loop
      await this.forwardUser(user.userId, user.conversationId);
    }
  }

  private async sendNow(userId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('WeChat client is not running');
    await this.client.send(userId, text);
    this.touchOutbound(userId);
  }

  private wakeForward(userId: string): void {
    const wake = this.retryWakes.get(userId);
    if (!wake) return;
    this.retryWakes.delete(userId);
    wake();
  }

  private sleep(ms: number): Promise<void> {
    const key = `sleep:${++this.sleepers}`;
    return new Promise((resolve) => {
      this.retryWakes.set(key, () => {
        this.retryWakes.delete(key);
        resolve();
      });
      setTimeout(() => this.retryWakes.get(key)?.(), ms).unref?.();
    });
  }

  // ---- reply window (24h) and heartbeat

  private startKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    const tick = Math.max(60_000, Math.floor(this.options.keepaliveMs / 12));
    this.keepaliveTimer = setInterval(() => {
      void this.keepalive();
    }, tick);
    this.keepaliveTimer.unref?.();
  }

  /**
   * Keep every allow-listed conversation inside its 24h reply window. The sync
   * runs at most three times per window and only sends when a user has been
   * quiet past `keepaliveMs`. A rejected heartbeat is the only way to learn the
   * window closed; the next user message opens a fresh one.
   */
  private async keepalive(): Promise<void> {
    if (!this.running || !this.client) return;
    for (const user of this.listUsers()) {
      if (!this.running) return;
      if (!this.allowed(user.userId)) continue;
      const state = this.windowState(user.userId);
      const now = Date.now();
      const idle = now - state.lastInboundAt;
      const remaining = state.lastInboundAt + CONVERSATION_TIMEOUT_MS - now;
      // Quiet long enough to probe, still plausibly inside the window, and the
      // per-window heartbeat budget is not spent.
      if (idle < this.options.keepaliveMs) continue;
      if (remaining < this.options.keepaliveLeadMs) continue;
      if (state.probes >= this.options.maxProbesPerWindow) continue;
      try {
        // Sequential on purpose: iLink counts every send against the window.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await this.client.send(user.userId, HEARTBEAT_TEXT);
        this.saveWindow(user.userId, {
          ...state,
          lastOutboundAt: now,
          lastProbeAt: now,
          probes: state.probes + 1,
        });
      } catch (error) {
        // Rejected means the window already closed: stop probing until the
        // user writes again, which opens a new one.
        this.report('wechat.keepalive', error, {
          scopeId: this.userScope(user.userId),
          extra: `heartbeat to ${user.userId} rejected; waiting for the user to write`,
        });
        this.saveWindow(user.userId, {
          ...state,
          probes: this.options.maxProbesPerWindow,
        });
        continue;
      }
    }
  }

  private windowState(userId: string): ConversationState {
    const row = this.host.db.sqlite
      .prepare(
        'SELECT last_inbound_at, last_outbound_at, last_probe_at, probes FROM wechat_windows WHERE user_id = ?',
      )
      .get(userId) as
      | {
          last_inbound_at: number;
          last_outbound_at: number;
          last_probe_at: number;
          probes: number;
        }
      | undefined;
    return row
      ? {
          lastInboundAt: row.last_inbound_at,
          lastOutboundAt: row.last_outbound_at,
          lastProbeAt: row.last_probe_at,
          probes: row.probes,
        }
      : { lastInboundAt: 0, lastOutboundAt: 0, lastProbeAt: 0, probes: 0 };
  }

  /** An inbound message opens a fresh window: reset the heartbeat budget. */
  private touchInbound(userId: string): void {
    const now = Date.now();
    this.saveWindow(userId, {
      lastInboundAt: now,
      lastOutboundAt: now,
      lastProbeAt: 0,
      probes: 0,
    });
  }

  private touchOutbound(userId: string): void {
    const state = this.windowState(userId);
    this.saveWindow(userId, {
      ...state,
      lastInboundAt: state.lastInboundAt || Date.now(),
      lastOutboundAt: Date.now(),
    });
  }

  private saveWindow(userId: string, state: ConversationState): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO wechat_windows (user_id, last_inbound_at, last_outbound_at, last_probe_at, probes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           last_inbound_at = excluded.last_inbound_at,
           last_outbound_at = excluded.last_outbound_at,
           last_probe_at = excluded.last_probe_at,
           probes = excluded.probes`,
      )
      .run(
        userId,
        state.lastInboundAt,
        state.lastOutboundAt,
        state.lastProbeAt,
        state.probes,
      );
  }

  // ---- conversation watches

  private async attachWatch(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    if (!this.running || !this.allowed(userId)) return;
    const current = this.watches.get(userId);
    if (current?.conversationId === conversationId) return;
    const epoch = this.epoch;
    await current?.stop().catch(() => {});
    if (epoch !== this.epoch) return;
    try {
      const conversation = await this.host.conversation(conversationId);
      const watch = await conversation.watch(BACKGROUND_CONTEXT);
      if (epoch !== this.epoch) {
        await watch.stop().catch(() => {});
        return;
      }
      this.watches.set(userId, {
        conversationId,
        stop: () => watch.stop(),
      });
      await watch.start(async () => {
        if (epoch !== this.epoch || !this.running) return;
        await this.forwardUser(userId, conversationId);
      });
    } catch (error) {
      this.report('wechat.watch', error, {
        scopeId: this.userScope(userId),
        conversationId: `conv:${conversationId}`,
      });
    }
  }

  // ---- own tables

  private ensureSchema(): void {
    this.host.db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS wechat_users (
        user_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wechat_forward_cursor (
        conversation_id TEXT PRIMARY KEY, entry_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wechat_windows (
        user_id TEXT PRIMARY KEY,
        last_inbound_at INTEGER NOT NULL,
        last_outbound_at INTEGER NOT NULL,
        last_probe_at INTEGER NOT NULL,
        probes INTEGER NOT NULL
      );
    `);
  }

  private userScope(userId: string): string | undefined {
    const row = this.host.db.sqlite
      .prepare('SELECT scope_id FROM wechat_users WHERE user_id = ?')
      .get(userId) as { scope_id: string } | undefined;
    return row?.scope_id;
  }

  private bindUser(userId: string, scopeId: string): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO wechat_users (user_id, scope_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET scope_id = excluded.scope_id, updated_at = excluded.updated_at`,
      )
      .run(userId, scopeId, new Date().toISOString());
  }

  private listUsers(): UserRow[] {
    const rows = this.host.db.sqlite
      .prepare(
        `SELECT u.user_id, u.scope_id, s.conversation_id FROM wechat_users u
         JOIN channel_sessions s ON s.channel = 'wechat' AND s.external_id = u.user_id AND s.scope_id = u.scope_id
         ORDER BY u.user_id`,
      )
      .all() as {
      user_id: string;
      scope_id: string;
      conversation_id: string;
    }[];
    return rows.map((row) => ({
      userId: row.user_id,
      scopeId: row.scope_id,
      conversationId: row.conversation_id,
    }));
  }

  private loadCursor(conversationId: string): number {
    const row = this.host.db.sqlite
      .prepare(
        'SELECT entry_id FROM wechat_forward_cursor WHERE conversation_id = ?',
      )
      .get(conversationId) as { entry_id: number } | undefined;
    return row ? Number(row.entry_id) : 0;
  }

  private saveCursor(conversationId: string, entryId: number): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO wechat_forward_cursor (conversation_id, entry_id) VALUES (?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET entry_id = excluded.entry_id`,
      )
      .run(conversationId, entryId);
  }
}
