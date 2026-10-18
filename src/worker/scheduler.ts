import { Cron } from 'croner';
import type { Db } from './db.js';
import type { GoalStore } from './goals.js';
import type {
  GoalItem,
  ScheduleItem,
  TaskItem,
} from '../shared/types.js';

export const DEFAULT_MAX_RUNS_PER_DAY = 3;
/** Timer granularity: never sleep longer than this before re-checking. */
const TICK_CAP_MS = 60_000;

/**
 * Validate a cron pattern and compute its first fire after `now`.
 * Throws with a readable message for bad patterns or timezones.
 */
export function parseCron(
  cron: string,
  timezone: string | null,
  now: Date,
): { nextFireAt: Date | null } {
  let schedule: Cron;
  try {
    schedule = new Cron(cron.trim(), {
      timezone: timezone ?? undefined,
    });
  } catch (error) {
    throw new Error(
      `Invalid cron expression "${cron}": ${error instanceof Error ? error.message : error}`,
    );
  }
  return { nextFireAt: schedule.nextRun(now) };
}

/** Everything the scheduler needs; all collaborators are injectable for tests. */
export interface SchedulerDeps {
  db: Db;
  goals: GoalStore;
  /** Return the goal's stable chief conversation id, creating it once. */
  ensureGoalConversation: (goalId: string, scopeId: string) => Promise<string>;
  /** Trigger delivery of queued notifications. */
  notify: () => Promise<void>;
  /** Injectable clock. */
  now?: () => Date;
  /** While true (closing/maintenance) no fire happens and the timer idles. */
  isPaused?: () => boolean;
  /** Push task/goal/notice updates to clients. */
  emitUpdates?: () => void;
  /** Refresh the notices panel of the scope a new notice belongs to. */
  emitNotice?: (scopeId: string) => void;
}

/**
 * Wakes goals on their schedules (PRD §5.3). The scheduler decides *when*;
 * the chief decides *what*. Every fire commits exactly one transaction:
 * task (deduped) + notification + advanced `next_fire_at` — a restart or a
 * missed stretch therefore coalesces into a single run, never a catch-up storm.
 */
