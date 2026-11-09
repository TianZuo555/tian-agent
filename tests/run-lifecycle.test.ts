import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db, type RunRow } from '../src/worker/db';
import {
  ACTIVE_RUN_STATUSES,
  FINISHED_RUN_STATUSES,
  REVIEW_TRANSITIONS,
  RUN_STATUS_TRANSITIONS,
  UNSETTLED_REVIEW_STATUSES,
  canRunAction,
  runActionBlocker,
  runDisplayStatus,
  runStateLabel,
  type RunAction,
  type RunGateState,
} from '../src/shared/run-lifecycle';
import { describeRunLine } from '../src/worker/run-progress';
import type { ReviewStatus, RunStatus } from '../src/shared/types';

const statuses = Object.keys(RUN_STATUS_TRANSITIONS) as RunStatus[];
const reviews = Object.keys(REVIEW_TRANSITIONS) as ReviewStatus[];
const actions: RunAction[] = ['stop', 'followUp', 'land', 'ship', 'discard'];

/** Every stored combination, with and without a Git branch and worktree. */
function everyState(): RunGateState[] {
  const states: RunGateState[] = [];
  for (const status of statuses)
    for (const reviewStatus of reviews)
      for (const git of [true, false])
        states.push({
          status,
          reviewStatus,
          branch: git ? 'tian/r-1' : null,
          worktreePath: git ? '/tmp/worktrees/r-1' : null,
        });
  return states;
}

test('active and finished statuses split every execution status', () => {
  assert.deepEqual(
    [...ACTIVE_RUN_STATUSES, ...FINISHED_RUN_STATUSES].sort(),
    [...statuses].sort(),
  );
  for (const review of UNSETTLED_REVIEW_STATUSES)
    assert.ok(REVIEW_TRANSITIONS[review].length > 0, review);
  assert.deepEqual(REVIEW_TRANSITIONS.landed, []);
  assert.deepEqual(REVIEW_TRANSITIONS.discarded, []);
});

test('every allowed action leads to a transition the tables allow', () => {
  const next: Record<
    RunAction,
    { status?: RunStatus; review?: ReviewStatus } | null
  > = {
    stop: { status: 'interrupted' },
    followUp: { status: 'queued' },
    land: { review: 'landing' },
    ship: { review: 'shipping' },
    discard: { review: 'discarding' },
  };
  for (const run of everyState())
    for (const action of actions) {
      if (!canRunAction(run, action)) continue;
      const target = next[action]!;
      if (target.status && target.status !== run.status)
        assert.ok(
          RUN_STATUS_TRANSITIONS[run.status].includes(target.status),
          `${action} from ${run.status}`,
        );
      if (target.review && target.review !== run.reviewStatus)
        assert.ok(
          REVIEW_TRANSITIONS[run.reviewStatus].includes(target.review),
          `${action} from review ${run.reviewStatus}`,
        );
    }
});

test('the gates accept exactly the states the service accepts', () => {
  const allowed = (run: RunGateState, action: RunAction): boolean => {
    const finished = ['done', 'failed', 'interrupted'].includes(run.status);
    switch (action) {
      case 'stop':
        return (
          ['queued', 'running'].includes(run.status) &&
          run.reviewStatus === 'pending'
        );
      case 'followUp':
        return finished && run.reviewStatus === 'pending';
      case 'land':
        return (
          !!run.branch &&
          finished &&
          ['pending', 'shipped', 'landing'].includes(run.reviewStatus)
        );
      case 'ship':
        return (
          !!run.branch &&
          !!run.worktreePath &&
          finished &&
          ['pending', 'shipping'].includes(run.reviewStatus)
        );
      case 'discard':
        return !['landed', 'discarded'].includes(run.reviewStatus);
    }
  };
  for (const run of everyState())
    for (const action of actions)
      assert.equal(
        canRunAction(run, action),
        allowed(run, action),
        `${action} with ${JSON.stringify(run)}`,
      );
});

test('a refusal names the state that blocks the action', () => {
  const running: RunGateState = {
    status: 'running',
    reviewStatus: 'pending',
    branch: 'tian/r-1',
    worktreePath: '/tmp/w',
  };
  assert.match(
    runActionBlocker(running, 'land')!,
    /its attempt is still running/,
  );
  assert.match(
    runActionBlocker(
      { ...running, status: 'done', reviewStatus: 'landed' },
      'followUp',
    )!,
    /its review is landed/,
  );
  assert.match(
    runActionBlocker({ ...running, branch: null }, 'land')!,
    /no Git branch/,
  );
});

test('people and agents read the Review once one began', () => {
  const run = { status: 'done', reviewStatus: 'pending' } as const;
  assert.equal(runDisplayStatus(run), 'done');
  assert.equal(runStateLabel(run), 'done');
  assert.equal(
    runDisplayStatus({ ...run, reviewStatus: 'landing' }),
    'landing',
  );
  assert.equal(
    runStateLabel({ status: 'interrupted', reviewStatus: 'discarded' }),
    'interrupted, discarded',
  );
  assert.match(
    describeRunLine({
      id: 'r-1',
      status: 'done',
      reviewStatus: 'landed',
      runtime: 'pi',
      projectId: 'p1',
      finishedAt: null,
      prompt: 'Fix it\nmore',
    }),
    /^r-1 \[done, landed\] pi in p1\n {2}Fix it$/,
  );
});

function database(t: TestContext): Db {
  const directory = mkdtempSync(join(tmpdir(), 'tian-run-lifecycle-'));
  const db = new Db(directory);
  t.after(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return db;
}

function addRun(db: Db): RunRow {
  const run: RunRow = {
    id: 'r-1',
    projectId: 'p1',
    conversationId: null,
    chiefConversationId: null,
    runtime: 'pi',
    prompt: 'do the thing',
    currentPrompt: 'do the thing',
    rootPath: '/tmp',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'queued',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    deadlineAt: '',
  };
  db.addRun(run);
  return run;
}

test('the database refuses a status change the lifecycle does not allow', (t) => {
  const db = database(t);
  addRun(db);
  assert.throws(
    () => db.patchRun('r-1', { status: 'done' }),
    /Illegal run transition for r-1: status queued → done/,
  );
  assert.throws(
    () => db.patchRun('r-1', { reviewStatus: 'landed' }),
    /review pending → landed/,
  );
  // A refused change writes nothing, not even its other fields.
  assert.throws(() => db.patchRun('r-1', { status: 'done', error: 'x' }));
  assert.equal(db.getRun('r-1')!.error, null);
  // Repeating the current status and writing other fields stay allowed.
  db.patchRun('r-1', { status: 'queued', error: 'note' });
  db.patchRun('r-1', { status: 'running' });
  db.patchRun('r-1', { status: 'collecting' });
  db.finishRun('r-1', 'done', null, {
    id: 'n-1',
    scopeId: 'p1',
    conversationId: null,
    content: 'done',
  });
  assert.equal(db.getRun('r-1')!.status, 'done');
  db.patchRun('r-1', { reviewStatus: 'discarding' });
  db.patchRun('r-1', { reviewStatus: 'discarded' });
  assert.throws(
    () => db.patchRun('r-1', { reviewStatus: 'pending' }),
    /review discarded → pending/,
  );
});
