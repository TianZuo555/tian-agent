import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db, type RunRow } from '../src/worker/db';
import { EventLog } from '../src/worker/events';
import { Scopes } from '../src/worker/scopes';
import { DATABASE_VERSION } from '../src/shared/version';
import {
  RuleBasedExtractor,
  SkillRegistry,
  skillMatches,
} from '../src/worker/skills';
import {
  RunOrchestrator,
  type WorkerConversation,
  type WorkerRuntime,
} from '../src/worker/runs';

type Outcome = { status: 'done' | 'unanswered'; reason?: string };

/** A worker runtime double that records the run rows it was created with. */
class FakeRuntime implements WorkerRuntime {
  readonly created: RunRow[] = [];
  private submissions = new Map<
    string,
    { resolve: (outcome: Outcome) => void }
  >();
  async create(run: RunRow): Promise<WorkerConversation> {
    this.created.push(run);
    return this.get(`worker-${this.created.length}`);
  }
  async get(id: string): Promise<WorkerConversation> {
    return {
      id,
      submit: async (_prompt, requestId) => {
        let entry = this.submissions.get(requestId);
        if (!entry) {
          let resolve!: (outcome: Outcome) => void;
          const wait = new Promise<Outcome>((done) => {
            resolve = done;
          });
          entry = { resolve };
          this.submissions.set(requestId, entry);
          return { wait: () => wait };
        }
        return { wait: () => new Promise<Outcome>(() => {}) };
      },
      abort: async () => {},
      lastText: async () => '',
    };
  }
  /** Resolve every open submission of a worker conversation. */
  complete(outcome: Outcome = { status: 'done' }): void {
    for (const entry of this.submissions.values()) entry.resolve(outcome);
    this.submissions.clear();
  }

  /** Resolve and forget every pending wait, like a runtime teardown. */
  stop(): void {
    this.complete({ status: 'unanswered', reason: 'test ended' });
  }
}

