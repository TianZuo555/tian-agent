import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Db,
  type ManagerMessageRow,
  type RunRow,
  type TaskRow,
} from '../src/worker/db';
import { DataService } from '../src/worker/data';
import { Scopes } from '../src/worker/scopes';
import { EventLog } from '../src/worker/events';
import { GoalStore } from '../src/worker/goals';
import type { HistoryIndex } from '../src/worker/history';
import {
  managerExtension,
  type ManagerDeps,
} from '../src/worker/manager-tools';
import { chiefExtension } from '../src/worker/tools';
import { ImprovementStore } from '../src/worker/improvements';
import { RunOrchestrator, type WorkerRuntime } from '../src/worker/runs';
import { ResidentServer } from '../src/service/server';
import { servicePaths } from '../src/shared/service-paths';
import { DATABASE_VERSION } from '../src/shared/version';
import { DatabaseSync } from 'node:sqlite';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-manager-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function addRun(db: Db, overrides: Partial<RunRow> = {}): RunRow {
  const run: RunRow = {
    id: `r-${randomUUID().slice(0, 8)}`,
    projectId: 'p-1',
    conversationId: `conv-${randomUUID().slice(0, 8)}`,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'do the thing',
    currentPrompt: 'do the thing',
    rootPath: '/tmp',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'running',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
  db.addRun(run);
  return run;
}

type ToolResult = { isError?: boolean; output: { text: string }[] };
type ExecutableTool = {
  execute: (
    args: unknown,
    api: unknown,
    context?: unknown,
  ) => Promise<ToolResult>;
};
const toolText = (result: ToolResult) => result.output[0].text;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Wake {
  projectId: string;
  content: string;
  id: string;
  taskId: number | null | undefined;
  /** Conversation the real service would route this wake to. */
  target: string | null;
}

interface Fixture {
  root: string;
  db: Db;
  data: DataService;
  scopes: Scopes;
  deps: ManagerDeps;
  managerConv: string;
  tool: (name: string) => ExecutableTool;
  chiefTool: (name: string) => ExecutableTool;
  wakes: Wake[];
  dispatched: {
    projectRef: string;
    chiefConversationId: string | null;
    model?: string;
    thinkingLevel?: string;
  }[];
  searches: { scopeId: string | null }[];
  /** The input a tool call would see — set to a user turn for a Tian turn. */
  turn: {
    entryId: string;
    kind: 'user' | 'system.notification' | 'worker.input';
    text: string;
  } | null;
}

function fixture(t: TestContext): Fixture {
  const root = temporary(t);
  const db = new Db(root);
  const globalDir = join(root, 'scopes', 'global');
  const scopes = new Scopes(globalDir, db);
  const data = new DataService(db, scopes, () => {});
  const projectDir = join(root, 'project-a');
  db.addProject({
    id: 'p-1',
    name: 'alpha',
    rootPath: projectDir,
    autoLand: 0,
    allowInPlace: 1,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: '阿七',
  });
  db.addProject({
    id: 'p-2',
    name: 'beta',
    rootPath: join(root, 'project-b'),
    autoLand: 0,
    allowInPlace: 1,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: '小七',
  });
  scopes.ensureDirs('p-1');
  scopes.ensureDirs('p-2');
  const events = new EventLog(db);
  const wakes: Wake[] = [];
  const dispatched: Fixture['dispatched'] = [];
  const searches: Fixture['searches'] = [];
  const turn: { current: Fixture['turn'] } = { current: null };

  const deps: ManagerDeps = {
    scopes,
    db,
    data,
    goals: new GoalStore(db),
    emitUpdates: () => {},
    latestInputEntry: async () => turn.current?.entryId ?? null,
    currentInput: async () => turn.current,
    dispatch: async (input) => {
      dispatched.push(input);
      return addRun(db, {
        id: 'r-dispatched',
        projectId: input.projectRef,
        chiefConversationId: input.chiefConversationId,
        model: input.model ?? null,
        thinkingLevel: input.thinkingLevel ?? null,
      });
    },
    workerModels: () => [],
    runReport: () => 'the report',
    runDiff: async () => 'the diff',
    runProgress: async () => ({
      id: 'r1',
      projectId: 'p1',
      status: 'running',
      reviewStatus: 'pending',
      attempt: 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      deadlineAt: '',
      error: null,
      lastText: 'working',
      toolCalls: [],
    }),
    stopRun: async (id) => ({
      ...db.getRun(id)!,
      status: 'interrupted',
    }),
    sendRunMessage: (runId, body, operationId) =>
      data.sendRunMessage(runId, body, operationId),
    runMessages: (runId) => data.runMessages(runId),
    wakeChief: async (projectId, content, notificationId, taskId) => {
      wakes.push({
        projectId,
        content,
        id: notificationId,
        taskId,
        // The service resolves the same way (managerReportTarget).
        target: data.managerReportTarget(projectId, taskId),
      });
    },
    history: {
      db,
      events,
      history: {
        search: async (_query: string, opts: { scopeId: string | null }) => {
          searches.push(opts);
          return [];
        },
        read: async (ref: string) => `content of ${ref}`,
      } as unknown as HistoryIndex,
    },
  };
  const pick = (
    tools: readonly { name: string }[] | undefined,
    name: string,
  ): ExecutableTool => {
    const found = tools?.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing tool: ${name}`);
    return found as unknown as ExecutableTool;
  };
  const tool = (name: string) => pick(managerExtension(deps).tools, name);
  const chiefTool = (name: string) =>
    pick(
      chiefExtension({
        scopes,
        db,
        data,
        goals: new GoalStore(db),
        improvements: new ImprovementStore(db),
        latestInputEntry: async () => null,
        currentInput: async () => null,
        openGoalConversation: async () => 'goal-conv',
        emitUpdates: () => {},
        emitImprovements: () => {},
        emitNotices: () => {},
        dispatch: () => Promise.reject(new Error('not used')),
        workerModels: () => [],
        runReport: () => '',
        runDiff: async () => '',
        runProgress: async () => {
          throw new Error('unused');
        },
        stopRun: async () => {
          throw new Error('unused');
        },
        sendRunMessage: () => {
          throw new Error('not used');
        },
        runMessages: () => [],
        delegateToManager: () => Promise.reject(new Error('not used')),
        sendManagerMessage: () => Promise.reject(new Error('not used')),
        managerMessages: (projectId) => data.managerMessages(projectId),
        history: { db, events, history: {} as HistoryIndex },
      }).tools,
      name,
    );
  t.after(() => db.close());
  // The manager conversation: bound to project p-1 via channel 'manager'.
  db.mapConversation('mgr-conv', 'p-1');
  db.bindSession(
    { channel: 'manager', externalId: 'p-1', scopeId: 'p-1' },
    'mgr-conv',
  );
  db.mapConversation('chief-conv', 'p-1');
  return {
    root,
    db,
    data,
    scopes,
    deps,
    managerConv: 'mgr-conv',
    tool,
    chiefTool,
    wakes,
    dispatched,
    searches,
    get turn() {
      return turn.current;
    },
    set turn(value: Fixture['turn']) {
      turn.current = value;
    },
  };
}

const api = (conversationId: string, callId = 'c1') => ({
  conversationId,
  taskId: 'task-1',
  callId,
});

const delegatedTask = (f: Fixture, title = 'keep main green') =>
  f.db.insertTask({
    scopeId: 'p-1',
    title,
    owner: 'agent',
    assignee: 'manager',
    reportTo: 'chief-conv',
  });

// ---- tool-level tests -------------------------------------------------------

test('manager conversations are bound, identified, and excluded from scope wakes', (t) => {
  const f = fixture(t);
  assert.equal(f.db.isManagerConversation('mgr-conv'), true);
  assert.deepEqual(f.db.managerConversationIds(), ['mgr-conv']);
  assert.equal(f.db.managerConversation('p-1')?.conversationId, 'mgr-conv');
  // A chief conversation in the same project stays the scope's wake target.
  f.db.mapConversation('other-mgr', 'p-2');
  f.db.bindSession(
    { channel: 'manager', externalId: 'p-2', scopeId: 'p-2' },
    'other-mgr',
  );
  assert.equal(f.db.latestConversation('p-1')?.conversationId, 'chief-conv');
  assert.equal(f.db.latestConversation('p-2'), undefined);
});

test('the chief cannot run a delegated task; the manager owns its lifecycle', async (t) => {
  const f = fixture(t);
  const task = delegatedTask(f);
  for (const name of ['start_task', 'complete_task', 'fail_task']) {
    const result = await f
      .chiefTool(name)
      .execute(
        name === 'complete_task'
          ? { task: task.id, outcome: 'achieved' }
          : name === 'fail_task'
            ? { task: task.id, reason: 'x' }
            : { task: task.id },
        api('chief-conv'),
      );
    assert.match(
      toolText(result),
      new RegExp(`task #${task.id} is delegated to the alpha manager`),
    );
  }
  // The manager runs the full lifecycle.
  const started = await f
    .tool('start_task')
    .execute({ task: task.id }, api('mgr-conv', 'm1'));
  assert.match(toolText(started), /running/);
  const done = await f
    .tool('complete_task')
    .execute(
      { task: task.id, outcome: 'achieved', summary: 'green again' },
      api('mgr-conv', 'm2'),
    );
  assert.match(toolText(done), /completed \(achieved\)/);
});

