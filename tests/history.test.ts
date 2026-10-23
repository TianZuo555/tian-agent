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
    managerName: 'Manager',
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
    latestInputEntry: async () => null,
    currentInput: async () => null,
    history: { db, events, history },
    goals: new GoalStore(db),
    improvements: new ImprovementStore(db),
    openGoalConversation: (goalId) => Promise.resolve(`goal-conv-${goalId}`),
    emitUpdates: () => {},
    emitImprovements: () => {},
    emitNotices: () => {},
    dispatch: () => Promise.reject(new Error('not used here')),
    workerModels: () => [],
    runReport: () => '',
    runDiff: () => Promise.resolve(''),
    runProgress: () => Promise.reject(new Error('unused')),
    stopRun: () => Promise.reject(new Error('unused')),
    sendRunMessage: () => {
      throw new Error('not used here');
    },
    runMessages: () => [],
    delegateToManager: () => Promise.reject(new Error('not used here')),
    sendManagerMessage: () => Promise.reject(new Error('not used here')),
    managerMessages: () => [],
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
  kind: 'pi.tool-result',
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
      recentToolCalls: async () => [],
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
    managerName: 'Manager',
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

test('a tool call ref resolves its own args even when the message also has text', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const entry = await f.append(conversation, {
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect the file' },
          {
            type: 'toolCall',
            id: 'call-read',
            name: 'bash',
            arguments: { command: 'cat ACTUAL_TOOL_ARGUMENT.txt' },
          },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: ZERO_USAGE,
        stopReason: 'toolUse',
        timestamp: T0,
      } satisfies AssistantMessage,
    ],
  });
  await f.history.syncAll();
  const read = f.tool('read_history');
  const callRef = `conv:${conversation.id}#${entry.id}:call:0`;
  const callText = plain(
    toolText(await call(read, String(conversation.id), { ref: callRef })),
  );
  assert.match(callText, /ACTUAL_TOOL_ARGUMENT/);
  assert.doesNotMatch(callText, /I will inspect the file/);
  // The plain entry ref still reads the assistant text.
  const textRef = `conv:${conversation.id}#${entry.id}`;
  assert.match(
    plain(
      toolText(await call(read, String(conversation.id), { ref: textRef })),
    ),
    /I will inspect the file/,
  );
});

test('tool calls are numbered across all messages of a multi-message entry', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const entry = await f.append(conversation, {
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-a',
            name: 'first_tool',
            arguments: { marker: 'FIRST_CALL_ARG' },
          },
        ],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: ZERO_USAGE,
        stopReason: 'toolUse',
        timestamp: T0,
      } satisfies AssistantMessage,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'second message body' },
          {
            type: 'toolCall',
            id: 'call-b',
            name: 'second_tool',
            arguments: { marker: 'SECOND_CALL_ARG' },
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
  const read = f.tool('read_history');
  const second = plain(
    toolText(
      await call(read, String(conversation.id), {
        ref: `conv:${conversation.id}#${entry.id}:call:1`,
      }),
    ),
  );
  assert.match(second, /SECOND_CALL_ARG/);
  assert.doesNotMatch(second, /FIRST_CALL_ARG/);
  // The second message's body is addressable too.
  assert.match(
    plain(
      toolText(
        await call(read, String(conversation.id), {
          ref: `conv:${conversation.id}#${entry.id}:msg:1`,
        }),
      ),
    ),
    /second message body/,
  );
});

