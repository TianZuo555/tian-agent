import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../src/worker/db';
import { GoalStore } from '../src/worker/goals';
import {
  GoalScheduler,
  parseCron,
  wakeContent,
  type SchedulerDeps,
} from '../src/worker/scheduler';
import { goalsTools } from '../src/worker/tools-goals';

/** Call a chief goal tool the way the harness would. */
function toolRunner(f: Fixture, completed: string[] = []) {
  let call = 0;
  const tools = new Map(
    goalsTools({
      db: f.db,
      goals: f.goals,
      openGoalConversation: (goalId) => Promise.resolve(`conv-${goalId}`),
      resolveScope: () => 'global',
      emitUpdates: () => {},
      emitNotice: () => {},
      onTaskCompleted: (scopeId) => completed.push(scopeId),
    }).map((tool) => [tool.name, tool]),
  );
  return async (
    name: string,
    args: Record<string, unknown>,
    ids: { taskId?: string; callId?: string } = {},
  ): Promise<string> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    const result = await tool.execute(
      args,
      {
        taskId: ids.taskId ?? 'task-1',
        callId: ids.callId ?? `call-${++call}`,
        conversationId: '1',
      } as never,
      {} as never,
    );
    return (result.output ?? [])
      .map((item) => ('text' in item ? item.text : ''))
      .join('\n');
  };
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A scheduler over an existing database — a "service restart" in tests. */
function rig(db: Db, clock: { now: Date }) {
  const goals = new GoalStore(db);
  const openers: string[] = [];
  const deps: SchedulerDeps = {
    db,
    goals,
    ensureGoalConversation: (goalId, scopeId) => {
      openers.push(`${goalId}@${scopeId}`);
      return Promise.resolve(`conv-${goalId}`);
    },
    notify: async () => {},
    now: () => clock.now,
  };
  return { goals, openers, scheduler: new GoalScheduler(deps) };
}

interface Rig {
  goals: GoalStore;
  openers: string[];
  scheduler: GoalScheduler;
}

interface Fixture extends Rig {
  db: Db;
  clock: { now: Date };
  /** A fresh scheduler over the same database, like a restarted service. */
  restart(): Rig;
}

function fixture(t: TestContext): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'tian-goals-'));
  const db = new Db(dir);
  const clock = { now: new Date('2026-10-05T10:00:00.000Z') };
  const base = rig(db, clock);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    db,
    clock,
    ...base,
    restart: () => rig(db, clock),
  };
}

function dailySchedule(f: Fixture, goalId: string, when = f.clock.now) {
  return f.goals.insertSchedule({
    goalId,
    cron: '* * * * *',
    timezone: 'UTC',
    nextFireAt: when.toISOString(),
  });
}

