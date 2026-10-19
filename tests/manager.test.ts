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
  dispatched: { projectRef: string; chiefConversationId: string | null }[];
  searches: { scopeId: string | null }[];
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
  });
  scopes.ensureDirs('p-1');
  scopes.ensureDirs('p-2');
  const events = new EventLog(db);
  const wakes: Wake[] = [];
  const dispatched: Fixture['dispatched'] = [];
  const searches: Fixture['searches'] = [];

  const deps: ManagerDeps = {
    scopes,
    db,
    data,
    goals: new GoalStore(db),
    emitUpdates: () => {},
    latestInputEntry: async () => null,
    currentInput: async () => null,
    dispatch: async (input) => {
      dispatched.push(input);
      return addRun(db, {
        id: 'r-dispatched',
        projectId: input.projectRef,
        chiefConversationId: input.chiefConversationId,
      });
    },
    runReport: () => 'the report',
    runDiff: async () => 'the diff',
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
        runReport: () => '',
        runDiff: async () => '',
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
  const other = await f
    .tool('remember')
    .execute({ text: 'beta uses pnpm', scope: 'p-2' }, api(f.managerConv));
  assert.match(toolText(other), /only this project/);
  const global = await f
    .tool('remember')
    .execute(
      { text: 'Tian likes dark mode', target: 'global' },
      api(f.managerConv),
    );
  assert.match(toolText(global), /only this project/);
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
  };
  db: Db;
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
  });
  const service = server.service as unknown as ServiceFixture['service'];
  return { server, service, db };
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