test('closing a delegated task wakes its chief; plain tasks close silently', async (t) => {
  const f = fixture(t);
  const goal = new GoalStore(f.db).insertGoal({
    scopeId: 'p-1',
    objective: 'keep CI green',
  });
  const task = f.db.insertTask({
    scopeId: 'p-1',
    title: 'triage CI',
    owner: 'agent',
    assignee: 'manager',
    reportTo: 'chief-conv',
    goalId: goal.id,
  });
  await f.tool('start_task').execute({ task: task.id }, api('mgr-conv', 's1'));
  const done = await f
    .tool('complete_task')
    .execute(
      { task: task.id, outcome: 'achieved', summary: 'CI green again' },
      api('mgr-conv', 'c2'),
    );
  // Managers never get the update_goal reminder — goals stay with the chief.
  assert.doesNotMatch(toolText(done), /update_goal/);
  const wake = f.wakes.find((w) => w.id.startsWith('mtask:'));
  assert.ok(wake);
  assert.equal(wake.target, 'chief-conv');
  assert.equal(wake.taskId, task.id);
  assert.match(
    wake.content,
    new RegExp(`manager closed task #${task.id}: completed \\(achieved\\)`),
  );
  assert.match(wake.content, /CI green again/);
  assert.match(wake.content, new RegExp(`Update goal ${goal.id}`));
  // A non-delegated task closes without any chief wake.
  const before = f.wakes.length;
  const plain = f.db.insertTask({ scopeId: 'p-1', title: 'own cleanup' });
  await f.tool('start_task').execute({ task: plain.id }, api('mgr-conv', 's2'));
  await f
    .tool('complete_task')
    .execute({ task: plain.id, outcome: 'achieved' }, api('mgr-conv', 'c3'));
  assert.equal(f.wakes.length, before);
});

