import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation, EntryRecord } from '@earendil-works/pi-durable';
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai';
import { Db, type RunRow } from '../src/worker/db';
import { Scopes } from '../src/worker/scopes';
import { DataService } from '../src/worker/data';
import { Settings } from '../src/worker/settings';
import { AgentRuntime } from '../src/worker/agents';
import { EventLog } from '../src/worker/events';
import { HistoryIndex, type HistoryRow } from '../src/worker/history';
import { chiefExtension } from '../src/worker/tools';
import { GoalStore } from '../src/worker/goals';
import { ImprovementStore } from '../src/worker/improvements';
import { workerExtension } from '../src/worker/worker-tools';
import { ResidentServer } from '../src/service/server';
import { ServiceClient } from '../src/service/client';
import { servicePaths } from '../src/shared/service-paths';
import {
  RunOrchestrator,
  type WorkerConversation,
  type WorkerRuntime,
} from '../src/worker/runs';

const T0 = Date.parse('2026-10-11T14:02:00Z');
const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function temporary(t: TestContext, prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('History test timed out');
    await new Promise((resolve) => setImmediate(resolve));
  }
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
/** Drop snippet highlight markers so assertions can match prose. */
const plain = (value: string) => value.replaceAll('«', '').replaceAll('»', '');
const call = (
  tool: ExecutableTool,
  conversationId: string,
  args: Record<string, unknown>,
) => tool.execute(args, { conversationId, taskId: 'task-1', callId: 'c1' });

interface Harness {
  root: string;
  userData: string;
  db: Db;
  scopes: Scopes;
  events: EventLog;
  history: HistoryIndex;
  agents: AgentRuntime;
  chief: ReturnType<typeof chiefExtension>;
  openConversation(scopeId: string): Promise<Conversation>;
  append(
    conversation: Conversation,
    entry: Omit<EntryRecord, 'id' | 'conversationId'>,
  ): Promise<EntryRecord>;
  tool(name: string): ExecutableTool;
}

