import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Db } from '../src/worker/db';
import { Scopes } from '../src/worker/scopes';
import { CodexRuntime } from '../src/worker/codex';
import { RunOrchestrator, type WorkerRuntime } from '../src/worker/runs';

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition did not settle');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** pi is registered but never dispatched in these tests. */
const unusedPi: WorkerRuntime = {
  create: () => Promise.reject(new Error('pi unused')),
  get: () => Promise.reject(new Error('pi unused')),
};

const FAKE_CODEX = `#!/bin/sh
# Logs argv, emits a session + JSONL events, then acts on the prompt:
# contains HANG -> sleeps until killed; contains CRASH -> exits 3.
echo "$*" >> "$FAKE_CODEX_LOG"
session="sess-$$"
previous=""
for arg in "$@"; do
  [ "$previous" = resume ] && session="$arg"
  previous="$arg"
done
printf '%s\\n' "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"$session\\"}"
case "$*" in
  *HANG*)
    printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"rm -rf build"}}'
    while :; do sleep 1; done ;;
  *CRASH*) echo 'fake crash' >&2; exit 3 ;;
esac
printf '%s\\n' '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"worker report text"}}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
exit 0
`;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'tian-codex-'));
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
  const bin = join(directory, 'fake-codex');
  writeFileSync(bin, FAKE_CODEX);
  chmodSync(bin, 0o755);
  const log = join(directory, 'argv.log');
  const db = new Db(userData);
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: 1,
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: 'Manager',
  });
  const scopes = new Scopes(join(userData, 'global'), db);
  const resumed: string[] = [];
  const lifetimes: { codex: CodexRuntime; runs: RunOrchestrator }[] = [];
  /** One service lifetime: a fresh adapter and orchestrator on the same db. */
  const boot = () => {
    const codex = new CodexRuntime(db, {
      bin,
      env: { FAKE_CODEX_LOG: log },
      onAutoResume: (run) => resumed.push(run.id),
    });
    const runs = new RunOrchestrator(
      db,
      scopes,
      { pi: unusedPi, codex },
      userData,
      () => {},
      async () => {},
    );
    const lifetime = { codex, runs };
    lifetimes.push(lifetime);
    return lifetime;
  };
  let live = boot();
  /** Service close: pause, kill external workers, settle the collectors. */
  const shutdown = async () => {
    live.runs.pause();
    await live.codex.close();
    await live.runs.join();
  };
  /** Restart the service: shut down, then boot and recover active runs. */
  const restart = async () => {
    await shutdown();
    live = boot();
    await live.runs.recover();
    return live;
  };
  /**
   * A hard crash: the old service stops scheduling but never kills its
   * codex process; a new service boots and recovers next to it.
   */
  const crash = async () => {
    const old = live;
    old.runs.pause();
    live = boot();
    await live.runs.recover();
    return old;
  };
  t.after(async () => {
    for (const lifetime of lifetimes) lifetime.runs.pause();
    await Promise.all(lifetimes.map((lifetime) => lifetime.codex.close()));
    await Promise.all(lifetimes.map((lifetime) => lifetime.runs.join()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    projectPath,
    db,
    get codex() {
      return live.codex;
    },
    get runs() {
      return live.runs;
    },
    log,
    resumed,
    restart,
    crash,
  };
}

test('a codex run executes, stores its session, and reports progress', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'finish the task',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const stored = f.db.getRun(run.id)!;
  assert.ok(stored.externalSession?.startsWith('sess-'));
  assert.equal(stored.runtime, 'codex');
  const argv = readFileSync(f.log, 'utf8');
  assert.match(
    argv,
    /exec --json --sandbox workspace-write --skip-git-repo-check -- finish the task/,
  );
  const progress = await f.runs.progress(run.id);
  assert.equal(progress.lastText, 'worker report text');
});

test('a prompt that looks like a flag or a subcommand stays the prompt', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: '- fix the tests\n- keep the API',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => f.db.getRun(run.id)?.status === 'done');
  await f.runs.followUp(run.id, 'review');
  await until(() => f.db.getRun(run.id)?.attempt === 2);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const session = f.db.getRun(run.id)!.externalSession!;
  const argv = readFileSync(f.log, 'utf8');
  assert.match(argv, /--skip-git-repo-check -- - fix the tests/);
  assert.match(argv, new RegExp(`resume ${session} -- review\\n`));
});

