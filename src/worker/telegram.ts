import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  Conversation,
  EntryId,
  EntryRecord,
} from '@earendil-works/pi-durable';
import type { ConversationInfo, SessionBinding } from '../shared/types.js';
import { GLOBAL_SCOPE, type Scopes } from './scopes.js';
import type { Db } from './db.js';

export const TELEGRAM_CHANNEL = 'telegram';

/** One Bot API update; only the fields the adapter consumes are typed. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

/**
 * The slice of the Telegram Bot API the adapter needs. The production
 * implementation talks to api.telegram.org over fetch; tests substitute a fake.
 */
export interface TelegramBotApi {
  getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  sendMessage(
    chatId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface TelegramConfig {
  token: string;
  /** Chat IDs that may talk to the bot; every other chat is ignored. */
  allowedChatIds: string[];
}

/**
 * Read the adapter configuration from the service environment
 * (`<dataDir>/service.env`, loaded by the service entry). No token means the
 * adapter is disabled and nothing else fails.
 */
export function telegramConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  const allowedChatIds = (env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return { token, allowedChatIds };
}

export interface TelegramSetup {
  /** Resolved from the service environment by the entry; absent = adapter off. */
  config?: TelegramConfig | null;
  api?: TelegramBotApi;
  options?: Partial<TelegramOptions>;
}

export interface TelegramOptions {
  /** Bot API long-poll duration; 0 disables long polling (tests). */
  pollTimeoutMs: number;
  /** Initial network backoff; doubled on every failure up to maxBackoffMs. */
  backoffMs: number;
  maxBackoffMs: number;
  /** Attempts per update before it is skipped with an error log. */
  maxUpdateAttempts: number;
}

const DEFAULT_OPTIONS: TelegramOptions = {
  pollTimeoutMs: 25_000,
  backoffMs: 1_000,
  maxBackoffMs: 60_000,
  maxUpdateAttempts: 5,
};

/** Application surface the adapter works against; owned by the Service. */
export interface TelegramHost {
  db: Db;
  scopes: Scopes;
  openSession(binding: SessionBinding): Promise<ConversationInfo>;
  submit(
    conversationId: string,
    content: string,
    requestId: string,
  ): Promise<void>;
  conversation(conversationId: string): Promise<Conversation>;
}

const API_BASE = 'https://api.telegram.org';
const MESSAGE_LIMIT = 4096;
const PAGE_SIZE = 50;
const HELP_TEXT = [
  '可用命令：',
  '/scope [名称] — 查看或切换 scope（global 或项目名）',
  '/status — 当前 scope 的待办任务与运行中的 Run',
  '/help — 显示本帮助',
  '直接发送文字即可与总管对话。',
].join('\n');

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Default Bot API transport. The token only ever travels in the URL path. */
export function fetchBotApi(token: string): TelegramBotApi {
  const scrub = (text: string) => text.split(token).join('[REDACTED]');
  const call = async <T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new Error(
        `Telegram ${method} network error: ${scrub(errorText(error))}`,
      );
    }
    if (!response.ok)
      throw new Error(`Telegram ${method} failed with HTTP ${response.status}`);
    const payload = (await response.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
    };
    if (!payload.ok)
      throw new Error(
        `Telegram ${method} failed: ${scrub(payload.description ?? 'unknown error')}`,
      );
    return payload.result as T;
  };
  return {
    getUpdates: (offset, timeoutSeconds, signal) =>
      call<TelegramUpdate[]>(
        'getUpdates',
        { offset: offset || undefined, timeout: timeoutSeconds },
        signal,
      ),
    sendMessage: (chatId, text, signal) =>
      call<unknown>('sendMessage', { chat_id: chatId, text }, signal),
  };
}

/** Text of a completed assistant entry: text blocks only, no thinking or tool calls. */
export function assistantText(entry: EntryRecord): string {
  if (entry.kind !== 'pi.assistant' || !entry.model) return '';
  const parts: string[] = [];
  for (const message of entry.model) {
    const content: unknown = (message as { content?: unknown }).content;
    if (typeof content === 'string') {
      if (content.trim()) parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const type = (block as { type?: unknown } | null)?.type;
        const text = (block as { text?: unknown } | null)?.text;
        if (type === 'text' && typeof text === 'string' && text.trim())
          parts.push(text);
      }
    }
  }
  return parts.join('\n').trim();
}

