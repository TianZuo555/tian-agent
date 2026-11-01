import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Notification } from '../src/worker/db.js';
import {
  NotificationOutbox,
  type NotificationStore,
} from '../src/worker/outbox.js';

class MemoryStore implements NotificationStore {
  readonly rows: Notification[];
  readonly delivered = new Set<string>();

  constructor(rows: Notification[] = []) {
    this.rows = rows;
  }

  queueNotification(value: Notification): boolean {
    if (this.rows.some((row) => row.id === value.id)) return false;
    this.rows.push(value);
    return true;
  }

  pendingNotifications(): Notification[] {
    return this.rows.filter((row) => !this.delivered.has(row.id));
  }

  targetNotification(id: string, conversationId: string): void {
    const row = this.rows.find((item) => item.id === id);
    if (row) row.conversationId = conversationId;
  }

  deliveredNotification(id: string): void {
    this.delivered.add(id);
  }
}

const note = (
  id: string,
  conversationId: string | null = null,
): Notification => ({
  id,
  scopeId: 'global',
  conversationId,
  content: `content of ${id}`,
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const build = (
  store: MemoryStore,
  deliver: (
    notification: Notification,
    conversationId: string,
  ) => Promise<void>,
) => {
  const delivered: string[] = [];
  const errors: string[] = [];
  const outbox = new NotificationOutbox({
    store,
    resolveConversation: async () => 'fallback-conversation',
    deliver,
    delivered: (notification) => delivered.push(notification.id),
    reportIssue: (_area, error) => errors.push(String(error)),
  });
  return { outbox, delivered, errors };
};

test('outbox resolves a target once and records the delivery', async () => {
  const store = new MemoryStore([note('a')]);
  const { outbox, delivered } = build(store, async () => {});

  await outbox.request();

  assert.equal(store.rows[0].conversationId, 'fallback-conversation');
  assert.deepEqual([...store.delivered], ['a']);
  assert.deepEqual(delivered, ['a']);
});

test('a failed notification stays pending and does not block the next', async () => {
  const store = new MemoryStore([note('bad', 'c1'), note('good', 'c1')]);
  const { outbox, delivered, errors } = build(store, async (notification) => {
    if (notification.id === 'bad') throw new Error('send failed');
  });

  await outbox.request();

  assert.deepEqual([...store.delivered], ['good']);
  assert.deepEqual(delivered, ['good']);
  assert.deepEqual(
    store.pendingNotifications().map((row) => row.id),
    ['bad'],
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /send failed/);
});

test('a notification queued during a pass is delivered by that pass', async () => {
  const gate = deferred();
  const store = new MemoryStore([note('first', 'c1')]);
  const calls: string[] = [];
  const { outbox } = build(store, async (notification) => {
    calls.push(notification.id);
    if (notification.id === 'first') await gate.promise;
  });

  const pass = outbox.request();
  await new Promise((resolve) => setImmediate(resolve));
  store.queueNotification(note('second', 'c1'));
  outbox.request();
  gate.resolve();
  await pass;

  assert.deepEqual(calls, ['first', 'second']);
  assert.deepEqual([...store.delivered], ['first', 'second']);
});

test('a paused outbox keeps notifications durable until resumed', async () => {
  const store = new MemoryStore([note('held', 'c1')]);
  const calls: string[] = [];
  const { outbox } = build(store, async (notification) => {
    calls.push(notification.id);
  });

  outbox.pause();
  await outbox.request();
  assert.deepEqual(calls, []);
  assert.equal(store.pendingNotifications().length, 1);

  outbox.resume();
  await outbox.request();
  assert.deepEqual(calls, ['held']);
  assert.deepEqual([...store.delivered], ['held']);
});
