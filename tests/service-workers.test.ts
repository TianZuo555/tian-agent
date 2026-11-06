import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ResidentServer } from '../src/service/server';
import { ServiceClient } from '../src/service/client';
import { servicePaths } from '../src/shared/service-paths';
import type { Service } from '../src/worker/service';
import type { Settings } from '../src/worker/settings';
import type { WorkerChoice } from '../src/worker/runs';
import type { DispatchInput } from '../src/worker/runs';
import type { ModelInfo, WorkerSettingsInfo } from '../src/shared/types';

async function fixture(t: TestContext) {
  const root = mkdtempSync('/tmp/tian-workers-');
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
  const client = new ServiceClient(paths.socketPath, undefined, {
    reconnectDelayMs: 10,
    readyTimeoutMs: 2_000,
  });
  clients.push(client);
  await client.start();
  return { root, server, client };
}

/** The service's private Settings + choice resolver — a test-only seam. */
function internals(service: unknown): {
  settings: Settings;
  resolve: (
    input: DispatchInput,
    project: { defaultIntent: string | null },
  ) => WorkerChoice;
} {
  const s = service as Service;
  return {
    settings: (s as unknown as { settings: Settings }).settings,
    resolve: (input, project) =>
      (
        s as unknown as {
          resolveWorkerChoice: (
            input: DispatchInput,
            project: { defaultIntent: string | null },
          ) => WorkerChoice;
        }
      ).resolveWorkerChoice(input, project),
  };
}

/** A catalog entry so pi intents can name a model. */
function plantCatalog(
  settings: Settings,
  models: ModelInfo[] = [
    {
      id: 'cheap',
      name: 'Cheap',
      reasoning: true,
      levels: ['low', 'high'],
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 8_192,
    },
  ],
): void {
  (settings as unknown as { catalogs: Record<string, ModelInfo[]> }).catalogs =
    { magpie: models };
}

const baseInput: DispatchInput = {
  projectRef: 'p1',
  prompt: 'do the thing',
  chiefConversationId: 'conv-mgr',
};
const noDefault = { defaultIntent: null };

test('setWorkers stores caps and intents; limits feed the orchestrator', async (t) => {
  const f = await fixture(t);
  const { settings } = internals(f.server.service);
  plantCatalog(settings);
  const block: WorkerSettingsInfo = {
    maxConcurrent: 4,
    runtimes: [
      { id: 'pi', enabled: true, maxConcurrent: 2 },
      { id: 'codex', enabled: false, maxConcurrent: null },
    ],
    intents: [
      {
        name: 'review',
        runtime: 'pi',
        model: 'cheap',
        thinkingLevel: 'high',
        purpose: 'careful reviews',
      },
      { name: 'simple', runtime: 'pi', model: null, thinkingLevel: null },
    ],
  };
  await f.client.invoke('setWorkers', [block]);
  const info = await f.client.invoke('getSettings', []);
  assert.equal(info.workers.maxConcurrent, 4);
  assert.equal(info.workers.runtimes[0].id, 'pi');
  assert.equal(info.workers.runtimes[0].maxConcurrent, 2);
  assert.equal(info.workers.runtimes[1].enabled, false);
  assert.deepEqual(
    info.workers.intents.map((intent) => intent.name),
    ['review', 'simple'],
  );
  assert.deepEqual(settings.workerLimits(), {
    global: 4,
    runtimes: { pi: 2 },
  });
});