/**
 * Split an outbound message into chunks of at most `limit` characters,
 * preferring line boundaries. Joining the parts with '' restores the original.
 */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit - 1);
    if (cut < Math.floor(limit / 2)) cut = limit; // no usable line boundary
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

interface ChatRow {
  chatId: string;
  scopeId: string;
  conversationId: string;
}

interface WatchEntry {
  conversationId: string;
  stop: () => Promise<unknown>;
}

/**
 * Telegram Bot gateway: long-polls updates from allow-listed chats, maps every
 * chat to a stable channel-bound conversation, and forwards completed
 * assistant text entries back to the chat exactly once across restarts.
 *
 * Own tables (created here, not in db.ts): telegram_chats (chat -> scope),
 * telegram_state (getUpdates offset), telegram_forward_cursor (per-conversation
 * forwarding cursor). Approvals and goal notices can later join as commands
 * or push channels without changing the polling core.
 */
export class TelegramAdapter {
  private readonly options: TelegramOptions;
  private running = false;
  private loop: Promise<void> | null = null;
  private epoch = 0;
  private abort: AbortController | null = null;
  private wakeSleep: (() => void) | null = null;
  private watches = new Map<string, WatchEntry>();
  /** One forwarding pass per conversation, at most one queued re-run. */
  private forwardRuns = new Map<string, Promise<void>>();
  private forwardDirty = new Set<string>();

