import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ToolRegistration } from '@earendil-works/pi-durable';
import { GLOBAL_SCOPE } from './scopes.js';
import type { Db, TaskRow } from './db.js';
import type { GoalStore, GoalUpdate } from './goals.js';
import { parseCron } from './scheduler.js';

export interface GoalsToolDeps {
  db: Db;
  goals: GoalStore;
  /** Open (or reuse) the goal's dedicated chief conversation. */
  openGoalConversation: (goalId: string, scopeId: string) => Promise<string>;
  /** Resolve a scope parameter against the calling conversation. */
  resolveScope: (conversationId: string, param?: string) => string;
  /** Push task/goal updates to clients after a tool write. */
  emitUpdates: () => void;
  emitNotice: (scopeId: string) => void;
  /** An extraction trigger fires when the chief completes a task (PRD §4.4). */
  onTaskCompleted?: (scopeId: string) => void;
}

export interface TaskToolDeps {
  db: Db;
  /** Push task updates to clients after a tool write. */
  emitUpdates: () => void;
  /** An extraction trigger fires when a task completes (PRD §4.4). */
  onTaskCompleted?: (scopeId: string) => void;
  /**
   * When set (the project manager), task tools refuse tasks outside this
   * scope, resolved from the calling conversation.
   */
  taskScope?: (conversationId: string) => string;
  /**
   * Refuse start/complete/fail on tasks carrying this assignee. The chief
   * passes 'manager' so delegated work stays the manager's to run.
   */
  refuseAssignee?: 'manager';
  /**
   * Append the update_goal reminder to complete_task results. Default true;
   * the manager passes false — goals stay with the chief.
   */
  goalReminder?: boolean;
  /** Called after complete_task / fail_task writes the new status. */
  onTaskClosed?: (task: TaskRow, operationId: string) => void | Promise<void>;
}

const text = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });
const err = (t: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: t }],
});

const ScopeParam = Type.Optional(
  Type.String({
    description:
      'Target scope: "global", a project name or id. Default: this conversation\'s scope.',
  }),
);

const GoalParam = Type.String({
  description: 'Goal id (from list_goals or <state>).',
});
const TaskParam = Type.Number({ description: 'Task id.' });
const OutcomeParam = Type.Union([
  Type.Literal('achieved'),
  Type.Literal('not_achieved'),
  Type.Literal('no_change'),
]);
const StatusParam = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('blocked'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
]);

const DEFAULT_MAX_RUNS_PER_DAY = 3;

/**
 * The chief's goal tools (PRD §5): manage goals and schedules, work woken
 * tasks to an outcome, and reach Tian through deduped notices. Every
 * mutating tool is replay-safe with a deterministic operation id.
 */
