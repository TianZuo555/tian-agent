import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  Conversation,
  EntryId,
  EntryRecord,
} from '@earendil-works/pi-durable';
import type { Db } from './db.js';
import type { EventLog } from './events.js';
import type { IssueReporter } from './improvements.js';
import { escapeLike, pageText, planSearch, tokenCost } from './search.js';

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
/**
 * Tool payloads and messages are indexed as whole source units (one row per
 * tool call, tool result, or message), so nothing at a chunk boundary or a
 * truncation threshold becomes unfindable. The stored text is complete;
 * output stays bounded only at the edges: FTS snippets in search results and
 * paged reads in read_history.
 */
const TOKEN_BUDGET = 1_500;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const EVENTS_CURSOR = 'events';
const EVENT_TEXT_CHARS = 400;
const SYNC_DEBOUNCE_MS = 2_000;
const INDEX_FORMAT = '4';

/**
 * Search results point at the whole entry, not the chunk that matched, so
 * read_history can page the original text from its start.
 */
const refOf = (row: Pick<HistoryRow, 'conversationId' | 'entryId' | 'kind'>) =>
  row.kind === 'event'
    ? `event:${row.entryId}`
    : `conv:${row.conversationId}#${row.entryId.replace(/:chunk:\d+$/, '')}`;

const clock = (at: string) => `${at.slice(0, 16).replace('T', ' ')}`;