test('a follow-up attempt resumes the stored codex session', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'first round',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const session = f.db.getRun(run.id)!.externalSession!;
  await f.runs.followUp(run.id, 'second round');
  await until(() => f.db.getRun(run.id)?.attempt === 2);
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const argv = readFileSync(f.log, 'utf8');
  assert.match(
    argv,
    new RegExp(
      `exec --json --sandbox workspace-write --skip-git-repo-check resume ${session} -- second round`,
    ),
  );
});

test('a resubmitted attempt auto-resumes once; a failed resume ends interrupted', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'CRASH mid-work',
    chiefConversationId: null,
    runtime: 'codex',
  });
  // The crash marks the attempt unanswered -> the run fails.
  await until(() => f.db.getRun(run.id)?.status === 'failed');
  const stored = f.db.getRun(run.id)!;
  assert.ok(stored.externalSession);

  // A restart recovery re-submits the same attempt on a fresh conversation —
  // the adapter turns it into `exec resume` with the kill notice.
  const conversation = await f.codex.get(stored.conversationId!);
  const resumed = await conversation.submit(
    stored.currentPrompt,
    `run:${run.id}:attempt:1`,
  );
  const second = await resumed.wait();
  // The resume also crashed: a failed resume ends the attempt interrupted.
  assert.equal(second.status, 'interrupted');
  assert.match(second.reason ?? '', /automatic resume failed/);
  assert.equal(f.db.getRun(run.id)!.autoResumed, 1);
  const argv = readFileSync(f.log, 'utf8');
  assert.match(argv, /--skip-git-repo-check resume sess-\d+ -- /);
  assert.match(argv, /killed mid-attempt/);

  // A third submit of the same attempt can never answer.
  const again = await conversation.submit(
    stored.currentPrompt,
    `run:${run.id}:attempt:1`,
  );
  const third = await again.wait();
  assert.equal(third.status, 'interrupted');
});

test('stop kills the codex process and interrupts the run', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'HANG forever',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => f.db.getRun(run.id)?.status === 'running');
  await f.runs.stop(run.id, { reason: 'test stop', actor: 'manager' });
  await until(() => f.db.getRun(run.id)?.status === 'interrupted');
});

test('a service restart resumes codex once with the last call; a second restart interrupts', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'HANG until restarted',
    chiefConversationId: 'mgr-conv',
    runtime: 'codex',
  });
  await until(
    () =>
      f.db.getRun(run.id)?.status === 'running' &&
      Boolean(f.db.getRun(run.id)?.externalLastCall),
  );
  const session = f.db.getRun(run.id)!.externalSession!;
  const deadline = f.db.getRun(run.id)!.deadlineAt;

  // First restart: close kills the process; recovery resumes the same
  // attempt from the stored session and names the last call from the row.
  await f.restart();
  await until(() => readFileSync(f.log, 'utf8').includes('killed mid-attempt'));
  let stored = f.db.getRun(run.id)!;
  assert.equal(stored.status, 'running');
  assert.equal(stored.attempt, 1);
  assert.equal(stored.autoResumed, 1);
  assert.equal(stored.deadlineAt, deadline);
  assert.deepEqual(f.resumed, [run.id]);
  const argv = readFileSync(f.log, 'utf8');
  assert.match(argv, new RegExp(`resume ${session} -- `));
  assert.match(argv, /last tool call was command_execution: .*rm -rf build/);

  // Second restart in the same attempt: no second resume, the run ends
  // interrupted and keeps its worktree.
  await f.restart();
  await until(() => f.db.getRun(run.id)?.status === 'interrupted');
  stored = f.db.getRun(run.id)!;
  assert.match(stored.error ?? '', /killed a second time/);
  assert.ok(stored.worktreePath && existsSync(stored.worktreePath));
  assert.deepEqual(f.resumed, [run.id]);
});

