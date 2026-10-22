import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_VERSION } from '../shared/version.js';
import type {
  ConversationInfo,
  InboxItem,
  RunInfo,
  RunInjection,
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
  /**
   * What Tian calls this project's manager ("阿七"). Required: every project
   * has exactly one manager (D18), named when the project is added. Its bound
   * conversation is created on first use.
   */
  managerName: string;
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

export type ManagerMessageKind =
  | 'delegation'
  | 'message'
  | 'question'
  | 'answer'
  | 'report';

export interface ManagerMessageRow {
  id: string;
  /** Insertion order within the project's chief↔manager thread. */
  seq: number;
  projectId: string;
  sender: 'chief' | 'manager';
  kind: ManagerMessageKind;
  /** Related task (delegation, report, question context); null when none. */
  taskId: number | null;
  /** Id of the 'question' row an 'answer' replies to. */
  replyTo: string | null;
  /** For kind='question': when ask_chief stopped waiting (answered or timed out). */
  closedAt: string | null;
  body: string;
  createdAt: string;
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
  private pendingAfterCommit: (() => void)[] | undefined;

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
    this.db.exec('PRAGMA journal_mode = WAL;');
    // A real upgrade (not a fresh database, not a same-version reopen) gets a
    // consistent snapshot first and runs inside one transaction: if any step
    // throws, the schema rolls back and the backup file remains for recovery.
    const upgrading = version > 0 && version < DATABASE_VERSION;
    if (upgrading)
      this.backupDatabase(join(userDataDir, `tian.db_v${version}.backup`));
    const migrate = () => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        auto_land INTEGER NOT NULL DEFAULT 0, allow_in_place INTEGER NOT NULL DEFAULT 0,
        agent_kind TEXT NOT NULL DEFAULT 'durable-worker', run_timeout_min INTEGER NOT NULL DEFAULT 0,
        base_branch TEXT NOT NULL DEFAULT 'main', prompt_preamble TEXT NOT NULL DEFAULT '', manager_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT,
        created_at TEXT NOT NULL, archived_at TEXT
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
        exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT, deadline_at TEXT NOT NULL DEFAULT '',
        model TEXT, thinking_level TEXT
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
      CREATE TABLE IF NOT EXISTS manager_messages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sender TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'message', task_id INTEGER, reply_to TEXT,
        closed_at TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, conversation_id TEXT, content TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_scope_status ON tasks(scope_id, status);
      CREATE INDEX IF NOT EXISTS conversations_scope ON conversations(scope_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id, status);
      CREATE INDEX IF NOT EXISTS agent_messages_run ON agent_messages(run_id);
      CREATE INDEX IF NOT EXISTS manager_messages_project ON manager_messages(project_id);
    `);
      this.ensureColumns('projects', {
        allow_in_place: 'INTEGER NOT NULL DEFAULT 0',
        // D14/D18: the chief and Tian address a project's manager by this
        // name. Required by the service; older rows are backfilled below.
        manager_name: 'TEXT',
      });
      this.ensureColumns('conversations', {
        archived_at: 'TEXT',
      });
      this.ensureColumns('tasks', {
        goal_id: 'TEXT',
        owner: "TEXT NOT NULL DEFAULT 'user'",
        outcome: 'TEXT',
        summary: 'TEXT',
        trigger: "TEXT NOT NULL DEFAULT 'manual'",
        trigger_ref: 'TEXT',
        // UNIQUE comes from the tasks_dedupe_key index created after this call.
        dedupe_key: 'TEXT',
        attempts: 'INTEGER NOT NULL DEFAULT 0',
        max_attempts: 'INTEGER NOT NULL DEFAULT 3',
        started_at: 'TEXT',
        updated_at: 'TEXT',
        assignee: 'TEXT',
        report_to: 'TEXT',
      });
      this.ensureColumns('manager_messages', {
        kind: "TEXT NOT NULL DEFAULT 'message'",
        task_id: 'INTEGER',
        reply_to: 'TEXT',
        closed_at: 'TEXT',
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
        injected_skills: 'TEXT',
        deadline_at: "TEXT NOT NULL DEFAULT ''",
        // Per-run model override (a magpie model id); NULL = the global default.
        model: 'TEXT',
        // Per-run thinking level (a pi level name); NULL = the model's own.
        thinking_level: 'TEXT',
      });
      this.db.exec(`
      -- A fresh tasks table declares dedupe_key UNIQUE, but migrated databases
      -- got it through ALTER TABLE, where UNIQUE is not allowed. The index makes
      -- task creation dedupe work on both shapes (NULLs stay allowed, so plain
      -- to-dos are unaffected). It must run after ensureColumns added the column.
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_dedupe_key ON tasks(dedupe_key);
    `);
      this.db.exec(`
      UPDATE runs SET root_path = COALESCE((SELECT root_path FROM projects WHERE projects.id = runs.project_id), '') WHERE root_path = '';
      UPDATE runs SET current_prompt = prompt WHERE current_prompt = '';
      -- D5: migrate the old todo statuses to the task state machine, idempotently.
      UPDATE tasks SET status = 'pending' WHERE status = 'open';
      UPDATE tasks SET status = 'completed' WHERE status = 'done';
      UPDATE tasks SET updated_at = COALESCE(updated_at, created_at);
      UPDATE runs SET execution_mode = 'in-place' WHERE branch IS NULL;
      UPDATE runs SET status = 'interrupted', review_status = 'discarded' WHERE status = 'discarded';
      -- D18: every project has a named manager; unnamed projects take their own name.
      UPDATE projects SET manager_name = name WHERE manager_name IS NULL OR trim(manager_name) = '';
    `);
      // Memory schema changes live in the same versioned transaction, so a
      // failure rolls back the version bump instead of marking an old schema
      // as current for MemoryStore to patch outside any transaction.
      this.migrateMemory();
      this.db.exec(`PRAGMA user_version = ${DATABASE_VERSION};`);
    };
    if (upgrading) this.transaction(migrate);
    else migrate();
  }

  /**
   * D4: explicit Core selection replaced the summary tree. Columns are added
   * before indexes mention them; retired tree rows are renamed (never read) so
   * the derived data stays inspectable, and the memory FTS index is rebuilt
   * from the surviving content when the table existed before.
   */
  private migrateMemory(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, seq INTEGER NOT NULL, goal_id TEXT,
        kind TEXT NOT NULL, content TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT,
        trust_level TEXT NOT NULL, confidence REAL, status TEXT NOT NULL DEFAULT 'active',
        core INTEGER NOT NULL DEFAULT 0, superseded_by TEXT, supersedes INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(scope_id, seq)
      );
      CREATE TABLE IF NOT EXISTS memory_versions (
        memory_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT,
        before TEXT, after TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
    `);
    this.ensureColumns('memories', {
      supersedes: 'INTEGER',
      core: 'INTEGER NOT NULL DEFAULT 0',
    });
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memories_scope_status ON memories(scope_id, status);
      CREATE INDEX IF NOT EXISTS memories_scope_core ON memories(scope_id, core);
    `);
    const hasNodes = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_nodes'",
      )
      .get();
    if (hasNodes) {
      this.db.exec('DROP TABLE IF EXISTS memory_nodes_retired');
      this.db.exec('ALTER TABLE memory_nodes RENAME TO memory_nodes_retired');
    }
    const hasFts = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'",
      )
      .get();
    if (!hasFts) {
      this.db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(
        content, mem_id UNINDEXED, tokenize='trigram'
      );`);
    } else if (hasNodes) {
      // Index format changed with the tree retirement: rebuild from memory rows.
      this.db.exec(`
        DELETE FROM memory_fts;
        INSERT INTO memory_fts (content, mem_id) SELECT content, id FROM memories;
      `);
    }
  }

  /** Consistent pre-upgrade snapshot; a leftover from a failed attempt is stale. */
  private backupDatabase(path: string): void {
    rmSync(path, { force: true });
    this.db.prepare('VACUUM INTO ?').run(path);
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

  /** True while a transaction or savepoint is open on this connection. */
  get inTransaction(): boolean {
    return this.txDepth > 0;
  }

  transaction<T>(action: () => T): T {
    if (this.txDepth > 0) {
      // Nested calls become savepoints so helpers with their own transaction
      // compose inside a larger one (operation-id replay, schedule fires).
      // Each level owns its own name and queue mark: rolling a savepoint back
      // discards exactly the after-commit callbacks queued inside it.
      const mark = this.pendingAfterCommit?.length ?? 0;
      const savepoint = `tian_sp_${++this.txDepth}`;
      this.db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const result = action();
        this.db.exec(`RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        this.db.exec(`ROLLBACK TO ${savepoint}`);
        this.db.exec(`RELEASE ${savepoint}`);
        if (this.pendingAfterCommit) this.pendingAfterCommit.length = mark;
        throw error;
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    const afterCommit: (() => void)[] = [];
    this.pendingAfterCommit = afterCommit;
    let result: T;
    try {
      result = action();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.txDepth = 0;
      this.pendingAfterCommit = undefined;
    }
    for (const callback of afterCommit) callback();
    return result;
  }

  /**
   * Run `action` only if the outermost transaction commits. Nested calls queue
   * with the outer one, so a feature store can write a file or bump an
   * in-memory version without publishing data that a rollback discards.
   */
  afterCommit(action: () => void): void {
    if (this.pendingAfterCommit) this.pendingAfterCommit.push(action);
    else action();
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
  /** Drop a project with its (untouched) manager binding and conversation row. */
  removeProject(id: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM conversations WHERE conversation_id IN
            (SELECT conversation_id FROM channel_sessions WHERE channel = 'manager' AND external_id = ?)`,
        )
        .run(id);
      this.db
        .prepare(
          "DELETE FROM channel_sessions WHERE channel = 'manager' AND external_id = ?",
        )
        .run(id);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    });
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
    // `role` is derived from channel_sessions, not a conversations column —
    // a fresh row is always a chief until bindSession says otherwise.
    const value = {
      conversationId,
      scopeId,
      title: null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    this.insert('conversations', value);
    return { ...value, role: 'chief' };
  }
  channelSession(binding: SessionBinding): ConversationRow | undefined {
    const value = this.db
      .prepare(`SELECT conversations.* FROM conversations JOIN channel_sessions USING (conversation_id)
      WHERE channel = ? AND external_id = ? AND channel_sessions.scope_id = ?`)
      .get(binding.channel, binding.externalId, binding.scopeId);
    if (!value) return undefined;
    return {
      ...row<ConversationRow>(value),
      role: binding.channel === 'manager' ? 'manager' : 'chief',
    };
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
  setConversationArchived(id: string, archived: boolean): void {
    this.db
      .prepare(
        'UPDATE conversations SET archived_at = ? WHERE conversation_id = ?',
      )
      .run(archived ? new Date().toISOString() : null, id);
  }
  listConversations(): ConversationRow[] {
    return rows(
      this.db
        .prepare(
          `SELECT conversations.*,
             CASE WHEN channel_sessions.channel = 'manager' THEN 'manager' ELSE 'chief' END AS role
           FROM conversations
           LEFT JOIN channel_sessions
             ON channel_sessions.conversation_id = conversations.conversation_id
             AND channel_sessions.channel = 'manager'
           ORDER BY conversations.created_at DESC`,
        )
        .all(),
    );
  }
  /**
   * Latest non-archived conversation in a scope that scope-level wakes may
   * target. Manager conversations are excluded: untargeted notifications
   * (inbox scans, goal wakes) belong to the chief, not the project manager.
   */
  latestConversation(scopeId: string): ConversationRow | undefined {
    const value = this.db
      .prepare(
        `SELECT *, 'chief' AS role FROM conversations WHERE scope_id = ? AND archived_at IS NULL
        AND conversation_id NOT IN (SELECT conversation_id FROM channel_sessions WHERE channel = 'manager')
        ORDER BY created_at DESC LIMIT 1`,
      )
      .get(scopeId);
    return value ? row(value) : undefined;
  }

  /** The project manager conversation bound via channel 'manager', if any. */
  managerConversation(projectId: string): ConversationRow | undefined {
    return this.channelSession({
      channel: 'manager',
      externalId: projectId,
      scopeId: projectId,
    });
  }
  isManagerConversation(conversationId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM channel_sessions WHERE channel = 'manager' AND conversation_id = ?",
        )
        .get(conversationId),
    );
  }
  /** Every conversation id currently bound as a project manager. */
  managerConversationIds(): string[] {
    return (
      this.db
        .prepare(
          "SELECT conversation_id FROM channel_sessions WHERE channel = 'manager'",
        )
        .all() as { conversation_id: string }[]
    ).map((value) => value.conversation_id);
  }

  addTask(scopeId: string, title: string, due: string | null): number {
    return this.insertTask({
      scopeId,
      title,
      due,
    }).id;
  }

  /** Allowed task status changes (D5). Everything else throws. */
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
      assignee: null,
      reportTo: null,
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
      `INSERT INTO tasks (scope_id,title,status,goal_id,owner,outcome,summary,trigger,trigger_ref,dedupe_key,assignee,report_to,attempts,max_attempts,due,started_at,created_at,done_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
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
      value.assignee,
      value.reportTo,
      value.attempts,
      value.maxAttempts,
      value.due,
      value.startedAt,
      value.createdAt,
      value.doneAt,
      value.updatedAt,
    );
    if (Number(info.changes) > 0)
      return this.getTask(Number(info.lastInsertRowid))!;
    // The dedupe key already exists: reuse that task instead of creating one.
    const existing = value.dedupeKey
      ? this.taskByDedupeKey(value.dedupeKey)
      : undefined;
    if (!existing)
      throw new Error(`Task insert was ignored without a dedupe match`);
    return existing;
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
      this.insert('runs', {
        ...run,
        injectedSkills: run.injectedSkills?.length
          ? JSON.stringify(run.injectedSkills)
          : null,
      });
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
          ...entries.map(([key, value]) =>
            key === 'injectedSkills'
              ? value
                ? JSON.stringify(value)
                : null
              : (value as string | number | null),
          ),
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
    status: 'done' | 'failed' | 'interrupted',
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
  /** Runs keep injected skill versions as JSON; parse them at the boundary. */
  private readRun(value: unknown): RunRow {
    const run = row<RunRow>(value);
    const raw = run.injectedSkills as unknown as string | null;
    return {
      ...run,
      injectedSkills: raw ? (JSON.parse(raw) as RunInjection[]) : null,
    };
  }
  getRun(id: string): RunRow | undefined {
    const value = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return value ? this.readRun(value) : undefined;
  }
  listRuns(projectId: string | null): RunRow[] {
    return this.db
      .prepare(
        'SELECT * FROM runs WHERE (? IS NULL OR project_id = ?) ORDER BY started_at DESC LIMIT 200',
      )
      .all(projectId, projectId)
      .map((value) => this.readRun(value));
  }
  activeRuns(): RunRow[] {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE status IN ('queued','running','collecting') AND review_status != 'discarded'",
      )
      .all()
      .map((value) => this.readRun(value));
  }
  unsettledReviews(): RunRow[] {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE review_status IN ('landing','shipping','discarding')",
      )
      .all()
      .map((value) => this.readRun(value));
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
    return value ? this.readRun(value) : undefined;
  }

  /** The run a folded dispatch resolved to — replay-safe for late retries. */
  dispatchFold(operationId: string): string | undefined {
    const saved = this.db
      .prepare('SELECT result FROM operations WHERE id = ?')
      .get(`dispatch-fold:${operationId}`) as { result: string } | undefined;
    return saved ? (JSON.parse(saved.result) as string) : undefined;
  }
  recordDispatchFold(operationId: string, runId: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO operations VALUES (?, ?)')
      .run(`dispatch-fold:${operationId}`, JSON.stringify(runId));
  }

  /**
   * The in-flight run this dispatcher already owns with the same briefing —
   * the dedup key a replayed or double-fired dispatch reuses instead of
   * stacking a second identical run.
   */
  activeRunByPrompt(
    projectId: string,
    prompt: string,
    chiefConversationId: string | null,
  ): RunRow | undefined {
    const value = this.db
      .prepare(
        `SELECT * FROM runs WHERE project_id = ? AND prompt = ?
         AND COALESCE(chief_conversation_id, '') = COALESCE(?, '')
         AND status IN ('queued', 'running', 'collecting')
         AND review_status = 'pending'
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(projectId, prompt, chiefConversationId);
    return value ? this.readRun(value) : undefined;
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

  addManagerMessage(
    value: Omit<
      ManagerMessageRow,
      'createdAt' | 'closedAt' | 'seq' | 'kind' | 'taskId' | 'replyTo'
    > & {
      kind?: ManagerMessageKind;
      taskId?: number | null;
      replyTo?: string | null;
    },
  ): ManagerMessageRow {
    this.db
      .prepare(
        `INSERT INTO manager_messages (id,project_id,sender,kind,task_id,reply_to,body,created_at)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        value.id,
        value.projectId,
        value.sender,
        value.kind ?? 'message',
        value.taskId ?? null,
        value.replyTo ?? null,
        value.body,
        new Date().toISOString(),
      );
    const record = this.db
      .prepare('SELECT rowid AS seq, * FROM manager_messages WHERE id = ?')
      .get(value.id) as Record<string, unknown>;
    if (!record) throw new Error(`Unknown manager message: ${value.id}`);
    return row<ManagerMessageRow>(record);
  }
  managerMessage(id: string): ManagerMessageRow | undefined {
    const value = this.db
      .prepare('SELECT rowid AS seq, * FROM manager_messages WHERE id = ?')
      .get(id);
    return value ? row<ManagerMessageRow>(value) : undefined;
  }
  /** Look up a thread row by its display seq (what tools and prompts cite). */
  managerMessageBySeq(
    projectId: string,
    seq: number,
  ): ManagerMessageRow | undefined {
    const value = this.db
      .prepare(
        'SELECT rowid AS seq, * FROM manager_messages WHERE project_id = ? AND rowid = ?',
      )
      .get(projectId, seq);
    return value ? row<ManagerMessageRow>(value) : undefined;
  }
  listManagerMessages(projectId: string): ManagerMessageRow[] {
    return rows(
      this.db
        .prepare(
          'SELECT rowid AS seq, * FROM manager_messages WHERE project_id = ? ORDER BY rowid',
        )
        .all(projectId),
    );
  }
  /** The chief's answer to a question row — what a waiting manager polls for. */
  managerAnswerTo(
    projectId: string,
    questionId: string,
  ): ManagerMessageRow | undefined {
    const value = this.db
      .prepare(
        "SELECT rowid AS seq, * FROM manager_messages WHERE project_id = ? AND sender = 'chief' AND kind = 'answer' AND reply_to = ? ORDER BY rowid LIMIT 1",
      )
      .get(projectId, questionId);
    return value ? row<ManagerMessageRow>(value) : undefined;
  }
  /**
   * Close a question and re-check for an answer in one transaction, so a
   * reply landing between timeout and close is never lost. Returns the
   * answer if one exists.
   */
  closeManagerQuestion(
    projectId: string,
    questionId: string,
  ): ManagerMessageRow | undefined {
    return this.transaction(() => {
      this.db
        .prepare(
          'UPDATE manager_messages SET closed_at = ? WHERE id = ? AND closed_at IS NULL',
        )
        .run(new Date().toISOString(), questionId);
      return this.managerAnswerTo(projectId, questionId);
    });
  }

  /** The most recently created task delegated to the project's manager. */
  latestDelegatedTask(projectId: string): TaskRow | undefined {
    const value = this.db
      .prepare(
        "SELECT * FROM tasks WHERE scope_id = ? AND assignee = 'manager' AND report_to IS NOT NULL ORDER BY id DESC LIMIT 1",
      )
      .get(projectId);
    return value ? row<TaskRow>(value) : undefined;
  }

  importMessage(scopeId: string, message: InboxItem): void {
    this.db
      .prepare(
        'INSERT INTO inbox (scope_id,id,payload) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      )
      .run(scopeId, message.id, JSON.stringify(message));
  }
  listMessages(scopeId: string | null): InboxItem[] {
    const values = (
      scopeId
        ? this.db
            .prepare(
              'SELECT scope_id,payload,is_read FROM inbox WHERE scope_id = ? ORDER BY id',
            )
            .all(scopeId)
        : this.db
            .prepare('SELECT scope_id,payload,is_read FROM inbox ORDER BY id')
            .all()
    ) as { scope_id: string; payload: string; is_read: number }[];
    return values.map((value) => ({
      ...(JSON.parse(value.payload) as InboxItem),
      scopeId: value.scope_id,
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
  /** Whether a delivered notification carries exactly this content. */
  deliveredNotificationWith(conversationId: string, content: string): boolean {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM notifications WHERE conversation_id = ? AND delivered_at IS NOT NULL AND content = ? LIMIT 1',
        )
        .get(conversationId, content),
    );
  }
  deliveredNotification(id: string): void {
    this.db
      .prepare('UPDATE notifications SET delivered_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