/** Real Pi harness with two chief conversations (project p1 + global) to index. */
async function harness(t: TestContext): Promise<Harness> {
  const root = temporary(t, 'tian-history-');
  const userData = join(root, 'data');
  mkdirSync(join(root, 'project'));
  const db = new Db(userData);
  const scopes = new Scopes(join(userData, 'scopes', 'global'), db);
  db.addProject({
    id: 'p1',
    name: 'proj',
    rootPath: join(root, 'project'),
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
  });
  scopes.ensureDirs('p1');
  const events = new EventLog(db);
  const settings = new Settings(userData);
  const agents = new AgentRuntime(
    userData,
    scopes.root('global'),
    settings,
    db,
  );
  const history = new HistoryIndex(db, agents, events);
  const data = new DataService(db, scopes, () => {});
  const chief = chiefExtension({
    scopes,
    db,
    data,
    latestUserEntry: async () => null,
    history: { db, events, history },
    goals: new GoalStore(db),
    improvements: new ImprovementStore(db),
    openGoalConversation: (goalId) => Promise.resolve(`goal-conv-${goalId}`),
    emitUpdates: () => {},
    emitImprovements: () => {},
    emitNotices: () => {},
    dispatch: () => Promise.reject(new Error('not used here')),
    runReport: () => '',
    runDiff: () => Promise.resolve(''),
    sendRunMessage: () => {
      throw new Error('not used here');
    },
    runMessages: () => [],
  });
  await agents.open(chief, workerExtension({ db, wake: async () => {} }));
  t.after(async () => {
    history.stop();
    await agents.close();
    db.close();
  });
  const openConversation = async (scopeId: string) => {
    const conversation = await agents.createChief(scopes.ensureDirs(scopeId));
    db.mapConversation(String(conversation.id), scopeId);
    return conversation;
  };
  const append = (
    conversation: Conversation,
    entry: Omit<EntryRecord, 'id' | 'conversationId'>,
  ) =>
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, entry),
      BACKGROUND_CONTEXT,
    );
  const tool = (name: string) => {
    const found = chief.tools?.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing tool: ${name}`);
    return found as unknown as ExecutableTool;
  };
  return {
    root,
    userData,
    db,
    scopes,
    events,
    history,
    agents,
    chief,
    openConversation,
    append,
    tool,
  };
}

const userTurn = (text: string, minutes: number) => ({
  kind: 'pi.user',
  model: [
    {
      role: 'user',
      content: text,
      timestamp: T0 + minutes * 60_000,
    } satisfies UserMessage,
  ],
});

const assistantTurn = (text: string, minutes: number) => ({
  kind: 'pi.assistant',
  model: [
    {
      role: 'assistant',
      content: [{ type: 'text', text }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'test-model',
      usage: ZERO_USAGE,
      stopReason: 'stop',
      timestamp: T0 + minutes * 60_000,
    } satisfies AssistantMessage,
  ],
});

const toolCallTurn = (
  name: string,
  args: Record<string, string>,
  minutes: number,
) => ({
  kind: 'pi.assistant',
  model: [
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: `call-${name}`, name, arguments: args },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'test-model',
      usage: ZERO_USAGE,
      stopReason: 'toolUse',
      timestamp: T0 + minutes * 60_000,
    } satisfies AssistantMessage,
  ],
});

const toolResultTurn = (name: string, text: string, minutes: number) => ({
  kind: 'pi.toolResult',
  model: [
    {
      role: 'toolResult',
      toolCallId: `call-${name}`,
      toolName: name,
      content: [{ type: 'text', text }],
      isError: false,
      timestamp: T0 + minutes * 60_000,
    } satisfies ToolResultMessage,
  ],
});

test('the event log is idempotent and filterable', (t) => {
  const directory = temporary(t, 'tian-history-events-');
  const db = new Db(directory);
  t.after(() => db.close());
  const events = new EventLog(db);
  const base = {
    type: 'inbox.received',
    actor: 'channel' as const,
    summary: 'a message arrived',
  };
  events.record({
    ...base,
    id: 'inbox:p1:m1',
    scopeId: 'p1',
    at: '2026-10-11T10:00:00.000Z',
  });
  // A replay of the same deterministic id keeps the first write.
  events.record({
    ...base,
    id: 'inbox:p1:m1',
    scopeId: 'p1',
    at: '2026-10-11T11:00:00.000Z',
  });
  events.record({
    ...base,
    id: 'inbox:p2:m2',
    scopeId: 'p2',
    at: '2026-10-12T10:00:00.000Z',
  });
  assert.equal(events.list({}).length, 2);
  assert.equal(events.list({ scopeId: 'p1' }).length, 1);
  assert.equal(events.list({ type: 'inbox.received' }).length, 2);
  assert.equal(events.get('inbox:p1:m1')!.at, '2026-10-11T10:00:00.000Z');
  assert.equal(events.list({ since: '2026-10-12T00:00:00.000Z' }).length, 1);
  assert.equal(events.list({ until: '2026-10-11T23:59:59.000Z' }).length, 1);
  assert.equal(events.list({ runId: 'r-none' }).length, 0);
});

test('chief turns are indexed, searchable, and expandable through refs', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  await f.append(
    conversation,
    userTurn('We chose SQLite over Postgres for the cache', 0),
  );
  await f.append(conversation, toolCallTurn('read_note', { name: 'cache' }, 1));
  await f.append(
    conversation,
    toolResultTurn('read_note', 'notes mention the cache budget', 2),
  );
  await f.append(
    conversation,
    assistantTurn('Confirmed: SQLite keeps deployment simple', 3),
  );
  await f.history.syncAll();

  const search = f.tool('search_history');
  const found = toolText(
    await call(search, String(conversation.id), { query: 'SQLite' }),
  );
  assert.match(
    plain(found),
    /user: We chose SQLite over Postgres for the cache/,
  );
  assert.match(plain(found), /Confirmed: SQLite keeps deployment simple/);
  const ref = /conv:\d+#[\w:]+/.exec(found)?.[0];
  assert.ok(ref, `no ref in search output: ${found}`);

  const read = f.tool('read_history');
  const context = plain(
    toolText(await call(read, String(conversation.id), { ref, around: 3 })),
  );
  assert.match(context, /We chose SQLite over Postgres/);
  assert.match(context, /Confirmed: SQLite keeps deployment simple/);
  assert.match(context, /read_note: notes mention the cache budget/);
  assert.match(
    toolText(await call(read, String(conversation.id), { ref: 'conv:999#1' })),
    /nothing indexed under 999/,
  );
});

test('a multi-message entry is indexed message by message', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  // A forked or codemode transcript can carry several messages in one entry.
  await f.append(conversation, {
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'First half of the plan' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: ZERO_USAGE,
        stopReason: 'stop',
        timestamp: T0,
      } satisfies AssistantMessage,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Second half calls the tool' },
          {
            type: 'toolCall',
            id: 'call-late',
            name: 'list_notes',
            arguments: { scope: 'p1' },
          },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: ZERO_USAGE,
        stopReason: 'toolUse',
        timestamp: T0 + 60_000,
      } satisfies AssistantMessage,
    ],
  });
  await f.history.syncAll();
  const rows = f.db.sqlite
    .prepare(
      'SELECT entry_id AS entryId, role, kind, text FROM history_entries ORDER BY entry_id',
    )
    .all() as unknown as {
    entryId: string;
    role: string;
    kind: string;
    text: string;
  }[];
  const byText = rows.sort((a, b) => a.text.localeCompare(b.text));
  assert.deepEqual(
    byText.map((row) => [row.role, row.kind]),
    [
      ['assistant', 'message'],
      ['assistant', 'tool_call'],
      ['assistant', 'message'],
    ],
  );
  assert.match(byText[0].text, /First half of the plan/);
  assert.match(byText[1].text, /list_notes\(\{.*p1.*\}\)/);
  assert.match(byText[2].text, /Second half calls the tool/);
  // Distinct refs, so read_history can address each message.
  assert.equal(new Set(rows.map((row) => row.entryId)).size, 3);

  const search = f.tool('search_history');
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), { query: 'Second half' }),
      ),
    ),
    /Second half calls the tool/,
  );
});

test('search scope defaults isolate projects and "all" spans scopes', async (t) => {
  const f = await harness(t);
  const project = await f.openConversation('p1');
  const general = await f.openConversation('global');
  await f.append(project, userTurn('The importer must never block startup', 0));
  await f.append(
    general,
    userTurn('Tian prefers plain summaries over dashboards', 0),
  );
  await f.history.syncAll();
  const search = f.tool('search_history');

  const scoped = toolText(
    await call(search, String(project.id), { query: 'importer' }),
  );
  assert.match(scoped, /importer/);
  assert.doesNotMatch(scoped, /dashboards/);

  assert.equal(
    toolText(await call(search, String(general.id), { query: 'importer' })),
    '(no matches)',
  );

  const everything = toolText(
    await call(search, String(project.id), { query: 'importer', scope: 'all' }),
  );
  assert.match(everything, /importer/);
  assert.match(
    toolText(
      await call(search, String(general.id), {
        query: 'summaries',
        scope: 'all',
      }),
    ),
    /dashboards/,
  );

  // Time bounds filter the same search.
  assert.equal(
    toolText(
      await call(search, String(project.id), {
        query: 'importer',
        until: '2026-10-11T13:00:00.000Z',
      }),
    ),
    '(no matches)',
  );
  assert.match(
    toolText(
      await call(search, String(project.id), {
        query: 'importer',
        since: '2026-10-11T13:00:00.000Z',
        until: '2026-10-11T15:00:00.000Z',
      }),
    ),
    /importer/,
  );

  // A worker conversation is indexed under its run's project, not the chief's scope.
  const worker = await f.agents.createChief(f.scopes.root('global'));
  f.db.addRun({
    id: 'r-worker',
    projectId: 'p1',
    conversationId: String(worker.id),
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'work',
    currentPrompt: 'work',
    rootPath: f.scopes.root('p1'),
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'done',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    deadlineAt: '',
  });
  await f.append(
    worker,
    assistantTurn('Ran the migration twice by accident', 5),
  );
  await f.history.syncAll();
  assert.match(
    plain(
      toolText(
        await call(search, String(project.id), { query: 'migration twice' }),
      ),
    ),
    new RegExp(`conv:${worker.id}#\\d+ assistant: Ran the migration twice`),
  );
  assert.equal(
    toolText(
      await call(search, String(general.id), { query: 'migration twice' }),
    ),
    '(no matches)',
  );
});