test('reports route per-task to their delegating chief', async (t) => {
  const f = fixture(t);
  const taskA = f.db.insertTask({
    scopeId: 'p-1',
    title: 'A',
    owner: 'agent',
    assignee: 'manager',
    reportTo: 'chief-a',
  });
  const taskB = f.db.insertTask({
    scopeId: 'p-1',
    title: 'B',
    owner: 'agent',
    assignee: 'manager',
    reportTo: 'chief-b',
  });
  await f
    .tool('report_chief')
    .execute({ text: 'A update', task: taskA.id }, api('mgr-conv', 'r1'));
  assert.equal(f.wakes.at(-1)!.target, 'chief-a');
  await f
    .tool('report_chief')
    .execute({ text: 'B update', task: taskB.id }, api('mgr-conv', 'r2'));
  assert.equal(f.wakes.at(-1)!.target, 'chief-b');
  // Without a task the report follows the latest delegated task.
  await f
    .tool('report_chief')
    .execute({ text: 'general update' }, api('mgr-conv', 'r3'));
  assert.equal(f.wakes.at(-1)!.target, 'chief-b');
  const reports = f.db
    .listManagerMessages('p-1')
    .filter((m) => m.kind === 'report');
  assert.deepEqual(
    reports.map((r) => r.taskId),
    [taskA.id, taskB.id, null],
  );
});

test('a foreign task id is refused and never routes a report', async (t) => {
  const f = fixture(t);
  const delegated = delegatedTask(f);
  const foreign = f.db.insertTask({
    scopeId: 'p-2',
    title: "beta's task",
    owner: 'agent',
    assignee: 'manager',
    reportTo: 'foreign-chief',
  });
  const bad = await f
    .tool('report_chief')
    .execute(
      { text: 'wrong project', task: foreign.id },
      api('mgr-conv', 'fx1'),
    );
  assert.match(toolText(bad), /belongs to p-2/);
  const badAsk = await f
    .tool('ask_chief')
    .execute(
      { question: 'wrong project?', task: foreign.id, wait_seconds: 5 },
      api('mgr-conv', 'fx2'),
    );
  assert.match(toolText(badAsk), /belongs to p-2/);
  // Neither call posted a message or woke the chief.
  assert.equal(f.wakes.length, 0);
  assert.equal(f.db.listManagerMessages('p-1').length, 0);
  // Even if a foreign task id slips through, the router falls back to this
  // project's latest delegated task instead of the foreign reportTo.
  assert.equal(
    f.data.managerReportTarget('p-1', foreign.id),
    delegated.reportTo,
  );
});

test('ask_chief waits for a reply_to answer, ignoring unrelated chief messages', async (t) => {
  const f = fixture(t);
  const asking = f
    .tool('ask_chief')
    .execute(
      { question: 'Ship to npm or keep private?', wait_seconds: 30 },
      api('mgr-conv'),
    );
  await sleep(30);
  const question = f.db
    .listManagerMessages('p-1')
    .find((m) => m.kind === 'question')!;
  assert.equal(f.wakes.length, 1);
  assert.match(f.wakes[0].content, /manager asks/);
  assert.match(f.wakes[0].content, new RegExp(`reply_to: ${question.seq}`));
  // An unrelated chief message mid-wait is not the answer.
  f.db.addManagerMessage({
    id: 'mm:p-1:plain',
    projectId: 'p-1',
    sender: 'chief',
    kind: 'message',
    body: 'unrelated guidance',
  });
  await sleep(30);
  f.db.addManagerMessage({
    id: 'mm:p-1:ans',
    projectId: 'p-1',
    sender: 'chief',
    kind: 'answer',
    replyTo: question.id,
    taskId: question.taskId,
    body: 'Keep it private for now.',
  });
  const result = await asking;
  assert.match(toolText(result), /Keep it private/);
  assert.doesNotMatch(toolText(result), /unrelated guidance/);
  assert.notEqual(f.db.managerMessage(question.id)!.closedAt, null);
});