test('read_history pages the full indexed unit when the transcript is unavailable', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const long = `${'A'.repeat(8_000)}TAIL_SENTINEL`;
  await f.append(conversation, toolResultTurn('bash', long, 0));
  await f.history.syncAll();
  // Lose the transcript source: the rebuilt index must still be complete.
  const offline = new HistoryIndex(
    f.db,
    { conversation: () => Promise.reject(new Error('storage gone')) },
    f.events,
  );
  t.after(() => offline.stop());
  const ref = `conv:${conversation.id}#${
    (
      f.db.sqlite
        .prepare(
          "SELECT entry_id AS id FROM history_entries WHERE conversation_id = ? AND kind = 'tool_result'",
        )
        .get(String(conversation.id)) as { id: string }
    ).id
  }`;
  const first = plain(await offline.read(ref, { around: 0, limit: 200 }));
  assert.match(first, /chars 1-200 of \d+/);
  assert.match(first, /continued at read_history/);
  let offset = Number(/offset=(\d+)/.exec(first)![1]);
  let all = first;
  for (let page = 0; page < 10; page++) {
    const chunk = plain(
      await offline.read(ref, { around: 0, offset, limit: 8_000 }),
    );
    all += chunk;
    if (chunk.includes('end of entry')) break;
    offset = Number(/offset=(\d+)/.exec(chunk)![1]);
  }
  assert.match(all, /TAIL_SENTINEL/);
  assert.match(all, /end of entry/);
  // Offsets past the end are rejected instead of producing inverted ranges.
  assert.match(
    await offline.read(ref, { around: 0, offset: 99_999 }),
    /beyond the end/,
  );
});

test('default read output stays bounded and neighbours are previews', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const long = 'L'.repeat(30_000);
  await f.append(conversation, userTurn('run the long job', 0));
  const target = await f.append(conversation, toolResultTurn('bash', long, 1));
  await f.append(conversation, assistantTurn('done', 2));
  await f.history.syncAll();
  const read = f.tool('read_history');
  const out = plain(
    toolText(
      await call(read, String(conversation.id), {
        ref: `conv:${conversation.id}#${target.id}`,
      }),
    ),
  );
  // Default limit is 2000 code points for the target plus bounded previews.
  assert.ok(out.length < 5_000, `default read returned ${out.length} chars`);
  assert.match(out, /chars 1-2000 of \d+/);
  assert.match(out, /run the long job/);
  assert.match(out, /done/);
  // Continuation does not repeat the neighbours.
  const next = Number(/offset=(\d+)/.exec(out)![1]);
  const continuation = plain(
    toolText(
      await call(read, String(conversation.id), {
        ref: `conv:${conversation.id}#${target.id}`,
        offset: next,
      }),
    ),
  );
  assert.doesNotMatch(continuation, /run the long job/);
  assert.ok(continuation.length < 3_000);
});

test('long events page with offsets and never invert the character range', async (t) => {
  const f = await harness(t);
  f.events.record({
    id: 'ev-long',
    type: 'run.finished',
    actor: 'system',
    scopeId: 'p1',
    summary: 'finished',
    payload: { detail: 'E'.repeat(6_000) + 'EVENT_TAIL' },
  });
  await f.history.syncAll();
  const read = f.tool('read_history');
  const first = plain(
    toolText(await call(read, 'x', { ref: 'event:ev-long' })),
  );
  assert.match(first, /chars 1-2000 of \d+/);
  let offset = Number(/offset=(\d+)/.exec(first)![1]);
  let all = first;
  for (let page = 0; page < 6; page++) {
    const chunk = plain(
      toolText(await call(read, 'x', { ref: 'event:ev-long', offset })),
    );
    all += chunk;
    if (chunk.includes('end of event')) break;
    offset = Number(/offset=(\d+)/.exec(chunk)![1]);
  }
  assert.match(all, /EVENT_TAIL/);
  assert.match(all, /end of event/);
  // Beyond the end is an explicit message, never an inverted range.
  const beyond = plain(
    toolText(await call(read, 'x', { ref: 'event:ev-long', offset: 99_999 })),
  );
  assert.match(beyond, /beyond the end of event ev-long/);
  assert.doesNotMatch(beyond, /chars \d+-\d+ of/);
});