test('Chinese phrases search through trigram and short queries fall back to LIKE', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const userEntry = await f.append(
    conversation,
    userTurn('我们决定使用 SQLite 存储记忆，因为部署最简单', 0),
  );
  await f.append(
    conversation,
    assistantTurn('好的，记忆层将全部落在 tian.db。', 1),
  );
  await f.history.syncAll();
  const search = f.tool('search_history');

  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), { query: '存储记忆' }),
      ),
    ),
    /我们决定使用 SQLite/,
  );
  assert.match(
    toolText(await call(search, String(conversation.id), { query: '记忆层' })),
    /tian\.db/,
  );
  // Two characters cannot match under trigram — the LIKE fallback finds them.
  assert.match(
    plain(
      toolText(await call(search, String(conversation.id), { query: '存储' })),
    ),
    /我们决定使用 SQLite/,
  );
  // Mixed terms: the long one goes through FTS, the short one through LIKE.
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), { query: 'SQLite 记忆' }),
      ),
    ),
    /我们决定使用 SQLite/,
  );
  assert.equal(
    plain(
      toolText(
        await call(search, String(conversation.id), { query: 'SQLite 部署' }),
      ),
    ),
    `[2026-10-11 14:02] conv:${conversation.id}#${userEntry.id} user: 我们决定使用 SQLite 存储记忆，因为部署最简单`,
  );
});

