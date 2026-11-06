import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ResidentServer } from '../src/service/server';
import { ServiceClient } from '../src/service/client';
import { servicePaths } from '../src/shared/service-paths';
import type { Settings } from '../src/worker/settings';
import type { AgentRuntime } from '../src/worker/agents';
import { createModels } from '@earendil-works/pi-ai/models';
import type { Credential, Provider } from '@earendil-works/pi-ai';
import type { ProviderLoginEvent } from '../src/shared/types';

async function fixture(t: TestContext) {
  const root = mkdtempSync('/tmp/tian-providers-');
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
  return { root, server, client };
}

/** The service's private Settings/AgentRuntime — a test-only seam. */
function internals(service: unknown): {
  settings: Settings;
  agents: AgentRuntime;
} {
  return service as unknown as { settings: Settings; agents: AgentRuntime };
}

test('provider CRUD and key redaction over IPC', async (t) => {
  const f = await fixture(t);
  const app = f.client();
  await app.start();

  const initial = await app.invoke('listProviders', []);
  assert.deepEqual(
    initial.map((provider) => provider.id),
    ['magpie'],
  );
  assert.equal(initial[0].hasKey, false);

  await app.invoke('addProvider', [
    {
      id: 'bigco',
      kind: 'gateway',
      name: 'BigCo',
      baseUrl: 'https://llm.example.com/v1',
    },
  ]);
  let providers = await app.invoke('listProviders', []);
  assert.equal(providers.length, 2);
  assert.equal(providers[1].id, 'bigco');
  assert.equal(providers[1].enabled, true);
  const { models } = internals(f.server.service).agents as unknown as {
    models: ReturnType<Settings['models']>;
  };
  assert.ok(models.getProvider('bigco'));

  await app.invoke('setProviderKey', ['bigco', 'sk-live-123456']);
  providers = await app.invoke('listProviders', []);
  const bigco = providers.find((provider) => provider.id === 'bigco');
  assert.equal(bigco?.hasKey, true);
  assert.equal(bigco?.keyTail, '…3456');
  assert.equal(bigco?.credentialType, 'api_key');
  assert.equal(JSON.stringify(providers).includes('sk-live-123456'), false);

  await app.invoke('updateProvider', [
    'bigco',
    { id: 'bigco', kind: 'gateway', name: 'BigCo', enabled: false },
  ]);
  providers = await app.invoke('listProviders', []);
  assert.equal(
    providers.find((provider) => provider.id === 'bigco')?.enabled,
    false,
  );
  assert.equal(models.getProvider('bigco'), undefined);

  await app.invoke('deleteProviderKey', ['bigco']);
  providers = await app.invoke('listProviders', []);
  assert.equal(
    providers.find((provider) => provider.id === 'bigco')?.hasKey,
    false,
  );

  await app.invoke('updateProvider', [
    'bigco',
    { id: 'bigco', kind: 'gateway', enabled: true },
  ]);
  assert.ok(models.getProvider('bigco'));
  await app.invoke('removeProvider', ['bigco']);
  providers = await app.invoke('listProviders', []);
  assert.equal(providers.length, 1);
  assert.equal(models.getProvider('bigco'), undefined);

  // Validation: bad id, duplicate id, and removing the magpie preset.
  await assert.rejects(
    app.invoke('addProvider', [{ id: 'Bad ID', kind: 'builtin' }]),
  );
  await assert.rejects(app.invoke('removeProvider', ['magpie']), /preset/);
});

test('chief and manager models are separate settings', async (t) => {
  const f = await fixture(t);
  const app = f.client();
  await app.start();

  await app.invoke('setManagerModel', [
    { provider: 'magpie', modelId: 'mgr/model' },
  ]);
  let settings = await app.invoke('getSettings', []);
  assert.deepEqual(settings.managerModel, {
    provider: 'magpie',
    modelId: 'mgr/model',
  });

  // Updating the chief model must keep the manager model.
  await app.invoke('setModel', [
    { provider: 'magpie', modelId: 'chief/model' },
  ]);
  settings = await app.invoke('getSettings', []);
  assert.equal(settings.model.modelId, 'chief/model');
  assert.equal(settings.managerModel?.modelId, 'mgr/model');
});

