import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createServiceClient,
  type Connection,
} from '../crates/tian-nsh/service-client';
import { createStore, initialState } from '../crates/tian-nsh/store';

class FakeConnection implements Connection {
  sent: Record<string, unknown>[] = [];
  queue: unknown[] = [];
  reader?: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  };
  closed = false;
  next(): Promise<unknown> {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.reject(new Error('closed'));
    return new Promise((resolve, reject) => {
      this.reader = { resolve, reject };
    });
  }
  push(value: unknown) {
    if (this.reader) {
      const reader = this.reader;
      this.reader = undefined;
      reader.resolve(value);
    } else this.queue.push(value);
  }
  async send(message: unknown) {
    this.sent.push(message as Record<string, unknown>);
  }
  close() {
    this.closed = true;
    this.reader?.reject(new Error('closed'));
    this.reader = undefined;
  }
  reply(command: string, value: unknown) {
    const request = this.sent.findLast((item) => item.command === command);
    assert.ok(request, `No ${command} request`);
    this.push({ type: 'result', id: request.id, value });
  }
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('NSH client condition timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('NSH RPC correlates out-of-order results, service errors, and targeted events', async (t) => {
  const peer = new FakeConnection();
  const events: unknown[] = [];
  const client = createServiceClient(
    async () => peer,
    (channel, payload) => events.push([channel, payload]),
  );
  t.after(() => client.close());
  client.start();
  await until(() => events.length === 2);
  const a = client.invoke('listConversations', []);
  const b = client.invoke('listScopes', []);
  peer.reply('listScopes', [{ id: 'global' }]);
  peer.reply('listConversations', []);
  assert.deepEqual(await a, []);
  assert.deepEqual(await b, [{ id: 'global' }]);
  const failed = client.invoke('watch', ['missing']);
  const rejection = assert.rejects(failed, /Unknown conversation/);
  peer.push({
    type: 'result',
    id: peer.sent.at(-1)!.id,
    error: 'Unknown conversation',
  });
  await rejection;
  const before = events.length;
  peer.push({
    type: 'event',
    channel: 'view',
    clientId: 2,
    payload: 'other window',
  });
  peer.push({
    type: 'event',
    channel: 'view',
    clientId: 1,
    payload: 'this window',
  });
  await until(() => events.length > before);
  assert.deepEqual(events.at(-1), ['view', 'this window']);
});

test('NSH reconnect rejects pending mutations and never replays them', async (t) => {
  const first = new FakeConnection(),
    second = new FakeConnection();
  let connects = 0,
    ready = 0;
  const client = createServiceClient(
    async () => (++connects === 1 ? first : second),
    (channel, payload) => {
      if (
        channel === 'runtime' &&
        (payload as { status: string }).status === 'ready'
      )
        ready++;
    },
    { retryMs: 1 },
  );
  t.after(() => client.close());
  client.start();
  await until(() => ready === 1);
  const submit = client.invoke('submit', ['c1', 'hello', 'dedupe-1']);
  const rejected = assert.rejects(submit, /closed/);
  first.close();
  await rejected;
  await until(() => ready === 2);
  assert.equal(second.sent.length, 0);
  const pending = client.invoke('listScopes', []);
  const closed = assert.rejects(pending, /client closed/);
  client.close();
  await closed;
  assert.equal(second.closed, true);
});

test('NSH store preserves newer events and ignores old conversation snapshots', async (t) => {
  const peer = new FakeConnection();
  let state = initialState();
  const store = createStore(
    async () => peer,
    () => state,
    (value) => {
      state = value;
    },
  );
  t.after(() => store.close());
  store.start();
  await until(() => peer.sent.length === 2);
  const conversation = (id: string) => ({
    conversationId: id,
    scopeId: 'global',
    title: id,
    createdAt: '',
    archivedAt: null,
    role: 'chief',
  });
  peer.push({
    type: 'event',
    channel: 'conversations',
    payload: [conversation('new')],
  });
  peer.reply('listConversations', [conversation('old')]);
  peer.reply('listScopes', []);
  await until(() => peer.sent.some((item) => item.command === 'watch'));
  peer.reply('watch', undefined);
  assert.equal(state.selected, 'new');
  assert.equal(state.conversations[0].conversationId, 'new');
  store.select('other', 'global');
  peer.push({
    type: 'event',
    channel: 'view',
    payload: { conversationId: 'new', view: { rows: [], busy: true } },
  });
  await until(() => peer.sent.some((item) => item.command === 'unwatch'));
  assert.equal(state.view, null);
  peer.reply('unwatch', undefined);
  await until(
    () => peer.sent.filter((item) => item.command === 'watch').length === 2,
  );
  peer.reply('watch', undefined);
  peer.push({
    type: 'event',
    channel: 'view',
    payload: { conversationId: 'other', view: { rows: [], busy: false } },
  });
  await until(() => state.view !== null);
  assert.deepEqual(state.view, { rows: [], busy: false });
});