test('the index survives a restart and incremental sync does not duplicate entries', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  await f.append(
    conversation,
    userTurn('Keep the worker on its own branch', 0),
  );
  await f.history.syncAll();
  const rows = () =>
    (
      f.db.sqlite
        .prepare('SELECT COUNT(*) AS n FROM history_entries')
        .get() as {
        n: number;
      }
    ).n;
  const before = rows();
  assert.equal(before, 1);

  // More turns arrive, then the service restarts: a fresh runtime and index over the same databases.
  await f.append(
    conversation,
    assistantTurn('Worker branches are cleaned up after landing', 1),
  );
  await f.history.stop();
  await f.agents.close();
  const events = new EventLog(f.db);
  const agents = new AgentRuntime(
    f.userData,
    f.scopes.root('global'),
    new Settings(f.userData),
    f.db,
  );
  const history = new HistoryIndex(f.db, agents, events);
  await agents.open(
    f.chief,
    workerExtension({ db: f.db, wake: async () => {} }),
  );
  t.after(async () => {
    history.stop();
    await agents.close();
  });
  await history.syncAll();
  assert.equal(rows(), before + 1);
  await history.syncAll(); // an incremental re-sync adds nothing
  assert.equal(rows(), before + 1);

  const again = plain(
    toolText(
      await call(f.tool('search_history'), String(conversation.id), {
        query: 'worker',
      }),
    ),
  );
  // Exactly one line per indexed turn — an incremental re-sync added no duplicates.
  assert.equal(
    again.split('\n').filter((line) => line.includes('user:')).length,
    1,
  );
  assert.match(again, /Keep the worker on its own branch/);
  assert.match(again, /Worker branches are cleaned up/);
});