test('tasks migrate from the old todo schema, idempotently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-goals-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A database created by the previous schema, before this branch.
  const legacy = new DatabaseSync(join(dir, 'tian.db'));
  legacy.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', due TEXT, created_at TEXT NOT NULL, done_at TEXT
    );
  `);
  legacy
    .prepare(
      "INSERT INTO tasks (scope_id,title,status,created_at) VALUES ('global','legacy open','open','2026-01-01T08:00:00.000Z')",
    )
    .run();
  legacy
    .prepare(
      "INSERT INTO tasks (scope_id,title,status,created_at,done_at) VALUES ('global','legacy done','done','2026-01-01T09:00:00.000Z','2026-01-02T09:00:00.000Z')",
    )
    .run();
  legacy.close();

  const db = new Db(dir);
  t.after(() => db.close());
  const byTitle = (title: string) =>
    db.listTasks(null).find((task) => task.title === title)!;
  const open = byTitle('legacy open');
  const done = byTitle('legacy done');
  assert.equal(open.status, 'pending');
  assert.equal(open.owner, 'user');
  assert.equal(open.trigger, 'manual');
  assert.equal(open.goalId, null);
  assert.equal(open.updatedAt, '2026-01-01T08:00:00.000Z');
  assert.equal(done.status, 'completed');
  assert.equal(done.doneAt, '2026-01-02T09:00:00.000Z');
  // Reopening the same database must not change anything again.
  const reopened = new Db(dir);
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.listTasks(null).map((task) => [task.title, task.status]),
    db.listTasks(null).map((task) => [task.title, task.status]),
  );
});

test('task transitions are enforced in one place and illegal moves throw', (t) => {
  const f = fixture(t);
  const id = f.db.addTask('global', 'a plain todo', null);
  assert.equal(f.db.getTask(id)!.status, 'pending');
  f.db.doneTask(id);
  assert.equal(f.db.getTask(id)!.status, 'completed');
  // Unchecking a todo is a legal reopen.
  f.db.reopenTask(id);
  assert.equal(f.db.getTask(id)!.status, 'pending');
  assert.equal(f.db.getTask(id)!.doneAt, null);
  f.db.updateTaskStatus(id, 'running', { countAttempt: true });
  const running = f.db.getTask(id)!;
  assert.equal(running.attempts, 1);
  assert.ok(running.startedAt);
  assert.throws(() => f.db.updateTaskStatus(id, 'pending'), /Illegal/);
  f.db.updateTaskStatus(id, 'completed', {
    outcome: 'achieved',
    summary: 'checked and confirmed',
  });
  const completed = f.db.getTask(id)!;
  assert.equal(completed.outcome, 'achieved');
  assert.equal(completed.summary, 'checked and confirmed');
  assert.ok(completed.doneAt);
  assert.throws(() => f.db.updateTaskStatus(id, 'running'), /Illegal/);
  // Same-status repeats are idempotent no-ops.
  f.db.updateTaskStatus(id, 'completed');
  assert.equal(f.db.getTask(id)!.attempts, 1);
});

test('a schedule fires exactly one task and one notification, even across a mid-fire restart', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Check the CI status of tian-agent',
    successCriteria: 'green for 7 days',
    constraints: 'read-only',
  });
  const schedule = dailySchedule(f, goal.id);

  const fired = await f.scheduler.fireDue();
  assert.equal(fired.length, 1);
  const tasks = f.db.listTasks(null);
  assert.equal(tasks.length, 1);
  const slot = f.clock.now.toISOString();
  assert.equal(tasks[0].dedupeKey, `sched:${schedule.id}:${slot}`);
  assert.equal(tasks[0].trigger, 'schedule');
  assert.equal(tasks[0].triggerRef, schedule.id);
  assert.equal(tasks[0].owner, 'agent');
  assert.equal(tasks[0].goalId, goal.id);
  const notifications = f.db.pendingNotifications();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, `task:${tasks[0].id}`);
  assert.equal(notifications[0].conversationId, `conv-${goal.id}`);
  assert.match(notifications[0].content, /Check the CI status/);
  assert.match(notifications[0].content, /success criteria: green for 7 days/);
  assert.match(notifications[0].content, /constraints: read-only/);
  assert.match(notifications[0].content, new RegExp(`Task #${tasks[0].id}`));
  assert.match(
    wakeContent(goal, tasks[0]),
    /complete_task or fail_task[\s\S]*do not notify Tian/,
  );
  // next_fire_at advanced by exactly one slot.
  assert.equal(
    f.goals.getSchedule(schedule.id)!.nextFireAt,
    new Date(f.clock.now.getTime() + MINUTE).toISOString(),
  );

  // The service restarts mid-fire: the slot had not been advanced yet, so the
  // same fire runs again — deduped to the same task and notification.
  const stale = { ...schedule, nextFireAt: slot };
  f.clock.now = new Date(f.clock.now.getTime() + MINUTE);
  const resumed = f.restart();
  const again = resumed.scheduler.fire(stale, f.clock.now);
  assert.equal(again!.id, tasks[0].id);
  assert.equal(f.db.listTasks(null).length, 1);
  assert.equal(f.db.pendingNotifications().length, 1);
  assert.equal(
    f.goals.getSchedule(schedule.id)!.nextFireAt,
    new Date(f.clock.now.getTime() + MINUTE).toISOString(),
  );

  // And a tick before the next slot does not re-fire the handled ones.
  f.clock.now = new Date(f.clock.now.getTime() + 30_000);
  await f.restart().scheduler.fireDue();
  assert.equal(f.db.listTasks(null).length, 1);
  assert.equal(f.db.pendingNotifications().length, 1);
});