test('ask_chief times out, closes the question, and replays without waiting', async (t) => {
  const f = fixture(t);
  const result = await f
    .tool('ask_chief')
    .execute({ question: 'Anyone?', wait_seconds: 1 }, api('mgr-conv'));
  assert.match(toolText(result), /best judgment/);
  const question = f.db
    .listManagerMessages('p-1')
    .find((m) => m.kind === 'question')!;
  assert.notEqual(question.closedAt, null);
  // Replaying the same call returns the timeout text instead of waiting again.
  const replay = await f
    .tool('ask_chief')
    .execute({ question: 'Anyone?', wait_seconds: 300 }, api('mgr-conv'));
  assert.match(toolText(replay), /best judgment/);
});

test('closing a question returns an answer that beat the timeout', (t) => {
  const f = fixture(t);
  const question = f.db.addManagerMessage({
    id: 'mm:p-1:qrace',
    projectId: 'p-1',
    sender: 'manager',
    kind: 'question',
    body: 'npm or private?',
  });
  f.db.addManagerMessage({
    id: 'mm:p-1:arace',
    projectId: 'p-1',
    sender: 'chief',
    kind: 'answer',
    replyTo: question.id,
    body: 'private',
  });
  const answer = f.db.closeManagerQuestion('p-1', question.id);
  assert.equal(answer?.body, 'private');
  assert.notEqual(f.db.managerMessage(question.id)!.closedAt, null);
});

test('manager progress and stop stay inside its own project', async (t) => {
  const f = fixture(t);
  const own = addRun(f.db, { projectId: 'p-1' });
  const foreign = addRun(f.db, { projectId: 'p-2' });
  const seen = await f
    .tool('run_progress')
    .execute({ id: own.id }, api(f.managerConv));
  assert.match(toolText(seen), /\[running\]/);
  assert.match(toolText(seen), /last output:\nworking/);
  const refused = await f
    .tool('run_progress')
    .execute({ id: foreign.id }, api(f.managerConv));
  assert.match(toolText(refused), /another project/);
  const stopped = await f
    .tool('stop_run')
    .execute({ id: own.id, reason: 'wrong branch' }, api(f.managerConv, 'c2'));
  assert.match(toolText(stopped), /stopped \[interrupted\]/);
  assert.match(toolText(stopped), /worktree.*is kept|is kept/);
  const foreignStop = await f
    .tool('stop_run')
    .execute({ id: foreign.id }, api(f.managerConv, 'c3'));
  assert.match(toolText(foreignStop), /another project/);
});

test('a run cannot cross projects: foreign task dispatch and chief steering are refused', async (t) => {
  const f = fixture(t);
  const runtime: WorkerRuntime = {
    create: () => Promise.reject(new Error('no workers here')),
    get: () => Promise.reject(new Error('no workers here')),
  };
  const runs = new RunOrchestrator(
    f.db,
    f.scopes,
    runtime,
    f.root,
    () => {},
    async () => {},
  );
  const ext = managerExtension({
    ...f.deps,
    dispatch: (input) => runs.dispatch(input),
  });
  const dispatch = ext.tools!.find((entry) => entry.name === 'dispatch')!;
  const foreignTask = f.db.insertTask({
    scopeId: 'p-2',
    title: "beta's task",
  });
  const refused = await (dispatch as unknown as ExecutableTool).execute(
    { prompt: 'migrate the schema', task: foreignTask.id },
    api('mgr-conv'),
  );
  assert.match(
    toolText(refused),
    new RegExp(`task #${foreignTask.id} belongs to p-2`),
  );
  // The chief may read a manager-owned run but not steer it.
  const mgrRun = addRun(f.db, {
    projectId: 'p-1',
    chiefConversationId: 'mgr-conv',
  });
  const steered = await f
    .chiefTool('send_run_msg')
    .execute({ run: mgrRun.id, body: 'stop' }, api('chief-conv'));
  assert.match(toolText(steered), /send_manager_msg/);
});

