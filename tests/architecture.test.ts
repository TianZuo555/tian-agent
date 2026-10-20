import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as Git from '../src/worker/dispatch';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { MemoryStore } from '../src/worker/memory';
import { Db, type RunRow } from '../src/worker/db';
import { Scopes } from '../src/worker/scopes';
import { GoalStore } from '../src/worker/goals';
import { ImprovementStore } from '../src/worker/improvements';
import { DataService } from '../src/worker/data';
import { AgentRuntime } from '../src/worker/agents';
import { Settings } from '../src/worker/settings';
import { EventLog } from '../src/worker/events';
import { HistoryIndex } from '../src/worker/history';
import { chiefExtension } from '../src/worker/tools';
import { workerExtension } from '../src/worker/worker-tools';
import {
  RunOrchestrator,
  type WorkerConversation,
  type WorkerRuntime,
} from '../src/worker/runs';
import { validateCommand } from '../src/shared/contracts';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-architecture-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition did not settle');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
type Outcome = { status: 'done' | 'unanswered'; reason?: string };
interface FakeRecord {
  run: RunRow;
  submissions: Map<string, ReturnType<typeof deferred<Outcome>>>;
  aborted: boolean;
}
class FakeRuntime implements WorkerRuntime {
  readonly closed = deferred<Outcome>();
  constructor(readonly records = new Map<string, FakeRecord>()) {}
  async create(run: RunRow): Promise<WorkerConversation> {
    const id = `worker-${this.records.size + 1}`;
    this.records.set(id, { run, submissions: new Map(), aborted: false });
    return this.get(id);
  }
  async get(id: string): Promise<WorkerConversation> {
    const record = this.records.get(id);
    if (!record) throw new Error(`No worker ${id}`);
    return {
      id,
      submit: async (_prompt, requestId) => {
        let submission = record.submissions.get(requestId);
        if (!submission) {
          submission = deferred<Outcome>();
          record.submissions.set(requestId, submission);
        }
        return {
          wait: () => Promise.race([submission.promise, this.closed.promise]),
        };
      },
      abort: async () => {
        record.aborted = true;
        for (const submission of record.submissions.values())
          submission.resolve({ status: 'unanswered', reason: 'aborted' });
      },
      lastText: async () => 'Worker report',
    };
  }
  complete(id: string, outcome: Outcome = { status: 'done' }): void {
    for (const submission of this.records.get(id)!.submissions.values())
      submission.resolve(outcome);
  }
  stopWaits(): void {
    this.closed.resolve({ status: 'unanswered', reason: 'runtime stopped' });
  }
}
async function fixture(
  t: TestContext,
  options: { git?: boolean; base?: string; allowInPlace?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'tian-architecture-'));
  const projectPath = join(directory, 'project');
  const userData = join(directory, 'data');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'base.txt'), 'base\n');
  if (options.git !== false) {
    const git = (args: string[]) =>
      execFileSync('git', ['-C', projectPath, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['add', 'base.txt']);
    git([
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@local',
      'commit',
      '-m',
      'initial',
    ]);
    git(['config', 'user.name', 'test']);
    git(['config', 'user.email', 'test@local']);
  }
  const db = new Db(userData);
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: Number(options.allowInPlace ?? false),
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: options.base ?? 'main',
    promptPreamble: '',
  });
  const scopes = new Scopes(join(userData, 'global'), db);
  const runtime = new FakeRuntime();
  const events: string[] = [];
  const runs = new RunOrchestrator(
    db,
    scopes,
    runtime,
    userData,
    (channel) => events.push(channel),
    async () => {},
  );
  t.after(async () => {
    runs.pause();
    runtime.stopWaits();
    await runs.join();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    projectPath,
    userData,
    db,
    scopes,
    runtime,
    runs,
    events,
  };
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Do work',
    chiefConversationId: null,
  });
  await until(() => f.db.getRun(run.id)?.status === 'running');
  return f.db.getRun(run.id)!;
}

