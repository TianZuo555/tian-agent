import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConversationInfo,
  InboxItem,
  RunInfo,
  TaskItem,
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
        status TEXT NOT NULL DEFAULT 'open', due TEXT, created_at TEXT NOT NULL, done_at TEXT
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
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, conversation_id TEXT, content TEXT NOT NULL, delivered_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_scope_status ON tasks(scope_id, status);
      CREATE INDEX IF NOT EXISTS conversations_scope ON conversations(scope_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id, status);
    `);
    this.ensureColumns('projects', {
      allow_in_place: 'INTEGER NOT NULL DEFAULT 0',
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
      deadline_at: "TEXT NOT NULL DEFAULT ''",
    });
    this.db.exec(`
      UPDATE runs SET root_path = COALESCE((SELECT root_path FROM projects WHERE projects.id = runs.project_id), '') WHERE root_path = '';
      UPDATE runs SET current_prompt = prompt WHERE current_prompt = '';
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

  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
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
    const entries = Object.entries(value);
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
    return Number(
      this.db
        .prepare(
          'INSERT INTO tasks (scope_id,title,due,created_at) VALUES (?,?,?,?)',
        )
        .run(scopeId, title, due, new Date().toISOString()).lastInsertRowid,
    );
  }
  doneTask(id: number): void {
    this.db
      .prepare("UPDATE tasks SET status = 'done', done_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }
  reopenTask(id: number): void {
    this.db
      .prepare("UPDATE tasks SET status = 'open', done_at = NULL WHERE id = ?")
      .run(id);
  }
  listTasks(scopeId: string | null, status?: string): TaskRow[] {
    return rows(
      this.db
        .prepare(
          `SELECT * FROM tasks WHERE (? IS NULL OR scope_id = ?) AND (? IS NULL OR status = ?) ORDER BY status = 'done', created_at DESC`,
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
