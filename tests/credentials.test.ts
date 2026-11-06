import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileCredentialStore } from '../src/worker/credentials.js';

const fileMode = (dir: string) =>
  statSync(join(dir, 'credentials.json')).mode & 0o777;

test('read and list on a missing file return empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  assert.equal(await store.read('magpie'), undefined);
  assert.deepEqual(await store.list(), []);
});

test('modify persists a credential with file mode 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  const written = await store.modify('magpie', async () => ({
    type: 'api_key',
    key: 'sk-test-secret',
  }));
  assert.equal(written?.type, 'api_key');
  assert.equal(fileMode(dir), 0o600);
  assert.deepEqual(await store.read('magpie'), {
    type: 'api_key',
    key: 'sk-test-secret',
  });
});

test('list returns only provider metadata, never secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  await store.modify('magpie', async () => ({
    type: 'api_key',
    key: 'sk-test-secret',
    env: { MAGPIE_ACCOUNT: 'acct-1' },
  }));
  await store.modify('openai', async () => ({
    type: 'oauth',
    refresh: 'rt-secret',
    access: 'at-secret',
    expires: 1,
  }));
  const list = await store.list();
  assert.deepEqual(list, [
    { providerId: 'magpie', type: 'api_key' },
    { providerId: 'openai', type: 'oauth' },
  ]);
  const serialized = JSON.stringify(list);
  assert.ok(!serialized.includes('sk-test-secret'));
  assert.ok(!serialized.includes('rt-secret'));
  assert.ok(!serialized.includes('at-secret'));
});

test('modify returning undefined leaves the entry unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  const resolved = await store.modify('magpie', async (current) => {
    assert.equal(current, undefined);
    return undefined;
  });
  assert.equal(resolved, undefined);
  assert.equal(await store.read('magpie'), undefined);
});

test('modify serializes per-provider read-modify-write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  const seen: (string | undefined)[] = [];
  const bump = (key: string) =>
    store.modify('magpie', async (current) => {
      seen.push(current?.type === 'api_key' ? current.key : undefined);
      return { type: 'api_key', key };
    });
  const [first, second] = await Promise.all([bump('k1'), bump('k2')]);
  assert.equal(first?.type === 'api_key' && first.key, 'k1');
  assert.equal(second?.type === 'api_key' && second.key, 'k2');
  assert.deepEqual(seen, [undefined, 'k1']);
});

test('concurrent updates to different providers preserve both credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  await Promise.all([
    store.modify('first', async () => ({ type: 'api_key', key: 'first-key' })),
    store.modify('second', async () => ({
      type: 'api_key',
      key: 'second-key',
    })),
  ]);
  const reopened = new FileCredentialStore(dir);
  assert.deepEqual(await reopened.read('first'), {
    type: 'api_key',
    key: 'first-key',
  });
  assert.deepEqual(await reopened.read('second'), {
    type: 'api_key',
    key: 'second-key',
  });
});

test('an async credential update does not restore another deleted provider', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  await store.modify('removed', async () => ({
    type: 'api_key',
    key: 'old-key',
  }));
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const update = store.modify('refreshing', async () => {
    started();
    await pending;
    return { type: 'api_key', key: 'new-key' };
  });
  await entered;
  await store.delete('removed');
  release();
  await update;
  assert.equal(await store.read('removed'), undefined);
  assert.deepEqual(await store.read('refreshing'), {
    type: 'api_key',
    key: 'new-key',
  });
});

test('delete removes a credential; deleting a missing one is a no-op', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const store = new FileCredentialStore(dir);
  await store.delete('magpie');
  await store.modify('magpie', async () => ({ type: 'api_key', key: 'k1' }));
  await store.delete('magpie');
  assert.equal(await store.read('magpie'), undefined);
  assert.deepEqual(await store.list(), []);
});

test('a loose-permission file is rewritten with mode 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  const path = join(dir, 'credentials.json');
  writeFileSync(
    path,
    JSON.stringify({ magpie: { type: 'api_key', key: 'k1' } }),
  );
  chmodSync(path, 0o644);
  const store = new FileCredentialStore(dir);
  await store.modify('openai', async () => ({ type: 'api_key', key: 'k2' }));
  assert.equal(fileMode(dir), 0o600);
  assert.deepEqual(await store.read('magpie'), { type: 'api_key', key: 'k1' });
});

test('a corrupt file rejects instead of reading as empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-credentials-'));
  writeFileSync(join(dir, 'credentials.json'), 'not json {');
  const store = new FileCredentialStore(dir);
  await assert.rejects(store.read('magpie'));
  await assert.rejects(store.list());
});
