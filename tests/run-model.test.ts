import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MagpieModelInfo } from '../src/worker/magpie.js';
import {
  resolveWorkerSpec,
  workerModelChoices,
  workerModelLine,
} from '../src/worker/run-model.js';

const model = (id: string, levels: string[] = []): MagpieModelInfo => ({
  id,
  name: id,
  reasoning: levels.length > 0,
  levels,
  input: ['text'],
  contextWindow: 128_000,
  maxTokens: 32_000,
});

const catalog = [
  model('fast/flash', ['low', 'high']),
  model('deep/pro', ['none', 'low', 'medium', 'high', 'xhigh', 'max']),
  model('plain/chat'),
];

// ---- resolveWorkerSpec ------------------------------------------------------

test('unset model and thinking level inherit the defaults', () => {
  assert.deepEqual(resolveWorkerSpec(catalog, 'fast/flash'), {
    model: null,
    thinkingLevel: null,
  });
  assert.deepEqual(resolveWorkerSpec(catalog, 'fast/flash', '  ', ''), {
    model: null,
    thinkingLevel: null,
  });
});

test('a pinned model and thinking level are stored as-is', () => {
  assert.deepEqual(
    resolveWorkerSpec(catalog, 'fast/flash', ' deep/pro ', 'HIGH'),
    { model: 'deep/pro', thinkingLevel: 'high' },
  );
});

test('a thinking level alone is checked against the default model', () => {
  assert.deepEqual(resolveWorkerSpec(catalog, 'fast/flash', null, 'low'), {
    model: null,
    thinkingLevel: 'low',
  });
  assert.throws(
    () => resolveWorkerSpec(catalog, 'fast/flash', null, 'medium'),
    /does not support thinking level 'medium' — it takes: low, high/,
  );
});

test('the gateway level none reaches pi as off', () => {
  assert.deepEqual(
    resolveWorkerSpec(catalog, 'fast/flash', 'deep/pro', 'off'),
    {
      model: 'deep/pro',
      thinkingLevel: 'off',
    },
  );
  assert.throws(
    () => resolveWorkerSpec(catalog, 'fast/flash', 'deep/pro', 'none'),
    /unknown thinking level 'none'/,
  );
});

test('an unknown model is rejected with the available list', () => {
  assert.throws(
    () => resolveWorkerSpec(catalog, 'fast/flash', 'nope/model'),
    /unknown model 'nope\/model' — available: fast\/flash, deep\/pro, plain\/chat/,
  );
});

test('an unknown thinking level is rejected before any model lookup', () => {
  assert.throws(
    () => resolveWorkerSpec(catalog, 'fast/flash', 'deep/pro', 'extreme'),
    /unknown thinking level 'extreme'/,
  );
});

test('a thinking level on a non-reasoning model is rejected', () => {
  assert.throws(
    () => resolveWorkerSpec(catalog, 'fast/flash', 'plain/chat', 'low'),
    /model 'plain\/chat' takes no thinking level \(reasoning off\)/,
  );
});

test('a thinking level with a default model outside the catalog is rejected', () => {
  assert.throws(
    () => resolveWorkerSpec(catalog, 'gone/default', null, 'low'),
    /cannot check thinking level 'low' — model 'gone\/default' is not in the current catalog/,
  );
});

// ---- state line -------------------------------------------------------------

test('worker model choices map gateway levels onto pi levels', () => {
  const choices = workerModelChoices(catalog, 'fast/flash');
  assert.deepEqual(
    choices.map((choice) => [choice.id, choice.levels, choice.isDefault]),
    [
      ['fast/flash', ['low', 'high'], true],
      ['deep/pro', ['off', 'low', 'medium', 'high', 'xhigh', 'max'], false],
      ['plain/chat', [], false],
    ],
  );
});

test('the worker models state line lists ids, levels, and the default', () => {
  assert.equal(workerModelLine([]), null);
  const line = workerModelLine(workerModelChoices(catalog, 'fast/flash'));
  assert.match(
    line!,
    /^worker models: fast\/flash \(default\) \[think: low\/high\], /,
  );
  assert.match(
    line!,
    /deep\/pro \[think: off\/low\/medium\/high\/xhigh\/max\]/,
  );
  assert.match(line!, /plain\/chat \[no thinking\]$/);
});