export function goalsTools(deps: GoalsToolDeps): ToolRegistration[] {
  const { db, goals } = deps;
  const changed = () => deps.emitUpdates();
  const scopeLabel = (scope: string) =>
    scope === GLOBAL_SCOPE ? 'global' : scope;

  const requireGoal = (id: string) => {
    const goal = goals.getGoal(id);
    if (!goal) throw new Error(`Unknown goal: ${id}`);
    return goal;
  };
  const scheduleSummary = (id: string): string => {
    const schedules = goals.listSchedules(id);
    if (schedules.length === 0) return 'no schedule';
    return schedules
      .map(
        (s) =>
          `${s.cron} (${s.timezone})${s.enabled ? '' : ' [disabled]'} next:${s.nextFireAt?.slice(0, 16) ?? '-'}`,
      )
      .join('; ');
  };

  const createGoal = defineTool({
    name: 'create_goal',
    replay: 'safe',
    description:
      "Create a long-lived goal in a scope: the result to achieve or maintain (objective), how success is measured, and the constraints. It gets its own conversation and shows up in Tian's Goals view.",
    parameters: Type.Object({
      objective: Type.String({
        description: 'One sentence: the result to achieve or maintain.',
      }),
      success_criteria: Type.Optional(
        Type.String({
          description: 'How to judge success; a checklist is fine.',
        }),
      ),
      constraints: Type.Optional(
        Type.String({
          description:
            'What the goal must not do (budgets, forbidden actions).',
        }),
      ),
      max_runs_per_day: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 48,
          description: `Daily execution budget. Default ${DEFAULT_MAX_RUNS_PER_DAY}.`,
        }),
      ),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = deps.resolveScope(String(api.conversationId), args.scope);
      try {
        const goal = db.once(`create-goal:${api.taskId}:${api.callId}`, () =>
          goals.insertGoal({
            scopeId: scope,
            objective: args.objective,
            successCriteria: args.success_criteria,
            constraints: args.constraints,
            maxRunsPerDay: args.max_runs_per_day ?? DEFAULT_MAX_RUNS_PER_DAY,
          }),
        );
        const conversationId = await deps.openGoalConversation(goal.id, scope);
        goals.setGoalConversation(goal.id, conversationId);
        changed();
        return text(
          `goal ${goal.id} created in [${scopeLabel(scope)}] with its own conversation. Add a schedule with add_schedule to have it wake on its own.`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const updateGoal = defineTool({
    name: 'update_goal',
    replay: 'safe',
    description:
      "Write a goal's current state, next action, last execution, success criteria, constraints, budget or status. Call this after every run on a goal — the next wake reads only these fields.",
    parameters: Type.Object({
      goal: GoalParam,
      current_state: Type.Optional(
        Type.String({ description: 'Where the goal stands right now.' }),
      ),
      next_action: Type.Optional(
        Type.String({
          description: 'The concrete next step for the next run.',
        }),
      ),
      last_execution: Type.Optional(
        Type.String({ description: 'What the last execution did and found.' }),
      ),
      success_criteria: Type.Optional(
        Type.String({ description: 'Replaces the success criteria.' }),
      ),
      constraints: Type.Optional(
        Type.String({ description: 'Replaces the constraints.' }),
      ),
      max_runs_per_day: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 48 }),
      ),
      status: Type.Optional(StatusParam),
    }),
    execute: async (args, api) => {
      try {
        requireGoal(args.goal);
        const patch: GoalUpdate = {};
        if (args.current_state !== undefined)
          patch.currentState = args.current_state;
        if (args.next_action !== undefined) patch.nextAction = args.next_action;
        if (args.last_execution !== undefined)
          patch.lastExecution = args.last_execution;
        if (args.success_criteria !== undefined)
          patch.successCriteria = args.success_criteria;
        if (args.constraints !== undefined)
          patch.constraints = args.constraints;
        if (args.max_runs_per_day !== undefined)
          patch.maxRunsPerDay = args.max_runs_per_day;
        if (args.status !== undefined) patch.status = args.status;
        const goal = db.once(`update-goal:${api.taskId}:${api.callId}`, () =>
          goals.updateGoal(args.goal, patch),
        );
        changed();
        return text(`goal ${goal.id} updated.`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const listGoals = defineTool({
    name: 'list_goals',
    description:
      'List goals of a scope with status, next action, schedule and last execution.',
    parameters: Type.Object({ scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = deps.resolveScope(String(api.conversationId), args.scope);
      const items = goals
        .listGoals(scope)
        .filter((g) => !['completed', 'cancelled'].includes(g.status));
      if (items.length === 0) return text('(no goals)');
      return text(
        items
          .map(
            (g) =>
              `${g.id} [${g.status}] ${g.objective}\n  next: ${g.nextAction || '-'}\n  schedule: ${scheduleSummary(g.id)}${g.lastExecution ? `\n  last run: ${g.lastExecution.slice(0, 200)}` : ''}`,
          )
          .join('\n'),
      );
    },
  });

  const addSchedule = defineTool({
    name: 'add_schedule',
    replay: 'safe',
    description:
      'Wake a goal on a cron schedule (5 fields, optional timezone). The wake creates one task and is deduped across restarts.',
    parameters: Type.Object({
      goal: GoalParam,
      cron: Type.String({
        description: 'Cron expression, e.g. "30 9 * * *" for 09:30 daily.',
      }),
      timezone: Type.Optional(
        Type.String({
          description:
            'IANA timezone, e.g. "Asia/Shanghai". Default: the service local time.',
        }),
      ),
    }),
    execute: async (args, api) => {
      try {
        const goal = requireGoal(args.goal);
        const timezone =
          args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { nextFireAt } = parseCron(args.cron, timezone, new Date());
        const schedule = db.once(
          `add-schedule:${api.taskId}:${api.callId}`,
          () =>
            goals.insertSchedule({
              goalId: goal.id,
              cron: args.cron.trim(),
              timezone,
              nextFireAt: nextFireAt?.toISOString() ?? null,
            }),
        );
        changed();
        return text(
          `schedule ${schedule.id} added to goal ${goal.id}: ${schedule.cron} (${schedule.timezone}), next fire ${schedule.nextFireAt ?? '-'}.`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const removeSchedule = defineTool({
    name: 'remove_schedule',
    replay: 'safe',
    description: 'Remove a schedule by id (see list_goals).',
    parameters: Type.Object({
      schedule: Type.String({ description: 'Schedule id.' }),
    }),
    execute: async (args, api) => {
      try {
        db.once(`remove-schedule:${api.taskId}:${api.callId}`, () => {
          if (!goals.getSchedule(args.schedule))
            throw new Error(`Unknown schedule: ${args.schedule}`);
          goals.removeSchedule(args.schedule);
          return null;
        });
        changed();
        return text(`schedule ${args.schedule} removed.`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  // Delegated tasks belong to the manager: the chief steers them with
  // send_manager_msg, never start/complete/fail.
  const [startTask, completeTask, failTask] = taskExecutionTools({
    ...deps,
    refuseAssignee: 'manager',
  });

  const notifyUser = defineTool({
    name: 'notify_user',
    replay: 'safe',
    description:
      'Leave a notice for Tian on a goal (shown in the Goals view; Telegram later). Deduped per fingerprint within 24h — returns whether it was delivered or suppressed as a repeat. Use it when a decision or attention is genuinely needed, never for routine no-change results.',
    parameters: Type.Object({
      goal: GoalParam,
      fingerprint: Type.String({
        description:
          'Stable key for this kind of notice, e.g. "ci-broken" or "needs-decision:pr-42".',
      }),
      notice: Type.String({ description: 'What Tian should know or decide.' }),
    }),
    execute: async (args, api) => {
      try {
        const goal = requireGoal(args.goal);
        const result = db.once(`notify-user:${api.taskId}:${api.callId}`, () =>
          goals.addNotice(goal.id, args.fingerprint, args.notice),
        );
        if (result.delivered) deps.emitNotice(goal.scopeId);
        return text(
          result.delivered
            ? `notice delivered to Tian (${result.notice.fingerprint}).`
            : `notice suppressed — the same fingerprint (${result.notice.fingerprint}) was delivered within the last 24h.`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  return [
    createGoal,
    updateGoal,
    listGoals,
    addSchedule,
    removeSchedule,
    startTask,
    completeTask,
    failTask,
    notifyUser,
  ];
}

/**
 * The task lifecycle tools shared by chief and project manager: claim a
 * pending task, then close it with an outcome or a failure. `taskScope`
 * confines a manager to its own project's tasks.
 */
export function taskExecutionTools(deps: TaskToolDeps): ToolRegistration[] {
  const { db } = deps;
  const changed = () => deps.emitUpdates();

  const requireTask = (id: number, conversationId: string) => {
    const task = db.getTask(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    if (deps.taskScope && task.scopeId !== deps.taskScope(conversationId))
      throw new Error(`task #${id} belongs to another scope`);
    if (deps.refuseAssignee && task.assignee === deps.refuseAssignee)
      throw new Error(
        `task #${id} is delegated to the ${db.getProject(task.scopeId)?.name ?? task.scopeId} manager — use send_manager_msg`,
      );
    return task;
  };

  const startTask = defineTool({
    name: 'start_task',
    replay: 'safe',
    description:
      'Mark a pending task as running (counts one attempt). Finish it with complete_task or fail_task.',
    parameters: Type.Object({ task: TaskParam }),
    execute: async (args, api) => {
      try {
        const task = requireTask(args.task, String(api.conversationId));
        if (task.attempts >= task.maxAttempts)
          return err(
            `task #${task.id} used all ${task.maxAttempts} attempts — try a different approach or create a new task.`,
          );
        const updated = db.once(`start-task:${api.taskId}:${api.callId}`, () =>
          db.updateTaskStatus(task.id, 'running', { countAttempt: true }),
        );
        changed();
        return text(`task #${updated.id} is running.`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const completeTask = defineTool({
    name: 'complete_task',
    replay: 'safe',
    description:
      'Complete a task with its outcome: achieved, not_achieved, or no_change (nothing worth reporting; do not notify Tian in that case). A one-line summary records what happened.',
    parameters: Type.Object({
      task: TaskParam,
      outcome: OutcomeParam,
      summary: Type.Optional(
        Type.String({
          description: 'One line: what was done and what it changed.',
        }),
      ),
    }),
    execute: async (args, api) => {
      try {
        const task = requireTask(args.task, String(api.conversationId));
        const operationId = `complete-task:${api.taskId}:${api.callId}`;
        const updated = db.once(operationId, () =>
          db.updateTaskStatus(task.id, 'completed', {
            outcome: args.outcome,
            summary: args.summary ?? null,
          }),
        );
        changed();
        deps.onTaskCompleted?.(updated.scopeId);
        await deps.onTaskClosed?.(updated, operationId);
        const reminder =
          deps.goalReminder !== false && updated.goalId
            ? ' Remember update_goal to record the new state and next action.'
            : '';
        return text(
          `task #${updated.id} completed (${updated.outcome}).${reminder}`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const failTask = defineTool({
    name: 'fail_task',
    replay: 'safe',
    description:
      'Fail a task with the reason (blocked, missing access, repeated failure). The reason is visible to Tian.',
    parameters: Type.Object({
      task: TaskParam,
      reason: Type.String(),
    }),
    execute: async (args, api) => {
      try {
        const task = requireTask(args.task, String(api.conversationId));
        const operationId = `fail-task:${api.taskId}:${api.callId}`;
        const updated = db.once(operationId, () =>
          db.updateTaskStatus(task.id, 'failed', { summary: args.reason }),
        );
        changed();
        await deps.onTaskClosed?.(updated, operationId);
        return text(`task #${updated.id} failed: ${args.reason}`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  return [startTask, completeTask, failTask];
}