test('IPC rejects unknown fields, unsupported workers, and invalid settings', () => {
  assert.throws(() =>
    validateCommand('updateProject', ['p1', { autoLand: 1 }]),
  );
  assert.throws(() =>
    validateCommand('updateProject', ['p1', { agentKind: 'arbitrary-shell' }]),
  );
  assert.throws(() =>
    validateCommand('updateProject', ['p1', { runTimeoutMin: 0 }]),
  );
  assert.throws(() =>
    validateCommand('updateProject', ['p1', { unexpected: true }]),
  );
  assert.throws(() => validateCommand('__proto__', []));
  assert.throws(() =>
    validateCommand('addImprovement', [
      'global',
      'bug',
      'Not a known kind',
      '',
      'medium',
    ]),
  );
  assert.throws(() =>
    validateCommand('setImprovementStatus', ['entry', 'promoted']),
  );
  assert.throws(() =>
    validateCommand('reportClientIssue', ['', 'empty summaries are invalid']),
  );
  assert.doesNotThrow(() =>
    validateCommand('addImprovement', [
      'global',
      'issue',
      'A useful summary',
      'Detail',
      'high',
    ]),
  );
  assert.doesNotThrow(() =>
    validateCommand('setImprovementStatus', ['entry', 'resolved']),
  );
  assert.doesNotThrow(() =>
    validateCommand('updateProject', [
      'p1',
      { autoLand: true, allowInPlace: false },
    ]),
  );
});

test('memory persists, supports recall and explicit Core selection, and validates length', (t) => {
  const path = temporary(t);
  const db = new Db(path);
  t.after(() => db.close());
  const memory = new MemoryStore(db, 'global', path);
  assert.doesNotThrow(() => memory.remember({ text: '中'.repeat(94) }));
  assert.throws(() => memory.remember({ text: '中'.repeat(1001) }), /1000/);
  const first = memory.remember({ text: 'Tian prefers Chinese' });
  memory.remember({ text: 'Project uses Electron' });
  memory.select(first.memory.seq, 'user');
  const reopened = new MemoryStore(db, 'global', path);
  assert.match(reopened.wake(), /Tian prefers Chinese/);
  assert.match(reopened.recall('Electron'), /Project uses Electron/);
  assert.equal(reopened.coreUsage().selected, 1);
});

test('UI and agent application operations emit updates; task operation IDs deduplicate', async (t) => {
  const f = await fixture(t);
  const data = new DataService(f.db, f.scopes, (channel) =>
    f.events.push(channel),
  );
  const id = data.addTask('p1', 'Task', null, 'tool-call-1');
  assert.equal(data.addTask('p1', 'Task', null, 'tool-call-1'), id);
  assert.equal(f.db.listTasks('p1').length, 1);
  data.doneTask(id, true);
  data.remember('p1', 'A durable fact');
  data.remember('p1', 'A second fact');
  assert.equal(f.db.listTasks('p1')[0].status, 'completed');
  assert.equal(f.events.filter((event) => event === 'memory').length, 2);
  assert.equal(f.events.filter((event) => event === 'tasks').length, 3);
});

test('inbox imports all files, persists read IDs, and does not mark later messages read', async (t) => {
  const f = await fixture(t);
  const one = f.scopes.sendMessage('p1', 'external', 'one');
  const two = f.scopes.sendMessage('p1', 'external', 'two');
  const captured = f.scopes.unreadMessages('p1');
  const three = f.scopes.sendMessage('p1', 'external', 'three');
  f.scopes.markInboxRead(
    'p1',
    captured.map((message) => message.id),
  );
  assert.deepEqual(
    f.scopes.unreadMessages('p1').map((message) => message.id),
    [three],
  );
  const another = new Scopes(join(f.userData, 'global'), f.db);
  assert.equal(another.listMessages('p1').length, 3);
  assert.ok(
    another
      .listMessages('p1')
      .filter((message) => [one, two].includes(message.id))
      .every((message) => message.read),
  );
});