test('a restart before codex reports a session ends the attempt interrupted', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'finish the task',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => f.db.getRun(run.id)?.status === 'done');
  // Simulate a kill between launch and the thread.started event: a crash
  // leaves this row as stored, so it bypasses the lifecycle guard.
  f.db.sqlite
    .prepare("UPDATE runs SET status = 'running' WHERE id = ?")
    .run(run.id);
  f.db.patchRun(run.id, { externalSession: null });
  const conversation = await f.codex.get(f.db.getRun(run.id)!.conversationId!);
  const submission = await conversation.submit(
    'again',
    `run:${run.id}:attempt:1`,
  );
  const outcome = await submission.wait();
  assert.equal(outcome.status, 'interrupted');
  assert.match(outcome.reason ?? '', /session id/);
});

test('a resume after a hard crash kills the orphaned codex process first', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'HANG until crashed',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => Boolean(f.db.getRun(run.id)?.externalSession));
  const orphan = f.db.getRun(run.id)!.externalPid!;
  assert.ok(orphan);
  assert.ok(alive(orphan));
  const old = await f.crash();
  await until(() => readFileSync(f.log, 'utf8').includes('killed mid-attempt'));
  await until(() => !alive(orphan));
  assert.notEqual(f.db.getRun(run.id)!.externalPid, orphan);
  await old.runs.join();
});

test('a second hard crash kills the resumed process before interrupting', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'HANG through two hard crashes',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => Boolean(f.db.getRun(run.id)?.externalSession));
  const firstPid = f.db.getRun(run.id)!.externalPid!;
  const firstLifetime = await f.crash();
  await until(() => f.db.getRun(run.id)?.externalPid !== firstPid);
  const secondPid = f.db.getRun(run.id)!.externalPid!;
  assert.ok(alive(secondPid));
  const secondLifetime = await f.crash();
  await until(() => f.db.getRun(run.id)?.status === 'interrupted');
  await until(() => !alive(secondPid));
  assert.equal(f.db.getRun(run.id)?.autoResumed, 1);
  assert.deepEqual(f.resumed, [run.id]);
  await Promise.all([firstLifetime.runs.join(), secondLifetime.runs.join()]);
});

test('a hard crash without a stored session kills the surviving process', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'HANG before session persistence',
    chiefConversationId: null,
    runtime: 'codex',
  });
  await until(() => Boolean(f.db.getRun(run.id)?.externalLastCall));
  const orphan = f.db.getRun(run.id)!.externalPid!;
  // Simulate losing the session event when the service crashed.
  f.db.patchRun(run.id, { externalSession: null });
  const old = await f.crash();
  await until(() => f.db.getRun(run.id)?.status === 'interrupted');
  await until(() => !alive(orphan));
  assert.match(f.db.getRun(run.id)?.error ?? '', /session id/);
  assert.deepEqual(f.resumed, []);
  await old.runs.join();
});

test('codex model and thinking pins apply to initial, follow-up and recovered attempts', async (t) => {
  const f = fixture(t);
  const run = await f.runs.dispatch({
    projectRef: 'p1',
    prompt: 'finish with the configured model',
    chiefConversationId: null,
    runtime: 'codex',
    model: 'configured-model',
    thinkingLevel: 'high',
  });
  await until(() => f.db.getRun(run.id)?.status === 'done');
  const session = f.db.getRun(run.id)!.externalSession!;
  await f.runs.followUp(run.id, 'HANG with the same model');
  await until(() => Boolean(f.db.getRun(run.id)?.externalLastCall));
  await until(() =>
    readFileSync(f.log, 'utf8').includes('HANG with the same model'),
  );
  const old = await f.crash();
  await until(() => readFileSync(f.log, 'utf8').includes('killed mid-attempt'));
  const argv = readFileSync(f.log, 'utf8');
  const pins =
    '--model configured-model --config model_reasoning_effort="high"';
  assert.equal(argv.split(pins).length - 1, 3);
  assert.ok(argv.includes(`${pins} -- finish with the configured model`));
  assert.ok(
    argv.includes(`${pins} resume ${session} -- HANG with the same model`),
  );
  assert.ok(
    argv.includes(`${pins} resume ${session} -- The previous codex process`),
  );
  await old.runs.join();
});