export class GoalScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private deps: SchedulerDeps) {}

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Start (or restart) the timer loop. Safe to call repeatedly. */
  start(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.stopped || this.timer) return;
    const wake = this.deps.goals.nextWake();
    const delay =
      wake === null
        ? TICK_CAP_MS
        : Math.max(
            0,
            Math.min(TICK_CAP_MS, wake.getTime() - this.now.getTime()),
          );
    const timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
    timer.unref?.();
    this.timer = timer;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (!(this.deps.isPaused?.() ?? false)) {
      try {
        await this.fireDue();
      } catch (error) {
        console.error('Scheduler:', error);
      }
    }
    this.scheduleNext();
  }

  /** Fire every due schedule; returns the tasks that were created or reused. */
  async fireDue(): Promise<TaskItem[]> {
    const now = this.now;
    const due = this.deps.goals.dueSchedules(now);
    const tasks: TaskItem[] = [];
    for (const schedule of due) {
      // Ensure the conversation exists before the write transaction; the
      // channel binding makes this idempotent across restarts.
      await this.ensureConversation(schedule);
      const task = this.fire(schedule, now);
      if (task) tasks.push(task);
    }
    if (tasks.length > 0 || due.length > 0) {
      this.deps.emitUpdates?.();
      await this.deps.notify();
    }
    return tasks;
  }

  private async ensureConversation(schedule: ScheduleItem): Promise<string> {
    const goal = this.deps.goals.getGoal(schedule.goalId);
    if (!goal) return '';
    if (goal.conversationId) return goal.conversationId;
    const conversationId = await this.deps.ensureGoalConversation(
      goal.id,
      goal.scopeId,
    );
    this.deps.goals.setGoalConversation(goal.id, conversationId);
    return conversationId;
  }

  /**
   * Fire one schedule slot. Everything happens in ONE transaction: create the
   * deduped task, queue its notification, and advance `next_fire_at` from NOW
   * so missed fires coalesce into this single run.
   */
  fire(schedule: ScheduleItem, now = this.now): TaskItem | null {
    const { db, goals } = this.deps;
    const goal = goals.getGoal(schedule.goalId);
    if (!goal) {
      // Orphaned schedule — disable it instead of firing into the void.
      goals.setScheduleEnabled(schedule.id, false);
      return null;
    }
    // The slot that came due identifies the fire; a restart re-fires the same
    // slot with the same key and must not create a second task.
    const slot = schedule.nextFireAt ?? now.toISOString();
    const dedupeKey = `sched:${schedule.id}:${slot}`;
    return db.transaction(() => {
      const current = goals.getGoal(goal.id)!;
      let task = db.taskByDedupeKey(dedupeKey);
      if (!task && current.status === 'active') {
        task = this.createTask({
          goal: current,
          title: current.nextAction.trim() || current.objective,
          trigger: 'schedule',
          triggerRef: schedule.id,
          dedupeKey,
          now,
          scheduleId: schedule.id,
        });
      }
      if (task)
        db.queueNotification({
          id: `task:${task.id}`,
          scopeId: current.scopeId,
          conversationId: current.conversationId,
          content: wakeContent(current, task),
        });
      goals.advanceSchedule(schedule.id, nextFireFrom(schedule, now), now);
      return task ?? null;
    });
  }

  /** Manual trigger: create a task for the goal now and wake its conversation. */
  async runGoalNow(goalId: string): Promise<TaskItem> {
    const goal = this.deps.goals.getGoal(goalId);
    if (!goal) throw new Error(`Unknown goal: ${goalId}`);
    if (goal.status !== 'active')
      throw new Error(`Goal is ${goal.status}, not active — resume it first.`);
    const now = this.now;
    if (!goal.conversationId) {
      const conversationId = await this.deps.ensureGoalConversation(
        goal.id,
        goal.scopeId,
      );
      this.deps.goals.setGoalConversation(goal.id, conversationId);
    }
    const task = this.deps.db.transaction(() => {
      const current = this.deps.goals.getGoal(goal.id)!;
      const capKey = `manual-cap:${goal.id}:${dayKey(now)}`;
      return this.createTask({
        goal: current,
        title: current.nextAction.trim() || current.objective,
        trigger: 'manual',
        triggerRef: null,
        // While capped, repeated presses reuse one blocked task per day.
        dedupeKey: this.overCap(current, now) ? capKey : null,
        now,
      });
    });
    this.deps.emitUpdates?.();
    await this.deps.notify();
    return task;
  }

  private overCap(goal: GoalItem, now: Date): boolean {
    return (
      this.deps.db.countGoalTasks(goal.id, startOfDay(now)) >=
      goal.maxRunsPerDay
    );
  }

  /** Create the task for one goal run; enforces the daily budget. */
  private createTask(input: {
    goal: GoalItem;
    title: string;
    trigger: 'schedule' | 'manual';
    triggerRef: string | null;
    dedupeKey: string | null;
    now: Date;
    scheduleId?: string;
  }): TaskItem {
    const { db, goals } = this.deps;
    const { goal, now } = input;
    if (this.overCap(goal, now)) {
      const task = db.insertTask({
        scopeId: goal.scopeId,
        title: input.title,
        status: 'blocked',
        goalId: goal.id,
        owner: 'agent',
        trigger: input.trigger,
        triggerRef: input.triggerRef,
        dedupeKey: input.dedupeKey,
        summary: `Daily budget reached: this goal allows ${goal.maxRunsPerDay} run(s) per day. Blocked until tomorrow, or raise the cap.`,
      });
      const notice = goals.addNotice(
        goal.id,
        `daily-cap:${dayKey(now)}`,
        `目标「${goal.objective}」今天的执行次数已达上限（${goal.maxRunsPerDay}），这次唤醒被拦下，明天再继续。`,
        now,
      );
      if (notice.delivered) this.deps.emitNotice?.(notice.notice.scopeId);
      return task;
    }
    return db.insertTask({
      scopeId: goal.scopeId,
      title: input.title,
      goalId: goal.id,
      owner: 'agent',
      trigger: input.trigger,
      triggerRef: input.triggerRef,
      dedupeKey: input.dedupeKey,
    });
  }
}

/** Advance from NOW: anything missed while asleep collapses into one fire. */
export function nextFireFrom(schedule: ScheduleItem, now: Date): Date | null {
  return new Cron(schedule.cron, { timezone: schedule.timezone }).nextRun(now);
}

function startOfDay(now: Date): string {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The wake text: goal state + this task — never the full history. */
export function wakeContent(goal: GoalItem, task: TaskItem): string {
  return [
    `[goal: ${goal.objective}] (id ${goal.id}, status ${goal.status})`,
    goal.successCriteria ? `success criteria: ${goal.successCriteria}` : '',
    goal.constraints ? `constraints: ${goal.constraints}` : '',
    goal.currentState ? `current state: ${goal.currentState}` : '',
    `next action: ${goal.nextAction || '(decide and record it)'}`,
    '',
    `Task #${task.id} (${task.trigger === 'schedule' ? `schedule ${task.triggerRef}` : task.trigger}): ${task.title}`,
    '',
    'Work this task in this conversation now. Finish it with complete_task or fail_task, and update_goal with the new current state and next action afterwards. If nothing changed (outcome=no_change), do not notify Tian.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