test('chief and worker capabilities remain separate, including previously contaminated chief conversations', async (t) => {
  const f = await fixture(t);
  const settings = new Settings(f.userData);
  const data = new DataService(f.db, f.scopes, () => {});
  const events = new EventLog(f.db);
  let agents = new AgentRuntime(
    f.userData,
    f.scopes.root('global'),
    settings,
    f.db,
  );
  const history = new HistoryIndex(f.db, agents, events);
  const extension = chiefExtension({
    scopes: f.scopes,
    db: f.db,
    data,
    latestInputEntry: async () => null,
    currentInput: async () => null,
    history: { db: f.db, events, history },
    goals: new GoalStore(f.db),
    improvements: new ImprovementStore(f.db),
    openGoalConversation: (goalId) => Promise.resolve(`goal-conv-${goalId}`),
    emitUpdates: () => {},
    emitImprovements: () => {},
    emitNotices: () => {},
    dispatch: (input) => f.runs.dispatch(input),
    workerModels: () => [],
    runReport: (id) => f.runs.report(id),
    runDiff: (id) => f.runs.diff(id),
    sendRunMessage: (runId, body, operationId) =>
      data.sendRunMessage(runId, body, operationId),
    runMessages: (runId) => data.runMessages(runId),
    delegateToManager: () => Promise.reject(new Error('not used here')),
    sendManagerMessage: () => Promise.reject(new Error('not used here')),
    managerMessages: () => [],
  });
  const worker = workerExtension({ db: f.db, wake: async () => {} });
  await agents.open(extension, worker);
  const chief = await agents.createChief(f.projectPath);
  f.db.mapConversation(String(chief.id), 'p1');
  const names = (await chief.agent(BACKGROUND_CONTEXT)).tools.map(
    (tool) => tool.name,
  );
  assert.ok(names.includes('read_run_report'));
  assert.ok(names.includes('remember'));
  assert.ok(names.includes('revise'));
  assert.ok(names.includes('forget'));
  for (const tool of ['bash', 'read', 'write', 'edit'])
    assert.ok(!names.includes(tool));
  await chief.configure({ extensions: [CodingTools] }, BACKGROUND_CONTEXT);
  await agents.close();
  agents = new AgentRuntime(
    f.userData,
    f.scopes.root('global'),
    settings,
    f.db,
  );
  await agents.open(extension, worker);
  try {
    const restored = await agents.conversation(String(chief.id));
    assert.ok(
      !(await restored.agent(BACKGROUND_CONTEXT)).tools.some(
        (tool) => tool.name === 'bash',
      ),
    );
    const run: RunRow = {
      id: 'test',
      projectId: 'p1',
      rootPath: f.projectPath,
      baseBranch: 'main',
      prompt: 'test',
      currentPrompt: 'test',
      agentKind: 'durable-worker',
      conversationId: null,
      chiefConversationId: null,
      executionMode: 'in-place',
      worktreePath: null,
      branch: null,
      status: 'queued',
      reviewStatus: 'pending',
      attempt: 1,
      error: null,
      prUrl: null,
      reportPath: null,
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const worker = await agents.create(run);
    const workerNames = (
      await (await agents.conversation(worker.id)).agent(BACKGROUND_CONTEXT)
    ).tools.map((tool) => tool.name);
    assert.deepEqual(workerNames.sort(), [
      'ask_chief',
      'bash',
      'check_msgs',
      'edit',
      'read',
      'tell_chief',
      'write',
    ]);
    // The chief keeps its narrow envelope: no coding, no worker messaging.
    const chiefNames = (await restored.agent(BACKGROUND_CONTEXT)).tools.map(
      (tool) => tool.name,
    );
    assert.ok(chiefNames.includes('send_run_msg'));
    assert.ok(!chiefNames.includes('ask_chief'));
    assert.ok(!chiefNames.includes('bash'));
  } finally {
    await agents.close();
  }
});

test('missing base branch fails without editing the main checkout or spawning a worker', async (t) => {
  const f = await fixture(t, { base: 'does-not-exist' });
  await assert.rejects(
    f.runs.dispatch({
      projectRef: 'p1',
      prompt: 'change base.txt',
      chiefConversationId: null,
    }),
    /worktree/,
  );
  assert.equal(f.runtime.records.size, 0);
  assert.equal(readFileSync(join(f.projectPath, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(f.db.listRuns(null)[0].status, 'failed');
});

test('non-Git execution requires an explicit project setting', async (t) => {
  const f = await fixture(t, { git: false });
  await assert.rejects(
    f.runs.dispatch({
      projectRef: 'p1',
      prompt: 'work',
      chiefConversationId: null,
    }),
    /Explicitly enable/,
  );
  assert.equal(f.db.listRuns(null).length, 0);
  f.db.updateProject('p1', { allowInPlace: 1 });
  const run = await start(f);
  assert.equal(run.executionMode, 'in-place');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
});

test('dispatch operation IDs produce one run and one worker', async (t) => {
  const f = await fixture(t);
  const input = {
    projectRef: 'p1',
    prompt: 'work',
    chiefConversationId: null,
    operationId: 'stable-call',
  };
  const [a, b] = await Promise.all([
    f.runs.dispatch(input),
    f.runs.dispatch(input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(f.db.listRuns(null).length, 1);
  assert.equal(f.runtime.records.size, 1);
});

test('a repeated identical dispatch reuses the in-flight run', async (t) => {
  const f = await fixture(t);
  const first = await start(f);
  // A double-fired call — different operation id, same dispatcher, project
  // and briefing — folds into the active run instead of stacking a worker.
  const second = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Do work',
    chiefConversationId: null,
    operationId: 'dispatch:another-call',
  });
  assert.equal(second.id, first.id);
  assert.equal(f.db.listRuns(null).length, 1);
  assert.equal(f.runtime.records.size, 1);
  // A different briefing, or a different dispatcher, is a different run.
  const other = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Other work',
    chiefConversationId: null,
  });
  assert.notEqual(other.id, first.id);
  const another = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Do work',
    chiefConversationId: 'chief-2',
  });
  assert.notEqual(another.id, first.id);
  // Once the run settles the same briefing may be sent again.
  f.runtime.complete(first.conversationId!);
  await until(() => f.db.getRun(first.id)?.status === 'done');
  const retry = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Do work',
    chiefConversationId: null,
  });
  assert.notEqual(retry.id, first.id);
  f.runtime.complete(retry.conversationId!);
  f.runtime.complete(other.conversationId!);
  f.runtime.complete(another.conversationId!);
});

