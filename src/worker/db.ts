import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ProjectRow {
  id: string;
  name: string;
  rootPath: string;
  autoLand: number;
  agentKind: string;
  runTimeoutMin: number;
  baseBranch: string;
  promptPreamble: string;
  createdAt: string;
}

export interface ConversationRow {
  conversationId: string;
  scopeId: string;
  title: string | null;
  createdAt: string;
}

export interface TaskRow {
  id: number;
  scopeId: string;
  title: string;
  status: 'open' | 'done';
  due: string | null;
  createdAt: string;
  doneAt: string | null;
}

export interface RunRow {
  id: string;
  projectId: string;
  /** Worker conversation doing the run. */
  conversationId: string | null;
  /** Chief conversation to wake when the run finishes. */
  chiefConversationId: string | null;
  agentKind: string;
  prompt: string;
  worktreePath: string | null;
  branch: string | null;
  status:
    | 'queued'
    | 'running'
    | 'done'
    | 'failed'
    | 'interrupted'
    | 'discarded';
  reportPath: string | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

const camelize = <T>(row: unknown): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out as T;
};
const mapRows = <T>(rs: unknown[]): T[] => rs.map((r) => camelize<T>(r));

export class Db {
  private db: DatabaseSync;

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });
    this.db = new DatabaseSync(join(userDataDir, 'tian.db'));
    this.db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
				auto_land INTEGER NOT NULL DEFAULT 0, agent_kind TEXT NOT NULL DEFAULT 'durable-worker',
				run_timeout_min INTEGER NOT NULL DEFAULT 30, base_branch TEXT NOT NULL DEFAULT 'main',
				prompt_preamble TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS conversations (
				conversation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL,
				title TEXT, created_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS tasks (
				id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL,
				title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
				due TEXT, created_at TEXT NOT NULL, done_at TEXT
			);
			CREATE TABLE IF NOT EXISTS runs (
				id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT,
				agent_kind TEXT NOT NULL, prompt TEXT NOT NULL,
				worktree_path TEXT, branch TEXT,
				status TEXT NOT NULL DEFAULT 'queued', report_path TEXT,
				exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT,
				chief_conversation_id TEXT
			);
		`);
    this.ensureColumn('runs', 'chief_conversation_id', 'TEXT');
  }

  private ensureColumn(table: string, name: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === name)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  close(): void {
    this.db.close();
  }

  // projects
  addProject(p: Omit<ProjectRow, 'createdAt'>): void {
    this.db
      .prepare(
        `INSERT INTO projects (id,name,root_path,auto_land,agent_kind,run_timeout_min,base_branch,prompt_preamble,created_at)
				 VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id,
        p.name,
        p.rootPath,
        p.autoLand,
        p.agentKind,
        p.runTimeoutMin,
        p.baseBranch,
        p.promptPreamble,
        new Date().toISOString(),
      );
  }
  updateProject(id: string, patch: Partial<ProjectRow>): void {
    const cols: Record<string, string> = {
      name: 'name',
      rootPath: 'root_path',
      autoLand: 'auto_land',
      agentKind: 'agent_kind',
      runTimeoutMin: 'run_timeout_min',
      baseBranch: 'base_branch',
      promptPreamble: 'prompt_preamble',
    };
    const sets = Object.entries(patch)
      .filter(([k]) => cols[k])
      .map(([k]) => `${cols[k]} = ?`);
    const vals = Object.entries(patch)
      .filter(([k]) => cols[k])
      .map(([, v]) => v);
    if (sets.length === 0) return;
    this.db
      .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
      .run(...(vals as never[]), id);
  }
  removeProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
  getProject(id: string): ProjectRow | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row === undefined ? undefined : camelize<ProjectRow>(row);
  }
  projectByName(name: string): ProjectRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE name = ?')
      .get(name);
    return row === undefined ? undefined : camelize<ProjectRow>(row);
  }
  listProjects(): ProjectRow[] {
    return mapRows<ProjectRow>(
      this.db.prepare('SELECT * FROM projects ORDER BY created_at').all(),
    );
  }

  // conversations ↔ scope
  mapConversation(conversationId: string, scopeId: string): void {
    this.db
      .prepare(
        'INSERT INTO conversations (conversation_id, scope_id, created_at) VALUES (?,?,?)',
      )
      .run(conversationId, scopeId, new Date().toISOString());
  }
  conversationScope(conversationId: string): string {
    const row = this.db
      .prepare(
        'SELECT scope_id AS s FROM conversations WHERE conversation_id = ?',
      )
      .get(conversationId) as { s: string } | undefined;
    return row?.s ?? 'global';
  }
  setConversationTitle(conversationId: string, title: string): void {
    this.db
      .prepare(
        'UPDATE conversations SET title = ? WHERE conversation_id = ? AND title IS NULL',
      )
      .run(title, conversationId);
  }
  listConversations(): ConversationRow[] {
    return mapRows<ConversationRow>(
      this.db
        .prepare('SELECT * FROM conversations ORDER BY created_at DESC')
        .all(),
    );
  }
  removeConversation(conversationId: string): void {
    this.db
      .prepare('DELETE FROM conversations WHERE conversation_id = ?')
      .run(conversationId);
  }
  latestConversation(scopeId: string): ConversationRow | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM conversations WHERE scope_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(scopeId);
    return row === undefined ? undefined : camelize<ConversationRow>(row);
  }

  // tasks
  addTask(scopeId: string, title: string, due: string | null): number {
    const r = this.db
      .prepare(
        'INSERT INTO tasks (scope_id, title, due, created_at) VALUES (?,?,?,?)',
      )
      .run(scopeId, title, due, new Date().toISOString());
    return Number(r.lastInsertRowid);
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
    if (scopeId === null) {
      return mapRows<TaskRow>(
        this.db
          .prepare(
            "SELECT * FROM tasks ORDER BY status = 'done', created_at DESC",
          )
          .all(),
      );
    }
    if (status) {
      return mapRows<TaskRow>(
        this.db
          .prepare(
            'SELECT * FROM tasks WHERE scope_id = ? AND status = ? ORDER BY created_at DESC',
          )
          .all(scopeId, status),
      );
    }
    return mapRows<TaskRow>(
      this.db
        .prepare(
          "SELECT * FROM tasks WHERE scope_id = ? ORDER BY status = 'done', created_at DESC",
        )
        .all(scopeId),
    );
  }

  // runs
  addRun(
    r: Omit<RunRow, 'startedAt' | 'finishedAt' | 'status' | 'exitCode'>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO runs (id,project_id,conversation_id,agent_kind,prompt,worktree_path,branch,status,report_path,started_at,chief_conversation_id)
				 VALUES (?,?,?,?,?,?,?,'queued',?,?,?)`,
      )
      .run(
        r.id,
        r.projectId,
        r.conversationId,
        r.agentKind,
        r.prompt,
        r.worktreePath,
        r.branch,
        r.reportPath,
        new Date().toISOString(),
        r.chiefConversationId,
      );
  }
  setRunConversation(id: string, conversationId: string): void {
    this.db
      .prepare('UPDATE runs SET conversation_id = ? WHERE id = ?')
      .run(conversationId, id);
  }
  /** Follow-up round: back to running, drop the previous finished stamp. */
  reopenRun(id: string): void {
    this.db
      .prepare(
        "UPDATE runs SET status = 'running', finished_at = NULL WHERE id = ?",
      )
      .run(id);
  }
  setRunStatus(
    id: string,
    status: RunRow['status'],
    exitCode?: number | null,
  ): void {
    const finished =
      status === 'done' || status === 'failed' || status === 'interrupted'
        ? new Date().toISOString()
        : null;
    this.db
      .prepare(
        'UPDATE runs SET status = ?, exit_code = COALESCE(?, exit_code), finished_at = COALESCE(?, finished_at) WHERE id = ?',
      )
      .run(status, exitCode ?? null, finished, id);
  }
  getRun(id: string): RunRow | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row === undefined ? undefined : camelize<RunRow>(row);
  }
  listRuns(projectId: string | null): RunRow[] {
    if (projectId === null)
      return mapRows<RunRow>(
        this.db
          .prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 200')
          .all(),
      );
    return mapRows<RunRow>(
      this.db
        .prepare(
          'SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 200',
        )
        .all(projectId),
    );
  }
  activeRuns(): RunRow[] {
    return mapRows<RunRow>(
      this.db
        .prepare("SELECT * FROM runs WHERE status IN ('queued','running')")
        .all(),
    );
  }
  interruptedOrphans(): RunRow[] {
    return mapRows<RunRow>(
      this.db.prepare("SELECT * FROM runs WHERE status = 'running'").all(),
    );
  }
}