test('manager memory writes are locked to its own project', async (t) => {
  const f = fixture(t);
  const ok = await f
    .tool('remember')
    .execute({ text: 'release branch is cut on Mondays' }, api(f.managerConv));
  assert.match(toolText(ok), /\[p-1\]/);
  // The write tools have no scope or target: extra arguments change nothing.
  await f
    .tool('remember')
    .execute(
      { text: 'beta uses pnpm', scope: 'p-2', target: 'global' },
      api(f.managerConv, 'c2'),
    );
  assert.deepEqual(
    f.scopes
      .memory('p-1')
      .dump()
      .items.map((item) => item.content),
    ['release branch is cut on Mondays', 'beta uses pnpm'],
  );
  assert.equal(f.scopes.memory('global').dump().items.length, 0);
  assert.equal(f.scopes.memory('p-2').dump().items.length, 0);
  // General is read-only context: readable, marked, and never a write target.
  f.scopes.memory('global').remember({ text: 'Tian likes dark mode' });
  const general = await f
    .tool('recall')
    .execute({ query: 'dark mode', scope: 'global' }, api(f.managerConv));
  assert.match(toolText(general), /read-only, kept by the chief/);
  assert.match(toolText(general), /Tian likes dark mode/);
  await f
    .tool('forget')
    .execute({ seq: 0, reason: 'test' }, api(f.managerConv, 'c3'));
  assert.equal(f.scopes.memory('global').dump().items[0].status, 'active');
  assert.equal(f.scopes.memory('p-1').dump().items[0].status, 'deleted');
  const other = await f
    .tool('recall')
    .execute({ query: 'pnpm', scope: 'beta' }, api(f.managerConv));
  assert.match(toolText(other), /only this project's and global memory/);
});

test("the manager's Core holds General and its project; the chief's holds General only", async (t) => {
  const f = fixture(t);
  f.scopes
    .memory('global')
    .remember({ text: 'Tian prefers Chinese', core: true });
  f.scopes
    .memory('p-1')
    .remember({ text: 'alpha ships on Fridays', core: true });
  const managerCore = managerExtension(f.deps).sections?.find(
    (entry) => entry.key === 'memory',
  );
  assert.ok(managerCore);
  const managed = String(
    await managerCore.render(
      { conversationId: f.managerConv } as never,
      {} as never,
    ),
  );
  assert.match(managed, /\[global\][\s\S]*Tian prefers Chinese/);
  assert.match(managed, /\[project: alpha\][\s\S]*alpha ships on Fridays/);
  const chief = chiefSurface(f);
  const chiefCore = String(await chief.memory('chief-conv'));
  assert.match(chiefCore, /Tian prefers Chinese/);
  assert.doesNotMatch(chiefCore, /alpha ships on Fridays/);
});
test('manager history stays inside its own project', async (t) => {
  const f = fixture(t);
  await f
    .tool('search_history')
    .execute({ query: 'deploy' }, api(f.managerConv));
  assert.deepEqual(
    f.searches.map((s) => s.scopeId),
    ['p-1'],
  );
  f.db.mapConversation('chief-other', 'p-2');
  const refused = await f
    .tool('read_history')
    .execute({ ref: 'conv:chief-other#1' }, api(f.managerConv));
  assert.match(toolText(refused), /another scope/);
  const own = await f
    .tool('read_history')
    .execute({ ref: 'conv:mgr-conv#1' }, api(f.managerConv));
  assert.match(toolText(own), /content of conv:mgr-conv#1/);
});

test('manager dispatch always targets its own project as the supervising conversation', async (t) => {
  const f = fixture(t);
  const result = await f
    .tool('dispatch')
    .execute({ prompt: 'migrate the schema' }, api(f.managerConv));
  assert.match(toolText(result), /r-dispatched/);
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0].projectRef, 'p-1');
  assert.equal(f.dispatched[0].chiefConversationId, 'mgr-conv');
});

test('manager dispatch forwards a pinned model and thinking level', async (t) => {
  const f = fixture(t);
  const result = await f.tool('dispatch').execute(
    {
      prompt: 'migrate the schema',
      model: 'deep/pro',
      thinking_level: 'high',
    },
    api(f.managerConv),
  );
  assert.equal(f.dispatched[0].model, 'deep/pro');
  assert.equal(f.dispatched[0].thinkingLevel, 'high');
  assert.match(toolText(result), /model deep\/pro think:high/);
});

// ---- manager names (D14) ----------------------------------------------------

/** The chief extension's <state> and list_scopes, rendered for a conversation. */
function chiefSurface(f: Fixture) {
  const chief = chiefExtension({
    scopes: f.scopes,
    db: f.db,
    data: f.data,
    goals: new GoalStore(f.db),
    improvements: new ImprovementStore(f.db),
    latestInputEntry: async () => null,
    currentInput: async () => null,
    openGoalConversation: async () => 'goal-conv',
    emitUpdates: () => {},
    emitImprovements: () => {},
    emitNotices: () => {},
    dispatch: () => Promise.reject(new Error('not used')),
    runReport: () => '',
    runDiff: async () => '',
    runProgress: async () => {
      throw new Error('not used');
    },
    stopRun: async () => {
      throw new Error('not used');
    },
    sendRunMessage: () => {
      throw new Error('not used');
    },
    runMessages: () => [],
    delegateToManager: () => Promise.reject(new Error('not used')),
    sendManagerMessage: () => Promise.reject(new Error('not used')),
    managerMessages: (projectId) => f.data.managerMessages(projectId),
    workerModels: () => [],
    history: {
      db: f.db,
      events: new EventLog(f.db),
      history: {} as HistoryIndex,
    },
  });
  const state = chief.sections?.find((entry) => entry.key === 'state');
  if (!state) throw new Error('Missing state section');
  const memory = chief.sections?.find((entry) => entry.key === 'memory');
  if (!memory) throw new Error('Missing memory section');
  const listScopes = chief.tools?.find((entry) => entry.name === 'list_scopes');
  if (!listScopes) throw new Error('Missing list_scopes');
  return {
    state: (conversationId: string) =>
      String(state.render({ conversationId } as never, {} as never) as unknown),
    memory: async (conversationId: string) =>
      String(await memory.render({ conversationId } as never, {} as never)),
    listScopes: async () =>
      toolText(
        await (listScopes as unknown as ExecutableTool).execute(
          {},
          api('chief-conv'),
        ),
      ),
  };
}