test('stop interrupts a running worker but keeps the run for review', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(join(run.worktreePath!, 'partial.txt'), 'in progress\n');
  await f.runs.stop(run.id);
  const stopped = f.db.getRun(run.id)!;
  assert.equal(stopped.status, 'interrupted');
  assert.equal(stopped.error, 'Stopped by Tian');
  assert.notEqual(stopped.finishedAt, null);
  assert.equal(stopped.reviewStatus, 'pending');
  assert.equal(f.runtime.records.get(run.conversationId!)!.aborted, true);
  // The collector must not resurrect the run; the worktree stays for review.
  await f.runs.join();
  assert.equal(f.db.getRun(run.id)!.status, 'interrupted');
  assert.equal(existsSync(run.worktreePath!), true);
  assert.equal(f.db.pendingNotifications().length, 1);
  // A settled run ignores another stop but accepts a follow-up.
  const again = await f.runs.stop(run.id);
  assert.equal(again.status, 'interrupted');
  await f.runs.followUp(run.id, 'continue');
  await until(
    () => f.runtime.records.get(run.conversationId!)!.submissions.size === 2,
  );
});

test('stop before launch never spawns a worker', async (t) => {
  const f = await fixture(t);
  f.runs.pause();
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'queued work',
    chiefConversationId: null,
  });
  assert.equal(f.db.getRun(run.id)!.status, 'queued');
  await f.runs.stop(run.id);
  assert.equal(f.db.getRun(run.id)!.status, 'interrupted');
  for (const record of f.runtime.records.values())
    assert.equal(record.submissions.size, 0);
});

test('completion commits the worktree, records report and one durable notification, and lands once', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(join(run.worktreePath!, 'changed.txt'), 'worker change\n');
  writeFileSync(join(run.worktreePath!, 'TIAN_REPORT.md'), 'Changed a file');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  assert.equal(existsSync(join(f.projectPath, 'changed.txt')), false);
  assert.match(await f.runs.diff(run.id), /worker change/);
  assert.equal(f.runs.report(run.id), 'Changed a file');
  assert.equal(f.db.pendingNotifications().length, 1);
  await f.runs.land(run.id);
  assert.equal(f.db.getRun(run.id)?.reviewStatus, 'landed');
  assert.equal(existsSync(run.worktreePath!), false);
  assert.equal(
    readFileSync(join(f.projectPath, 'changed.txt'), 'utf8'),
    'worker change\n',
  );
  assert.equal(await f.runs.land(run.id), 'Already landed');
  await assert.rejects(f.runs.followUp(run.id, 'more'), /not available/);
});

test('discard cannot be overwritten by a concurrently finishing collector', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(join(run.worktreePath!, 'unwanted.txt'), 'discard');
  await f.runs.discard(run.id);
  await f.runs.join();
  const current = f.db.getRun(run.id)!;
  assert.equal(current.reviewStatus, 'discarded');
  assert.equal(current.status, 'interrupted');
  assert.equal(existsSync(run.worktreePath!), false);
  assert.equal(existsSync(join(f.projectPath, 'unwanted.txt')), false);
  assert.equal(f.db.pendingNotifications().length, 0);
  await assert.rejects(f.runs.followUp(run.id, 'more'), /not available/);
});

test('an unanswered worker is failed, even when the conversation is idle', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  f.runtime.complete(run.conversationId!, {
    status: 'unanswered',
    reason: 'provider failed',
  });
  await until(() => f.db.getRun(run.id)?.status === 'failed');
  assert.match(f.db.getRun(run.id)!.error!, /provider failed/);
});