  constructor(
    private host: TelegramHost,
    private config: TelegramConfig,
    private api: TelegramBotApi,
    options?: Partial<TelegramOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private allowed(chatId: string): boolean {
    return this.config.allowedChatIds.includes(chatId);
  }

  // ---- lifecycle

  /** Idempotent; never throws and never blocks on the polling loop itself. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    try {
      this.ensureSchema();
      for (const chat of this.listChats()) {
        if (!this.allowed(chat.chatId)) continue;
        await this.attachWatch(chat.chatId, chat.conversationId);
      }
      await this.forwardAll(); // catch up on anything missed while stopped
    } catch (error) {
      console.error('Telegram adapter start:', errorText(error));
    }
    this.loop = this.pollLoop();
  }

  /**
   * Stop polling and watching and resolve only once in-flight work has fully
   * settled: aborted Bot API calls fail fast, and the loop and forwarding
   * passes are awaited, so maintenance cannot proceed with a submit mid-flight.
   */
  async stop(): Promise<void> {
    if (!this.running && !this.loop) return;
    this.running = false;
    this.epoch += 1;
    this.abort?.abort();
    this.abort = null;
    this.wakeSleep?.();
    for (const watch of this.watches.values())
      await watch.stop().catch(() => {});
    this.watches.clear();
    const loop = this.loop;
    this.loop = null;
    if (loop) await loop.catch(() => {});
    // Watches are stopped, so nothing new is enqueued; drain what is running.
    // `forwardChat` refuses to start while stopped, so this loop terminates.
    while (this.forwardRuns.size > 0)
      await Promise.allSettled(this.forwardRuns.values());
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0 || !this.running) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleep = null;
        resolve();
      }, ms);
      this.wakeSleep = () => {
        clearTimeout(timer);
        this.wakeSleep = null;
        resolve();
      };
    });
  }

  // ---- polling loop

  private async pollLoop(): Promise<void> {
    let backoff = this.options.backoffMs;
    while (this.running) {
      try {
        const updates = await this.api.getUpdates(
          this.loadOffset(),
          Math.max(0, Math.round(this.options.pollTimeoutMs / 1000)),
          this.abort?.signal,
        );
        backoff = this.options.backoffMs;
        for (const update of updates) {
          if (!this.running) return;
          await this.processUpdate(update);
        }
        await this.forwardAll();
        if (updates.length === 0 && this.options.pollTimeoutMs <= 0)
          await this.sleep(20); // no long poll: avoid a hot spin
      } catch (error) {
        if (!this.running) return;
        console.error('Telegram polling failed:', errorText(error));
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, this.options.maxBackoffMs);
      }
    }
  }

  /**
   * Handle one update with retries and then acknowledge it by advancing the
   * offset, so a re-delivered update cannot double-submit (Durable dedupes on
   * the stable requestId) and restarts do not reprocess acknowledged updates.
   */
  private async processUpdate(update: TelegramUpdate): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      if (!this.running) return; // stopping: leave the update unacknowledged
      try {
        await this.handleUpdate(update);
        this.saveOffset(update.update_id + 1);
        return;
      } catch (error) {
        if (attempt >= this.options.maxUpdateAttempts) {
          console.error(
            `Telegram update ${update.update_id} skipped after ${attempt} attempts:`,
            errorText(error),
          );
          this.saveOffset(update.update_id + 1);
          return;
        }
        console.error(
          `Telegram update ${update.update_id} attempt ${attempt} failed:`,
          errorText(error),
        );
        await this.sleep(this.options.backoffMs);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message || typeof message.text !== 'string') return;
    const chatId = String(message.chat.id);
    if (!this.allowed(chatId)) {
      console.log(`Telegram: ignoring unauthorized chat ${chatId}`);
      return;
    }
    const text = message.text.trim();
    if (!text) return;
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text);
      return;
    }
    await this.submitToChat(chatId, text, `tg:${chatId}:${message.message_id}`);
  }

  private async submitToChat(
    chatId: string,
    text: string,
    requestId: string,
  ): Promise<void> {
    const scopeId = this.chatScope(chatId) ?? GLOBAL_SCOPE;
    this.bindChat(chatId, scopeId);
    const conversation = await this.host.openSession({
      channel: TELEGRAM_CHANNEL,
      externalId: chatId,
      scopeId,
    });
    await this.attachWatch(chatId, conversation.conversationId);
    await this.host.submit(conversation.conversationId, text, requestId);
  }

  private async handleCommand(chatId: string, text: string): Promise<void> {
    const [rawName, ...rest] = text.split(/\s+/);
    const name = rawName.replace(/@\w+$/, '');
    if (name === '/help') {
      await this.send(chatId, HELP_TEXT);
      return;
    }
    if (name === '/scope') {
      await this.send(chatId, await this.scopeCommand(chatId, rest.join(' ')));
      return;
    }
    if (name === '/status') {
      await this.send(chatId, this.statusCommand(chatId));
      return;
    }
    await this.send(chatId, `${name} 不是可用命令。\n\n${HELP_TEXT}`);
  }

  private async scopeCommand(chatId: string, arg: string): Promise<string> {
    const current = this.chatScope(chatId) ?? GLOBAL_SCOPE;
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
    this.bindChat(chatId, scopeId);
    const conversation = await this.host.openSession({
      channel: TELEGRAM_CHANNEL,
      externalId: chatId,
      scopeId,
    });
    await this.attachWatch(chatId, conversation.conversationId);
    return `已切换到 scope：${this.scopeLabel(scopeId)}`;
  }

  private statusCommand(chatId: string): string {
    const scopeId = this.chatScope(chatId) ?? GLOBAL_SCOPE;
    const lines = [`当前 scope：${this.scopeLabel(scopeId)}`];
    // Tasks replaced the old open/done to-dos; show everything still actionable.
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

  /**
   * Forward every completed assistant text entry newer than the persisted
   * cursor of this conversation, then persist the cursor after each send.
   * The allow-list is enforced here, on the single outbound path for
   * conversation output. Passes are coalesced per conversation: at most one
   * running and one queued re-run; extra triggers while one is pending only
   * set the dirty flag. Failures leave the cursor behind and retry on the
   * next trigger, so restarts neither drop nor duplicate messages.
   */
  private forwardChat(chatId: string, conversationId: string): Promise<void> {
    if (!this.running || !this.allowed(chatId)) return Promise.resolve();
    const running = this.forwardRuns.get(conversationId);
    if (running) {
      this.forwardDirty.add(conversationId);
      return running;
    }
    const run = this.forwardNow(chatId, conversationId)
      .catch((error) =>
        console.error(`Telegram forward to chat ${chatId}:`, errorText(error)),
      )
      .then(() => {
        this.forwardRuns.delete(conversationId);
        if (this.forwardDirty.delete(conversationId) && this.running)
          void this.forwardChat(chatId, conversationId);
      });
    this.forwardRuns.set(conversationId, run);
    return run;
  }

  private async forwardNow(
    chatId: string,
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
        if (text)
          for (const part of splitMessage(text)) await this.send(chatId, part);
        this.saveCursor(conversationId, entry.id);
      }
      if (page.items.length < PAGE_SIZE) return;
    }
  }

  private async forwardAll(): Promise<void> {
    if (!this.running) return;
    for (const chat of this.listChats()) {
      if (!this.running) return;
      await this.forwardChat(chat.chatId, chat.conversationId);
    }
  }

  private async send(chatId: string, text: string): Promise<void> {
    try {
      await this.api.sendMessage(chatId, text, this.abort?.signal);
    } catch (error) {
      throw new Error(`Telegram sendMessage failed: ${errorText(error)}`);
    }
  }

  // ---- conversation watches (push triggers for forwarding)

  private async attachWatch(
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    if (!this.running || !this.allowed(chatId)) return;
    const current = this.watches.get(chatId);
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
      this.watches.set(chatId, {
        conversationId,
        stop: () => watch.stop(),
      });
      await watch.start(async () => {
        if (epoch !== this.epoch || !this.running) return;
        await this.forwardChat(chatId, conversationId);
      });
    } catch (error) {
      console.error(
        `Telegram: cannot watch conversation ${conversationId}:`,
        errorText(error),
      );
    }
  }

  // ---- own tables (telegram_chats, telegram_state, telegram_forward_cursor)

  private ensureSchema(): void {
    this.host.db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS telegram_chats (
        chat_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_forward_cursor (
        conversation_id TEXT PRIMARY KEY, entry_id INTEGER NOT NULL
      );
    `);
  }

  private chatScope(chatId: string): string | undefined {
    const row = this.host.db.sqlite
      .prepare('SELECT scope_id FROM telegram_chats WHERE chat_id = ?')
      .get(chatId) as { scope_id: string } | undefined;
    return row?.scope_id;
  }

  private bindChat(chatId: string, scopeId: string): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO telegram_chats (chat_id, scope_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET scope_id = excluded.scope_id, updated_at = excluded.updated_at`,
      )
      .run(chatId, scopeId, new Date().toISOString());
  }

  private listChats(): ChatRow[] {
    const rows = this.host.db.sqlite
      .prepare(
        `SELECT c.chat_id, c.scope_id, s.conversation_id FROM telegram_chats c
         JOIN channel_sessions s ON s.channel = 'telegram' AND s.external_id = c.chat_id AND s.scope_id = c.scope_id
         ORDER BY c.chat_id`,
      )
      .all() as {
      chat_id: string;
      scope_id: string;
      conversation_id: string;
    }[];
    return rows.map((row) => ({
      chatId: row.chat_id,
      scopeId: row.scope_id,
      conversationId: row.conversation_id,
    }));
  }

  private loadOffset(): number {
    const row = this.host.db.sqlite
      .prepare("SELECT value FROM telegram_state WHERE key = 'update_offset'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }

  private saveOffset(offset: number): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO telegram_state (key, value) VALUES ('update_offset', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(offset));
  }

  private loadCursor(conversationId: string): number {
    const row = this.host.db.sqlite
      .prepare(
        'SELECT entry_id FROM telegram_forward_cursor WHERE conversation_id = ?',
      )
      .get(conversationId) as { entry_id: number } | undefined;
    return row ? Number(row.entry_id) : 0;
  }

  private saveCursor(conversationId: string, entryId: number): void {
    this.host.db.sqlite
      .prepare(
        `INSERT INTO telegram_forward_cursor (conversation_id, entry_id) VALUES (?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET entry_id = excluded.entry_id`,
      )
      .run(conversationId, entryId);
  }
}