interface Fixture {
  db: Db;
  skills: SkillRegistry;
  events: EventLog;
  runtime: FakeRuntime;
  runs: RunOrchestrator;
  projectPath: string;
  userData: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'tian-skills-'));
  const projectPath = join(directory, 'project');
  const userData = join(directory, 'data');
  mkdirSync(projectPath);
  writeFileSync(join(projectPath, 'base.txt'), 'base\n');
  const git = (args: string[]) =>
    execFileSync('git', ['-C', projectPath, ...args], { stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['add', 'base.txt']);
  git([
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@local',
    'commit',
    '-m',
    'initial',
  ]);
  git(['config', 'user.name', 'test']);
  git(['config', 'user.email', 'test@local']);

  const db = new Db(userData);
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
  });
  const events = new EventLog(db);
  const skills = new SkillRegistry(db, events);
  const runtime = new FakeRuntime();
  const runs = new RunOrchestrator(
    db,
    new Scopes(join(userData, 'global'), db),
    runtime,
    userData,
    () => {},
    async () => {},
    events,
    undefined,
    skills,
  );
  t.after(async () => {
    runs.pause();
    runtime.stop();
    await runs.join();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { db, skills, events, runtime, runs, projectPath, userData };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition did not settle');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const STEPS_REPORT = `## Changes

Made the login test stable.

## Steps

1. Run the login suite twice
2. Reset the snapshot state between runs
3. Confirm the result is green both times
`;

/** Dispatch and wait until the worker is running (its wait is registered). */
async function dispatchRun(f: Fixture, prompt: string): Promise<RunRow> {
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt,
    chiefConversationId: null,
  });
  await until(() => f.db.getRun(run.id)?.status === 'running');
  return f.db.getRun(run.id)!;
}

/** Dispatch, let the fake worker finish with a report, wait for collection. */
async function successfulRun(
  f: Fixture,
  prompt: string,
  report = STEPS_REPORT,
): Promise<RunRow> {
  const run = await dispatchRun(f, prompt);
  if (run.worktreePath)
    writeFileSync(join(run.worktreePath, 'TIAN_REPORT.md'), report);
  f.runtime.complete();
  await until(() => ['done', 'failed'].includes(f.db.getRun(run.id)!.status));
  return f.db.getRun(run.id)!;
}

test('successful runs produce a sourced candidate; failed runs produce none', async (t) => {
  const f = await fixture(t);
  const run = await successfulRun(f, 'Fix the flaky login test');
  assert.equal(run.status, 'done');
  const candidates = f.skills.list('p1');
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.verification, 'unverified');
  assert.equal(candidate.version, 1);
  assert.deepEqual(candidate.sourceRefs, [`run:${run.id}:attempt:1`]);
  assert.match(candidate.body, /## Steps/);
  assert.equal(candidate.name, 'fix-the-flaky-login-test');
  // The extraction is audited as a system event, never as a user approval.
  assert.equal(f.events.list({ type: 'skill.candidate' })[0]?.actor, 'system');

  // A failed run reviews to nothing: no candidate, no version bump.
  const failed = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'Break the build on purpose',
    chiefConversationId: null,
  });
  await until(() => f.db.getRun(failed.id)?.status === 'running');
  f.runtime.complete({ status: 'unanswered', reason: 'provider exploded' });
  await until(() => f.db.getRun(failed.id)?.status === 'failed');
  assert.equal(f.skills.list('p1').length, 1);

  // Evidence rules: a success report without delimited steps yields nothing.
  await successfulRun(
    f,
    'Tidy the readme wording',
    'I changed some words in the readme file without any particular order.',
  );
  assert.equal(f.skills.list('p1').length, 1);
});

test('a repeat extraction merges source refs instead of spawning versions', async (t) => {
  const f = await fixture(t);
  const first = await successfulRun(f, 'Fix the flaky login test');
  const second = await successfulRun(f, 'Fix the flaky login test');
  const versions = f.skills.history('p1', 'fix-the-flaky-login-test');
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0].sourceRefs, [
    `run:${first.id}:attempt:1`,
    `run:${second.id}:attempt:1`,
  ]);
});

test('unapproved candidates never reach a worker prompt', async (t) => {
  const f = await fixture(t);
  await successfulRun(f, 'Fix the flaky login test');
  const candidate = f.skills.list('p1')[0];

  // The matching dispatch records no skills and the rendered block is empty.
  const run = await dispatchRun(
    f,
    'Fix the flaky login test again, it broke once more',
  );
  assert.deepEqual(run.injectedSkills ?? [], []);
  assert.deepEqual(f.runtime.created.at(-1)!.injectedSkills, []);
  assert.equal(f.skills.promptBlock(f.db.getRun(run.id)!), '');

  // Defense in depth: even a recorded ref renders nothing until approved.
  assert.equal(
    f.skills.promptBlock({
      injectedSkills: [
        { id: candidate.id, name: candidate.name, version: candidate.version },
      ],
    }),
    '',
  );
  // Unknown ids render nothing either.
  assert.equal(
    f.skills.promptBlock({
      injectedSkills: [{ id: 's-ghost', name: 'ghost', version: 1 }],
    }),
    '',
  );
});

test('approval is user-only, recorded, and turns on injection with provenance', async (t) => {
  const f = await fixture(t);
  await successfulRun(f, 'Fix the flaky login test');
  const candidate = f.skills.list('p1')[0];

  assert.throws(() => f.skills.retire('s-ghost'), /Unknown skill/);
  const approved = f.skills.approve(candidate.id);
  assert.equal(approved.status, 'approved');
  // Retiring non-candidates or re-approving is refused.
  assert.throws(() => f.skills.approve(candidate.id), /candidate/);
  const approval = f.events.list({ type: 'skill.approved' })[0];
  assert.equal(approval?.actor, 'user');
  assert.equal(JSON.parse(approval!.payload).version, 1);

  const run = await dispatchRun(f, 'Fix the flaky login test again, please');
  assert.deepEqual(run.injectedSkills, [
    { id: candidate.id, name: candidate.name, version: 1 },
  ]);
  const block = f.skills.promptBlock(f.db.getRun(run.id)!);
  assert.match(block, /fix-the-flaky-login-test \(v1\)/);
  assert.match(block, /## Steps/);
  // A different scope's run does not load this skill.
  f.db.addProject({
    id: 'p2',
    name: 'other',
    rootPath: f.projectPath,
    autoLand: 0,
    allowInPlace: 1,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
  });
  assert.deepEqual(
    f.skills.matchApproved('p2', 'fix the flaky login test'),
    [],
  );
});

test('a failed run marks its loaded version failed; retire stops injection', async (t) => {
  const f = await fixture(t);
  await successfulRun(f, 'Fix the flaky login test');
  const skill = f.skills.approve(f.skills.list('p1')[0].id);

  const failed = await dispatchRun(f, 'Fix the flaky login test once more');
  f.runtime.complete({ status: 'unanswered', reason: 'suites red' });
  await until(() => f.db.getRun(failed.id)?.status === 'failed');
  const marked = f.skills.get(skill.id)!;
  assert.equal(marked.verification, 'failed');
  assert.equal(marked.status, 'approved'); // the user decides, not the agent

  // Retiring stops injection immediately.
  f.skills.retire(skill.id, 'superseded by a better procedure');
  const next = await dispatchRun(f, 'Fix the flaky login test yet again');
  assert.deepEqual(next.injectedSkills ?? [], []);
});

test('rollback restores the previous approved version with full history', async (t) => {
  const f = await fixture(t);
  await successfulRun(f, 'Fix the flaky login test');
  const v1 = f.skills.approve(f.skills.list('p1')[0].id);

  // A second, different procedure under the same name becomes v2.
  await successfulRun(
    f,
    'Fix the flaky login test',
    '## Steps\n\n1. Quarantine the flaky spec\n2. Fix the clock stub\n3. Un-quarantine and re-run twice\n\nLong enough body for the evidence check to pass easily.',
  );
  const v2 = f.skills.approve(f.skills.latest('p1', v1.name)!.id);
  assert.equal(v2.version, 2);
  assert.equal(f.skills.get(v1.id)!.status, 'superseded');

  // The new version is what dispatches load.
  let run = await dispatchRun(f, 'Fix the flaky login test');
  assert.deepEqual(
    run.injectedSkills?.map((ref) => ref.version),
    [2],
  );

  // The run that loaded v2 failed: one click rolls back to v1.
  f.runtime.complete({ status: 'unanswered', reason: 'v2 made it worse' });
  await until(() => f.db.getRun(run.id)?.status === 'failed');
  const rolledBack = f.skills.rollback(v2.id, 'failed in run');
  assert.equal(rolledBack.status, 'retired');
  assert.equal(rolledBack.verification, 'failed');
  assert.equal(f.skills.get(v1.id)!.status, 'approved');

  // v1 is immediately usable again, and the history keeps every version.
  run = await dispatchRun(f, 'Fix the flaky login test');
  assert.deepEqual(
    run.injectedSkills?.map((ref) => ref.version),
    [1],
  );
  const history = f.skills.history('p1', v1.name);
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((skill) => [skill.version, skill.status]),
    [
      [1, 'approved'],
      [2, 'retired'],
    ],
  );
  assert.ok(f.events.list({ type: 'skill.rollback' }).length > 0);
  // Rolling back again is refused: v2 is no longer the approved version.
  assert.throws(() => f.skills.rollback(v2.id), /approved/);
});

test('a failing extractor damages nothing', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'tian-skills-boom-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = new Db(directory);
  t.after(() => db.close());
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: '/tmp/nowhere',
    autoLand: 0,
    allowInPlace: 1,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
  });
  const events = new EventLog(db);
  let extractions = 0;
  const skills = new SkillRegistry(db, events, {
    extract() {
      extractions += 1;
      throw new Error('extractor is down');
    },
  });
  // Pre-existing data must survive.
  const kept = skills.recordExtraction({
    scopeId: 'p1',
    name: 'kept-skill',
    description: 'kept',
    body: '# kept\n\nunchanged',
    sourceRefs: ['run:earlier:attempt:1'],
  });
  skills.approve(kept.id);

  const run: RunRow = {
    id: 'r-boom',
    projectId: 'p1',
    conversationId: null,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'Fix the flaky login test',
    currentPrompt: 'Fix the flaky login test',
    rootPath: '/tmp/nowhere',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'done',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: 0,
    taskId: null,
    injectedSkills: [{ id: kept.id, name: kept.name, version: 1 }],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  };
  // The extractor throws out of review…
  assert.throws(() => skills.review(run, STEPS_REPORT));
  assert.equal(extractions, 1);
  // …but the database stands: same single skill, still approved, no partial
  // candidate rows, and a successful run did not mark verification failed.
  assert.equal(skills.list('p1').length, 1);
  assert.equal(skills.get(kept.id)!.status, 'approved');
  assert.equal(skills.get(kept.id)!.verification, 'unverified');

  // A review that throws inside the orchestrator must not fail the run.
  const orchestrator = new RunOrchestrator(
    db,
    new Scopes(join(directory, 'global'), db),
    new FakeRuntime(),
    directory,
    () => {},
    async () => {},
    events,
    undefined,
    {
      matchApproved: () => [],
      review: () => {
        throw new Error('review is down');
      },
    },
  );
  orchestrator.pause();
  assert.doesNotThrow(() =>
    (
      orchestrator as unknown as {
        reviewExperience: (run: RunRow, report: string) => void;
      }
    ).reviewExperience(run, STEPS_REPORT),
  );
});

test('matcher rules stay simple and predictable', () => {
  assert.ok(skillMatches('run-tests', 'please run tests again'));
  assert.ok(skillMatches('run-tests', 'please run the tests now')); // all tokens
  assert.ok(skillMatches('发布检查', '先执行发布检查流程')); // CJK substring
  assert.ok(!skillMatches('run-tests', 'run the test suite')); // token missing
  assert.ok(!skillMatches('ci', 'special delivery')); // word boundary
  assert.ok(skillMatches('ci', 'check the ci pipeline'));
  assert.ok(!skillMatches('deploy', ''));
  assert.ok(!skillMatches('', 'anything at all'));
});

test('extractor evidence rules are deterministic', () => {
  const extractor = new RuleBasedExtractor();
  const base = {
    attempts: [{ attempt: 1, status: 'done', error: null }],
    messages: [],
  };
  const run = (overrides: Partial<RunRow>): RunRow => ({
    id: 'r-x',
    projectId: 'p1',
    conversationId: null,
    chiefConversationId: null,
    agentKind: 'durable-worker',
    prompt: 'Ship the release checklist',
    currentPrompt: 'Ship the release checklist',
    rootPath: '/tmp',
    baseBranch: 'main',
    executionMode: 'in-place',
    worktreePath: null,
    branch: null,
    status: 'done',
    reviewStatus: 'pending',
    attempt: 1,
    error: null,
    prUrl: null,
    reportPath: null,
    exitCode: 0,
    taskId: null,
    injectedSkills: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  });
  const headed = `Intro text that is long enough for the length check.\n## Steps\n1. tag the release\n2. run the smoke suite\n3. announce in the channel`;
  const [fromHeading] = extractor.extract({
    ...base,
    run: run({}),
    report: headed,
  });
  assert.equal(fromHeading.name, 'ship-the-release-checklist');
  assert.match(fromHeading.body, /1\. tag the release/);

  // No heading, but a >= 3 item list block is still a procedure.
  const listed = `Intro line that easily passes the minimum report length.\n- update the changelog\n- bump the version\n- push the tag`;
  const [fromList] = extractor.extract({
    ...base,
    run: run({}),
    report: listed,
  });
  assert.match(fromList.body, /bump the version/);

  // Two list items are not evidence; failed runs never extract.
  const short = `Intro line that easily passes the minimum report length.\n- update the changelog\n- bump the version`;
  assert.deepEqual(
    extractor.extract({ ...base, run: run({}), report: short }),
    [],
  );
  assert.deepEqual(
    extractor.extract({
      ...base,
      run: run({ status: 'failed' }),
      report: headed,
    }),
    [],
  );
});