test('setWorkers rejects invalid intents and disabled pi', async (t) => {
  const f = await fixture(t);
  const { settings } = internals(f.server.service);
  plantCatalog(settings);
  const valid: WorkerSettingsInfo = {
    maxConcurrent: 3,
    runtimes: [{ id: 'pi', enabled: true }],
    intents: [],
  };
  await assert.rejects(
    f.client.invoke('setWorkers', [
      { ...valid, runtimes: [{ id: 'pi', enabled: false }] },
    ]),
    /always enabled/,
  );
  await assert.rejects(
    f.client.invoke('setWorkers', [
      {
        ...valid,
        intents: [
          { name: 'a', runtime: 'pi' },
          { name: 'a', runtime: 'pi' },
        ],
      },
    ]),
    /duplicate/,
  );
  // An invalid name fails at the wire schema before reaching the service.
  await assert.rejects(
    f.client.invoke('setWorkers', [
      { ...valid, intents: [{ name: 'Bad Name', runtime: 'pi' }] },
    ]),
    /Invalid command or arguments/,
  );
  await assert.rejects(
    f.client.invoke('setWorkers', [
      { ...valid, intents: [{ name: 'x', runtime: 'codex' }] },
    ]),
    /disabled or unknown runtime/,
  );
  await assert.rejects(
    f.client.invoke('setWorkers', [
      { ...valid, intents: [{ name: 'x', runtime: 'pi', model: 'nope' }] },
    ]),
    /unknown model/,
  );
});

test('dispatch resolves intent, explicit pins, and the project default', async (t) => {
  const f = await fixture(t);
  const { settings, resolve } = internals(f.server.service);
  plantCatalog(settings);
  settings.setWorkers({
    maxConcurrent: 3,
    runtimes: [{ id: 'pi', enabled: true }],
    intents: [
      {
        name: 'review',
        runtime: 'pi',
        model: 'cheap',
        thinkingLevel: 'high',
      },
    ],
  });

  // 1. An intent resolves to its stored spec.
  assert.deepEqual(resolve({ ...baseInput, intent: 'review' }, noDefault), {
    runtime: 'pi',
    model: 'cheap',
    thinkingLevel: 'high',
  });
  // 2. Explicit pins validate against the catalog.
  assert.deepEqual(
    resolve({ ...baseInput, runtime: 'pi', model: 'cheap' }, noDefault),
    { runtime: 'pi', model: 'cheap', thinkingLevel: null },
  );
  // Explicit pins also override a project's configured default intent.
  assert.deepEqual(
    resolve(
      { ...baseInput, runtime: 'pi', model: 'cheap', thinkingLevel: 'low' },
      { defaultIntent: 'review' },
    ),
    { runtime: 'pi', model: 'cheap', thinkingLevel: 'low' },
  );
  // Even a removed default must not prevent an explicit dispatch.
  assert.deepEqual(
    resolve(
      { ...baseInput, runtime: 'pi', model: 'cheap' },
      { defaultIntent: 'gone' },
    ),
    { runtime: 'pi', model: 'cheap', thinkingLevel: null },
  );
  // 3. Neither falls to the project default intent.
  assert.deepEqual(resolve(baseInput, { defaultIntent: 'review' }), {
    runtime: 'pi',
    model: 'cheap',
    thinkingLevel: 'high',
  });
  // No project default at all: pi with the app-wide model.
  assert.deepEqual(resolve(baseInput, noDefault), {
    runtime: 'pi',
    model: null,
    thinkingLevel: null,
  });
});

test('dispatch choice errors: exclusivity, unknown intent, disabled runtime', async (t) => {
  const f = await fixture(t);
  const { settings, resolve } = internals(f.server.service);
  settings.setWorkers({
    maxConcurrent: 3,
    runtimes: [
      { id: 'pi', enabled: true },
      { id: 'codex', enabled: false },
    ],
    intents: [{ name: 'review', runtime: 'pi' }],
  });

  assert.throws(
    () =>
      resolve({ ...baseInput, intent: 'review', model: 'cheap' }, noDefault),
    /mutually exclusive/,
  );
  assert.throws(
    () => resolve({ ...baseInput, intent: 'nope' }, noDefault),
    /Unknown intent/,
  );
  assert.throws(
    () => resolve({ ...baseInput, runtime: 'codex' }, noDefault),
    /not enabled/,
  );
  // A deleted project default surfaces as an unknown intent at dispatch.
  assert.throws(
    () => resolve(baseInput, { defaultIntent: 'gone' }),
    /Unknown intent/,
  );
});