test('dropping the derived index and resyncing restores every result', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  await f.append(
    conversation,
    userTurn('The scheduler must merge missed firings', 0),
  );
  await f.history.syncAll();
  const search = f.tool('search_history');
  const query = { query: 'missed firings' };
  const count = () =>
    (
      f.db.sqlite
        .prepare('SELECT COUNT(*) AS n FROM history_entries')
        .get() as {
        n: number;
      }
    ).n;
  assert.match(
    plain(toolText(await call(search, String(conversation.id), query))),
    /must merge missed firings/,
  );

  // Lose the derived tables entirely: the transcript is still the only source.
  f.db.sqlite.exec(
    'DROP TABLE history_fts; DROP TABLE history_entries; DROP TABLE history_cursors;',
  );
  const rebuilt = new HistoryIndex(f.db, f.agents, f.events);
  t.after(() => rebuilt.stop());
  assert.equal(count(), 0);
  // A search syncs lazily first, so the dropped index rebuilds itself.
  assert.match(
    plain(toolText(await call(search, String(conversation.id), query))),
    /The scheduler must merge missed firings/,
  );
  assert.equal(count(), 1);

  // Dropping it again and resyncing explicitly restores it too.
  f.db.sqlite.exec(
    'DROP TABLE history_fts; DROP TABLE history_entries; DROP TABLE history_cursors;',
  );
  const explicit = new HistoryIndex(f.db, f.agents, f.events);
  t.after(() => explicit.stop());
  await explicit.resync();
  assert.equal(count(), 1);
  assert.match(
    plain(toolText(await call(search, String(conversation.id), query))),
    /The scheduler must merge missed firings/,
  );
});

type Outcome = { status: 'done' | 'unanswered'; reason?: string };
type Submission = {
  promise: Promise<Outcome>;
  resolve: (outcome: Outcome) => void;
};

class FakeRuntime implements WorkerRuntime {
  readonly closed: {
    promise: Promise<Outcome>;
    resolve: (outcome: Outcome) => void;
  };
  readonly records: Map<
    string,
    { run: RunRow; submissions: Map<string, Submission> }
  >;
  constructor(records?: FakeRuntime['records']) {
    this.records = records ?? new Map();
    let resolve!: (outcome: Outcome) => void;
    this.closed = {
      promise: new Promise<Outcome>((ok) => {
        resolve = ok;
      }),
      resolve,
    };
  }
  async create(run: RunRow): Promise<WorkerConversation> {
    const id = `worker-${this.records.size + 1}`;
    this.records.set(id, { run, submissions: new Map() });
    return this.get(id);
  }
  async get(id: string): Promise<WorkerConversation> {
    const record = this.records.get(id);
    if (!record) throw new Error(`No worker ${id}`);
    return {
      id,
      submit: async (_prompt: string, requestId: string) => {
        let submission = record.submissions.get(requestId);
        if (!submission) {
          submission = this.deferred();
          record.submissions.set(requestId, submission);
        }
        return {
          wait: () => Promise.race([submission!.promise, this.closed.promise]),
        };
      },
      abort: async () => {
        for (const submission of record.submissions.values())
          submission.resolve({ status: 'unanswered', reason: 'aborted' });
      },
      lastText: async () => 'Worker report',
    };
  }
  private deferred(): Submission {
    let resolve!: (outcome: Outcome) => void;
    const promise = new Promise<Outcome>((ok) => {
      resolve = ok;
    });
    return { promise, resolve };
  }
  complete(id: string, outcome: Outcome = { status: 'done' }): void {
    for (const submission of this.records.get(id)!.submissions.values())
      submission.resolve(outcome);
  }
  stopWaits(): void {
    this.closed.resolve({ status: 'unanswered', reason: 'runtime stopped' });
  }
}

/** Orchestrator fixture over a real Git project, sharing one event log. */
function runsFixture(t: TestContext) {
  const directory = temporary(t, 'tian-history-runs-');
  const projectPath = join(directory, 'project');
  const userData = join(directory, 'data');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'base.txt'), 'base\n');
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
  const db = new Db(userData);
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
  });
  const scopes = new Scopes(join(userData, 'global'), db);
  const events = new EventLog(db);
  const runtime = new FakeRuntime();
  const runs = new RunOrchestrator(
    db,
    scopes,
    runtime,
    userData,
    () => {},
    async () => {},
    events,
  );
  t.after(async () => {
    runs.pause();
    runtime.stopWaits();
    await runs.join();
    db.close();
  });
  return {
    directory,
    projectPath,
    userData,
    db,
    scopes,
    events,
    runtime,
    runs,
  };
}

