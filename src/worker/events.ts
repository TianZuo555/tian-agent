import type { Db } from './db.js';

/** Who performed the action recorded by an event. */
export type EventActor =
  | 'user'
  | 'chief'
  | 'manager'
  | 'worker'
  | 'scheduler'
  | 'channel'
  | 'system';

export interface EventInput {
  /**
   * Deterministic when the fact can be replayed (e.g. `run:<id>:dispatched`);
   * `record` ignores duplicates, so replays stay idempotent.
   */
  id: string;
  /** Dotted business fact: run.dispatched, run.finished, run.landed, run.shipped, run.discarded, inbox.received, notification.delivered. */
  type: string;
  actor: EventActor;
  scopeId: string;
  /** One human-readable line. */
  summary: string;
  /** ISO timestamp; defaults to now. */
  at?: string;
  goalId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  conversationId?: string | null;
  payload?: Record<string, unknown>;
}

export interface EventRow {
  id: string;
  at: string;
  type: string;
  actor: EventActor;
  scopeId: string;
  goalId: string | null;
  taskId: string | null;
  runId: string | null;
  conversationId: string | null;
  summary: string;
  /** JSON string. */
  payload: string;
}

export interface EventFilter {
  scopeId?: string | null;
  type?: string | null;
  runId?: string | null;
  conversationId?: string | null;
  /** ISO timestamp lower bound (inclusive). */
  since?: string | null;
  /** ISO timestamp upper bound (inclusive). */
  until?: string | null;
  limit?: number;
}

const toEventRow = (value: unknown): EventRow => {
  const record = value as Record<string, unknown>;
  return {
    id: record.id as string,
    at: record.at as string,
    type: record.type as string,
    actor: record.actor as EventActor,
    scopeId: record.scope_id as string,
    goalId: (record.goal_id as string | null) ?? null,
    taskId: (record.task_id as string | null) ?? null,
    runId: (record.run_id as string | null) ?? null,
    conversationId: (record.conversation_id as string | null) ?? null,
    summary: record.summary as string,
    payload: record.payload as string,
  };
};

/**
 * Append-only business event log in `tian.db`: auditable facts about runs, inbox
 * imports and notification deliveries. Other features record here too — keep the
 * API at `record` / `get` / `list`. `record` is a one-call, fire-and-forget
 * INSERT OR IGNORE: pass a deterministic `id` whenever the caller can replay.
 */
export class EventLog {
  constructor(private db: Db) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL,
        scope_id TEXT NOT NULL, goal_id TEXT, task_id TEXT, run_id TEXT, conversation_id TEXT,
        summary TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS events_scope_at ON events(scope_id, at);
      CREATE INDEX IF NOT EXISTS events_type_at ON events(type, at);
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id);
    `);
  }

  record(event: EventInput): void {
    this.db.sqlite
      .prepare(
        `INSERT OR IGNORE INTO events
        (id,at,type,actor,scope_id,goal_id,task_id,run_id,conversation_id,summary,payload)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.id,
        event.at ?? new Date().toISOString(),
        event.type,
        event.actor,
        event.scopeId,
        event.goalId ?? null,
        event.taskId ?? null,
        event.runId ?? null,
        event.conversationId ?? null,
        event.summary,
        JSON.stringify(event.payload ?? {}),
      );
  }

  get(id: string): EventRow | undefined {
    const value = this.db.sqlite
      .prepare('SELECT * FROM events WHERE id = ?')
      .get(id);
    return value ? toEventRow(value) : undefined;
  }

  list(filter: EventFilter = {}): EventRow[] {
    const clauses = ['1=1'];
    const args: (string | number)[] = [];
    if (filter.scopeId) {
      clauses.push('scope_id = ?');
      args.push(filter.scopeId);
    }
    if (filter.type) {
      clauses.push('type = ?');
      args.push(filter.type);
    }
    if (filter.runId) {
      clauses.push('run_id = ?');
      args.push(filter.runId);
    }
    if (filter.conversationId) {
      clauses.push('conversation_id = ?');
      args.push(filter.conversationId);
    }
    if (filter.since) {
      clauses.push('at >= ?');
      args.push(filter.since);
    }
    if (filter.until) {
      clauses.push('at <= ?');
      args.push(filter.until);
    }
    args.push(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
    return this.db.sqlite
      .prepare(
        `SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY at, rowid LIMIT ?`,
      )
      .all(...args)
      .map((value) => toEventRow(value));
  }
}