test('updateProject validates and stores the default intent', async (t) => {
  const f = await fixture(t);
  const { settings } = internals(f.server.service);
  settings.setWorkers({
    maxConcurrent: 3,
    runtimes: [{ id: 'pi', enabled: true }],
    intents: [{ name: 'review', runtime: 'pi' }],
  });
  const rootPath = join(f.root, 'alpha');
  mkdirSync(rootPath, { recursive: true });
  await f.client.invoke('addProject', ['alpha', rootPath, '阿七']);
  const project = f.server.service.db
    .listProjects()
    .find((entry) => entry.name === 'alpha');
  assert.ok(project);

  await assert.rejects(
    f.client.invoke('updateProject', [project.id, { defaultIntent: 'nope' }]),
    /Unknown intent/,
  );
  await f.client.invoke('updateProject', [
    project.id,
    { defaultIntent: 'review' },
  ]);
  assert.equal(
    f.server.service.db.getProject(project.id)?.defaultIntent,
    'review',
  );
  await f.client.invoke('updateProject', [project.id, { defaultIntent: '' }]);
  assert.equal(f.server.service.db.getProject(project.id)?.defaultIntent, null);
});

test('updateProject stores and scopes sandbox settings', async (t) => {
  const f = await fixture(t);
  const rootPath = join(f.root, 'beta');
  mkdirSync(rootPath, { recursive: true });
  await f.client.invoke('addProject', ['beta', rootPath, '阿七']);
  const project = f.server.service.db
    .listProjects()
    .find((entry) => entry.name === 'beta');
  assert.ok(project);
  // New projects start sandboxed (Phase 5 default-on).
  assert.equal(project.sandboxMode, 'workspace-write');
  assert.equal(project.sandboxNetwork, 1);

  await f.client.invoke('updateProject', [
    project.id,
    {
      sandboxMode: 'off',
      sandboxNetwork: false,
      sandboxExtraWrite: '/opt/cache\n/opt/tools',
      sandboxAllowRead: `${process.env.HOME}/.aws`,
    },
  ]);
  const updated = f.server.service.db.getProject(project.id)!;
  assert.equal(updated.sandboxMode, 'off');
  assert.equal(updated.sandboxNetwork, 0);
  assert.equal(updated.sandboxExtraWrite, '/opt/cache\n/opt/tools');
  const scope = f.server.service.listScopes().find((s) => s.id === project.id);
  assert.equal(scope?.settings?.sandboxMode, 'off');
  assert.equal(scope?.settings?.sandboxNetwork, false);
});

test('codex starts disabled and switches on only after its check passes', async (t) => {
  const f = await fixture(t);
  // A fake codex on PATH: installed, and signed in only when $root/ok exists.
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'codex'),
    `#!/bin/sh\ncase "$1" in\n  --version) echo 'codex-cli 9.9.9' ;;\n  login) [ -f '${f.root}/ok' ] || { echo 'Not logged in' >&2; exit 1; } ;;\nesac\n`,
  );
  chmodSync(join(bin, 'codex'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  t.after(() => {
    process.env.PATH = path;
  });
  const info = await f.client.invoke('getSettings', []);
  const codex = info.workers.runtimes.find((runtime) => runtime.id === 'codex');
  assert.equal(codex?.enabled, false);
  const block = (enabled: boolean): WorkerSettingsInfo => ({
    maxConcurrent: 3,
    runtimes: [
      { id: 'pi', enabled: true },
      { id: 'codex', enabled },
    ],
    intents: [],
  });
  await assert.rejects(
    f.client.invoke('setWorkers', [block(true)]),
    /sign-in required/,
  );
  writeFileSync(join(f.root, 'ok'), '');
  await f.client.invoke('setWorkers', [block(true)]);
  const after = await f.client.invoke('getSettings', []);
  assert.equal(
    after.workers.runtimes.find((runtime) => runtime.id === 'codex')?.enabled,
    true,
  );
});
