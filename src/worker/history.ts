import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  Conversation,
  EntryId,
  EntryRecord,
} from '@earendil-works/pi-durable';
import type { Db } from './db.js';
import type { EventLog } from './events.js';
import type { IssueReporter } from './improvements.js';

/** One searchable unit: a transcript excerpt, a tool call/result, or an event. */
export interface HistoryRow {
  /** Transcript conversation id, or '' for event rows. */
  conversationId: string;
  /** Pi entry id (with a `:call:<n>` suffix for tool calls), or the event id. */
  entryId: string;
  scopeId: string;
  kind: 'message' | 'tool_call' | 'tool_result' | 'event';
  role: string | null;
  at: string;
  text: string;
}

export interface SearchFilter {
  /** Scope to search; null/undefined searches every scope. */
  scopeId?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
}

/** The only Pi access the index needs; `AgentRuntime` satisfies it. */
export interface HistorySource {
  conversation(id: string): Promise<Conversation>;
}

const PAGE = 500;
const TOOL_RESULT_CHARS = 2_000;
const TOOL_ARGS_CHARS = 400;
const READ_CHARS = 1_200;
const TOKEN_BUDGET = 1_500; // estimated as ceil(utf8Bytes / 3)
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const EVENTS_CURSOR = 'events';
const EVENT_TEXT_CHARS = 400;
const SYNC_DEBOUNCE_MS = 2_000;

const refOf = (row: Pick<HistoryRow, 'conversationId' | 'entryId' | 'kind'>) =>
  row.kind === 'event'
    ? `event:${row.entryId}`
    : `conv:${row.conversationId}#${row.entryId}`;

const clock = (at: string) => `${at.slice(0, 16).replace('T', ' ')}`;

const formatLine = (row: HistoryRow, text: string) =>
  `[${clock(row.at)}] ${refOf(row)} ${row.role ?? row.kind}: ${text}`;

const codePoints = (value: string) => [...value].length;

const escapeLike = (value: string) =>
  value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Derived, rebuildable full-text index over Pi transcripts (`pi-session.sqlite`
 * stays the only source) plus the event log, stored in `tian.db`. Per
 * conversation it pages entries ascending from a cursor, so syncs are
 * incremental and idempotent; a full resync restores everything from scratch.
 */
export class HistoryIndex {
  private syncs = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;