test('run lifecycle produces events exactly once, including across a restart', async (t) => {
  const f = runsFixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'first pass',
    chiefConversationId: null,
  });
  await until(() => f.db.getRun(run.id)?.status === 'running');
  // "Crash" before the worker answers: the pause guard must prevent a finish event.
  f.runs.pause();
  f.runtime.stopWaits();
  await f.runs.join();
  assert.equal(f.db.getRun(run.id)!.status, 'running');
  const of = (type: string) => f.events.list({ type });
  assert.equal(of('run.dispatched').length, 1);
  assert.equal(of('run.finished').length, 0);

  // Restart: recovery relaunches the same attempt and finishes it once.
  const resumedRuntime = new FakeRuntime(f.runtime.records);
  const resumed = new RunOrchestrator(
    f.db,
    f.scopes,
    resumedRuntime,
    f.userData,
    () => {},
    async () => {},
    f.events,
  );
  try {
    await resumed.recover();
    await until(() => f.db.getRun(run.id)?.status === 'running');
    writeFileSync(join(run.worktreePath!, 'change.txt'), 'change\n');
    resumedRuntime.complete(run.conversationId!);
    await until(() => f.db.getRun(run.id)?.status === 'done');

    assert.equal(of('run.dispatched').length, 1);
    assert.equal(of('run.finished').length, 1);
    assert.equal(of('run.finished')[0].runId, run.id);
    assert.equal(of('run.finished')[0].type, 'run.finished');

    // Another recovery pass over the finished run records nothing new.
    const again = new RunOrchestrator(
      f.db,
      f.scopes,
      resumedRuntime,
      f.userData,
      () => {},
      async () => {},
      f.events,
    );
    await again.recover();
    again.pause();
    await again.join();
    assert.equal(of('run.dispatched').length, 1);
    assert.equal(of('run.finished').length, 1);

    // The review decision is an event too, and repeating it stays idempotent.
    await resumed.land(run.id);
    assert.equal(of('run.landed').length, 1);
    assert.equal(await resumed.land(run.id), 'Already landed');
    assert.equal(of('run.landed').length, 1);
    assert.equal(of('run.discarded').length, 0);
    assert.ok(existsSync(join(f.projectPath, 'change.txt')));

    // Events are indexed into the same search, reachable by ref.
    const history = new HistoryIndex(
      f.db,
      {
        conversation: async () => {
          throw new Error('no Pi storage in this fixture');
        },
      },
      f.events,
    );
    t.after(() => history.stop());
    await history.syncAll();
    const hits = await history.search('landed into', { scopeId: 'p1' });
    const ref = hits.map((line) => /event:\S+/.exec(line)?.[0]).find(Boolean);
    assert.ok(ref, `no event ref in ${hits.join('\n')}`);
    assert.match(await history.read(ref!), /run\.landed/);
  } finally {
    resumed.pause();
    resumedRuntime.stopWaits();
    await resumed.join();
  }
});

test('searching 5000 indexed entries stays well under 300ms', async (t) => {
  const directory = temporary(t, 'tian-history-perf-');
  const db = new Db(directory);
  t.after(() => db.close());
  const events = new EventLog(db);
  const history = new HistoryIndex(
    db,
    {
      conversation: async () => {
        throw new Error('no conversations in this test');
      },
    },
    events,
  );
  const rows: HistoryRow[] = [];
  for (let i = 0; i < 5000; i++) {
    rows.push({
      conversationId: '900',
      entryId: String(i + 1),
      scopeId: 'p-perf',
      kind: 'message',
      role: i % 2 ? 'assistant' : 'user',
      at: new Date(T0 + i * 60_000).toISOString(),
      text:
        i % 500 === 0
          ? `纪要 ${i}：星云计划启动会确认了里程碑与责任人`
          : `条目 ${i}：常规同步内容，没有特别的结论`,
    });
  }
  history.indexRows(rows);

  const start = performance.now();
  const hits = await history.search('星云计划', { scopeId: 'p-perf' });
  const elapsed = performance.now() - start;
  console.log(`history search over 5000 entries took ${elapsed.toFixed(1)}ms`);
  assert.ok(elapsed < 300, `search took ${elapsed.toFixed(1)}ms`);
  assert.equal(hits.length, 10);
  assert.match(hits[0], /星云计划/);
  // The default result limit and token budget cap the output.
  const many = await history.search('常规', { scopeId: 'p-perf', limit: 5 });
  assert.equal(many.length, 5);
});

