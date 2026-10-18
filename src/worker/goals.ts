import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type {
  GoalItem,
  GoalPatch,
  GoalStatus,
  NoticeItem,
  ScheduleItem,
} from '../shared/types.js';

export type GoalRow = GoalItem;
export type ScheduleRow = ScheduleItem;
export type NoticeRow = NoticeItem;

/** Every goal field the chief (or UI) may write; state fields belong to the chief. */
export type GoalUpdate = GoalPatch &
  Partial<
    Pick<GoalItem, 'status' | 'currentState' | 'nextAction' | 'lastExecution'>
  >;

/** Dedupe window for user notices with the same fingerprint. */
export const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const snake = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Persistent store for goals, schedules and user notices (PRD §5.1, §5.3).
 * Owns its own tables; the tasks table itself stays in `db.ts`. Writes are
 * synchronous so the scheduler can wrap a fire in one `Db.transaction`.
 */
export class GoalStore {
  constructor(private db: Db) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, objective TEXT NOT NULL,
        success_criteria TEXT NOT NULL DEFAULT '', constraints TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active', current_state TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '', last_execution TEXT,
        conversation_id TEXT, max_runs_per_day INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, cron TEXT NOT NULL,
        timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        next_fire_at TEXT, last_fired_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        text TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS goals_scope ON goals(scope_id, status);
      CREATE INDEX IF NOT EXISTS schedules_next_fire ON schedules(enabled, next_fire_at);
      CREATE INDEX IF NOT EXISTS schedules_goal ON schedules(goal_id);
      CREATE INDEX IF NOT EXISTS user_notices_goal_fingerprint ON user_notices(goal_id, fingerprint, created_at);
    `);
  }

  private mapGoal(value: Record<string, unknown>): GoalRow {
    return {
      id: value.id as string,
      scopeId: value.scope_id as string,
      objective: value.objective as string,
      successCriteria: value.success_criteria as string,
      constraints: value.constraints as string,
      status: value.status as GoalStatus,
      currentState: value.current_state as string,
      nextAction: value.next_action as string,
      lastExecution: value.last_execution as string | null,
      conversationId: value.conversation_id as string | null,
      maxRunsPerDay: value.max_runs_per_day as number,
      schedules: [],
      createdAt: value.created_at as string,
      updatedAt: value.updated_at as string,
    };
  }

  // ---- goals

  insertGoal(
    input: {
      scopeId: string;
      objective: string;
      successCriteria?: string;
      constraints?: string;
      maxRunsPerDay?: number;
    },
    now = new Date(),
  ): GoalRow {
    const timestamp = now.toISOString();
    const goal: GoalRow = {
      id: `g-${randomUUID()}`,
      scopeId: input.scopeId,
      objective: input.objective.trim(),
      successCriteria: input.successCriteria?.trim() ?? '',
      constraints: input.constraints?.trim() ?? '',
      status: 'active',
      currentState: '',
      nextAction: '',
      lastExecution: null,
      conversationId: null,
      maxRunsPerDay: input.maxRunsPerDay ?? 3,
      schedules: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.sqlite
      .prepare(
        'INSERT INTO goals (id,scope_id,objective,success_criteria,constraints,status,current_state,next_action,last_execution,conversation_id,max_runs_per_day,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        goal.id,
        goal.scopeId,
        goal.objective,
        goal.successCriteria,
        goal.constraints,
        goal.status,
        goal.currentState,
        goal.nextAction,
        goal.lastExecution,
        goal.conversationId,
        goal.maxRunsPerDay,
        goal.createdAt,
        goal.updatedAt,
      );
    return goal;
  }

  getGoal(id: string): GoalRow | undefined {
    const value = this.db.sqlite
      .prepare('SELECT * FROM goals WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!value) return undefined;
    const goal = this.mapGoal(value);
    goal.schedules = this.listSchedules(goal.id);
    return goal;
  }

  listGoals(scopeId: string | null): GoalRow[] {
    const values = this.db.sqlite
      .prepare(
        'SELECT * FROM goals WHERE (? IS NULL OR scope_id = ?) ORDER BY created_at',
      )
      .all(scopeId, scopeId) as Record<string, unknown>[];
    return values.map((value) => {
      const goal = this.mapGoal(value);
      goal.schedules = this.listSchedules(goal.id);
      return goal;
    });
  }

  updateGoal(id: string, patch: GoalUpdate, now = new Date()): GoalRow {
    const entries = Object.entries(patch).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length)
      this.db.sqlite
        .prepare(
          `UPDATE goals SET ${entries.map(([key]) => `${snake(key)} = ?`).join(',')}, updated_at = ? WHERE id = ?`,
        )
        .run(
          ...entries.map(([, value]) => value as string | number),
          now.toISOString(),
          id,
        );
    return this.getGoal(id)!;
  }

  setGoalStatus(id: string, status: GoalStatus, now = new Date()): GoalRow {
    return this.updateGoal(id, { status }, now);
  }

  /** First binding wins: the goal keeps one stable chief conversation. */
  setGoalConversation(id: string, conversationId: string): void {
    this.db.sqlite
      .prepare(
        'UPDATE goals SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL',
      )
      .run(conversationId, id);
  }

  goalConversation(id: string): string | null {
    return this.getGoal(id)?.conversationId ?? null;
  }

  // ---- schedules

  private mapSchedule(value: Record<string, unknown>): ScheduleRow {
    return {
      id: value.id as string,
      goalId: value.goal_id as string,
      cron: value.cron as string,
      timezone: value.timezone as string,
      enabled: value.enabled === 1,
      nextFireAt: value.next_fire_at as string | null,
      lastFiredAt: value.last_fired_at as string | null,
    };
  }

  insertSchedule(input: {
    goalId: string;
    cron: string;
    timezone: string;
    nextFireAt: string | null;
  }): ScheduleRow {
    const schedule: ScheduleRow = {
      id: `s-${randomUUID()}`,
      goalId: input.goalId,
      cron: input.cron,
      timezone: input.timezone,
      enabled: true,
      nextFireAt: input.nextFireAt,
      lastFiredAt: null,
    };
    this.db.sqlite
      .prepare(
        'INSERT INTO schedules (id,goal_id,cron,timezone,enabled,next_fire_at,last_fired_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        schedule.id,
        schedule.goalId,
        schedule.cron,
        schedule.timezone,
        1,
        schedule.nextFireAt,
        schedule.lastFiredAt,
      );
    return schedule;
  }

  getSchedule(id: string): ScheduleRow | undefined {
    const value = this.db.sqlite
      .prepare('SELECT * FROM schedules WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return value ? this.mapSchedule(value) : undefined;
  }

  listSchedules(goalId?: string): ScheduleRow[] {
    const values = goalId
      ? (this.db.sqlite
          .prepare(
            'SELECT * FROM schedules WHERE goal_id = ? ORDER BY cron, id',
          )
          .all(goalId) as Record<string, unknown>[])
      : (this.db.sqlite
          .prepare('SELECT * FROM schedules ORDER BY cron, id')
          .all() as Record<string, unknown>[]);
    return values.map((value) => this.mapSchedule(value));
  }

  removeSchedule(id: string): void {
    this.db.sqlite.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  setScheduleEnabled(id: string, enabled: boolean): void {
    this.db.sqlite
      .prepare('UPDATE schedules SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);
  }

  /** Enabled schedules whose next fire is due at or before `now`. */
  dueSchedules(now: Date): ScheduleRow[] {
    return (
      this.db.sqlite
        .prepare(
          'SELECT * FROM schedules WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at',
        )
        .all(now.toISOString()) as Record<string, unknown>[]
    ).map((value) => this.mapSchedule(value));
  }

  /** Earliest next fire across enabled schedules — the timer's target. */
  nextWake(): Date | null {
    const value = this.db.sqlite
      .prepare(
        'SELECT MIN(next_fire_at) AS next FROM schedules WHERE enabled = 1 AND next_fire_at IS NOT NULL',
      )
      .get() as { next: string | null };
    return value.next ? new Date(value.next) : null;
  }

  advanceSchedule(id: string, nextFireAt: Date | null, firedAt: Date): void {
    this.db.sqlite
      .prepare(
        'UPDATE schedules SET next_fire_at = ?, last_fired_at = ? WHERE id = ?',
      )
      .run(nextFireAt?.toISOString() ?? null, firedAt.toISOString(), id);
  }

  // ---- user notices

  private mapNotice(value: Record<string, unknown>): NoticeRow {
    return {
      id: value.id as number,
      goalId: value.goal_id as string,
      scopeId: value.scope_id as string,
      fingerprint: value.fingerprint as string,
      text: value.text as string,
      createdAt: value.created_at as string,
      deliveredAt: value.delivered_at as string | null,
    };
  }

  /**
   * Record a notice for the user, deduped per (goal, fingerprint) inside the
   * window. Returns whether it was delivered now or suppressed as a repeat.
   */
  addNotice(
    goalId: string,
    fingerprint: string,
    text: string,
    now = new Date(),
    windowMs = NOTICE_WINDOW_MS,
  ): { notice: NoticeRow; delivered: boolean } {
    // Flat statements, no own transaction: callers that need atomicity (a
    // schedule fire, a tool replay window) are already inside one.
    const scopeRow = this.db.sqlite
      .prepare('SELECT scope_id FROM goals WHERE id = ?')
      .get(goalId) as { scope_id: string } | undefined;
    if (!scopeRow) throw new Error(`Unknown goal: ${goalId}`);
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const recent = this.db.sqlite
      .prepare(
        'SELECT * FROM user_notices WHERE goal_id = ? AND fingerprint = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(goalId, fingerprint, cutoff) as Record<string, unknown> | undefined;
    if (recent) return { notice: this.mapNotice(recent), delivered: false };
    const info = this.db.sqlite
      .prepare(
        'INSERT INTO user_notices (goal_id,fingerprint,text,created_at) VALUES (?,?,?,?)',
      )
      .run(goalId, fingerprint, text, now.toISOString());
    const row = this.db.sqlite
      .prepare(
        'SELECT user_notices.*, goals.scope_id AS scope_id FROM user_notices JOIN goals ON goals.id = user_notices.goal_id WHERE user_notices.id = ?',
      )
      .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    return { notice: this.mapNotice(row), delivered: true };
  }

  listNotices(scopeId: string | null, limit = 50): NoticeRow[] {
    return (
      this.db.sqlite
        .prepare(
          `SELECT user_notices.*, goals.scope_id AS scope_id FROM user_notices JOIN goals ON goals.id = user_notices.goal_id
          WHERE (? IS NULL OR goals.scope_id = ?) ORDER BY user_notices.id DESC LIMIT ?`,
        )
        .all(scopeId, scopeId, limit) as Record<string, unknown>[]
    ).map((value) => this.mapNotice(value));
  }
}