  constructor(
    private db: Db,
    private source: HistorySource,
    private events: EventLog,
    /** Gate for background sync work (e.g. paused during service maintenance). */
    private enabled: () => boolean = () => true,
    /** Automatic issue sink; defaults to the console. */
    private onIssue?: IssueReporter,
  ) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS history_entries (
        conversation_id TEXT NOT NULL, entry_id TEXT NOT NULL, scope_id TEXT NOT NULL,
        kind TEXT NOT NULL, role TEXT, at TEXT NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY (conversation_id, entry_id)
      );
      CREATE INDEX IF NOT EXISTS history_scope_at ON history_entries(scope_id, at);
      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
        text, content='history_entries', content_rowid='rowid', tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS history_fts_insert AFTER INSERT ON history_entries BEGIN
        INSERT INTO history_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS history_fts_delete AFTER DELETE ON history_entries BEGIN
        INSERT INTO history_fts(history_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;
      CREATE TABLE IF NOT EXISTS history_cursors (
        conversation_id TEXT PRIMARY KEY, last_entry TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
  }

  // ---- sync ----------------------------------------------------------------

  /** Conversations worth indexing: chief conversations plus every run's worker. */
  private knownConversations(): { id: string; scopeId: string }[] {
    const list = this.db
      .listConversations()
      .map((row) => ({ id: row.conversationId, scopeId: row.scopeId }));
    const seen = new Set(list.map((row) => row.id));
    // Every run, not just the recent page `listRuns` returns: old workers stay searchable.
    const runs = this.db.sqlite
      .prepare(
        'SELECT DISTINCT conversation_id AS id, project_id AS scopeId FROM runs WHERE conversation_id IS NOT NULL',
      )
      .all() as unknown as { id: string; scopeId: string }[];
    for (const run of runs) {
      if (seen.has(run.id)) continue;
      list.push(run);
      seen.add(run.id);
    }
    return list;
  }

  private cursorOf(key: string): string | null {
    const value = this.db.sqlite
      .prepare(
        'SELECT last_entry FROM history_cursors WHERE conversation_id = ?',
      )
      .get(key) as { last_entry: string } | undefined;
    return value?.last_entry ?? null;
  }

  private setCursor(key: string, lastEntry: string): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO history_cursors (conversation_id,last_entry,updated_at) VALUES (?,?,?)
        ON CONFLICT(conversation_id) DO UPDATE SET last_entry=excluded.last_entry, updated_at=excluded.updated_at`,
      )
      .run(key, lastEntry, new Date().toISOString());
  }

  /** Index rows exactly once; safe to call again with overlapping input. */
  indexRows(rows: HistoryRow[]): void {
    if (rows.length === 0) return;
    const insert = this.db.sqlite.prepare(
      `INSERT OR IGNORE INTO history_entries
      (conversation_id,entry_id,scope_id,kind,role,at,text) VALUES (?,?,?,?,?,?,?)`,
    );
    this.db.transaction(() => {
      for (const row of rows)
        insert.run(
          row.conversationId,
          row.entryId,
          row.scopeId,
          row.kind,
          row.role,
          row.at,
          row.text,
        );
    });
  }

  /** Catch one conversation up from its cursor. Concurrent calls share one run. */
  async syncConversation(
    conversationId: string,
    scopeId: string,
  ): Promise<void> {
    if (this.stopped) return;
    const pending = this.syncs.get(conversationId);
    if (pending) return pending;
    const task = this.doSync(conversationId, scopeId).finally(() =>
      this.syncs.delete(conversationId),
    );
    this.syncs.set(conversationId, task);
    return task;
  }

  private async doSync(conversationId: string, scopeId: string): Promise<void> {
    const conversation = await this.source
      .conversation(conversationId)
      .catch(() => undefined);
    if (!conversation) return;
    let cursor = Number(this.cursorOf(conversationId) ?? 0);
    for (;;) {
      const page = await conversation.entries(
        { order: 'ascending', minEntryId: (cursor + 1) as EntryId },
        PAGE,
        undefined,
        BACKGROUND_CONTEXT,
      );
      if (page.items.length === 0) break;
      const fallbackAt = new Date().toISOString();
      const rows: HistoryRow[] = [];
      for (const entry of page.items) {
        rows.push(...extractRows(entry, scopeId, fallbackAt));
        cursor = Math.max(cursor, entry.id);
      }
      this.indexRows(rows);
      this.setCursor(conversationId, String(cursor));
      if (!page.next) break;
    }
  }

  /** Index newly recorded events; the cursor is the events table rowid. */
  private syncEvents(): void {
    let cursor = Number(this.cursorOf(EVENTS_CURSOR) ?? 0);
    for (;;) {
      const batch = this.db.sqlite
        .prepare(
          'SELECT rowid AS rid, * FROM events WHERE rowid > ? ORDER BY rowid LIMIT 1000',
        )
        .all(cursor) as unknown as (EventRowLike & { rid: number })[];
      if (batch.length === 0) break;
      this.indexRows(
        batch.map((event) => ({
          conversationId: '',
          entryId: event.id,
          scopeId: event.scope_id,
          kind: 'event' as const,
          role: event.actor,
          at: event.at,
          text: `${event.type} | ${event.summary} | ${event.payload.slice(0, EVENT_TEXT_CHARS)}`,
        })),
      );
      cursor = batch[batch.length - 1].rid;
      this.setCursor(EVENTS_CURSOR, String(cursor));
      if (batch.length < 1000) break;
    }
  }

  /** Sync every known conversation (scopeIds null) or just the given scopes, plus events. */
  async syncAll(scopeIds?: readonly string[]): Promise<void> {
    if (this.stopped || !this.enabled()) return;
    const all = this.knownConversations();
    const wanted = scopeIds ? new Set(scopeIds) : null;
    const selected = wanted
      ? all.filter((row) => wanted.has(row.scopeId))
      : all;
    await Promise.all(
      selected.map((row) =>
        this.syncConversation(row.id, row.scopeId).catch((error) =>
          this.report('history.sync', error, {
            scopeId: row.scopeId,
            conversationId: `conv:${row.id}`,
          }),
        ),
      ),
    );
    this.syncEvents();
  }

  /** Schedule a debounced catch-up after a conversation changed (e.g. went idle). */
  touch(conversationId: string, scopeId: string): void {
    if (this.stopped || !this.enabled()) return;
    clearTimeout(this.timers.get(conversationId));
    this.timers.set(
      conversationId,
      setTimeout(() => {
        this.timers.delete(conversationId);
        if (this.stopped || !this.enabled()) return;
        void this.syncConversation(conversationId, scopeId).catch((error) =>
          this.report('history.sync', error, {
            scopeId,
            conversationId: `conv:${conversationId}`,
          }),
        );
      }, SYNC_DEBOUNCE_MS),
    );
  }

  /** Drop everything and rebuild from the sources. */
  async resync(): Promise<void> {
    this.db.sqlite.exec(
      'DELETE FROM history_entries; DELETE FROM history_cursors;',
    );
    this.db.sqlite.exec(
      "INSERT INTO history_fts(history_fts) VALUES('rebuild')",
    );
    await this.syncAll();
  }

  /** Wait for in-flight syncs (used on service close). */
  async idle(): Promise<void> {
    await Promise.allSettled(this.syncs.values());
  }

  private report(
    area: string,
    error: unknown,
    context: Parameters<IssueReporter>[2] = {},
  ): void {
    if (this.onIssue) this.onIssue(area, error, context);
    else console.error(`${area}:`, error);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  // ---- search --------------------------------------------------------------

  /**
   * FTS-search or LIKE-fallback the index; rows keep their stored text.
   *
   * A multi-word query matches documents containing every term (AND), so
   * "SQLite 记忆" works. Terms shorter than 3 characters cannot match under
   * trigram: those become LIKE clauses, and if every term is short the whole
   * query falls back to LIKE.
   */
  private select(
    phrase: string,
    filter: SearchFilter,
    limit: number,
    forceLike = false,
  ): (HistoryRow & { snippetText?: string })[] {
    const terms = phrase.split(/\s+/).filter(Boolean);
    const long = terms.filter((term) => codePoints(term) >= 3);
    const short = terms.filter((term) => codePoints(term) < 3);
    const useFts = !forceLike && long.length > 0;
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (useFts) {
      clauses.push('history_fts MATCH ?');
      args.push(
        long.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND '),
      );
      for (const term of short) {
        clauses.push("e.text LIKE ? ESCAPE '\\'");
        args.push(`%${escapeLike(term)}%`);
      }
    } else {
      for (const term of terms) {
        clauses.push("e.text LIKE ? ESCAPE '\\'");
        args.push(`%${escapeLike(term)}%`);
      }
    }
    if (filter.scopeId) {
      clauses.push('e.scope_id = ?');
      args.push(filter.scopeId);
    }
    if (filter.since) {
      clauses.push('e.at >= ?');
      args.push(filter.since);
    }
    if (filter.until) {
      clauses.push('e.at <= ?');
      args.push(filter.until);
    }
    const sql = `SELECT e.conversation_id AS conversationId, e.entry_id AS entryId,
        e.scope_id AS scopeId, e.kind AS kind, e.role AS role, e.at AS at, e.text AS text
        ${useFts ? ", snippet(history_fts, 0, '«', '»', '…', 64) AS snippetText" : ''}
      FROM history_entries e
      ${useFts ? 'JOIN history_fts ON history_fts.rowid = e.rowid' : ''}
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${useFts ? 'history_fts.rank, e.at DESC' : 'e.at DESC'}
      LIMIT ?`;
    try {
      return this.db.sqlite.prepare(sql).all(...args, limit) as unknown as (
        | HistoryRow
        | { snippetText?: string }
      )[] as (HistoryRow & { snippetText?: string })[];
    } catch (error) {
      // A query FTS rejects must still be searchable.
      if (useFts) return this.select(phrase, filter, limit, true);
      throw error;
    }
  }

  private likeSnippet(text: string, phrase: string): string {
    const needle = phrase.split(/\s+/).find((term) => text.includes(term));
    if (!needle) return text.slice(0, READ_CHARS);
    const at = text.indexOf(needle);
    const start = Math.max(0, at - 80);
    const end = Math.min(text.length, at + needle.length + 120);
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }

  /** Search lines, best first, de-duplicated, cut to a ~1500-token budget. */
  async search(query: string, filter: SearchFilter = {}): Promise<string[]> {
    const phrase = query.trim();
    if (!phrase) return [];
    await this.syncAll(filter.scopeId ? [filter.scopeId] : undefined);
    const limit = Math.min(
      Math.max(filter.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const rows = this.select(phrase, filter, limit * 4);
    const seen = new Set<string>();
    const lines: string[] = [];
    let budget = TOKEN_BUDGET;
    for (const row of rows) {
      if (lines.length >= limit) break;
      const ref = refOf(row);
      if (seen.has(ref)) continue;
      seen.add(ref);
      const text = row.snippetText ?? this.likeSnippet(row.text, phrase);
      const line = formatLine(row, text);
      const cost = Math.ceil(Buffer.byteLength(line, 'utf8') / 3);
      if (lines.length > 0 && cost > budget) break;
      lines.push(line);
      budget -= cost;
    }
    return lines;
  }

  // ---- read ----------------------------------------------------------------

  private entryWindow(
    conversationId: string,
    base: number,
    around: number,
  ): HistoryRow[] {
    const bases = (
      this.db.sqlite
        .prepare(
          'SELECT DISTINCT CAST(entry_id AS INTEGER) AS base FROM history_entries WHERE conversation_id = ?',
        )
        .all(conversationId) as { base: number }[]
    )
      .map((row) => row.base)
      .sort((a, b) => a - b);
    const at = bases.indexOf(base);
    if (at < 0) return [];
    const from = bases[Math.max(0, at - around)];
    const to = bases[Math.min(bases.length - 1, at + around)];
    return this.db.sqlite
      .prepare(
        `SELECT conversation_id AS conversationId, entry_id AS entryId, scope_id AS scopeId,
          kind AS kind, role AS role, at AS at, text AS text
        FROM history_entries
        WHERE conversation_id = ? AND CAST(entry_id AS INTEGER) BETWEEN ? AND ?
        ORDER BY CAST(entry_id AS INTEGER), entry_id`,
      )
      .all(conversationId, from, to) as unknown as HistoryRow[];
  }

  private readEvent(id: string): string {
    const event = this.events.get(id);
    if (event)
      return `[${clock(event.at)}] event:${event.id} ${event.actor} (${event.type}, scope ${event.scopeId})\n${event.summary}\npayload: ${event.payload}`;
    const row = this.db.sqlite
      .prepare(
        `SELECT conversation_id AS conversationId, entry_id AS entryId, scope_id AS scopeId,
          kind AS kind, role AS role, at AS at, text AS text
        FROM history_entries WHERE conversation_id = '' AND entry_id = ?`,
      )
      .get(id) as HistoryRow | undefined;
    return row ? formatLine(row, row.text) : `(no event ${id})`;
  }

  /** Expand a `conv:<id>#<entry>` ref with neighbours, or show an `event:<id>`. */
  async read(ref: string, around = 2): Promise<string> {
    const trimmed = ref.trim();
    if (trimmed.startsWith('event:'))
      return this.readEvent(trimmed.slice('event:'.length));
    const match = /^conv:([^#\s]+)#(.+)$/.exec(trimmed);
    if (!match)
      return `bad ref: ${trimmed} (expected conv:<id>#<entry> or event:<id>)`;
    const conversationId = match[1];
    const base = Number.parseInt(match[2], 10);
    if (!Number.isFinite(base)) return `bad ref: ${trimmed}`;
    let window = this.entryWindow(conversationId, base, around);
    if (window.length === 0) {
      const known = this.knownConversations().find(
        (row) => row.id === conversationId,
      );
      if (known) await this.syncConversation(known.id, known.scopeId);
      window = this.entryWindow(conversationId, base, around);
    }
    if (window.length === 0) return `(nothing indexed under ${conversationId})`;
    return window
      .map((row) =>
        formatLine(
          row,
          row.text.length > READ_CHARS
            ? `${row.text.slice(0, READ_CHARS)}…`
            : row.text,
        ),
      )
      .join('\n');
  }
}

interface EventRowLike {
  id: string;
  type: string;
  scope_id: string;
  actor: string;
  at: string;
  summary: string;
  payload: string;
}

/**
 * Turn one Pi entry into zero or more index rows; empty/thinking content is
 * skipped. An entry may carry several model messages (a forked or compacted
 * transcript, a codemode turn), so every message is indexed — entries are
 * never only partially represented. The first message keeps the bare entry id
 * and later ones get a `:msg:<n>` suffix so refs stay stable and unique.
 */
function extractRows(
  entry: EntryRecord,
  scopeId: string,
  fallbackAt: string,
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let callIndex = 0;
  (entry.model ?? []).forEach((message, index) => {
    const entryId = index === 0 ? String(entry.id) : `${entry.id}:msg:${index}`;
    const at =
      typeof message.timestamp === 'number'
        ? new Date(message.timestamp).toISOString()
        : fallbackAt;
    const base = {
      conversationId: String(entry.conversationId),
      entryId,
      scopeId,
      at,
    };
    if (entry.kind === 'pi.user' && message.role === 'user') {
      const text = messageText(message.content);
      if (text) rows.push({ ...base, kind: 'message', role: 'user', text });
      return;
    }
    if (entry.kind === 'pi.assistant' && message.role === 'assistant') {
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (text)
        rows.push({ ...base, kind: 'message', role: 'assistant', text });
      for (const block of message.content) {
        if (block.type !== 'toolCall') continue;
        let args = JSON.stringify(block.arguments);
        if (args.length > TOOL_ARGS_CHARS)
          args = `${args.slice(0, TOOL_ARGS_CHARS)}…`;
        rows.push({
          ...base,
          entryId: `${entry.id}:call:${callIndex++}`,
          kind: 'tool_call',
          role: 'assistant',
          text: `${block.name}(${args})`,
        });
      }
      return;
    }
    if (entry.kind === 'pi.toolResult' && message.role === 'toolResult') {
      const text = messageText(message.content);
      if (!text) return;
      const body =
        text.length > TOOL_RESULT_CHARS
          ? `${text.slice(0, TOOL_RESULT_CHARS)}…`
          : text;
      rows.push({
        ...base,
        kind: 'tool_result',
        role: 'tool',
        text: `${message.toolName}: ${body}`,
      });
    }
  });
  return rows;
}

function messageText(
  content: string | readonly { type: string; text?: string }[] | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('')
    .trim();
}
