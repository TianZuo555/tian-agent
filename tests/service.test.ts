import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ResidentServer } from '../src/service/server';
import { ServiceClient } from '../src/service/client';
import { servicePaths } from '../src/shared/service-paths';
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
  f.server.service.data.note('global', 'The service owns shared memory');
  const another = f.client();
  const after = await another.start();
  assert.equal(after.pid, before.pid);
  assert.equal(after.startedAt, before.startedAt);
  assert.equal(
    (await another.invoke('listTasks', ['global']))[0].title,
    'Continue without the App',
  );
  assert.match(
    (await another.invoke('memoryDump', ['global'])).lines[0],
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
  f.server.service.data.note('global', 'One memory for all channels');
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
  f.server.service.data.note(projectId, 'Project memory stays scoped');
  assert.equal((await client.invoke('memoryDump', ['global'])).lines.length, 0);
  assert.equal(
    (await client.invoke('memoryDump', [projectId])).lines.length,
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

test('service restart restores sessions and memory; existing clients reconnect', async (t) => {
  const f = await fixture(t);
  const client = f.client();
  const binding = {
    channel: 'telegram',
    externalId: 'chat:stable',
    scopeId: 'global',
  };
  const session = await client.invoke('openSession', [binding]);
  f.server.service.data.note('global', 'Persistent memory');
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
      (await client.invoke('memoryDump', ['global'])).lines[0],
      /Persistent memory/,
    );
  } finally {
    client.close();
    await replacement.close();
  }
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