test('follow-up preserves previous report artifacts and creates a new attempt', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(join(run.worktreePath!, 'TIAN_REPORT.md'), 'First report');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const next = await f.runs.followUp(run.id, 'second task');
  assert.equal(next.attempt, 2);
  await until(
    () => f.runtime.records.get(run.conversationId!)!.submissions.size === 2,
  );
  writeFileSync(join(run.worktreePath!, 'TIAN_REPORT.md'), 'Second report');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  assert.equal(f.runs.report(run.id), 'Second report');
  assert.equal(
    readFileSync(
      join(f.scopes.runsDir('p1'), `${run.id}-attempt-1.md`),
      'utf8',
    ),
    'First report',
  );
  assert.equal(f.db.pendingNotifications().length, 2);
});

test('commit failure is reported as failure and preserves the worktree for review', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  const gitDirectory = execFileSync(
    'git',
    [
      '-C',
      run.worktreePath!,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ],
    { encoding: 'utf8' },
  ).trim();
  await Git.git(f.projectPath, [
    'config',
    'core.hooksPath',
    join(gitDirectory, 'hooks'),
  ]);
  writeFileSync(join(gitDirectory, 'hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755,
  });
  writeFileSync(join(run.worktreePath!, 'change.txt'), 'change');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'failed');
  assert.match(f.db.getRun(run.id)!.error!, /git -c/);
  assert.equal(existsSync(run.worktreePath!), true);
  assert.equal(existsSync(join(f.projectPath, 'change.txt')), false);
});

test('landing refuses to merge into a different checked-out branch', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  // Ensure there is a real commit to land, even though the fake worker made no changes.
  writeFileSync(join(run.worktreePath!, 'change.txt'), 'change');
  await Git.commitAll(run.worktreePath!, 'change');
  execFileSync('git', ['-C', f.projectPath, 'switch', '-c', 'other'], {
    stdio: 'pipe',
  });
  await assert.rejects(f.runs.land(run.id), /switch to main/);
  assert.equal(existsSync(join(f.projectPath, 'change.txt')), false);
});

test('restart reconciles a merge that succeeded before cleanup was recorded', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(join(run.worktreePath!, 'change.txt'), 'change');
  f.runtime.complete(run.conversationId!);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  await f.runs.join();
  await Git.merge(f.projectPath, run.branch!, 'main');
  f.db.patchRun(run.id, { reviewStatus: 'landing' });
  const headBefore = execFileSync(
    'git',
    ['-C', f.projectPath, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  );
  const resumed = new RunOrchestrator(
    f.db,
    f.scopes,
    f.runtime,
    f.userData,
    () => {},
    async () => {},
  );
  await resumed.recover();
  assert.equal(f.db.getRun(run.id)?.reviewStatus, 'landed');
  assert.equal(existsSync(run.worktreePath!), false);
  assert.equal(
    execFileSync('git', ['-C', f.projectPath, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }),
    headBefore,
  );
  resumed.pause();
  await resumed.join();
});

test('restart restores collection and reuses the durable submission key', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  f.runs.pause();
  f.runtime.stopWaits();
  await f.runs.join();
  const resumedRuntime = new FakeRuntime(f.runtime.records);
  const resumed = new RunOrchestrator(
    f.db,
    f.scopes,
    resumedRuntime,
    f.userData,
    () => {},
    async () => {},
  );
  try {
    await resumed.recover();
    await until(
      () => f.runtime.records.get(run.conversationId!)!.submissions.size === 1,
    );
    resumedRuntime.complete(run.conversationId!);
    await until(() => f.db.getRun(run.id)?.status === 'done');
    assert.equal(
      f.runtime.records.get(run.conversationId!)!.submissions.size,
      1,
    );
    assert.equal(f.db.pendingNotifications().length, 1);
  } finally {
    resumed.pause();
    resumedRuntime.stopWaits();
    await resumed.join();
  }
});

test('restart respects the original deadline instead of resetting the timeout', async (t) => {
  const f = await fixture(t);
  const run = await start(f);
  writeFileSync(
    join(run.worktreePath!, 'partial.txt'),
    'partial work survives timeout',
  );
  f.runs.pause();
  f.runtime.stopWaits();
  await f.runs.join();
  f.db.patchRun(run.id, {
    deadlineAt: new Date(Date.now() - 1_000).toISOString(),
  });
  const runtime = new FakeRuntime(f.runtime.records);
  const resumed = new RunOrchestrator(
    f.db,
    f.scopes,
    runtime,
    f.userData,
    () => {},
    async () => {},
  );
  try {
    await resumed.recover();
    await until(() => f.db.getRun(run.id)?.status === 'failed');
    assert.match(f.db.getRun(run.id)!.error!, /deadline/);
    assert.match(await resumed.diff(run.id), /partial work survives timeout/);
    assert.equal(runtime.records.get(run.conversationId!)!.aborted, true);
  } finally {
    resumed.pause();
    runtime.stopWaits();
    await resumed.join();
  }
});
