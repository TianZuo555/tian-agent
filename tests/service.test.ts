import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation } from '@earendil-works/pi-durable';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { ResidentServer } from '../src/service/server';
import { ServiceClient } from '../src/service/client';
import { servicePaths } from '../src/shared/service-paths';
import type { ConversationInfo } from '../src/shared/types';
import { launchAgentDefinition } from '../src/service/launchd';

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Service condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(t: TestContext) {
  const root = mkdtempSync('/tmp/tian-service-');
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
    rmSync(root, { recursive: true, force: true });
  });
  const client = (emit?: ConstructorParameters<typeof ServiceClient>[1]) => {
    const instance = new ServiceClient(paths.socketPath, emit, {
      reconnectDelayMs: 10,
      readyTimeoutMs: 2_000,
    });
    clients.push(instance);
    return instance;
  };
  return { root, paths, server, client };
}

test('closing every desktop client leaves the service and persistent data running', async (t) => {
  const f = await fixture(t);
  const app = f.client();
  const before = await app.start();
  await app.invoke('addTask', ['global', 'Continue without the App', null]);
  app.close();
  f.server.service.data.remember('global', 'The service owns shared memory');
  const another = f.client();
  const after = await another.start();
  assert.equal(after.pid, before.pid);
  assert.equal(after.startedAt, before.startedAt);
  assert.equal(
    (await another.invoke('listTasks', ['global']))[0].title,
    'Continue without the App',
  );
  assert.match(
    (await another.invoke('memoryDump', ['global'])).items[0].content,
    /shared memory/,
  );
});

test('channel sessions are independent, stable, and share scope memory', async (t) => {
  const f = await fixture(t);
  const app = f.client();
  const telegram = f.client();
  const binding = {
    channel: 'telegram',
    externalId: 'owner:chat:topic',
    scopeId: 'global',
  };
  const [a, b] = await Promise.all([
    app.invoke('openSession', [{ ...binding, channel: 'app' }]),
    telegram.invoke('openSession', [binding]),
  ]);
  assert.notEqual(a.conversationId, b.conversationId);
  const [again, concurrent] = await Promise.all([
    telegram.invoke('openSession', [binding]),
    telegram.invoke('openSession', [binding]),
  ]);
  assert.equal(again.conversationId, b.conversationId);
  assert.equal(concurrent.conversationId, b.conversationId);
  f.server.service.data.remember('global', 'One memory for all channels');
  assert.deepEqual(
    await app.invoke('memoryDump', ['global']),
    await telegram.invoke('memoryDump', ['global']),
  );
  assert.equal(
    f.server.service.db.conversationScope(a.conversationId),
    'global',
  );
  assert.equal(
    f.server.service.db.conversationScope(b.conversationId),
    'global',
  );
});

test('conversations archive and restore through the command surface', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const events: ConversationInfo[][] = [];
  const watcher = f.client((channel, payload) => {
    if (channel === 'conversations') events.push(payload as ConversationInfo[]);
  });
  // Clients connect lazily on first call; join before broadcasts matter.
  await watcher.start();
  const created = await client.invoke('createConversation', ['global']);
  assert.equal(created.archivedAt, null);

  await client.invoke('archiveConversation', [created.conversationId, true]);
  const listed = await client.invoke('listConversations', []);
  assert.ok(
    listed.find((c) => c.conversationId === created.conversationId)!.archivedAt,
  );
  // Notification routing must not resurrect an archived conversation.
  assert.equal(f.server.service.db.latestConversation('global'), undefined);
  assert.ok(
    events.some((rows) =>
      rows.some(
        (c) => c.conversationId === created.conversationId && c.archivedAt,
      ),
    ),
  );

  await client.invoke('archiveConversation', [created.conversationId, false]);
  const restored = await client.invoke('listConversations', []);
  assert.equal(
    restored.find((c) => c.conversationId === created.conversationId)!
      .archivedAt,
    null,
  );
  await assert.rejects(
    client.invoke('archiveConversation', ['missing', true]),
    /Unknown chief conversation/,
  );
});