test('every project lists its manager by name in <state> and list_scopes', async (t) => {
  const f = fixture(t);
  const chief = chiefSurface(f);
  const state = await chief.state('chief-conv');
  assert.match(state, /- alpha \(.*\) — manager: 阿七/);
  assert.match(state, /- beta \(.*\) — manager: 小七/);
  // The current scope header carries the manager too.
  assert.match(state, /scope: alpha \(.*\) — manager: 阿七/);
  const scopes = await chief.listScopes();
  assert.match(scopes, /alpha \(.*\) — manager: 阿七/);
  assert.match(scopes, /beta \(.*\) — manager: 小七/);
  assert.doesNotMatch(state, /无|未配置|未命名/);
});
test('list_manager_msgs names the manager instead of a bare (no messages)', async (t) => {
  const f = fixture(t);
  const named = await f
    .chiefTool('list_manager_msgs')
    .execute({ project: 'alpha' }, api('chief-conv'));
  assert.match(toolText(named), /no messages with 阿七 yet/);
  const unknown = await f
    .chiefTool('list_manager_msgs')
    .execute({ project: 'eta' }, api('chief-conv'));
  assert.match(toolText(unknown), /Unknown project: eta/);
});
// ---- manager_name storage (D14) -------------------------------------------

test('a v6 database gains a manager_name, backfilled from the project name', (t) => {
  const root = temporary(t);
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const legacy = new DatabaseSync(join(dataDir, 'tian.db'));
  // The projects table as the previous release created it (no manager_name).
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
      auto_land INTEGER NOT NULL DEFAULT 0, allow_in_place INTEGER NOT NULL DEFAULT 0,
      agent_kind TEXT NOT NULL DEFAULT 'durable-worker', run_timeout_min INTEGER NOT NULL DEFAULT 30,
      base_branch TEXT NOT NULL DEFAULT 'main', prompt_preamble TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    INSERT INTO projects (id,name,root_path,created_at) VALUES
      ('p-old','legacy','/tmp/legacy','2026-01-01T00:00:00.000Z');
    PRAGMA user_version = 6;
  `);
  legacy.close();

  const db = new Db(dataDir);
  assert.equal(
    (db.sqlite.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version,
    DATABASE_VERSION,
  );
  const migrated = db.getProject('p-old')!;
  assert.equal(migrated.name, 'legacy');
  assert.equal(migrated.rootPath, '/tmp/legacy');
  // D18: every project has a named manager; old rows take the project name.
  assert.equal(migrated.managerName, 'legacy');
  db.updateProject('p-old', { managerName: '阿七' });
  db.close();

  // Reopening at the current version is a no-op and keeps the name.
  const reopened = new Db(dataDir);
  t.after(() => reopened.close());
  assert.equal(reopened.getProject('p-old')?.managerName, '阿七');
  assert.ok(
    (
      reopened.sqlite.prepare('PRAGMA table_info(projects)').all() as {
        name: string;
      }[]
    ).some((column) => column.name === 'manager_name'),
  );
  const backup = new DatabaseSync(join(dataDir, 'tian.db_v6.backup'), {
    readOnly: true,
  });
  try {
    assert.equal(
      (
        backup.prepare('PRAGMA table_info(projects)').all() as {
          name: string;
        }[]
      ).length,
      10,
    );
  } finally {
    backup.close();
  }
});

test('adding a project requires a manager name and opens its manager', async (t) => {
  const f = await serviceFixture(t);
  const service = f.service as unknown as {
    addProject: (
      name: string,
      rootPath: string,
      managerName: string,
    ) => Promise<{ id: string; name: string; managerName?: string }[]>;
    updateProject: (
      id: string,
      patch: { managerName?: string },
    ) => Promise<{ id: string; name: string; managerName?: string }[]>;
    removeProject: (id: string) => Promise<unknown>;
    listScopes: () => { id: string; name: string; managerName?: string }[];
  };
  const projectDir = join(f.root, 'named');
  mkdirSync(projectDir, { recursive: true });
  await assert.rejects(
    service.addProject('named', projectDir, '   '),
    /needs a manager name/,
  );
  assert.equal(
    service.listScopes().some((scope) => scope.name === 'named'),
    false,
  );
  const added = await service.addProject('named', projectDir, '  阿七  ');
  const created = added.find((scope) => scope.name === 'named')!;
  // Trimmed on write, and the manager exists from the start.
  assert.equal(created.managerName, '阿七');
  const manager = f.db.managerConversation(created.id);
  assert.ok(manager);
  assert.equal(manager.role, 'manager');
  // A blank rename keeps the name: a manager is never unnamed.
  const kept = await service.updateProject(created.id, { managerName: '   ' });
  assert.equal(
    kept.find((scope) => scope.id === created.id)!.managerName,
    '阿七',
  );
  const renamed = await service.updateProject(created.id, {
    managerName: '小七',
  });
  assert.equal(
    renamed.find((scope) => scope.id === created.id)!.managerName,
    '小七',
  );
  // An untouched manager goes with its project.
  await service.removeProject(created.id);
  assert.equal(f.db.getProject(created.id), undefined);
  assert.equal(f.db.managerConversation(created.id), undefined);
  assert.equal(
    f.db
      .listConversations()
      .some((row) => row.conversationId === manager.conversationId),
    false,
  );
});

test('service start gives every older project its manager', async (t) => {
  const f = await serviceFixture(t);
  // serviceFixture inserts p-1 straight into the database after start.
  assert.equal(f.db.managerConversation('p-1'), undefined);
  await (
    f.server.service as unknown as { ensureManagers(): Promise<void> }
  ).ensureManagers();
  assert.equal(f.db.managerConversation('p-1')?.role, 'manager');
});

// ---- Tian turns -------------------------------------------------------------

test('in a Tian turn ask_chief returns guidance without a message or wake', async (t) => {
  const f = fixture(t);
  f.turn = { entryId: '9', kind: 'user', text: 'should we switch to pnpm?' };
  const result = await f
    .tool('ask_chief')
    .execute({ question: 'should we switch to pnpm?' }, api(f.managerConv));
  assert.doesNotMatch(toolText(result), /isError/);
  assert.match(toolText(result), /ask him in your reply/);
  assert.equal(f.data.managerMessages('p-1').length, 0);
  assert.equal(f.wakes.length, 0);
});

test('in a Tian turn report_chief is blocked except on a delegated task', async (t) => {
  const f = fixture(t);
  f.turn = { entryId: '9', kind: 'user', text: 'how is the release going?' };
  // No task: guidance, nothing written, nobody woken.
  const bare = await f
    .tool('report_chief')
    .execute({ text: 'release is on track' }, api(f.managerConv));
  assert.doesNotMatch(toolText(bare), /isError/);
  assert.match(toolText(bare), /answer him in your reply/);
  // The manager's own task: still just guidance.
  const own = f.db.insertTask({ scopeId: 'p-1', title: 'own cleanup' });
  const ownReport = await f
    .tool('report_chief')
    .execute({ text: 'cleanup done', task: own.id }, api(f.managerConv));
  assert.match(toolText(ownReport), /answer him in your reply/);
  assert.equal(f.data.managerMessages('p-1').length, 0);
  assert.equal(f.wakes.length, 0);
  // A chief-delegated task keeps reporting up even during a Tian turn.
  const delegated = delegatedTask(f);
  const ok = await f
    .tool('report_chief')
    .execute(
      { text: 'main is green again', task: delegated.id },
      api(f.managerConv),
    );
  assert.match(toolText(ok), /reported to the chief/);
  const reports = f.data.managerMessages('p-1');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, 'report');
  assert.equal(reports[0].taskId, delegated.id);
  assert.equal(f.wakes.length, 1);
  assert.equal(f.wakes[0].target, 'chief-conv');
  assert.equal(f.wakes[0].taskId, delegated.id);
});

test('a task the manager adds and closes in a Tian turn stays silent', async (t) => {
  const f = fixture(t);
  f.turn = { entryId: '9', kind: 'user', text: 'tidy the notes folder' };
  const added = await f
    .tool('add_task')
    .execute({ title: 'tidy the notes folder' }, api(f.managerConv));
  const id = Number(/task #(\d+) added/.exec(toolText(added))?.[1]);
  await f.tool('start_task').execute({ task: id }, api(f.managerConv));
  await f
    .tool('complete_task')
    .execute({ task: id, outcome: 'achieved' }, api(f.managerConv));
  const done = f.db.getTask(id);
  assert.equal(done?.status, 'completed');
  assert.equal(done?.assignee, null);
  assert.equal(f.wakes.length, 0);
});

test('a Tian turn still reports up when a delegated task closes', async (t) => {
  const f = fixture(t);
  f.turn = { entryId: '9', kind: 'user', text: 'also, wrap up that task' };
  const task = delegatedTask(f);
  await f.tool('start_task').execute({ task: task.id }, api(f.managerConv));
  await f
    .tool('complete_task')
    .execute({ task: task.id, outcome: 'achieved' }, api(f.managerConv));
  const wake = f.wakes.find((w) => w.id.startsWith('mtask:'));
  assert.ok(wake);
  assert.equal(wake.target, 'chief-conv');
  assert.equal(wake.taskId, task.id);
});

test('remember source:user in a Tian turn stores user_confirmed', async (t) => {
  const f = fixture(t);
  f.turn = { entryId: '9', kind: 'user', text: '我们周五发布' };
  const result = await f
    .tool('remember')
    .execute({ text: '我们周五发布', source: 'user' }, api(f.managerConv));
  assert.match(toolText(result), /user-confirmed/);
  const row = f.db.sqlite
    .prepare('SELECT trust_level, source_ref FROM memories WHERE seq = 0')
    .get() as { trust_level: string; source_ref: string };
  assert.equal(row.trust_level, 'user_confirmed');
  assert.equal(row.source_ref, `conv:${f.managerConv}#9`);
});

