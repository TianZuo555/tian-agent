import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation } from '@earendil-works/pi-durable';
import type { ConversationInfo, SessionBinding } from '../shared/types.js';
import type { Scopes } from './scopes.js';
import type { Db } from './db.js';
import type { IssueContext } from './improvements.js';

/** Application surface a channel adapter works against; owned by the Service. */
export interface ChannelHost {
  db: Db;
  scopes: Scopes;
  openSession(binding: SessionBinding): Promise<ConversationInfo>;
  /** The project's persistent manager conversation, opened lazily. */
  openManager(projectId: string): Promise<ConversationInfo>;
  submit(
    conversationId: string,
    content: string,
    requestId: string,
  ): Promise<void>;
  conversation(conversationId: string): Promise<Conversation>;
  /** Automatic issue sink; adapters degrade to console logging without it. */
  reportIssue?: (area: string, error: unknown, context?: IssueContext) => void;
}

/**
 * Outbound forwarding cursors of one channel, kept per (recipient,
 * conversation). A project scope routes every chat to its one manager
 * conversation (M6), so a cursor per conversation would let one recipient
 * consume the replies of another. A recipient that joins a conversation
 * starts at its newest entry: it gets replies from then on, not the whole
 * transcript. `<channel>_forward_cursor` is the older per-conversation table;
 * it is only read, as the start for a pair that has no row yet.
 */
export class ForwardCursors {
  private readonly table: string;
  private readonly legacy: string;

  constructor(
    private db: Db,
    channel: string,
  ) {
    this.table = `${channel}_recipient_cursor`;
    this.legacy = `${channel}_forward_cursor`;
  }

  ensureSchema(): void {
    this.db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        recipient_id TEXT NOT NULL, conversation_id TEXT NOT NULL, entry_id INTEGER NOT NULL,
        PRIMARY KEY (recipient_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS ${this.legacy} (
        conversation_id TEXT PRIMARY KEY, entry_id INTEGER NOT NULL
      );
    `);
  }

  /** The last forwarded entry id, or null when the pair has no cursor yet. */
  load(recipientId: string, conversationId: string): number | null {
    const row = (this.db.sqlite
      .prepare(
        `SELECT entry_id FROM ${this.table} WHERE recipient_id = ? AND conversation_id = ?`,
      )
      .get(recipientId, conversationId) ??
      this.db.sqlite
        .prepare(
          `SELECT entry_id FROM ${this.legacy} WHERE conversation_id = ?`,
        )
        .get(conversationId)) as { entry_id: number } | undefined;
    return row ? Number(row.entry_id) : null;
  }

  save(recipientId: string, conversationId: string, entryId: number): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO ${this.table} (recipient_id, conversation_id, entry_id) VALUES (?, ?, ?)
         ON CONFLICT(recipient_id, conversation_id) DO UPDATE SET entry_id = excluded.entry_id`,
      )
      .run(recipientId, conversationId, entryId);
  }

  /** The pair's cursor; a new pair starts at the conversation's newest entry. */
  async open(
    recipientId: string,
    conversationId: string,
    conversation: Conversation,
  ): Promise<number> {
    const cursor = this.load(recipientId, conversationId);
    if (cursor !== null) return cursor;
    const newest = await conversation.entries(
      { order: 'descending' },
      1,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const start = Number(newest.items[0]?.id ?? 0);
    this.save(recipientId, conversationId, start);
    return start;
  }
}

/**
 * Text of a completed assistant entry: text blocks only, no thinking or tool
 * calls. Shared by every outbound channel so both deliver the same words.
 */
export function assistantText(entry: {
  kind: string;
  model?: unknown;
}): string {
  if (entry.kind !== 'pi.assistant' || !entry.model) return '';
  const parts: string[] = [];
  for (const message of entry.model as { content?: unknown }[]) {
    const content = message.content;
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