test('the resident service records inbox and delivery events, and backfills transcripts', async (t) => {
  const root = temporary(t, 'tian-history-service-');
  const paths = {
    ...servicePaths(join(root, 'data')),
    socketPath: join(root, 'agent.sock'),
  };
  const server = new ResidentServer(paths);
  const clients: ServiceClient[] = [];
  await server.start();
  t.after(async () => {
    for (const client of clients) client.close();
    await server.close();
  });
  const client = new ServiceClient(paths.socketPath, undefined, {
    reconnectDelayMs: 10,
    readyTimeoutMs: 2_000,
  });
  clients.push(client);
  await client.start();
  const service = server.service;
  const conversation = await client.invoke('createConversation', ['global']);

  // A chief turn written straight into Pi is picked up by the derived index.
  const agents = (
    service as unknown as {
      agents: {
        conversation(id: string): Promise<Conversation>;
      };
    }
  ).agents;
  const chief = await agents.conversation(conversation.conversationId);
  await chief.commit(
    (tx) =>
      tx.appendEntry(
        chief.id,
        userTurn('The importer must never block startup', 0),
      ),
    BACKGROUND_CONTEXT,
  );
  await service.history.syncAll();
  const hits = await service.history.search('importer', { scopeId: 'global' });
  assert.equal(hits.length, 1);
  assert.match(
    plain(hits[0]),
    /conv:\d+#\d+ user: The importer must never block startup/,
  );

  // An inbox message produces exactly one event, even when it is scanned again.
  service.scopes.sendMessage(
    'global',
    'external',
    'please check the nightly job',
  );
  const scan = (
    service as unknown as { scanInbox(id: string): void }
  ).scanInbox.bind(service);
  scan('global');
  const inboxEvents = () =>
    service.events.list({ type: 'inbox.received', scopeId: 'global' });
  assert.ok(inboxEvents()[0]?.id, 'no inbox event recorded');
  scan('global');
  assert.equal(inboxEvents().length, 1);

  // Delivering that notification is an event too, recorded once per notification.
  await until(() => service.db.pendingNotifications().length === 0);
  const delivered = service.events.list({
    type: 'notification.delivered',
    scopeId: 'global',
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].conversationId, conversation.conversationId);
  assert.match(delivered[0].summary, /inbox:global:/);

  // Events are searchable through the same index, with an event ref to expand.
  await service.history.syncAll();
  const events = await service.history.search('nightly job', {
    scopeId: 'global',
  });
  const ref = events.map((line) => /event:\S+/.exec(line)?.[0]).find(Boolean);
  assert.ok(ref, `no event ref in ${events.join('\n')}`);
  assert.match(plain(await service.history.read(ref!)), /inbox.received/);

  // Maintenance pauses background sync work; finishing it resumes.
  await client.invoke('beginMaintenance', []);
  await chief.commit(
    (tx) =>
      tx.appendEntry(
        chief.id,
        userTurn('written while the updater holds maintenance', 1),
      ),
    BACKGROUND_CONTEXT,
  );
  await service.history.syncAll();
  assert.equal(
    (await service.history.search('holds maintenance', { scopeId: 'global' }))
      .length,
    0,
  );
  await client.invoke('finishMaintenance', []);
  await service.history.syncAll();
  assert.equal(
    (await service.history.search('holds maintenance', { scopeId: 'global' }))
      .length,
    1,
  );
});