// ---- service-level tests ----------------------------------------------------

interface ServiceFixture {
  server: ResidentServer;
  service: {
    delegateToManager: (input: {
      projectId: string;
      chiefConversationId: string;
      title: string;
      briefing: string;
      goalId?: string | null;
      operationId: string;
    }) => Promise<{ task: TaskRow; message: ManagerMessageRow }>;
    sendManagerMessage: (input: {
      projectId: string;
      body: string;
      replyTo?: number;
      taskId?: number;
      operationId: string;
    }) => Promise<{
      message: ManagerMessageRow;
      delivered: 'waiting' | 'woken';
    }>;
    openManager: (projectId: string) => Promise<{ role: string }>;
  };
  db: Db;
  root: string;
}

async function serviceFixture(t: TestContext): Promise<ServiceFixture> {
  const root = mkdtempSync('/tmp/tian-manager-svc-');
  const paths = {
    ...servicePaths(join(root, 'data')),
    socketPath: join(root, 'agent.sock'),
  };
  const server = new ResidentServer(paths);
  await server.start();
  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const db = server.service.db;
  const projectDir = join(root, 'project-a');
  mkdirSync(projectDir, { recursive: true });
  db.addProject({
    id: 'p-1',
    name: 'alpha',
    rootPath: projectDir,
    autoLand: 0,
    allowInPlace: 1,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: '阿七',
  });
  const service = server.service as unknown as ServiceFixture['service'];
  return { server, service, db, root };
}