test('tool payloads beyond 60k code points stay searchable and pageable', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const tail = ' IMPORTANT_TAIL_SENTINEL after a very long log';
  await f.append(
    conversation,
    toolResultTurn('bash', `${'x'.repeat(65_000)}${tail}`, 0),
  );
  await f.append(
    conversation,
    toolCallTurn(
      'bash',
      { command: `cat ${'y'.repeat(64_000)}/TAIL_ARG.txt` },
      1,
    ),
  );
  await f.history.syncAll();
  const search = f.tool('search_history');
  // The tail of a 65k result is indexed in full, not truncated at 60k.
  const found = plain(
    toolText(
      await call(search, String(conversation.id), {
        query: 'IMPORTANT_TAIL_SENTINEL',
        scope: 'p1',
      }),
    ),
  );
  assert.match(found, /IMPORTANT_TAIL_SENTINEL/);
  // Multi-word query across the tail works too.
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), {
          query: 'TAIL_SENTINEL long log',
          scope: 'p1',
        }),
      ),
    ),
    /IMPORTANT_TAIL_SENTINEL/,
  );
  // The long tool arguments are indexed whole as well.
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), {
          query: 'TAIL_ARG',
          scope: 'p1',
        }),
      ),
    ),
    /TAIL_ARG/,
  );
  // Reads page the tail from the complete index even without the transcript.
  const offline = new HistoryIndex(
    f.db,
    { conversation: () => Promise.reject(new Error('storage gone')) },
    f.events,
  );
  t.after(() => offline.stop());
  const ref = /conv:\d+#[\w:]+/.exec(found)?.[0];
  assert.ok(ref);
  const entryRef = ref.replace(/:call:\d+$/, '');
  const total = Number(
    /of (\d+)/.exec(
      plain(await offline.read(entryRef, { around: 0, limit: 50 })),
    )![1],
  );
  assert.ok(total > 65_000, `indexed text truncated at ${total}`);
  const tailPage = plain(
    await offline.read(entryRef, { around: 0, offset: total - 60, limit: 60 }),
  );
  assert.match(tailPage, /IMPORTANT_TAIL_SENTINEL/);
});

test('an entry with only tool calls is reported clearly and previews stay bounded', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const entry = await f.append(conversation, {
    kind: 'pi.assistant',
    model: [
      {
        role: 'assistant',
        content: Array.from({ length: 80 }, (_, i) => ({
          type: 'toolCall' as const,
          id: `call-${i}`,
          name: 'inspect',
          arguments: { text: 'example '.repeat(100) },
        })),
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test-model',
        usage: ZERO_USAGE,
        stopReason: 'toolUse',
        timestamp: T0,
      } satisfies AssistantMessage,
    ],
  });
  await f.history.syncAll();
  const read = f.tool('read_history');
  const bare = plain(
    toolText(
      await call(read, String(conversation.id), {
        ref: `conv:${conversation.id}#${entry.id}`,
        limit: 20,
      }),
    ),
  );
  // No text for the bare entry: an explicit explanation plus bounded previews.
  assert.match(bare, /no text for conv:\d+#\d+; showing \d+ indexed unit/);
  assert.ok(
    bare.length < 3_000,
    `bare entry read returned ${bare.length} chars`,
  );
  assert.match(bare, /omitted \(context budget\)|bounded previews/);
  // An unknown sub-ref is explicit, not a silent dump.
  const unknown = plain(
    toolText(
      await call(read, String(conversation.id), {
        ref: `conv:${conversation.id}#${entry.id}:call:999`,
        around: 0,
      }),
    ),
  );
  // An unknown sub-ref of an existing entry is explicit too (previews are of
  // the entry's real units, never a fabricated payload for the ref).
  assert.match(unknown, /no text for conv:\d+#\d+:call:999/);
  assert.ok(
    unknown.length < 3_000,
    `unknown ref read returned ${unknown.length} chars`,
  );
});

test('a keyword split across the old chunk boundary is still searchable', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  // Put the marker exactly across the former 1,500-char chunk boundary.
  const long = `${'x'.repeat(1_495)}CROSSBOUNDARYMARKER${'y'.repeat(100)}`;
  await f.append(conversation, toolResultTurn('bash', long, 0));
  await f.history.syncAll();
  const search = f.tool('search_history');
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), {
          query: 'CROSSBOUNDARYMARKER',
          scope: 'p1',
        }),
      ),
    ),
    /CROSSBOUNDARYMARKER/,
  );
  // A two-word query spanning the boundary also works on the whole unit.
  assert.match(
    plain(
      toolText(
        await call(search, String(conversation.id), {
          query: 'CROSSBOUNDARYMARKER yyy',
          scope: 'p1',
        }),
      ),
    ),
    /CROSSBOUNDARYMARKER/,
  );
});

