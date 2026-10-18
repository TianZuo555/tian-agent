import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppStore } from '../src/renderer/state';
import type { CommandApi, TianApi } from '../src/shared/contracts';
import type { AppEvents, TaskItem } from '../src/shared/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function task(scopeId: string, id: number): TaskItem {
  return {
    id,
    scopeId,
    title: `${scopeId} task`,
    status: 'open',
    due: null,
    doneAt: null,
    createdAt: new Date().toISOString(),
  };
}
function mockApi(overrides: Partial<CommandApi> = {}) {
  const listeners = new Map<keyof AppEvents, Set<(payload: never) => void>>();
  const watched = new Set<string>();
  let watchCount = 0;
  const api: TianApi = {
    listScopes: async () => [],
    listConversations: async () => [],
    getSettings: async () => ({
      model: { provider: 'anthropic', modelId: 'test' },
    }),
    listTasks: async () => [],
    memoryDump: async () => ({ lines: [], pendingMerges: 0 }),
    inboxList: async () => [],
    runList: async () => [],
    watch: async (id) => {
      watched.add(id);
      watchCount++;
    },
    unwatch: async (id) => {
      watched.delete(id);
    },
    pickDir: async () => null,
    addProject: async () => [],
    updateProject: async () => [],
    removeProject: async () => [],
    createConversation: async (scopeId) => ({
      conversationId: 'new',
      scopeId,
      title: null,
      createdAt: new Date().toISOString(),
    }),
    openSession: async ({ scopeId }) => ({
      conversationId: 'bound',
      scopeId,
      title: null,
      createdAt: new Date().toISOString(),
    }),
    submit: async () => ({ submissionId: '1' }),
    abort: async () => {},
    addTask: async () => 1,
    doneTask: async () => {},
    runReport: async () => '',
    runDiff: async () => '',
    followUpRun: async () => {
      throw new Error('Unused');
    },
    landRun: async () => '',
    discardRun: async () => {},
    shipRun: async () => '',
    setModel: async () => {},
    usageStats: async () => ({ days: [] }),
    modelCatalog: async () => ({
      models: [],
      ok: true,
      baseUrl: 'http://127.0.0.1:3425/v1',
    }),
    refreshModels: async () => ({
      models: [],
      ok: true,
      baseUrl: 'http://127.0.0.1:3425/v1',
    }),
    ...overrides,
    on(channel, callback) {
      const callbacks = listeners.get(channel) ?? new Set();
      listeners.set(channel, callbacks);
      callbacks.add(callback as (payload: never) => void);
      return () => {
        callbacks.delete(callback as (payload: never) => void);
      };
    },
  };
  return {
    api,
    watched,
    listeners,
    watchCount: () => watchCount,
    emit<K extends keyof AppEvents>(channel: K, payload: AppEvents[K]) {
      for (const callback of listeners.get(channel) ?? [])
        callback(payload as never);
    },
  };
}

test('late scope responses cannot replace the active scope panels', async () => {
  const pending = new Map<string, ReturnType<typeof deferred<TaskItem[]>>>();
  const mock = mockApi({
    listTasks: (scope) => {
      const request = deferred<TaskItem[]>();
      pending.set(scope!, request);
      return request.promise;
    },
  });
  const store = createAppStore(mock.api);
  const a = store.actions.selectScope('A');
  const b = store.actions.selectScope('B');
  pending.get('B')!.resolve([task('B', 2)]);
  await b;
  pending.get('A')!.resolve([task('A', 1)]);
  await a;
  assert.equal(store.getState().activeScopeId, 'B');
  assert.deepEqual(
    store.getState().tasks.map((item) => item.scopeId),
    ['B'],
  );
});

test('a newer event wins over an older snapshot request', async () => {
  const snapshot = deferred<TaskItem[]>();
  const mock = mockApi({ listTasks: () => snapshot.promise });
  const store = createAppStore(mock.api);
  const cleanup = store.actions.init();
  const selection = store.actions.selectScope('A');
  mock.emit('tasks', [task('A', 2)]);
  snapshot.resolve([task('A', 1)]);
  await selection;
  assert.deepEqual(
    store.getState().tasks.map((item) => item.id),
    [2],
  );
  cleanup();
});

test('memory writes refresh the active memory panel', async () => {
  let lines: string[] = [];
  const mock = mockApi({
    memoryDump: async () => ({ lines, pendingMerges: 0 }),
  });
  const store = createAppStore(mock.api);
  const cleanup = store.actions.init();
  await store.actions.refresh();
  lines = ['A lasting fact'];
  mock.emit('memory', 'global');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(store.getState().memory?.lines, ['A lasting fact']);
  cleanup();
});

test('rapid conversation selection leaves only the latest subscription', async () => {
  const mock = mockApi();
  const store = createAppStore(mock.api);
  await Promise.all([
    store.actions.selectConversation('1', 'A'),
    store.actions.selectConversation('2', 'B'),
    store.actions.selectConversation('3', 'C'),
  ]);
  assert.equal(store.getState().activeConversationId, '3');
  assert.deepEqual([...mock.watched], ['3']);
  await store.actions.selectScope('D');
  assert.equal(store.getState().activeConversationId, null);
  assert.equal(mock.watched.size, 0);
});

test('cleanup releases listeners and reinitialization registers each once', async () => {
  const mock = mockApi();
  const store = createAppStore(mock.api);
  const cleanup = store.actions.init();
  await store.actions.refresh();
  await store.actions.selectConversation('1', 'A');
  cleanup();
  assert.equal(
    [...mock.listeners.values()].reduce(
      (sum, callbacks) => sum + callbacks.size,
      0,
    ),
    0,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(mock.watched.size, 0);
  const nextCleanup = store.actions.init();
  await store.actions.refresh();
  for (const callbacks of mock.listeners.values())
    assert.equal(callbacks.size, 1);
  nextCleanup();
});

test('runtime restart restores the active conversation subscription', async () => {
  const mock = mockApi();
  const store = createAppStore(mock.api);
  const cleanup = store.actions.init();
  await store.actions.refresh();
  await store.actions.selectConversation('1', 'A');
  const before = mock.watchCount();
  mock.watched.clear();
  mock.emit('runtime', { status: 'starting' });
  mock.emit('runtime', { status: 'ready' });
  await store.actions.refresh();
  assert.ok(mock.watchCount() > before);
  assert.deepEqual([...mock.watched], ['1']);
  cleanup();
});