test('a v3 database upgrades in one transaction and leaves a backup', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-skills-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const legacy = new DatabaseSync(join(dir, 'tian.db'));
  // The runs schema before injected_skills existed (v3 era).
  legacy.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT, chief_conversation_id TEXT,
      agent_kind TEXT NOT NULL, prompt TEXT NOT NULL, current_prompt TEXT NOT NULL DEFAULT '',
      root_path TEXT NOT NULL DEFAULT '', base_branch TEXT NOT NULL DEFAULT 'main',
      execution_mode TEXT NOT NULL DEFAULT 'worktree', worktree_path TEXT, branch TEXT,
      status TEXT NOT NULL DEFAULT 'queued', review_status TEXT NOT NULL DEFAULT 'pending',
      attempt INTEGER NOT NULL DEFAULT 1, error TEXT, pr_url TEXT, report_path TEXT,
      exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT, deadline_at TEXT NOT NULL DEFAULT ''
    );
  `);
  legacy
    .prepare(
      "INSERT INTO runs (id,project_id,agent_kind,prompt,started_at) VALUES ('r-old','p1','durable-worker','legacy','2026-01-01T00:00:00.000Z')",
    )
    .run();
  legacy.exec('PRAGMA user_version = 3');
  legacy.close();

  const db = new Db(dir);
  t.after(() => db.close());
  const version = (
    db.sqlite.prepare('PRAGMA user_version').get() as { user_version: number }
  ).user_version;
  assert.equal(version, DATABASE_VERSION);
  const columns = (
    db.sqlite.prepare('PRAGMA table_info(runs)').all() as { name: string }[]
  ).map((column) => column.name);
  assert.ok(columns.includes('injected_skills'));
  const migrated = db.getRun('r-old')!;
  assert.equal(migrated.prompt, 'legacy');
  assert.equal(migrated.injectedSkills ?? null, null);
  assert.ok(existsSync(join(dir, 'tian.db_v3.backup')));

  // Reopening the upgraded database takes no second backup.
  const reopened = new Db(dir);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getRun('r-old')!.injectedSkills ?? null, null);
});
