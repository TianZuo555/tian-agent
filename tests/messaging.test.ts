import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  Db,
  type AgentMessageRow,
  type Notification,
  type RunRow,
} from '../src/worker/db';
import { DataService } from '../src/worker/data';
import { Scopes } from '../src/worker/scopes';
import { workerExtension } from '../src/worker/worker-tools';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-messaging-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function addRun(db: Db, overrides: Partial<RunRow> = {}): RunRow {
  const run: RunRow = {
    id: `r-${randomUUID().slice(0, 8)}`,
    projectId: 'p-test',
    conversationId: `conv-${randomUUID().slice(0, 8)}`,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'do the thing',
    currentPrompt: 'do the thing',
    rootPath: '/tmp',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'running',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    deadlineAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
  db.addRun(run);
  return run;
}

type ToolResult = { isError?: boolean; output: { text: string }[] };
type ExecutableTool = {
  execute: (
    args: unknown,
    api: unknown,
    context?: unknown,
  ) => Promise<ToolResult>;
};
const toolText = (result: ToolResult) => result.output[0].text;

function messaging(t: TestContext) {
  const root = temporary(t);
  const db = new Db(root);
  const scopes = new Scopes(join(root, 'scopes', 'global'), db);
  const data = new DataService(db, scopes, () => {});
  const wakeCalls: Notification[] = [];
  const wake = async (notification: Notification) => {
    wakeCalls.push(notification);
  };
  const extension = workerExtension({ db, wake });
  const tool = (name: string) => {
    const found = extension.tools?.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing tool: ${name}`);
    return found as unknown as ExecutableTool;
  };
  t.after(() => db.close());
  return { root, db, data, wakeCalls, tool };
}

const api = (run: RunRow, callId = 'c1') => ({
  conversationId: run.conversationId,
  taskId: 'task-1',
  callId,
});

test('ask_chief wakes the chief, waits, and returns its reply', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  const reply = 'Use SQLite — no new infrastructure allowed.';
  const asking = f
    .tool('ask_chief')
    .execute({ question: 'SQLite or Postgres for the cache?' }, api(run));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(f.wakeCalls.length, 1);
  assert.match(f.wakeCalls[0].content, new RegExp(run.id));
  assert.match(f.wakeCalls[0].content, /send_run_msg/);
  f.db.addAgentMessage({
    id: `msg:${run.id}:reply-1`,
    runId: run.id,
    sender: 'chief',
    body: reply,
  });
  const result = await asking;
  assert.equal(result.isError, undefined);
  assert.match(toolText(result), new RegExp(reply));
  const thread = f.db.listAgentMessages(run.id);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].sender, 'worker');
  assert.equal(thread[1].deliveredAt !== null, true);
});

test('ask_chief falls back to best judgment when nobody replies', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  const result = await f
    .tool('ask_chief')
    .execute({ question: 'Anyone?', wait_seconds: 1 }, api(run));
  assert.match(toolText(result), /best judgment/);
  assert.equal(f.wakeCalls.length, 1);
});

test('ask_chief stops as soon as the run is discarded', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  const asking = f
    .tool('ask_chief')
    .execute({ question: 'Should I continue?', wait_seconds: 300 }, api(run));
  await new Promise((resolve) => setTimeout(resolve, 30));
  f.db.patchRun(run.id, { reviewStatus: 'discarded' });
  const result = await asking;
  assert.match(toolText(result), /cancelled/);
});

test('check_msgs hands over pending chief messages exactly once', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  const read: AgentMessageRow = f.db.addAgentMessage({
    id: 'm-read',
    runId: run.id,
    sender: 'chief',
    body: 'old guidance',
  });
  f.db.markAgentMessagesDelivered([read.id]);
  f.db.addAgentMessage({
    id: 'm-new',
    runId: run.id,
    sender: 'chief',
    body: 'switch to plan B',
  });
  f.db.addAgentMessage({
    id: 'm-worker',
    runId: run.id,
    sender: 'worker',
    body: 'progress note',
  });
  const first = await f.tool('check_msgs').execute({}, api(run));
  assert.match(toolText(first), /plan B/);
  assert.doesNotMatch(toolText(first), /old guidance/);
  assert.doesNotMatch(toolText(first), /progress note/);
  const second = await f.tool('check_msgs').execute({}, api(run));
  assert.match(toolText(second), /no new messages/);
});

test('chief run messages are idempotent and thread-complete', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  f.data.sendRunMessage(run.id, 'use option A', 'op-1');
  f.data.sendRunMessage(run.id, 'use option A', 'op-1');
  f.data.sendRunMessage(run.id, 'actually, option B', 'op-2');
  const thread = f.data.runMessages(run.id);
  assert.equal(thread.length, 2);
  assert.equal(thread[1].body, 'actually, option B');
  assert.throws(() => f.data.sendRunMessage('r-missing', 'x'), /Unknown run/);
  assert.throws(() => f.data.runMessages('r-missing'), /Unknown run/);
});

test('tell_chief posts a note without waiting', async (t) => {
  const f = messaging(t);
  const run = addRun(f.db);
  const result = await f
    .tool('tell_chief')
    .execute({ text: 'Found a flaky test, will retry once.' }, api(run));
  assert.match(toolText(result), /delivered/);
  assert.equal(f.wakeCalls.length, 1);
  assert.match(f.wakeCalls[0].content, /flaky test/);
});