const managerWakes = (f: ServiceFixture) => {
  const conversationId = f.db.managerConversation('p-1')?.conversationId;
  if (!conversationId) return [];
  return f.db.sqlite
    .prepare('SELECT * FROM notifications WHERE conversation_id = ?')
    .all(conversationId) as { id: string; content: string }[];
};

test('delegate creates a delegated task, one manager wake, and is replay-safe', async (t) => {
  const f = await serviceFixture(t);
  // A manager exists only once it is opened; a project row alone has none.
  await f.service.openManager('p-1');
  const goal = new GoalStore(f.db).insertGoal({
    scopeId: 'p-1',
    objective: 'keep main green',
  });
  const input = {
    projectId: 'p-1',
    chiefConversationId: 'chief-conv',
    title: 'keep main green',
    briefing: 'triage CI failures daily',
    goalId: goal.id,
    operationId: 'op-delegate-1',
  };
  const { task, message } = await f.service.delegateToManager(input);
  assert.equal(task.scopeId, 'p-1');
  assert.equal(task.owner, 'agent');
  assert.equal(task.assignee, 'manager');
  assert.equal(task.reportTo, 'chief-conv');
  assert.equal(task.goalId, goal.id);
  assert.equal(task.dedupeKey, 'delegate:op-delegate-1');
  assert.equal(message.kind, 'delegation');
  assert.equal(message.sender, 'chief');
  assert.equal(message.taskId, task.id);
  // The manager conversation is bound and got exactly one wake.
  const binding = f.db.managerConversation('p-1');
  assert.ok(binding);
  assert.equal(managerWakes(f).length, 1);
  assert.match(managerWakes(f)[0].content, /delegated task #\d+ from chief/);
  // Replaying the same operation returns the same task, still one wake.
  const replay = await f.service.delegateToManager(input);
  assert.equal(replay.task.id, task.id);
  assert.equal(replay.message.id, message.id);
  assert.equal(managerWakes(f).length, 1);
});

test('a reply_to answer while the question is open does not wake; a late one does', async (t) => {
  const f = await serviceFixture(t);
  await f.service.openManager('p-1');
  const question = f.db.addManagerMessage({
    id: 'mm:p-1:q1',
    projectId: 'p-1',
    sender: 'manager',
    kind: 'question',
    body: 'npm or private?',
  });
  // reply_to must point at a question row.
  await assert.rejects(
    f.service.sendManagerMessage({
      projectId: 'p-1',
      body: 'x',
      replyTo: 999,
      operationId: 'op-bad',
    }),
    /not a manager question/,
  );
  // While the manager still waits, the answer is picked up — no wake.
  const waiting = await f.service.sendManagerMessage({
    projectId: 'p-1',
    body: 'private for now',
    replyTo: question.seq,
    operationId: 'op-ans-1',
  });
  assert.equal(waiting.delivered, 'waiting');
  assert.equal(waiting.message.kind, 'answer');
  assert.equal(waiting.message.replyTo, question.id);
  assert.equal(managerWakes(f).length, 0);
  // After the question closed (timeout), an answer wakes the manager once.
  f.db.closeManagerQuestion('p-1', question.id);
  const late = await f.service.sendManagerMessage({
    projectId: 'p-1',
    body: 'actually, ship it',
    replyTo: question.seq,
    operationId: 'op-ans-2',
  });
  assert.equal(late.delivered, 'woken');
  const wakes = managerWakes(f);
  assert.equal(wakes.length, 1);
  assert.match(wakes[0].content, /answers your earlier question/);
  assert.match(wakes[0].content, /ship it/);
});