test('the same external chat can bind separate sessions to different scopes', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const project = join(f.root, 'project');
  mkdirSync(project);
  const scopes = await client.invoke('addProject', ['project', project]);
  const projectId = scopes.find((scope) => scope.kind === 'project')!.id;
  const binding = {
    channel: 'telegram',
    externalId: 'chat:1',
    scopeId: 'global',
  };
  const general = await client.invoke('openSession', [binding]);
  const scoped = await client.invoke('openSession', [
    { ...binding, scopeId: projectId },
  ]);
  assert.notEqual(general.conversationId, scoped.conversationId);
  f.server.service.data.remember(projectId, 'Project memory stays scoped');
  assert.equal((await client.invoke('memoryDump', ['global'])).items.length, 0);
  assert.equal(
    (await client.invoke('memoryDump', [projectId])).items.length,
    1,
  );
});

test('identical local client IDs from different connections cannot steal conversation watches', async (t) => {
  const f = await fixture(t);
  const aViews: string[] = [],
    bViews: string[] = [];
  const a = f.client((channel, payload) => {
    if (channel === 'view')
      aViews.push((payload as { conversationId: string }).conversationId);
  });
  const b = f.client((channel, payload) => {
    if (channel === 'view')
      bViews.push((payload as { conversationId: string }).conversationId);
  });
  const first = await a.invoke('createConversation', ['global']);
  const second = await b.invoke('createConversation', ['global']);
  await a.invoke('watch', [first.conversationId], 1);
  await b.invoke('watch', [second.conversationId], 1);
  assert.deepEqual(aViews, [first.conversationId]);
  assert.deepEqual(bViews, [second.conversationId]);
  a.close();
  await b.invoke('watch', [second.conversationId], 1);
  assert.equal(bViews.length, 2);
  assert.ok(bViews.every((id) => id === second.conversationId));
});

test('usage stats bucket assistant tokens by local day for each scope', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const project = join(f.root, 'project');
  mkdirSync(project);
  const scopes = await client.invoke('addProject', ['project', project]);
  const projectId = scopes.find((scope) => scope.kind === 'project')!.id;
  const agents = (
    f.server.service as unknown as {
      agents: {
        conversation(id: string): Promise<Conversation>;
        createChief(cwd: string): Promise<Conversation>;
      };
    }
  ).agents;
  const global = await agents.conversation(
    (await client.invoke('createConversation', ['global'])).conversationId,
  );
  const scoped = await agents.conversation(
    (await client.invoke('createConversation', [projectId])).conversationId,
  );
  const worker = await agents.createChief(project);
  f.server.service.db.addRun({
    id: 'r1',
    projectId,
    conversationId: String(worker.id),
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'work',
    currentPrompt: 'work',
    rootPath: project,
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

  const record = (
    conversation: Conversation,
    timestamp: number,
    tokens: number,
    cost: number,
  ) =>
    conversation.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: 'pi.assistant',
          model: [
            {
              role: 'assistant',
              content: [],
              api: 'anthropic-messages',
              provider: 'anthropic',
              model: 'test-model',
              usage: {
                input: tokens,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: tokens,
                cost: {
                  input: cost,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: cost,
                },
              },
              stopReason: 'stop',
              timestamp,
            } satisfies AssistantMessage,
          ],
        }),
      BACKGROUND_CONTEXT,
    );
  const dayA = new Date('2026-10-01T12:00:00').getTime();
  const dayB = new Date('2026-10-02T12:00:00').getTime();
  await record(global, dayA, 100, 0.5);
  await record(scoped, dayA, 200, 1);
  await record(scoped, dayB, 50, 0.25);
  await record(worker, dayB, 400, 2);

  const all = await client.invoke('usageStats', [null]);
  assert.deepEqual(
    all.days.map((day) => [day.date, day.totalTokens]),
    [
      ['2026-10-01', 300],
      ['2026-10-02', 450],
    ],
  );
  assert.equal(all.days[1].cost, 2.25);
  assert.equal(all.days[1].messages, 2);
  const general = await client.invoke('usageStats', ['global']);
  assert.deepEqual(
    general.days.map((day) => [day.date, day.totalTokens]),
    [['2026-10-01', 100]],
  );
  const scopedStats = await client.invoke('usageStats', [projectId]);
  assert.deepEqual(
    scopedStats.days.map((day) => [day.date, day.totalTokens]),
    [
      ['2026-10-01', 200],
      ['2026-10-02', 450],
    ],
  );
});

