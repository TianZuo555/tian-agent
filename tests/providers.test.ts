import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ProviderConfig } from '../src/shared/types.js';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  builtinCatalog,
  builtinProviderIds,
  catalogForConfig,
  magpieConfig,
  parseModelRef,
} from '../src/worker/providers.js';
import { Settings } from '../src/worker/settings.js';

const dir = () => mkdtempSync(join(tmpdir(), 'tian-providers-'));

// ---- provider configs -------------------------------------------------------

test('the magpie preset exists even with no configured providers', () => {
  const settings = new Settings(dir());
  const providers = settings.providers();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'magpie');
  assert.equal(providers[0].kind, 'gateway');
  assert.equal(providers[0].enabled, true);
  assert.ok(providers[0].baseUrl);
});

test('a configured magpie entry keeps its saved fields with env fallback', () => {
  const root = dir();
  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({
      model: { provider: 'magpie', modelId: 'm1' },
      providers: [
        {
          id: 'magpie',
          kind: 'gateway',
          name: 'My Magpie',
          enabled: true,
        },
      ],
    }),
  );
  const settings = new Settings(root);
  const magpie = settings.providers()[0];
  assert.equal(magpie.name, 'My Magpie');
  // baseUrl falls back to the MAGPIE_BASE_URL env / default for the preset.
  assert.ok(magpie.baseUrl);
});

test('the legacy single catalog migrates into the magpie catalogs map', () => {
  const root = dir();
  const catalog = [
    {
      id: 'm1',
      name: 'm1',
      reasoning: false,
      levels: [],
      input: ['text'],
      contextWindow: 1,
      maxTokens: 1,
    },
  ];
  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({ model: { provider: 'magpie', modelId: 'm1' }, catalog }),
  );
  const settings = new Settings(root);
  assert.deepEqual(settings.catalogFor('magpie'), catalog);
  assert.deepEqual(settings.catalogState().models, catalog);
});

test('catalogFor honors kind, enablement, and unknown ids', () => {
  const root = dir();
  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({
      model: { provider: 'magpie', modelId: 'm1' },
      providers: [
        { id: 'bigco', kind: 'builtin', builtinId: 'anthropic', enabled: true },
        { id: 'off', kind: 'gateway', baseUrl: 'http://x/v1', enabled: false },
      ],
      catalogs: {
        off: [
          {
            id: 'm',
            name: 'm',
            reasoning: false,
            levels: [],
            input: ['text'],
            contextWindow: 1,
            maxTokens: 1,
          },
        ],
      },
    }),
  );
  const settings = new Settings(root);
  assert.equal(settings.catalogFor('off').length, 0); // disabled
  assert.equal(settings.catalogFor('nope').length, 0); // unknown
  assert.ok(settings.catalogFor('bigco').length > 0); // builtin generates
});

test('setModel rejects unknown or disabled providers', () => {
  const settings = new Settings(dir());
  assert.throws(
    () => settings.setModel({ provider: 'nope', modelId: 'x' }),
    /Unknown provider 'nope'/,
  );
  settings.setModel({ provider: 'magpie', modelId: 'workbuddy-ai/x' });
  assert.equal(settings.get().model.modelId, 'workbuddy-ai/x');
});

test('the default manager model survives reopening and clearing settings', () => {
  const root = dir();
  const settings = new Settings(root);
  const manager = { provider: 'magpie', modelId: 'manager-model' };
  const chief = { provider: 'magpie', modelId: 'chief-model' };
  settings.setManagerModel(manager);
  settings.setModel(chief);

  const reopened = new Settings(root);
  assert.deepEqual(reopened.get().managerModel, manager);
  assert.deepEqual(reopened.managerModel(), manager);
  assert.deepEqual(reopened.get().model, chief);

  reopened.setManagerModel(null);
  const cleared = new Settings(root);
  assert.equal(cleared.get().managerModel, undefined);
  assert.deepEqual(cleared.managerModel(), chief);
});

