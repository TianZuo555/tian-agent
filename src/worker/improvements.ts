import { createHash, randomUUID } from 'node:crypto';
import type { Db, TaskRow } from './db.js';
import { GLOBAL_SCOPE } from './scopes.js';
import type {
  ImprovementItem,
  ImprovementKind,
  ImprovementSeverity,
  ImprovementSource,
  ImprovementStatus,
  ImprovementSummary,
} from '../shared/types.js';

const MAX_SUMMARY = 300;
const MAX_DETAIL = 20_000;
const MAX_LIST = 500;

/** Context attached to an automatically captured issue. */
export interface IssueContext {
  scopeId?: string;
  severity?: ImprovementSeverity;
  runId?: string;
  taskId?: number;
  conversationId?: string;
  eventId?: string;
  /** Extra text appended to the stack (e.g. renderer component stack). */
  extra?: string;
}

export type IssueReporter = (
  area: string,
  error: unknown,
  context?: IssueContext,
) => void;

export interface ImprovementRecordInput {
  /** Deterministic for replay-safe callers; random otherwise. */
  id?: string;
  scopeId: string;
  kind: ImprovementKind;
  summary: string;
  detail?: string;
  severity?: ImprovementSeverity;
  source: ImprovementSource;
  area?: string | null;
  fingerprint?: string | null;
  conversationId?: string | null;
  runId?: string | null;
  eventId?: string | null;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

export interface ImprovementFilter {
  scopeId?: string | null;
  status?: ImprovementStatus | null;
  kind?: ImprovementKind | null;
  limit?: number;
}

export interface Promotion {
  entry: ImprovementItem;
  task: TaskRow;
  /** False when the entry (or its dedupe key) already had a task. */
  created: boolean;
}

const SEVERITY_RANK: Record<ImprovementSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const STATUS_ORDER: Record<ImprovementStatus, number> = {
  open: 0,
  promoted: 1,
  resolved: 2,
  dismissed: 3,
};

const clip = (value: string, max: number): string => {
  const text = value.trim();
  const points = [...text];
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text;
};

/**
 * Remove credentials from automatically captured text. The service log is
 * local, but the improvement log is shown in the UI and may be exported.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/bot\d+:[A-Za-z0-9_-]{15,}/g, 'bot[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^&\s,;]+/gi,
      '$1[REDACTED]',
    );
}

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const errorDetail = (error: unknown): string => {
  if (error instanceof Error)
    return error.stack ?? `${error.name}: ${error.message}`;
  return errorText(error);
};

/** Stable across repeated occurrences of the same failure. */
export function fingerprintError(area: string, error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code != null
      ? String((error as { code?: unknown }).code)
      : '';
  return createHash('sha256')
    .update(`${area}\0${name}\0${code}\0${errorText(error)}`)
    .digest('hex')
    .slice(0, 16);
}

export const improvementRef = (id: string): string =>
  `#${id.replace(/^imp-/, '').slice(0, 8)}`;

const summaryColumns = `
  id, scope_id, kind, status, severity, summary, source, area, fingerprint,
  occurrences, first_seen_at, last_seen_at, task_id, conversation_id, run_id,
  event_id, created_at, updated_at
`;

const toSummary = (value: unknown): ImprovementSummary => {
  const record = value as Record<string, unknown>;
  return {
    id: String(record.id),
    scopeId: String(record.scope_id),
    kind: record.kind as ImprovementKind,
    status: record.status as ImprovementStatus,
    severity: record.severity as ImprovementSeverity,
    summary: String(record.summary),
    source: record.source as ImprovementSource,
    area: (record.area as string | null) ?? null,
    fingerprint: (record.fingerprint as string | null) ?? null,
    occurrences: Number(record.occurrences),
    firstSeenAt: String(record.first_seen_at),
    lastSeenAt: String(record.last_seen_at),
    taskId: record.task_id == null ? null : Number(record.task_id),
    conversationId: (record.conversation_id as string | null) ?? null,
    runId: (record.run_id as string | null) ?? null,
    eventId: (record.event_id as string | null) ?? null,
    createdAt: String(record.created_at),
    updatedAt: String(record.updated_at),
  };
};

/**
 * The Improvement Log: durable, triable observations about the product itself.
 * Chief and user entries are recorded as-is; automatic failures are folded by
 * fingerprint so a recurring error becomes one row with an occurrence count.
 * This is deliberately separate from `events` (audit facts) and `memory`
 * (facts injected into prompts).
 */
export class ImprovementStore {
  constructor(private db: Db) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS improvements (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', severity TEXT NOT NULL DEFAULT 'medium',
        summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
        area TEXT, fingerprint TEXT, occurrences INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, task_id INTEGER,
        conversation_id TEXT, run_id TEXT, event_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS improvements_scope_status
        ON improvements(scope_id, status, last_seen_at);
      CREATE INDEX IF NOT EXISTS improvements_fingerprint
        ON improvements(scope_id, fingerprint, status);
      CREATE INDEX IF NOT EXISTS improvements_task ON improvements(task_id);
    `);
  }

  /** Insert one entry, or fold a repeated automatic failure into the open row. */
  record(input: ImprovementRecordInput): ImprovementItem {
    if (input.id) {
      const existing = this.get(input.id);
      if (existing) return existing;
    }
    const now = input.at ?? new Date().toISOString();
    const summary = clip(redactSecrets(input.summary), MAX_SUMMARY);
    if (!summary) throw new Error('Improvement summary cannot be empty');
    const detail = redactSecrets((input.detail ?? '').slice(0, MAX_DETAIL));
    const severity = input.severity ?? 'medium';

    if (input.fingerprint && input.source === 'system') {
      const repeated = this.openByFingerprint(input.scopeId, input.fingerprint);
      if (repeated) {
        const previous = this.get(repeated.id)!;
        const at = now;
        this.db.sqlite
          .prepare(
            `UPDATE improvements SET occurrences = occurrences + 1,
            summary = ?, detail = ?, severity = ?, last_seen_at = ?, updated_at = ?,
            area = COALESCE(?, area), conversation_id = COALESCE(?, conversation_id),
            run_id = COALESCE(?, run_id), event_id = COALESCE(?, event_id)
            WHERE id = ?`,
          )
          .run(
            summary,
            detail.length >= previous.detail.length ? detail : previous.detail,
            SEVERITY_RANK[severity] > SEVERITY_RANK[previous.severity]
              ? severity
              : previous.severity,
            at,
            at,
            input.area ?? null,
            input.conversationId ?? null,
            input.runId ?? null,
            input.eventId ?? null,
            repeated.id,
          );
        return this.get(repeated.id)!;
      }
    }

    const id = input.id ?? `imp-${randomUUID()}`;
    this.db.sqlite
      .prepare(
        `INSERT INTO improvements
        (id,scope_id,kind,status,severity,summary,detail,source,area,fingerprint,
         occurrences,first_seen_at,last_seen_at,task_id,conversation_id,run_id,
         event_id,created_at,updated_at)
        VALUES (?,?,?,'open',?,?,?,?,?,?,1,?,?,NULL,?,?,?,?,?)`,
      )
      .run(
        id,
        input.scopeId,
        input.kind,
        severity,
        summary,
        detail,
        input.source,
        input.area ?? null,
        input.fingerprint ?? null,
        now,
        now,
        input.conversationId ?? null,
        input.runId ?? null,
        input.eventId ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  /** Capture an exception as an issue, with fingerprint dedupe. */
  capture(
    area: string,
    error: unknown,
    context: IssueContext = {},
  ): ImprovementItem {
    const message = errorText(error).split('\n')[0];
    const detail = [
      errorDetail(error),
      context.extra ? `\n${context.extra}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return this.record({
      scopeId: context.scopeId ?? GLOBAL_SCOPE,
      kind: 'issue',
      source: 'system',
      summary: clip(`${area}: ${message}`, MAX_SUMMARY),
      detail,
      severity: context.severity ?? 'medium',
      area,
      fingerprint: fingerprintError(area, error),
      conversationId: context.conversationId ?? null,
      runId: context.runId ?? null,
      eventId: context.eventId ?? null,
    });
  }