test('missed fires coalesce into one run without a catch-up storm', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Sweep the inbox',
  });
  dailySchedule(f, goal.id); // due 10:00
  // The service slept for seven minutes; the slot is still 10:00.
  f.clock.now = new Date(f.clock.now.getTime() + 7 * MINUTE);
  const fired = await f.scheduler.fireDue();
  assert.equal(fired.length, 1);
  assert.equal(f.db.listTasks(null).length, 1);
  // Advanced from NOW (10:07 → 10:08), not replayed seven times.
  assert.equal(
    f.goals.listSchedules()[0].nextFireAt,
    new Date('2026-10-05T10:08:00.000Z').toISOString(),
  );
  await f.scheduler.fireDue();
  assert.equal(f.db.listTasks(null).length, 1);
  assert.equal(f.db.pendingNotifications().length, 1);
});

test('a paused goal does not fire, and orphaned schedules disable themselves', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Water the plants',
  });
  const schedule = dailySchedule(f, goal.id);
  f.goals.setGoalStatus(goal.id, 'paused');
  const fired = await f.scheduler.fireDue();
  assert.equal(fired.length, 0);
  assert.equal(f.db.listTasks(null).length, 0);
  assert.equal(f.db.pendingNotifications().length, 0);
  // The schedule still advances so resuming starts from the future.
  assert.ok(
    f.goals.getSchedule(schedule.id)!.nextFireAt! > f.clock.now.toISOString(),
  );

  // A schedule whose goal vanished is disabled instead of firing forever.
  f.goals.insertSchedule({
    goalId: 'g-missing',
    cron: '* * * * *',
    timezone: 'UTC',
    nextFireAt: f.clock.now.toISOString(),
  });
  await f.scheduler.fireDue();
  assert.equal(
    f.goals.listSchedules().find((s) => s.goalId === 'g-missing')!.enabled,
    false,
  );
});

test('the daily cap blocks extra runs and leaves a deduped user notice', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Watch the deploy',
    maxRunsPerDay: 1,
  });
  dailySchedule(f, goal.id);
  const first = await f.scheduler.fireDue();
  assert.equal(first[0].status, 'pending');

  f.clock.now = new Date(f.clock.now.getTime() + 30 * MINUTE);
  const second = (await f.scheduler.fireDue())[0];
  assert.equal(second.status, 'blocked');
  assert.match(second.summary!, /budget/i);
  const notices = f.goals.listNotices(null);
  assert.equal(notices.length, 1);
  assert.match(notices[0].fingerprint, /^daily-cap:/);
  assert.match(notices[0].text, /Watch the deploy/);
  // The blocked task itself does not consume the budget.
  assert.equal(f.db.countGoalTasks(goal.id, '2026-10-05T00:00:00.000Z'), 1);
  // An over-cap fire must not wake the chief: only the first run has a wake.
  assert.equal(f.db.pendingNotifications().length, 1);
  assert.equal(
    f.db.pendingNotifications().some((n) => n.id === `task:${second.id}`),
    false,
  );

  // A third fire the same day reuses the one blocked task and stays deduped.
  f.clock.now = new Date(f.clock.now.getTime() + 30 * MINUTE);
  const third = (await f.scheduler.fireDue())[0];
  assert.equal(third.id, second.id);
  assert.equal(f.goals.listNotices(null).length, 1);
  assert.equal(f.db.pendingNotifications().length, 1);
});

