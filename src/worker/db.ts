import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_VERSION } from '../shared/version.js';
import type {
  ConversationInfo,
  InboxItem,
  RunInfo,
  TaskItem,
  TaskStatus,
  SessionBinding,
} from '../shared/types';

export interface ProjectRow {
  id: string;
  name: string;
  rootPath: string;
  autoLand: number;
  allowInPlace: number;
  agentKind: string;
  runTimeoutMin: number;
  baseBranch: string;
  promptPreamble: string;
  createdAt: string;
}
export type ConversationRow = ConversationInfo;
export type TaskRow = TaskItem;
export interface RunRow extends RunInfo {
  chiefConversationId: string | null;
  currentPrompt: string;
  deadlineAt: string;
}
export interface Notification {
  id: string;
  scopeId: string;
  conversationId: string | null;
  content: string;
}

export interface AgentMessageRow {
  id: string;
  /** Insertion order within the run's thread. */
  seq: number;
  runId: string;
  sender: 'chief' | 'worker';
  body: string;
  createdAt: string;
  /** When the recipient read it; null while pending. */
  deliveredAt: string | null;
}

const snake = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const row = <T>(value: unknown): T =>
  Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      item,
    ]),
  ) as T;
const rows = <T>(values: unknown[]): T[] =>
  values.map((value) => row<T>(value));