  get(id: string): ImprovementItem | undefined {
    const value = this.db.sqlite
      .prepare(
        `SELECT ${summaryColumns}, detail FROM improvements WHERE id = ?`,
      )
      .get(id);
    if (!value) return undefined;
    const record = value as Record<string, unknown>;
    return { ...toSummary(value), detail: String(record.detail ?? '') };
  }

  list(filter: ImprovementFilter = {}): ImprovementSummary[] {
    const clauses = ['1=1'];
    const args: (string | number)[] = [];
    if (filter.scopeId) {
      clauses.push('scope_id = ?');
      args.push(filter.scopeId);
    }
    if (filter.status) {
      clauses.push('status = ?');
      args.push(filter.status);
    }
    if (filter.kind) {
      clauses.push('kind = ?');
      args.push(filter.kind);
    }
    const limit = Math.min(Math.max(filter.limit ?? MAX_LIST, 1), MAX_LIST);
    args.push(limit);
    return this.db.sqlite
      .prepare(
        `SELECT ${summaryColumns} FROM improvements WHERE ${clauses.join(' AND ')}
        ORDER BY CASE status
          WHEN 'open' THEN 0 WHEN 'promoted' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
          last_seen_at DESC LIMIT ?`,
      )
      .all(...args)
      .map(toSummary)
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.lastSeenAt.localeCompare(a.lastSeenAt),
      );
  }