test('a second daemon cannot open the same storage and socket permissions are private', async (t) => {
  const f = await fixture(t);
  const duplicate = new ResidentServer(f.paths);
  await assert.rejects(duplicate.start(), /lock|locked/i);
  await duplicate.close();
  assert.equal(statSync(f.paths.dataDir).mode & 0o777, 0o700);
  assert.equal(statSync(f.paths.socketPath).mode & 0o777, 0o600);
  assert.equal((await f.client().invoke('listScopes', []))[0].id, 'global');
});

test('the socket transport rejects invalid arguments and native-dialog requests', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  await assert.rejects(
    client.invoke('updateProject', ['p1', { autoLand: 1 } as never]),
    /Invalid command/,
  );
  await assert.rejects(client.invoke('pickDir', []), /desktop client/);
  assert.equal((await client.invoke('listScopes', []))[0].id, 'global');
});

test('the manager channel is reserved: openSession cannot bind it', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  await assert.rejects(
    client.invoke('openSession', [
      { channel: 'manager', externalId: 'global', scopeId: 'global' },
    ]),
    /reserved/,
  );
  await assert.rejects(
    client.invoke('openSession', [
      { channel: 'manager', externalId: 'p-1', scopeId: 'p-1' },
    ]),
    /reserved/,
  );
});

test('openManager exposes the project manager conversation to Tian directly', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const project = join(f.root, 'project');
  mkdirSync(project);
  const scopes = await client.invoke('addProject', ['alpha', project]);
  const projectId = scopes.find((scope) => scope.kind === 'project')!.id;
  const manager = await client.invoke('openManager', [projectId]);
  assert.equal(manager.role, 'manager');
  assert.equal(manager.title, 'Manager · alpha');
  assert.equal(manager.scopeId, projectId);
  // Repeat calls are idempotent: same bound conversation.
  const again = await client.invoke('openManager', [projectId]);
  assert.equal(again.conversationId, manager.conversationId);
  // listConversations carries the role for both kinds.
  const chief = await client.invoke('createConversation', [projectId]);
  const listed = await client.invoke('listConversations', []);
  assert.equal(
    listed.find((c) => c.conversationId === manager.conversationId)?.role,
    'manager',
  );
  assert.equal(
    listed.find((c) => c.conversationId === chief.conversationId)?.role,
    'chief',
  );
  // Global has no manager.
  await assert.rejects(client.invoke('openManager', ['global']), /project/i);
});

test('service restart restores sessions and memory; existing clients reconnect', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const binding = {
    channel: 'telegram',
    externalId: 'chat:stable',
    scopeId: 'global',
  };
  const session = await client.invoke('openSession', [binding]);
  f.server.service.data.remember('global', 'Persistent memory');
  const before = client.info!.startedAt;
  await f.server.close();
  await until(() => client.info === null);
  const replacement = new ResidentServer(f.paths);
  try {
    await replacement.start();
    await until(() => client.info !== null);
    assert.notEqual(client.info!.startedAt, before);
    assert.equal(
      (await client.invoke('openSession', [binding])).conversationId,
      session.conversationId,
    );
    assert.match(
      (await client.invoke('memoryDump', ['global'])).items[0].content,
      /Persistent memory/,
    );
  } finally {
    client.close();
    await replacement.close();
  }
});

test('goal commands round-trip over the socket, including their events', async (t) => {
  const f = await fixture(t);
  const events: string[] = [];
  const app = f.client((channel) => events.push(channel));
  await app.start();
  const goal = await app.invoke('createGoal', [
    'global',
    'Ship wave 1',
    'tests green',
    'no push',
    2,
  ]);
  assert.equal(goal.status, 'active');
  assert.ok(goal.conversationId);
  const scheduled = await app.invoke('addSchedule', [
    goal.id,
    '*/5 * * * *',
    'UTC',
  ]);
  assert.equal(scheduled.schedules.length, 1);
  const run = await app.invoke('runGoalNow', [goal.id]);
  assert.equal(run.trigger, 'manual');
  assert.equal(run.owner, 'agent');
  assert.equal((await app.invoke('listGoals', ['global'])).length, 1);
  assert.deepEqual(await app.invoke('listNotices', ['global']), []);
  assert.equal((await app.invoke('listTasks', ['global'])).length, 1);
  await app.invoke('setGoalStatus', [goal.id, 'paused']);
  const removed = await app.invoke('removeSchedule', [
    scheduled.schedules[0].id,
  ]);
  assert.equal(removed.schedules.length, 0);
  // Goal and notice events must reach the client without breaking the socket.
  assert.ok(events.includes('goals'));
  assert.equal((await app.invoke('listScopes', []))[0].id, 'global');
});