test('models() registers a provider per enabled config', () => {
  const root = dir();
  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({
      model: { provider: 'magpie', modelId: 'm1' },
      providers: [
        { id: 'bigco', kind: 'builtin', builtinId: 'anthropic', enabled: true },
        { id: 'off', kind: 'gateway', enabled: false },
      ],
    }),
  );
  const models = new Settings(root).models();
  assert.ok(models.getProviders().some((provider) => provider.id === 'magpie'));
  assert.ok(models.getProviders().some((provider) => provider.id === 'bigco'));
  assert.ok(!models.getProvider('anthropic'));
  assert.ok(!models.getProviders().some((provider) => provider.id === 'off'));
});

test('the credential store feeds provider registration', async () => {
  const root = dir();
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('bigco', async () => ({
    type: 'api_key',
    key: 'sk-test',
  }));
  const settings = new Settings(root, credentials);
  assert.ok(settings.models()); // construction does not throw
});

test('builtin aliases use their own model ids and credentials', async () => {
  const credentials = new InMemoryCredentialStore();
  const settings = new Settings(dir(), credentials);
  for (const id of ['personal', 'work']) {
    settings.addProvider({
      id,
      kind: 'builtin',
      builtinId: 'anthropic',
      enabled: true,
    });
    await credentials.modify(id, async () => ({
      type: 'api_key',
      key: `${id}-key`,
    }));
  }
  const models = settings.models();
  for (const id of ['personal', 'work']) {
    const provider = models.getProvider(id);
    assert.ok(provider);
    assert.ok(provider.getModels().length > 0);
    assert.ok(provider.getModels().every((model) => model.provider === id));
    assert.ok(
      provider.getAllModels?.().every((model) => model.provider === id),
    );
    const first = provider.getModels()[0];
    const model = models.getModel(id, first.id);
    assert.ok(model);
    assert.equal((await models.getAuth(model))?.auth.apiKey, `${id}-key`);
    assert.ok((await models.getAvailable(id)).length > 0);
  }
  assert.equal(models.getProvider('anthropic'), undefined);
});

// ---- catalogs ---------------------------------------------------------------

test('builtin provider ids cover the well-known providers', () => {
  const ids = builtinProviderIds();
  assert.ok(ids.includes('anthropic'));
  assert.ok(ids.includes('openai'));
});

test('the builtin catalog maps models onto ModelInfo', () => {
  const catalog = builtinCatalog('anthropic');
  assert.ok(catalog.length > 0);
  for (const info of catalog) {
    assert.ok(info.id);
    assert.ok(info.contextWindow > 0);
    assert.ok(info.input.includes('text'));
  }
});

test('catalogForConfig reads gateway cache and generates builtins', () => {
  const gateway: ProviderConfig = {
    id: 'gw',
    kind: 'gateway',
    baseUrl: 'http://x/v1',
    enabled: true,
  };
  const builtin: ProviderConfig = {
    id: 'bigco',
    kind: 'builtin',
    builtinId: 'openai',
    enabled: true,
  };
  const cached = [
    {
      id: 'm',
      name: 'm',
      reasoning: false,
      levels: [],
      input: ['text'] as ('text' | 'image')[],
      contextWindow: 1,
      maxTokens: 1,
    },
  ];
  assert.deepEqual(catalogForConfig(gateway, { gw: cached }), cached);
  assert.deepEqual(catalogForConfig(gateway, {}), []);
  assert.ok(catalogForConfig(builtin, {}).length > 0);
});

// ---- model refs -------------------------------------------------------------

test('parseModelRef splits a qualified ref and keeps bare ids', () => {
  const ids = new Set(['magpie', 'bigco']);
  assert.deepEqual(parseModelRef('bigco:sonnet/x', ids, 'magpie'), {
    provider: 'bigco',
    modelId: 'sonnet/x',
  });
  assert.deepEqual(parseModelRef('sonnet/x', ids, 'magpie'), {
    provider: 'magpie',
    modelId: 'sonnet/x',
  });
  // A ':' prefix that is not a configured provider is part of the model id.
  assert.deepEqual(parseModelRef('ft:gpt-4:org:x', ids, 'magpie'), {
    provider: 'magpie',
    modelId: 'ft:gpt-4:org:x',
  });
});

test('magpieConfig resolves the preset with env fallback', () => {
  const config = magpieConfig();
  assert.equal(config.id, 'magpie');
  assert.equal(config.kind, 'gateway');
  assert.ok(config.baseUrl);
});