  setStatus(
    id: string,
    status: Exclude<ImprovementStatus, 'promoted'>,
  ): ImprovementItem {
    return this.db.transaction(() => {
      const entry = this.get(id);
      if (!entry) throw new Error(`Unknown improvement: ${id}`);
      if (entry.status === status) return entry;
      const allowed: Record<ImprovementStatus, ImprovementStatus[]> = {
        open: ['resolved', 'dismissed'],
        promoted: ['resolved', 'dismissed'],
        resolved: ['open'],
        dismissed: ['open'],
      };
      if (!allowed[entry.status].includes(status))
        throw new Error(
          `Cannot move improvement from ${entry.status} to ${status}`,
        );
      this.db.sqlite
        .prepare(
          'UPDATE improvements SET status = ?, updated_at = ? WHERE id = ?',
        )
        .run(status, new Date().toISOString(), id);
      return this.get(id)!;
    });
  }

  /** Create (once) a pending task for an entry and link the two. */
  promote(id: string): Promotion {
    return this.db.transaction(() => {
      const entry = this.get(id);
      if (!entry) throw new Error(`Unknown improvement: ${id}`);
      if (entry.taskId != null) {
        const existing = this.db.getTask(entry.taskId);
        if (existing) return { entry, task: existing, created: false };
      }
      const task = this.db.insertTask({
        scopeId: entry.scopeId,
        title: entry.summary,
        trigger: 'manual',
        triggerRef: entry.id,
        dedupeKey: `improvement:${entry.id}`,
      });
      const now = new Date().toISOString();
      this.db.sqlite
        .prepare(
          `UPDATE improvements SET status = 'promoted', task_id = ?, updated_at = ?
          WHERE id = ?`,
        )
        .run(task.id, now, id);
      return { entry: this.get(id)!, task, created: true };
    });
  }

  private openByFingerprint(
    scopeId: string,
    fingerprint: string,
  ): ImprovementSummary | undefined {
    const value = this.db.sqlite
      .prepare(
        `SELECT ${summaryColumns} FROM improvements
        WHERE scope_id = ? AND fingerprint = ? AND status IN ('open','promoted')
        ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .get(scopeId, fingerprint);
    return value ? toSummary(value) : undefined;
  }
}