test('a refused maintenance request leaves the scheduler firing', async (t) => {
  const f = await fixture(t);
  const service = f.server.service;
  const goal = await service.createGoal('global', 'Keep firing', '', '', 3);
  const due = new Date(Date.now() - 60_000).toISOString();
  service.goals.insertSchedule({
    goalId: goal.id,
    cron: '* * * * *',
    timezone: 'UTC',
    nextFireAt: due,
  });
  // A running run makes the service refuse to stop for an update.
  service.db.addRun({
    id: 'r-busy',
    projectId: 'p-none',
    conversationId: null,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'busy',
    currentPrompt: 'busy',
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
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(service.scheduler.running, true);
  await assert.rejects(service.beginMaintenance(), /still running/);
  // The refusal must not silently stop schedules until the next activate().
  assert.equal(service.scheduler.running, true);
  assert.equal((await service.activity()).maintenance, false);
  service.db.patchRun('r-busy', { status: 'done', reviewStatus: 'discarded' });
  const fired = await service.scheduler.fireDue();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].goalId, goal.id);
});

test('improvement entries are added, promoted, resolved, and listed over IPC', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const entry = await client.invoke('addImprovement', [
    'global',
    'idea',
    'Show the run diff inline',
    'Avoid a round trip to the diff pane.',
    'medium',
  ]);
  assert.equal(entry.status, 'open');
  assert.equal(entry.source, 'user');
  const list = await client.invoke('listImprovements', [null]);
  assert.equal(list.length, 1);
  assert.equal(list[0].summary, entry.summary);
  assert.equal(
    (await client.invoke('getImprovement', [entry.id])).detail,
    'Avoid a round trip to the diff pane.',
  );

  const promoted = await client.invoke('promoteImprovement', [entry.id]);
  assert.equal(promoted.status, 'promoted');
  assert.notEqual(promoted.taskId, null);
  const tasks = await client.invoke('listTasks', ['global']);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Show the run diff inline');

  const again = await client.invoke('promoteImprovement', [entry.id]);
  assert.equal(again.taskId, promoted.taskId);
  assert.equal((await client.invoke('listTasks', ['global'])).length, 1);

  const resolved = await client.invoke('setImprovementStatus', [
    entry.id,
    'resolved',
  ]);
  assert.equal(resolved.status, 'resolved');

  await client.invoke('reportClientIssue', [
    'Renderer failed to mount',
    'component stack',
  ]);
  const issues = (await client.invoke('listImprovements', [null])).filter(
    (item) => item.area === 'renderer',
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'issue');
  assert.equal(issues[0].source, 'system');

  f.server.service.reportIssue('test.capture', new Error('boom'));
  f.server.service.reportIssue('test.capture', new Error('boom'));
  const captured = (await client.invoke('listImprovements', [null])).filter(
    (item) => item.area === 'test.capture',
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0].occurrences, 2);
});

test(
  'LaunchAgent runs Node from a stable release and automatically restarts at login',
  { skip: process.platform !== 'darwin' },
  () => {
    const paths = servicePaths('/tmp/tian-launch-agent-test');
    const definition = launchAgentDefinition(
      { paths, nodePath: '/absolute/node', label: 'dev.tian.agent.test' },
      '/absolute/release/service.cjs',
    );
    assert.deepEqual(definition.ProgramArguments, [
      '/absolute/node',
      '/absolute/release/service.cjs',
      '--data-dir',
      paths.dataDir,
    ]);
    assert.equal(definition.RunAtLoad, true);
    assert.equal(definition.KeepAlive, true);
    assert.equal(definition.Umask, 0o077);
    assert.equal(
      definition.EnvironmentVariables.TIAN_AGENT_SOCKET_PATH,
      paths.socketPath,
    );
    assert.equal(
      Object.hasOwn(definition.EnvironmentVariables, 'ANTHROPIC_API_KEY'),
      false,
    );
  },
);
