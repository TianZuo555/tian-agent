import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/worker/db';
import { Scopes } from '../src/worker/scopes';
import {
  ImprovementStore,
  improvementRef,
  redactSecrets,
} from '../src/worker/improvements';
import { improvementTools } from '../src/worker/tools-improvements';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'tian-improvements-'));
  const db = new Db(join(directory, 'data'));
  const store = new ImprovementStore(db);
  const scopes = new Scopes(join(directory, 'data', 'global'), db);
  db.mapConversation('c1', 'global');
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, db, store, scopes };
}

function toolRunner(f: ReturnType<typeof fixture>) {
  const tools = new Map(
    improvementTools({
      db: f.db,
      scopes: f.scopes,
      improvements: f.store,
      emitImprovements: () => {},
    }).map((tool) => [tool.name, tool]),
  );
  return async (
    name: string,
    args: Record<string, unknown>,
    ids: { callId?: string; taskId?: string } = {},
  ): Promise<string> => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    const result = await tool.execute(
      args as never,
      {
        taskId: ids.taskId ?? 'task-1',
        callId: ids.callId ?? 'call-1',
        conversationId: 'c1',
      } as never,
      {} as never,
    );
    return (result.output ?? [])
      .map((item) => ('text' in item ? item.text : ''))
      .join('\n');
  };
}

test('entries are scoped, list without detail, and return detail on demand', (t) => {
  const { store } = fixture(t);
  const idea = store.record({
    scopeId: 'global',
    kind: 'idea',
    source: 'user',
    summary: '  Show the run diff inline  ',
    detail: 'A side-by-side diff would avoid a round trip.',
  });
  assert.equal(idea.summary, 'Show the run diff inline');
  assert.equal(idea.status, 'open');
  assert.equal(idea.occurrences, 1);
  assert.equal(idea.severity, 'medium');
  assert.equal(idea.taskId, null);

  store.record({
    scopeId: 'project-a',
    kind: 'friction',
    source: 'chief',
    summary: 'Project switcher resets the scroll',
  });
  const global = store.list({ scopeId: 'global' });
  assert.equal(global.length, 1);
  assert.equal(global[0].summary, 'Show the run diff inline');
  assert.equal('detail' in global[0], false);
  assert.equal(
    store.get(idea.id)?.detail,
    'A side-by-side diff would avoid a round trip.',
  );
  assert.equal(store.list().length, 2);
  assert.throws(
    () =>
      store.record({
        scopeId: 'global',
        kind: 'idea',
        source: 'user',
        summary: '   ',
      }),
    /cannot be empty/,
  );
});

test('automatic failures dedupe by fingerprint, redact secrets, and reopen after resolve', (t) => {
  const { store } = fixture(t);
  const error = new Error(
    'getUpdates failed: https://api.telegram.org/bot123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/getUpdates?token=secret-value',
  );
  const first = store.capture('telegram.poll', error, { severity: 'low' });
  assert.equal(first.kind, 'issue');
  assert.equal(first.source, 'system');
  assert.equal(first.occurrences, 1);
  assert.match(first.summary, /telegram\.poll/);
  assert.ok(!first.detail.includes('AAAAAAAA'));
  assert.ok(!first.detail.includes('secret-value'));
  assert.ok(
    redactSecrets('Bearer abcdefghijklmnopqrstuvwxyz').includes('[REDACTED]'),
  );

  const second = store.capture('telegram.poll', error, { severity: 'high' });
  assert.equal(second.id, first.id);
  assert.equal(second.occurrences, 2);
  assert.equal(second.severity, 'high');
  assert.equal(store.list({ status: 'open' }).length, 1);
  assert.ok(second.lastSeenAt >= first.lastSeenAt);

  const otherScope = store.capture('telegram.poll', error, {
    scopeId: 'project-a',
  });
  assert.notEqual(otherScope.id, first.id);

  store.setStatus(first.id, 'resolved');
  const recurrence = store.capture('telegram.poll', error);
  assert.notEqual(recurrence.id, first.id);
  assert.equal(recurrence.status, 'open');
  assert.equal(store.list({ status: 'resolved' }).length, 1);
});

test('an entry promotes once into a deduped task', (t) => {
  const { db, store } = fixture(t);
  const entry = store.record({
    scopeId: 'global',
    kind: 'issue',
    source: 'system',
    summary: 'Scheduler skips a goal after sleep',
    detail: 'Reproduce by pausing the process across the fire time.',
  });
  const first = store.promote(entry.id);
  assert.equal(first.created, true);
  assert.equal(first.task.status, 'pending');
  assert.equal(first.task.title, entry.summary);
  assert.equal(first.task.dedupeKey, `improvement:${entry.id}`);
  assert.equal(first.task.triggerRef, entry.id);
  assert.equal(first.entry.status, 'promoted');
  assert.equal(first.entry.taskId, first.task.id);
  assert.equal(db.listTasks('global').length, 1);

  const again = store.promote(entry.id);
  assert.equal(again.created, false);
  assert.equal(again.task.id, first.task.id);
  assert.equal(db.listTasks('global').length, 1);
  assert.equal(store.get(entry.id)?.status, 'promoted');
});

test('status transitions are guarded and reopening succeeds', (t) => {
  const { store } = fixture(t);
  const entry = store.record({
    scopeId: 'global',
    kind: 'win',
    source: 'chief',
    summary: 'The inline diff view made review fast',
  });
  assert.equal(store.setStatus(entry.id, 'dismissed').status, 'dismissed');
  assert.equal(store.setStatus(entry.id, 'open').status, 'open');
  assert.equal(store.setStatus(entry.id, 'resolved').status, 'resolved');
  assert.throws(
    () => store.setStatus(entry.id, 'promoted' as never),
    /Cannot move improvement/,
  );
});

test('chief log_improvement is replay-safe and list_improvements reports entries', async (t) => {
  const f = fixture(t);
  const run = toolRunner(f);
  const output = await run('log_improvement', {
    kind: 'issue',
    summary: 'Run report omits the exit code',
    detail: 'A failed run should show its exit code next to the status.',
    source: 'user',
    severity: 'medium',
  });
  assert.match(output, /logged #/);
  assert.equal(f.store.list().length, 1);

  const replay = await run('log_improvement', {
    kind: 'issue',
    summary: 'Run report omits the exit code',
    detail: 'A failed run should show its exit code next to the status.',
    source: 'user',
    severity: 'medium',
  });
  assert.match(replay, /logged #/);
  assert.equal(f.store.list().length, 1);
  assert.equal(f.store.list()[0].occurrences, 1);

  const listed = await run('list_improvements', {
    status: 'all',
    limit: 10,
  });
  assert.match(listed, /Run report omits the exit code/);
  assert.match(listed, new RegExp(improvementRef(f.store.list()[0].id)));
});

test('chief tools reject an unknown scope without writing', async (t) => {
  const f = fixture(t);
  const run = toolRunner(f);
  const output = await run('log_improvement', {
    kind: 'idea',
    summary: 'A scope that does not exist',
    scope: 'missing-project',
  });
  assert.match(output, /unknown scope/);
  assert.equal(f.store.list().length, 0);
});