test('a project manager model override resolves for its manager', async (t) => {
  const f = await fixture(t);
  const app = f.client();
  await app.start();
  await app.invoke('addProvider', [
    {
      id: 'bigco',
      kind: 'gateway',
      baseUrl: 'https://llm.example.com/v1',
    },
  ]);
  const rootPath = join(f.root, 'alpha');
  mkdirSync(rootPath, { recursive: true });
  await app.invoke('addProject', ['alpha', rootPath, '阿七']);

  const service = f.server.service;
  const project = service.db
    .listProjects()
    .find((entry) => entry.name === 'alpha');
  assert.ok(project);

  // Invalid references are rejected at write time.
  await assert.rejects(
    app.invoke('updateProject', [
      project.id,
      { managerModel: 'no-such-provider:x' },
    ]),
    /Unknown provider/,
  );
  await assert.rejects(
    app.invoke('updateProject', [project.id, { managerModel: 'no-colon' }]),
    /provider:model/,
  );

  await app.invoke('updateProject', [
    project.id,
    { managerModel: 'bigco:strong/model' },
  ]);
  assert.equal(
    service.db.getProject(project.id)?.managerModel,
    'bigco:strong/model',
  );

  // createManager receives the override; clearing falls back to the default.
  const created: { model?: { provider: string; modelId: string } }[] = [];
  const agents = internals(service).agents as AgentRuntime & {
    createManager(
      cwd: string,
      model: { provider: string; modelId: string },
    ): Promise<unknown>;
  };
  const original = agents.createManager.bind(agents);
  agents.createManager = async (cwd: string, model) => {
    created.push({ model });
    return original(cwd, model);
  };
  await service.createConversation(project.id, true);
  assert.deepEqual(created[0]?.model, {
    provider: 'bigco',
    modelId: 'strong/model',
  });

  await app.invoke('updateProject', [project.id, { managerModel: '' }]);
  assert.equal(service.db.getProject(project.id)?.managerModel, null);
  await service.createConversation(project.id, true);
  assert.equal(created[1]?.model?.provider, 'magpie');
});

test('oauth login streams events, answers prompts, persists the credential', async (t) => {
  const f = await fixture(t);
  const events: ProviderLoginEvent['event'][] = [];
  const app = f.client((channel, payload) => {
    if (channel === 'providerLogin')
      events.push((payload as ProviderLoginEvent).event);
  });
  await app.start();
  await app.invoke('addProvider', [
    { id: 'fakeco', kind: 'builtin', builtinId: 'anthropic' },
  ]);

  // A fake OAuth provider inside the Models instance providerLogin uses.
  const service = f.server.service;
  const { settings } = internals(service);
  const models = createModels({
    credentials: (
      service as unknown as {
        credentials: import('../src/worker/credentials').FileCredentialStore;
      }
    ).credentials,
  });
  models.setProvider({
    id: 'fakeco',
    name: 'FakeCo',
    auth: {
      oauth: {
        async login(interaction: {
          notify: (event: unknown) => void;
          prompt: (prompt: unknown) => Promise<string>;
        }): Promise<Credential> {
          interaction.notify({
            type: 'auth_url',
            url: 'https://fake.example/auth',
            instructions: 'open it',
          });
          interaction.notify({
            type: 'device_code',
            userCode: 'ABCD-1234',
            verificationUri: 'https://fake.example/device',
          });
          const code = await interaction.prompt({
            type: 'text',
            message: 'Paste the code',
          });
          return {
            type: 'oauth',
            access: `access-${code}`,
            refresh: 'refresh-1',
            expires: Date.now() + 3_600_000,
          };
        },
        async refresh(credential: Credential) {
          return credential;
        },
        async toAuth() {
          return { headers: {} };
        },
      },
    },
    getModels: () => [],
    stream: () => {
      throw new Error('unused');
    },
    streamSimple: () => {
      throw new Error('unused');
    },
  } as unknown as Provider);
  const original = settings.models.bind(settings);
  settings.models = () => models;
  t.after(() => {
    settings.models = original;
  });

  const login = app.invoke('providerLogin', ['fakeco']);
  // The prompt event arrives first; answer it, then the login completes.
  const deadline = Date.now() + 5_000;
  while (
    !events.some((event) => event.type === 'prompt') &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  const prompt = events.find((event) => event.type === 'prompt');
  assert.ok(prompt && prompt.type === 'prompt');
  await app.invoke('providerLoginAnswer', [
    'fakeco',
    prompt.promptId,
    'code-42',
  ]);
  await login;

  assert.deepEqual(
    events.map((event) => event.type),
    ['auth_url', 'device_code', 'prompt', 'done'],
  );
  const providers = await app.invoke('listProviders', []);
  const fakeco = providers.find((provider) => provider.id === 'fakeco');
  assert.equal(fakeco?.hasKey, true);
  assert.equal(fakeco?.credentialType, 'oauth');
  assert.equal(fakeco?.keyTail, '…e-42');

  // A gateway provider cannot OAuth-login.
  await assert.rejects(
    app.invoke('providerLogin', ['magpie']),
    /no OAuth login/,
  );
});