test('a migrated database still dedupes blocked tasks to one per day', (t) => {
  // The real user database is a migrated one: dedupe_key arrived by ALTER
  // TABLE, so uniqueness must come from the index, not the column.
  const dir = mkdtempSync(join(tmpdir(), 'tian-goals-migrated-'));
  const legacy = new DatabaseSync(join(dir, 'tian.db'));
  legacy.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', due TEXT, created_at TEXT NOT NULL, done_at TEXT
    );
  `);
  legacy.close();
  const db = new Db(dir);
  const clock = { now: new Date('2026-10-05T10:00:00.000Z') };
  const goals = new GoalStore(db);
  const scheduler = new GoalScheduler({
    db,
    goals,
    ensureGoalConversation: (goalId) => Promise.resolve(`conv-${goalId}`),
    notify: async () => {},
    now: () => clock.now,
  });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const goal = goals.insertGoal({
    scopeId: 'global',
    objective: 'Watch the deploy',
    maxRunsPerDay: 1,
  });
  goals.insertSchedule({
    goalId: goal.id,
    cron: '* * * * *',
    timezone: 'UTC',
    nextFireAt: clock.now.toISOString(),
  });
  return (async () => {
    await scheduler.fireDue();
    // Three over-cap fires in a row on a minute cron.
    for (let i = 0; i < 3; i += 1) {
      clock.now = new Date(clock.now.getTime() + MINUTE);
      await scheduler.fireDue();
    }
    const blocked = db
      .listTasks(null)
      .filter((task) => task.status === 'blocked');
    assert.equal(blocked.length, 1);
    assert.equal(db.listTasks(null).length, 2);
    assert.equal(goals.listNotices(null).length, 1);
  })();
});

test('the goal conversation is stable across restarts', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Track releases',
  });
  dailySchedule(f, goal.id);
  await f.scheduler.fireDue();
  assert.deepEqual(f.openers, [`${goal.id}@global`]);
  assert.equal(f.goals.getGoal(goal.id)!.conversationId, `conv-${goal.id}`);

  // A completely fresh store + scheduler (service restart) reuses the binding.
  const resumed = f.restart();
  resumed.goals.insertSchedule({
    goalId: goal.id,
    cron: '0 11 * * *',
    timezone: 'UTC',
    nextFireAt: f.clock.now.toISOString(),
  });
  await resumed.scheduler.fireDue();
  assert.deepEqual(resumed.openers, []); // never reopened
  assert.ok(
    f.db
      .pendingNotifications()
      .every((n) => n.conversationId === `conv-${goal.id}`),
  );

  // A crashed binding (null on the row) is healed, not duplicated.
  f.db.sqlite
    .prepare('UPDATE goals SET conversation_id = NULL WHERE id = ?')
    .run(goal.id);
  const healed = f.restart();
  healed.goals.insertSchedule({
    goalId: goal.id,
    cron: '0 12 * * *',
    timezone: 'UTC',
    nextFireAt: f.clock.now.toISOString(),
  });
  await healed.scheduler.fireDue();
  assert.deepEqual(healed.openers, [`${goal.id}@global`]);
  assert.equal(
    healed.goals.getGoal(goal.id)!.conversationId,
    `conv-${goal.id}`,
  );
});

test('notices dedupe on fingerprint inside the window', (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Mind the flaky test',
  });
  const first = f.goals.addNotice(
    goal.id,
    'ci-broken',
    'main is red',
    f.clock.now,
  );
  assert.equal(first.delivered, true);
  assert.equal(first.notice.scopeId, 'global');
  const repeat = f.goals.addNotice(
    goal.id,
    'ci-broken',
    'main is still red',
    new Date(f.clock.now.getTime() + 60 * MINUTE),
  );
  assert.equal(repeat.delivered, false);
  assert.equal(repeat.notice.id, first.notice.id);
  const other = f.goals.addNotice(
    goal.id,
    'needs-decision',
    'raise the cap?',
    f.clock.now,
  );
  assert.equal(other.delivered, true);
  const later = f.goals.addNotice(
    goal.id,
    'ci-broken',
    'main is red again',
    new Date(f.clock.now.getTime() + DAY + 60 * MINUTE),
  );
  assert.equal(later.delivered, true);
  assert.equal(f.goals.listNotices(null).length, 3);
  assert.equal(f.goals.listNotices('global').length, 3);
  assert.equal(f.goals.listNotices('p-other').length, 0);
});

test('runGoalNow creates a manual agent task and respects pause and the cap', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Summarize the week',
    maxRunsPerDay: 1,
  });
  const task = await f.scheduler.runGoalNow(goal.id);
  assert.equal(task.trigger, 'manual');
  assert.equal(task.owner, 'agent');
  assert.equal(task.status, 'pending');
  assert.equal(task.goalId, goal.id);
  assert.equal(task.dedupeKey, null);
  const notification = f.db.pendingNotifications().at(-1)!;
  assert.equal(notification.conversationId, `conv-${goal.id}`);
  assert.match(notification.content, /Summarize the week/);

  // A second press the same day hits the cap: blocked, with one notice and no
  // wake — the budget must not be bypassed by the very wake it blocks.
  const blocked = await f.scheduler.runGoalNow(goal.id);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.dedupeKey, `cap:${goal.id}:2026-10-05`);
  const notifications = f.db.pendingNotifications();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, `task:${task.id}`);
  const again = await f.scheduler.runGoalNow(goal.id);
  assert.equal(again.id, blocked.id);
  assert.equal(f.db.pendingNotifications().length, 1);
  assert.equal(f.goals.listNotices(null).length, 1);

  // Paused goals refuse manual runs.
  f.goals.setGoalStatus(goal.id, 'paused');
  await assert.rejects(f.scheduler.runGoalNow(goal.id), /not active/);
  await assert.rejects(f.scheduler.runGoalNow('g-missing'), /Unknown goal/);
});

test('nested transactions (operation replay around a transition) compose', (t) => {
  const f = fixture(t);
  const id = f.db.addTask('global', 'nested', null);
  // `once` opens a transaction; updateTaskStatus opens its own inside it.
  f.db.once('op-1', () => f.db.updateTaskStatus(id, 'running'));
  assert.equal(f.db.getTask(id)!.status, 'running');
  f.db.once('op-1', () => f.db.updateTaskStatus(id, 'completed'));
  // A replayed operation returns its saved result instead of re-running.
  assert.equal(f.db.getTask(id)!.status, 'running');
  // A failing inner action rolls back the whole outer transaction.
  assert.throws(() =>
    f.db.once('op-2', () => {
      f.db.updateTaskStatus(id, 'pending');
      return null;
    }),
  );
  assert.equal(f.db.getTask(id)!.status, 'running');
});

test('notify_user dedupes inside the window and replays safely', async (t) => {
  const f = fixture(t);
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Watch the deploy',
  });
  const run = toolRunner(f);
  const first = await run('notify_user', {
    goal: goal.id,
    fingerprint: 'deploy-broken',
    notice: 'deploy 42 is red',
  });
  assert.match(first, /delivered/);
  const repeat = await run('notify_user', {
    goal: goal.id,
    fingerprint: 'deploy-broken',
    notice: 'deploy 42 is still red',
  });
  assert.match(repeat, /suppressed/);
  assert.equal(f.goals.listNotices(null).length, 1);
  // A durable replay of the same call returns the saved answer, not a new notice.
  const replayed = await run(
    'notify_user',
    { goal: goal.id, fingerprint: 'deploy-broken', notice: 'deploy 42 is red' },
    { taskId: 'task-9', callId: 'stable-call' },
  );
  const replayedAgain = await run(
    'notify_user',
    { goal: goal.id, fingerprint: 'deploy-broken', notice: 'deploy 42 is red' },
    { taskId: 'task-9', callId: 'stable-call' },
  );
  assert.equal(replayed, replayedAgain);
  assert.equal(f.goals.listNotices(null).length, 1);
  // Another fingerprint is a separate notice.
  await run('notify_user', {
    goal: goal.id,
    fingerprint: 'needs-decision',
    notice: 'raise the cap?',
  });
  assert.equal(f.goals.listNotices(null).length, 2);
});

test('the task tools move a woken task to a recorded outcome', async (t) => {
  const f = fixture(t);
  const completed: string[] = [];
  const goal = f.goals.insertGoal({ scopeId: 'global', objective: 'Check CI' });
  const run = toolRunner(f, completed);
  dailySchedule(f, goal.id);
  const [task] = await f.scheduler.fireDue();

  assert.match(await run('start_task', { task: task.id }), /running/);
  assert.equal(f.db.getTask(task.id)!.attempts, 1);
  assert.match(
    await run('complete_task', {
      task: task.id,
      outcome: 'no_change',
      summary: 'still green',
    }),
    /completed \(no_change\)/,
  );
  const done = f.db.getTask(task.id)!;
  assert.equal(done.status, 'completed');
  assert.equal(done.outcome, 'no_change');
  assert.equal(done.summary, 'still green');
  // Completing a task fires the memory-worker extraction trigger (F03).
  assert.deepEqual(completed, ['global']);

  const failingId = f.db.addTask('global', 'second', null);
  assert.match(
    await run('fail_task', {
      task: failingId,
      reason: 'no access to the repo',
    }),
    /no access/,
  );
  const failed = f.db.getTask(failingId)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.summary, 'no access to the repo');

  // Starting a task past its attempt budget is refused, not silently retried.
  f.db.sqlite
    .prepare('UPDATE tasks SET attempts = max_attempts WHERE id = ?')
    .run(failingId);
  f.db.updateTaskStatus(failingId, 'pending');
  assert.match(await run('start_task', { task: failingId }), /attempts/);
  assert.equal(f.db.getTask(failingId)!.status, 'pending');
  // Unknown ids are reported as errors rather than throwing out of the tool.
  assert.match(
    await run('complete_task', { task: 999, outcome: 'achieved' }),
    /Unknown task/,
  );
});

test('the budget day follows the local calendar, not UTC', async (t) => {
  const f = fixture(t);
  // 01:00 local on 2026-10-06 — the UTC date is still 2026-10-05 for UTC+X.
  const local = new Date(2026, 9, 6, 1, 0, 0, 0);
  f.clock.now = local;
  const goal = f.goals.insertGoal({
    scopeId: 'global',
    objective: 'Early bird check',
    maxRunsPerDay: 1,
  });
  const schedule = f.goals.insertSchedule({
    goalId: goal.id,
    cron: '* * * * *',
    timezone: 'UTC',
    nextFireAt: local.toISOString(),
  });
  await f.scheduler.fireDue();
  f.clock.now = new Date(local.getTime() + MINUTE);
  const blocked = (await f.scheduler.fireDue())[0];
  assert.equal(blocked.status, 'blocked');
  const localKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  assert.equal(blocked.dedupeKey, `cap:${goal.id}:${localKey}`);
  assert.equal(
    f.goals.listNotices(null)[0].fingerprint,
    `daily-cap:${localKey}`,
  );
  // The budget window itself is local midnight, so the first run counted.
  assert.equal(
    f.db.countGoalTasks(
      goal.id,
      new Date(2026, 9, 6, 0, 0, 0, 0).toISOString(),
    ),
    1,
  );
  assert.ok(f.goals.getSchedule(schedule.id)!.nextFireAt);
});

test('schedule parsing validates expressions and computes the first fire', () => {
  const now = new Date('2026-10-05T01:00:00.000Z');
  const daily = parseCron('30 9 * * *', 'Asia/Shanghai', now);
  assert.equal(daily.nextFireAt!.toISOString(), '2026-10-05T01:30:00.000Z');
  assert.throws(() => parseCron('not a cron', null, now), /Invalid cron/);
});