const formatLine = (row: HistoryRow, text: string) =>
  `[${clock(row.at)}] ${refOf(row)} ${row.role ?? row.kind}: ${text}`;

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
    this.ensureIndexFormat();
  }

  private ensureIndexFormat(): void {
    const row = this.db.sqlite
      .prepare(
        "SELECT value FROM memory_meta WHERE key = 'history-index-format'",
      )
      .get() as { value: string } | undefined;
    if (row?.value === INDEX_FORMAT) return;
    this.resetIndex();
  }

  /**
   * Drop every derived row and cursor. After a rebuild the entry rowids are
   * new, so ALL cursors are meaningless — conversation, events, and the memory
   * worker's per-scope rowid cursors alike. The next sync rebuilds the index
   * from Pi and the event log; the memory worker re-collects from the start and
   * its exact-plus-similarity dedupe keeps dismissed candidates dismissed
   * instead of duplicating them.
   */
  private resetIndex(): void {
    this.db.transaction(() => {
      this.db.sqlite.exec('DELETE FROM history_entries;');
      this.db.sqlite.exec('DELETE FROM history_cursors;');
      this.db.sqlite.exec(
        "INSERT INTO history_fts(history_fts) VALUES('rebuild')",
      );
      this.db.sqlite
        .prepare(
          `INSERT INTO memory_meta (key, value) VALUES ('history-index-format', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(INDEX_FORMAT);
    });
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
    this.resetIndex();
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
    const plan = planSearch(phrase);
    const useFts = !forceLike && plan.match !== null;
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (useFts) {
      clauses.push('history_fts MATCH ?');
      args.push(plan.match!);
      for (const term of plan.short) {
        clauses.push("e.text LIKE ? ESCAPE '\\'");
        args.push(`%${escapeLike(term)}%`);
      }
    } else {
      for (const term of plan.terms) {
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
    if (!needle) return [...text].slice(0, 400).join('');
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
      const cost = tokenCost(line);
      if (lines.length > 0 && cost > budget) break;
      lines.push(line);
      budget -= cost;
    }
    return lines;
  }

  // ---- read ----------------------------------------------------------------

  /** Indexed rows around an entry, using numeric entry ids for ordering. */
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

  private readEvent(id: string, offset: number, limit: number): string {
    const event = this.events.get(id);
    if (!event) {
      const row = this.db.sqlite
        .prepare(
          `SELECT conversation_id AS conversationId, entry_id AS entryId, scope_id AS scopeId,
            kind AS kind, role AS role, at AS at, text AS text
          FROM history_entries WHERE conversation_id = '' AND entry_id = ?`,
        )
        .get(id) as HistoryRow | undefined;
      return row ? formatLine(row, row.text) : `(no event ${id})`;
    }
    const full = `${event.summary}\npayload: ${event.payload}`;
    if (offset >= [...full].length)
      return `(offset ${offset} is beyond the end of event ${id} (${[...full].length} code points); use offset 0)`;
    const page = pageText(full, offset, limit);
    const range = `chars ${page.offset + 1}-${page.offset + [...page.page].length} of ${page.total}`;
    const continuation =
      page.next === null
        ? 'end of event'
        : `continued at read_history(ref="event:${id}", offset=${page.next})`;
    return `[${clock(event.at)}] event:${event.id} ${event.actor} (${event.type}, scope ${event.scopeId}) (${range})\n${page.page}\n… ${continuation}`;
  }

  /** The indexed text of one ref, exactly as stored. */
  private indexedText(conversationId: string, entryId: string): string | null {
    const direct = this.db.sqlite
      .prepare(
        `SELECT text FROM history_entries WHERE conversation_id = ? AND entry_id = ?`,
      )
      .get(conversationId, entryId) as { text: string } | undefined;
    return direct ? direct.text : null;
  }

  /**
   * Resolve a ref against the original Pi transcript, using the same ref rules
   * as the indexer: `<entry>` is the first message, `<entry>:msg:<n>` the n-th
   * message, and `<entry>:call:<n>` the n-th tool call counted across ALL
   * messages of the entry (the indexer numbers calls entry-wide). Returns null
   * when the transcript is unavailable or lacks the ref.
   */
  private async originalText(
    conversationId: string,
    entryId: string,
  ): Promise<string | null> {
    const base = Number.parseInt(entryId, 10);
    if (!Number.isFinite(base)) return null;
    const msgMatch = /^\d+:msg:(\d+)$/.exec(entryId);
    const callMatch = /^\d+:call:(\d+)$/.exec(entryId);
    try {
      const conversation = await this.source.conversation(conversationId);
      const page = await conversation.entries(
        {
          order: 'ascending',
          minEntryId: base as EntryId,
          maxEntryId: base as EntryId,
        },
        1,
        undefined,
        BACKGROUND_CONTEXT,
      );
      const entry = page.items.find((item) => Number(item.id) === base);
      if (!entry) return null;
      const messages = entry.model ?? [];
      if (callMatch) {
        // Calls are numbered across the whole entry, not per message.
        let remaining = Number(callMatch[1]);
        for (const message of messages) {
          if (message.role !== 'assistant') continue;
          for (const block of message.content) {
            if (block.type !== 'toolCall') continue;
            if (remaining === 0)
              return `${block.name}(${JSON.stringify(block.arguments)})`;
            remaining--;
          }
        }
        return null;
      }
      const messageIndex = msgMatch ? Number(msgMatch[1]) : 0;
      const message = messages[messageIndex];
      if (!message) return null;
      if (message.role === 'user') return messageText(message.content) || null;
      if (message.role === 'assistant') {
        const text = message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim();
        if (text && !callMatch) return text;
        return null;
      }
      if (message.role === 'toolResult') {
        const text = messageText(message.content);
        return text ? `${message.toolName}: ${text}` : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Expand a `conv:<id>#<entry>` ref, or show an `event:<id>`.
   *
   * Output is always bounded: the target entry is paged (default 2,000 code
   * points) from the original transcript or its index, and neighbours render
   * as one-line previews. `offset > 0` continues the target entry alone.
   */
  async read(
    ref: string,
    options: {
      around?: number;
      offset?: number;
      limit?: number;
    } = {},
  ): Promise<string> {
    const trimmed = ref.trim();
    if (trimmed.startsWith('event:'))
      return this.readEvent(
        trimmed.slice('event:'.length),
        options.offset ?? 0,
        options.limit ?? 2_000,
      );
    const match = /^conv:([^#\s]+)#(.+)$/.exec(trimmed);
    if (!match)
      return `bad ref: ${trimmed} (expected conv:<id>#<entry> or event:<id>)`;
    const conversationId = match[1];
    const entryId = match[2];
    const base = Number.parseInt(entryId, 10);
    if (!Number.isFinite(base)) return `bad ref: ${trimmed}`;
    const around = Math.min(Math.max(options.around ?? 2, 0), 20);
    const offset = Math.max(options.offset ?? 0, 0);
    const limit = Math.min(Math.max(options.limit ?? 2_000, 1), 8_000);
    if (offset === 0 && around > 0) {
      let window = this.entryWindow(conversationId, base, around);
      if (window.length === 0) {
        const known = this.knownConversations().find(
          (row) => row.id === conversationId,
        );
        if (known) await this.syncConversation(known.id, known.scopeId);
        window = this.entryWindow(conversationId, base, around);
      }
      if (window.length === 0)
        return `(nothing indexed under ${conversationId})`;
    }
    const full =
      (await this.originalText(conversationId, entryId)) ??
      this.indexedText(conversationId, entryId);
    if (full === null) {
      // No text for this exact ref (a bare entry with only tool calls, or an
      // unknown sub-ref). Say so and show bounded previews of the entry's
      // indexed units instead of dumping the whole window.
      const window = this.entryWindow(conversationId, base, around);
      if (window.length === 0)
        return `(no content indexed for ${trimmed}; check the ref — bare entries with only tool calls need :call:<n>, and unknown sub-refs have no content)`;
      const heading = `(no text for ${trimmed}; showing ${window.length} indexed unit${window.length === 1 ? '' : 's'} of this entry as bounded previews)`;
      return [heading, ...this.boundedPreviews(window)].join('\n');
    }
    if (offset >= [...full].length)
      return `(offset ${offset} is beyond the end (${[...full].length} code points); use offset 0)`;
    const page = pageText(full, offset, limit);
    const row = this.db.sqlite
      .prepare(
        `SELECT conversation_id AS conversationId, entry_id AS entryId, scope_id AS scopeId,
          kind AS kind, role AS role, at AS at, text AS text
        FROM history_entries WHERE conversation_id = ? AND entry_id = ?`,
      )
      .get(conversationId, entryId) as HistoryRow | undefined;
    const header = row
      ? `[${clock(row.at)}] ${refOf(row)} ${row.role ?? row.kind}`
      : trimmed;
    const range = `chars ${page.offset + 1}-${page.offset + [...page.page].length} of ${page.total}`;
    const continuation =
      page.next === null
        ? 'end of entry'
        : `continued at read_history(ref="${trimmed}", offset=${page.next})`;
    const expanded = `${header} (${range})\n${page.page}\n… ${continuation}`;
    if (offset > 0 || around === 0) return expanded;
    // Context view: the target entry expanded, neighbours as bounded one-line
    // previews (deduplicated by ref), never their full payloads.
    const lines = [expanded];
    // Neighbours are other entries: sibling units of the same entry are not
    // context for the exact ref (a tool call must not be padded with its
    // message's prose), so they are skipped. Context itself has a total
    // character budget so a long window cannot dominate the output.
    lines.push(
      ...this.boundedPreviews(
        this.entryWindow(conversationId, base, around).filter(
          (neighbor) => String(neighbor.entryId).split(':')[0] !== String(base),
        ),
      ),
    );
    return lines.join('\n');
  }

  /** Total character budget for context/preview output. */
  private static readonly CONTEXT_BUDGET = 1_200;

  /** Bounded preview lines with a single omission note when over budget. */
  private boundedPreviews(rows: HistoryRow[]): string[] {
    const lines: string[] = [];
    let used = 0;
    let omitted = 0;
    for (const row of rows) {
      const line = this.previewLine(row);
      if (used + line.length > HistoryIndex.CONTEXT_BUDGET) {
        omitted++;
        continue;
      }
      used += line.length;
      lines.push(line);
    }
    if (omitted > 0)
      lines.push(
        `… ${omitted} more unit${omitted === 1 ? '' : 's'} omitted (context budget)`,
      );
    return lines;
  }

  /** One bounded preview line for a context neighbour. */
  private previewLine(row: HistoryRow): string {
    const chars = [...row.text];
    const preview =
      chars.length <= 200 ? row.text : `${chars.slice(0, 200).join('')}…`;
    return formatLine(row, preview);
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
    if (message.role === 'user') {
      // Real user turns keep `user`; system notifications and worker input are
      // indexed with their own kind so provenance and search stay honest.
      const text = messageText(message.content);
      if (text)
        rows.push({
          ...base,
          kind: 'message',
          role: entry.kind === 'pi.user' ? 'user' : entry.kind,
          text,
        });
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
        const callId = `${entry.id}:call:${callIndex++}`;
        rows.push({
          ...base,
          entryId: callId,
          kind: 'tool_call',
          role: 'assistant',
          // One row per call, stored in full: a term anywhere in the args is
          // searchable, and reads page the transcript.
          text: `${block.name}(${JSON.stringify(block.arguments)})`,
        });
      }
      return;
    }
    if (entry.kind === 'pi.toolResult' && message.role === 'toolResult') {
      const text = messageText(message.content);
      if (!text) return;
      rows.push({
        ...base,
        kind: 'tool_result',
        role: 'tool',
        text: `${message.toolName}: ${text}`,
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