export class Db {
  private db: DatabaseSync;

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });
    this.db = new DatabaseSync(join(userDataDir, 'tian.db'));
    const version = (
      this.db.prepare('PRAGMA user_version').get() as { user_version: number }
    ).user_version;
    if (version > DATABASE_VERSION) {
      this.db.close();
      throw new Error('The database requires a newer service version');
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        auto_land INTEGER NOT NULL DEFAULT 0, allow_in_place INTEGER NOT NULL DEFAULT 0,
        agent_kind TEXT NOT NULL DEFAULT 'durable-worker', run_timeout_min INTEGER NOT NULL DEFAULT 30,
        base_branch TEXT NOT NULL DEFAULT 'main', prompt_preamble TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channel TEXT NOT NULL, external_id TEXT NOT NULL, scope_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL UNIQUE,
        PRIMARY KEY (channel, external_id, scope_id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', goal_id TEXT, owner TEXT NOT NULL DEFAULT 'user',
        outcome TEXT, summary TEXT, trigger TEXT NOT NULL DEFAULT 'manual', trigger_ref TEXT,
        dedupe_key TEXT UNIQUE, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        due TEXT, started_at TEXT, created_at TEXT NOT NULL, done_at TEXT, updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT, chief_conversation_id TEXT,
        agent_kind TEXT NOT NULL, prompt TEXT NOT NULL, current_prompt TEXT NOT NULL DEFAULT '',
        root_path TEXT NOT NULL DEFAULT '', base_branch TEXT NOT NULL DEFAULT 'main',
        execution_mode TEXT NOT NULL DEFAULT 'worktree', worktree_path TEXT, branch TEXT,
        status TEXT NOT NULL DEFAULT 'queued', review_status TEXT NOT NULL DEFAULT 'pending',
        attempt INTEGER NOT NULL DEFAULT 1, error TEXT, pr_url TEXT, report_path TEXT,
        exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT, deadline_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS run_attempts (
        run_id TEXT NOT NULL, attempt INTEGER NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
        PRIMARY KEY (run_id, attempt)
      );
      CREATE TABLE IF NOT EXISTS inbox (
        scope_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scope_id, id)
      );
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sender TEXT NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, conversation_id TEXT, content TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_scope_status ON tasks(scope_id, status);
      CREATE INDEX IF NOT EXISTS conversations_scope ON conversations(scope_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id, status);
      CREATE INDEX IF NOT EXISTS agent_messages_run ON agent_messages(run_id);
    `);
    this.ensureColumns('projects', {
      allow_in_place: 'INTEGER NOT NULL DEFAULT 0',
    });
    this.ensureColumns('tasks', {
      goal_id: 'TEXT',
      owner: "TEXT NOT NULL DEFAULT 'user'",
      outcome: 'TEXT',
      summary: 'TEXT',
      trigger: "TEXT NOT NULL DEFAULT 'manual'",
      trigger_ref: 'TEXT',
      // ALTER TABLE cannot add a UNIQUE column; creation is guarded in the
      // insert path (dedupe lookup inside one transaction) for these databases.
      dedupe_key: 'TEXT',
      attempts: 'INTEGER NOT NULL DEFAULT 0',
      max_attempts: 'INTEGER NOT NULL DEFAULT 3',
      started_at: 'TEXT',
      updated_at: 'TEXT',
    });
    this.ensureColumns('runs', {
      chief_conversation_id: 'TEXT',
      current_prompt: "TEXT NOT NULL DEFAULT ''",
      root_path: "TEXT NOT NULL DEFAULT ''",
      base_branch: "TEXT NOT NULL DEFAULT 'main'",
      execution_mode: "TEXT NOT NULL DEFAULT 'worktree'",
      review_status: "TEXT NOT NULL DEFAULT 'pending'",
      attempt: 'INTEGER NOT NULL DEFAULT 1',
      error: 'TEXT',
      pr_url: 'TEXT',
      task_id: 'INTEGER',
      deadline_at: "TEXT NOT NULL DEFAULT ''",
    });
    this.db.exec(`
      UPDATE runs SET root_path = COALESCE((SELECT root_path FROM projects WHERE projects.id = runs.project_id), '') WHERE root_path = '';
      UPDATE runs SET current_prompt = prompt WHERE current_prompt = '';
      -- ADR 0005: migrate the old todo statuses to the task state machine, idempotently.
      UPDATE tasks SET status = 'pending' WHERE status = 'open';
      UPDATE tasks SET status = 'completed' WHERE status = 'done';
      UPDATE tasks SET updated_at = COALESCE(updated_at, created_at);
      PRAGMA user_version = ${DATABASE_VERSION};
      UPDATE runs SET execution_mode = 'in-place' WHERE branch IS NULL;
      UPDATE runs SET status = 'interrupted', review_status = 'discarded' WHERE status = 'discarded';
    `);
  }

  private ensureColumns(
    table: string,
    definitions: Record<string, string>,
  ): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    for (const [name, definition] of Object.entries(definitions)) {
      if (!columns.some((column) => column.name === name))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  get sqlite(): DatabaseSync {
    return this.db;
  }

  private txDepth = 0;

  transaction<T>(action: () => T): T {
    if (this.txDepth > 0) {
      // Nested calls become savepoints so helpers with their own transaction
      // compose inside a larger one (operation-id replay, schedule fires).
      const savepoint = `tian_sp_${this.txDepth}`;
      this.db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = action();
        this.db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        this.db.exec(`ROLLBACK TO ${savepoint}`);
        this.db.exec(`RELEASE ${savepoint}`);
        throw error;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.txDepth = 0;
    }
  }

  once<T>(operationId: string | undefined, action: () => T): T {
    if (!operationId) return action();
    return this.transaction(() => {
      const saved = this.db
        .prepare('SELECT result FROM operations WHERE id = ?')
        .get(operationId) as { result: string } | undefined;
      if (saved) return JSON.parse(saved.result) as T;
      const result = action();
      this.db
        .prepare('INSERT INTO operations VALUES (?, ?)')
        .run(operationId, JSON.stringify(result ?? null));
      return result;
    });
  }

  private insert(table: string, value: object): void {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined,
    );
    this.db
      .prepare(
        `INSERT INTO ${table} (${entries.map(([key]) => snake(key)).join(',')}) VALUES (${entries.map(() => '?').join(',')})`,
      )
      .run(...entries.map(([, item]) => item as string | number | null));
  }

  close(): void {
    this.db.close();
  }
  addProject(project: Omit<ProjectRow, 'createdAt'>): void {
    this.insert('projects', {
      ...project,
      createdAt: new Date().toISOString(),
    });
  }
  updateProject(
    id: string,
    patch: Partial<Omit<ProjectRow, 'id' | 'createdAt'>>,
  ): void {
    const entries = Object.entries(patch);
    if (!entries.length) return;
    this.db
      .prepare(
        `UPDATE projects SET ${entries.map(([key]) => `${snake(key)} = ?`).join(',')} WHERE id = ?`,
      )
      .run(...entries.map(([, value]) => value as string | number), id);
  }
  removeProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  getProject(id: string): ProjectRow | undefined {
    const value = this.db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id);
    return value ? row<ProjectRow>(value) : undefined;
  }
  projectByName(name: string): ProjectRow | undefined {
    const value = this.db
      .prepare('SELECT * FROM projects WHERE name = ?')
      .get(name);
    return value ? row<ProjectRow>(value) : undefined;
  }
  listProjects(): ProjectRow[] {
    return rows(
      this.db.prepare('SELECT * FROM projects ORDER BY created_at').all(),
    );
  }

  mapConversation(conversationId: string, scopeId: string): ConversationRow {
    const value: ConversationRow = {
      conversationId,
      scopeId,
      title: null,
      createdAt: new Date().toISOString(),
    };
    this.insert('conversations', value);
    return value;
  }
  channelSession(binding: SessionBinding): ConversationRow | undefined {
    const value = this.db
      .prepare(`SELECT conversations.* FROM conversations JOIN channel_sessions USING (conversation_id)
      WHERE channel = ? AND external_id = ? AND channel_sessions.scope_id = ?`)
      .get(binding.channel, binding.externalId, binding.scopeId);
    return value ? row<ConversationRow>(value) : undefined;
  }
  bindSession(binding: SessionBinding, conversationId: string): void {
    this.db
      .prepare(
        'INSERT INTO channel_sessions (channel,external_id,scope_id,conversation_id) VALUES (?,?,?,?)',
      )
      .run(
        binding.channel,
        binding.externalId,
        binding.scopeId,
        conversationId,
      );
  }

  conversationScope(conversationId: string): string {
    const value = this.db
      .prepare('SELECT scope_id FROM conversations WHERE conversation_id = ?')
      .get(conversationId) as { scope_id: string } | undefined;
    if (!value)
      throw new Error(`Unknown chief conversation: ${conversationId}`);
    return value.scope_id;
  }
  setConversationTitle(id: string, title: string): void {
    this.db
      .prepare(
        'UPDATE conversations SET title = ? WHERE conversation_id = ? AND title IS NULL',
      )
      .run(title, id);
  }
  listConversations(): ConversationRow[] {
    return rows(
      this.db
        .prepare('SELECT * FROM conversations ORDER BY created_at DESC')
        .all(),
    );
  }
  latestConversation(scopeId: string): ConversationRow | undefined {
    const value = this.db
      .prepare(
        'SELECT * FROM conversations WHERE scope_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(scopeId);
    return value ? row(value) : undefined;
  }

  addTask(scopeId: string, title: string, due: string | null): number {
    return this.insertTask({
      scopeId,
      title,
      due,
    }).id;
  }

  /** Allowed task status changes (ADR 0005). Everything else throws. */
  static readonly TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: [
      'running',
      'waiting_approval',
      'completed',
      'paused',
      'blocked',
      'failed',
      'cancelled',
    ],
    running: [
      'waiting_approval',
      'completed',
      'failed',
      'paused',
      'blocked',
      'cancelled',
    ],
    waiting_approval: [
      'running',
      'completed',
      'failed',
      'paused',
      'blocked',
      'cancelled',
    ],
    paused: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    blocked: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    failed: ['pending', 'running', 'completed', 'cancelled'],
    // A completed to-do can be unchecked again; cancelled is final.
    completed: ['pending'],
    cancelled: [],
  };

  private assertTransition(from: TaskStatus, to: TaskStatus): void {
    if (from === to) return; // idempotent repeats are no-ops
    if (!Db.TASK_TRANSITIONS[from].includes(to))
      throw new Error(`Illegal task transition: ${from} → ${to}`);
  }

  /** The single place that applies a task status change, with transition guard. */
  updateTaskStatus(
    id: number,
    status: TaskStatus,
    patch: {
      outcome?: TaskItem['outcome'];
      summary?: string | null;
      countAttempt?: boolean;
    } = {},
  ): TaskRow {
    return this.transaction(() => {
      const task = this.getTask(id);
      if (!task) throw new Error(`Unknown task: ${id}`);
      this.assertTransition(task.status, status);
      if (task.status === status && Object.keys(patch).length === 0)
        return task;
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, outcome = COALESCE(?, outcome), summary = COALESCE(?, summary),
          attempts = attempts + ?, started_at = COALESCE(started_at, ?),
          done_at = ${status === 'completed' ? '?' : 'NULL'}, updated_at = ? WHERE id = ?`,
        )
        .run(
          status,
          patch.outcome ?? null,
          patch.summary ?? null,
          patch.countAttempt ? 1 : 0,
          status === 'running' ? now : null,
          ...(status === 'completed' ? [now] : []),
          now,
          id,
        );
      return this.getTask(id)!;
    });
  }

  getTask(id: number): TaskRow | undefined {
    const value = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return value ? row<TaskRow>(value) : undefined;
  }
  taskByDedupeKey(key: string): TaskRow | undefined {
    const value = this.db
      .prepare('SELECT * FROM tasks WHERE dedupe_key = ?')
      .get(key);
    return value ? row<TaskRow>(value) : undefined;
  }

  /** Insert a task row; every field except scope and title is optional. */
  insertTask(
    task: Partial<Omit<TaskRow, 'id' | 'updatedAt'>> & {
      scopeId: string;
      title: string;
    },
  ): TaskRow {
    const now = new Date().toISOString();
    const value = {
      status: 'pending' as TaskStatus,
      goalId: null,
      owner: 'user' as const,
      outcome: null,
      summary: null,
      trigger: 'manual' as const,
      triggerRef: null,
      dedupeKey: null,
      attempts: 0,
      maxAttempts: 3,
      due: null,
      startedAt: null,
      doneAt: null,
      ...task,
      createdAt: now,
      updatedAt: now,
    };
    const statement = this.db.prepare(
      `INSERT INTO tasks (scope_id,title,status,goal_id,owner,outcome,summary,trigger,trigger_ref,dedupe_key,attempts,max_attempts,due,started_at,created_at,done_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
    );
    const info = statement.run(
      value.scopeId,
      value.title,
      value.status,
      value.goalId,
      value.owner,
      value.outcome,
      value.summary,
      value.trigger,
      value.triggerRef,
      value.dedupeKey,
      value.attempts,
      value.maxAttempts,
      value.due,
      value.startedAt,
      value.createdAt,
      value.doneAt,
      value.updatedAt,
    );
    const id =
      Number(info.changes) > 0
        ? Number(info.lastInsertRowid)
        : this.taskByDedupeKey(value.dedupeKey!)!.id;
    return this.getTask(id)!;
  }

  /** Tasks created for a goal since `since` (daily budget accounting). */
  countGoalTasks(goalId: string, since: string): number {
    const value = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE goal_id = ? AND status != 'blocked' AND created_at >= ?",
      )
      .get(goalId, since) as { n: number };
    return Number(value.n);
  }

  doneTask(id: number): void {
    this.updateTaskStatus(id, 'completed');
  }
  reopenTask(id: number): void {
    this.updateTaskStatus(id, 'pending');
  }
  listTasks(scopeId: string | null, status?: string): TaskRow[] {
    return rows(
      this.db
        .prepare(
          `SELECT * FROM tasks WHERE (? IS NULL OR scope_id = ?) AND (? IS NULL OR status = ?) ORDER BY status = 'completed', created_at DESC`,
        )
        .all(scopeId, scopeId, status ?? null, status ?? null),
    );
  }

  addRun(run: RunRow): void {
    this.transaction(() => {
      this.insert('runs', run);
      this.recordAttempt(run);
    });
  }
  patchRun(id: string, patch: Partial<Omit<RunRow, 'id'>>): RunRow {
    const entries = Object.entries(patch);
    if (entries.length)
      this.db
        .prepare(
          `UPDATE runs SET ${entries.map(([key]) => `${snake(key)} = ?`).join(',')} WHERE id = ?`,
        )
        .run(
          ...entries.map(([, value]) => value as string | number | null),
          id,
        );
    const run = this.getRun(id);
    if (!run) throw new Error(`Unknown run: ${id}`);
    return run;
  }
  recordAttempt(run: RunRow): void {
    this.db
      .prepare(`INSERT INTO run_attempts (run_id,attempt,prompt,status,started_at,finished_at,error) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(run_id,attempt) DO UPDATE SET status=excluded.status,finished_at=excluded.finished_at,error=excluded.error`)
      .run(
        run.id,
        run.attempt,
        run.currentPrompt,
        run.status,
        run.startedAt,
        run.finishedAt,
        run.error,
      );
  }
  finishRun(
    id: string,
    status: 'done' | 'failed',
    error: string | null,
    notification: Notification,
  ): RunRow {
    return this.transaction(() => {
      const run = this.patchRun(id, {
        status,
        error,
        exitCode: status === 'done' ? 0 : 1,
        finishedAt: new Date().toISOString(),
      });
      this.recordAttempt(run);
      this.queueNotification(notification);
      return run;
    });
  }
  getRun(id: string): RunRow | undefined {
    const value = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return value ? row(value) : undefined;
  }
  listRuns(projectId: string | null): RunRow[] {
    return rows(
      this.db
        .prepare(
          'SELECT * FROM runs WHERE (? IS NULL OR project_id = ?) ORDER BY started_at DESC LIMIT 200',
        )
        .all(projectId, projectId),
    );
  }
  activeRuns(): RunRow[] {
    return rows(
      this.db
        .prepare(
          "SELECT * FROM runs WHERE status IN ('queued','running','collecting') AND review_status != 'discarded'",
        )
        .all(),
    );
  }
  unsettledReviews(): RunRow[] {
    return rows(
      this.db
        .prepare(
          "SELECT * FROM runs WHERE review_status IN ('landing','shipping','discarding')",
        )
        .all(),
    );
  }
  projectHasRuns(id: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM runs WHERE project_id = ? AND (status IN ('queued','running','collecting') OR (worktree_path IS NOT NULL AND review_status != 'discarded')) LIMIT 1",
      )
      .get(id);
  }
  runConversationIds(projectId: string | null): string[] {
    return (
      this.db
        .prepare(
          'SELECT conversation_id FROM runs WHERE conversation_id IS NOT NULL AND (? IS NULL OR project_id = ?)',
        )
        .all(projectId, projectId) as { conversation_id: string }[]
    ).map((value) => value.conversation_id);
  }

  runByConversation(conversationId: string): RunRow | undefined {
    const value = this.db
      .prepare('SELECT * FROM runs WHERE conversation_id = ?')
      .get(conversationId);
    return value ? row<RunRow>(value) : undefined;
  }

  addAgentMessage(
    value: Omit<AgentMessageRow, 'createdAt' | 'deliveredAt' | 'seq'>,
  ): AgentMessageRow {
    this.db
      .prepare(
        'INSERT INTO agent_messages (id,run_id,sender,body,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
      )
      .run(
        value.id,
        value.runId,
        value.sender,
        value.body,
        new Date().toISOString(),
      );
    const record = this.db
      .prepare('SELECT rowid AS seq, * FROM agent_messages WHERE id = ?')
      .get(value.id) as Record<string, unknown>;
    if (!record) throw new Error(`Unknown agent message: ${value.id}`);
    return row<AgentMessageRow>(record);
  }
  listAgentMessages(runId: string): AgentMessageRow[] {
    return rows(
      this.db
        .prepare(
          'SELECT rowid AS seq, * FROM agent_messages WHERE run_id = ? ORDER BY rowid',
        )
        .all(runId),
    );
  }
  chiefReplyAfter(runId: string, seq: number): AgentMessageRow | undefined {
    const value = this.db
      .prepare(
        "SELECT rowid AS seq, * FROM agent_messages WHERE run_id = ? AND sender = 'chief' AND rowid > ? ORDER BY rowid LIMIT 1",
      )
      .get(runId, seq);
    return value ? row<AgentMessageRow>(value) : undefined;
  }
  undeliveredAgentMessages(runId: string): AgentMessageRow[] {
    return rows(
      this.db
        .prepare(
          "SELECT rowid AS seq, * FROM agent_messages WHERE run_id = ? AND delivered_at IS NULL AND sender = 'chief' ORDER BY rowid",
        )
        .all(runId),
    );
  }
  markAgentMessagesDelivered(ids: string[]): void {
    if (ids.length === 0) return;
    this.transaction(() => {
      for (const id of ids)
        this.db
          .prepare(
            'UPDATE agent_messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL',
          )
          .run(new Date().toISOString(), id);
    });
  }

  importMessage(scopeId: string, message: InboxItem): void {
    this.db
      .prepare(
        'INSERT INTO inbox (scope_id,id,payload) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      )
      .run(scopeId, message.id, JSON.stringify(message));
  }
  listMessages(scopeId: string): InboxItem[] {
    const values = this.db
      .prepare(
        'SELECT payload,is_read FROM inbox WHERE scope_id = ? ORDER BY id',
      )
      .all(scopeId) as { payload: string; is_read: number }[];
    return values.map((value) => ({
      ...(JSON.parse(value.payload) as InboxItem),
      read: value.is_read === 1,
    }));
  }
  markMessagesRead(scopeId: string, ids: string[]): void {
    this.transaction(() => {
      for (const id of ids)
        this.db
          .prepare('UPDATE inbox SET is_read = 1 WHERE scope_id = ? AND id = ?')
          .run(scopeId, id);
    });
  }
  queueNotification(value: Notification): void {
    this.db
      .prepare(
        'INSERT INTO notifications (id,scope_id,conversation_id,content) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
      )
      .run(value.id, value.scopeId, value.conversationId, value.content);
  }
  pendingNotifications(): Notification[] {
    return rows(
      this.db
        .prepare(
          'SELECT id,scope_id,conversation_id,content FROM notifications WHERE delivered_at IS NULL ORDER BY rowid',
        )
        .all(),
    );
  }
  targetNotification(id: string, conversationId: string): void {
    this.db
      .prepare('UPDATE notifications SET conversation_id = ? WHERE id = ?')
      .run(conversationId, id);
  }
  deliveredNotification(id: string): void {
    this.db
      .prepare('UPDATE notifications SET delivered_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