test('notes search shares the query planner and reports bounded snippets', async (t) => {
  const f = await harness(t);
  f.scopes.writeNote(
    'p1',
    'plan.md',
    [
      '# Plan',
      'deploy the worker',
      'unrelated line',
      'deploy and rollback notes',
    ].join('\n'),
  );
  const hits = f.scopes.searchNotes('p1', 'deploy rollback');
  assert.match(hits, /plan\.md:4: deploy and rollback notes/);
  assert.doesNotMatch(hits, /plan\.md:2/);
  assert.match(f.scopes.searchNotes('p1', 'PLAN'), /plan\.md:1: # Plan/);
  const window = f.scopes.readNoteWindow('p1', 'plan.md:4');
  assert.match(window, /plan\.md:1-4/);
  assert.match(window, /4: deploy and rollback notes/);
  for (let i = 0; i < 12; i++)
    f.scopes.writeNote('p1', `bulk-${i}.md`, 'needle line');
  const bounded = f.scopes.searchNotes('p1', 'needle', 5);
  assert.equal(bounded.split('\n').length, 6);
  assert.match(bounded, /more matches; narrow the query/);
  // A very long line is snippet-bounded, not returned whole.
  f.scopes.writeNote('p1', 'huge.md', `needle ${'z'.repeat(5_000)}`);
  const snippet = f.scopes.searchNotes('p1', 'needle zzz', 100);
  assert.ok(
    snippet.length < 3_000,
    `notes snippet too long: ${snippet.length}`,
  );
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

test('an index format upgrade resets every derived cursor and rebuilds without loss', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  await f.append(conversation, userTurn('The old index format row', 0));
  await f.history.syncAll();
  const count = () =>
    (
      f.db.sqlite
        .prepare('SELECT COUNT(*) AS n FROM history_entries')
        .get() as { n: number }
    ).n;
  assert.equal(count(), 1);
  // Simulate a database written by the previous index format, with a worker
  // cursor pointing at the old rowid space.
  f.db.sqlite
    .prepare(
      "UPDATE memory_meta SET value = '1' WHERE key = 'history-index-format'",
    )
    .run();
  f.db.sqlite
    .prepare(
      "INSERT OR REPLACE INTO history_cursors (conversation_id,last_entry,updated_at) VALUES ('memory-worker:p1','1',?)",
    )
    .run(new Date().toISOString());

  const upgraded = new HistoryIndex(f.db, f.agents, f.events);
  t.after(() => upgraded.stop());
  assert.equal(count(), 0);
  // The stale worker cursor is gone: rowids are meaningless after a rebuild.
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM history_cursors WHERE conversation_id LIKE 'memory-worker:%'",
      )
      .get()?.n,
    0,
  );
  // The next sync rebuilds from Pi; nothing is lost.
  await upgraded.syncAll();
  assert.equal(count(), 1);
  assert.match(
    plain(
      (await upgraded.search('old index format', { scopeId: 'p1' })).join('\n'),
    ),
    /The old index format row/,
  );
});

test('system notifications are indexed and shown as system, never as the user', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  await f.append(conversation, {
    kind: 'system.notification',
    model: [
      {
        role: 'user',
        content: '[inbox message from run] nightly job failed',
        timestamp: T0,
      },
    ],
  });
  await f.append(conversation, userTurn('what happened last night?', 1));
  await f.history.syncAll();
  const rows = f.db.sqlite
    .prepare(
      'SELECT role, kind FROM history_entries WHERE conversation_id = ? ORDER BY CAST(entry_id AS INTEGER)',
    )
    .all(String(conversation.id)) as { role: string; kind: string }[];
  assert.deepEqual(
    rows.map((row) => [row.kind, row.role]),
    [
      ['message', 'system.notification'],
      ['message', 'user'],
    ],
  );
  // The notification text is still searchable, but attributed to the system.
  const hits = await f.history.search('nightly job', {
    scopeId: 'p1',
  });
  assert.match(
    plain(hits.join('\n')),
    /system\.notification: .*nightly job failed/,
  );
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
  // The queue row clears before its submission settles; maintenance counts
  // in-flight submissions, so wait for the wake to settle as well.
  await until(() => service.db.pendingNotifications().length === 0);
  for (let i = 0; i < 500; i++) {
    if ((await service.activity()).submissions === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
