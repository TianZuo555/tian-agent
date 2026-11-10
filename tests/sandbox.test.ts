import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { FileError } from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import {
  SandboxedExecutionEnv,
  sandboxProfile,
  writeProfile,
  type SandboxSpec,
} from '../src/worker/sandbox.js';

const darwin = process.platform === 'darwin';
const root = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
const work = join(root, 'worktree');
const data = join(root, 'data');
// "Outside" must sit outside every allowed root — $TMPDIR is a write root,
// so the escape target lives under HOME where the catch-all deny applies.
const outside = mkdtempSync(join(homedir(), '.tian-sandbox-outside-'));
mkdirSync(work, { recursive: true });
mkdirSync(data, { recursive: true });

function spec(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    runId: 'run-1',
    workRoot: work,
    gitDir: null,
    dataDir: data,
    socketPath: join(root, 'service.sock'),
    network: true,
    extraWrite: [],
    allowRead: [],
    ...overrides,
  };
}

function env(s: SandboxSpec): SandboxedExecutionEnv {
  return new SandboxedExecutionEnv(
    new NodeExecutionEnv({ cwd: work, shellEnv: {} }),
    s,
    writeProfile(s, join(data, 'sandbox')),
  );
}

test('profile denies service data and allows the work root', () => {
  const profile = sandboxProfile(spec());
  assert.match(
    profile,
    /\(deny file-read\* file-write\* \(subpath "[^"]*data"\)/,
  );
  assert.match(profile, /\(deny file-write\*\)/);
  assert.match(profile, /\(allow file-write\* \(subpath "[^"]*worktree"\)/);
  assert.match(
    profile,
    /deny network-outbound \(remote unix-socket \(path-literal "[^"]*service\.sock"\)\)/,
  );
  // Network on: no blanket network deny.
  assert.doesNotMatch(profile, /\(deny network\*\)/);
});

test('profile denies external network but keeps localhost', () => {
  const profile = sandboxProfile(spec({ network: false }));
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /remote ip "localhost:\*"/);
});

test('profile escapes quotes and backslashes in paths', () => {
  const profile = sandboxProfile(spec({ extraWrite: ['/tmp/wei"rd\\path'] }));
  assert.match(profile, /wei\\"rd\\\\path/);
});

test('in-process writeFile outside the roots returns FileError', async () => {
  const sandbox = env(spec());
  const denied = await sandbox.writeFile(
    join(outside, 'nope.txt'),
    'x',
    BACKGROUND_CONTEXT,
  );
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.ok(denied.error instanceof FileError);
  assert.equal(denied.error.code, 'permission_denied');
  assert.equal(existsSync(join(outside, 'nope.txt')), false);
});

test('in-process writes inside the root and temp dir succeed', async () => {
  const sandbox = env(spec());
  const inside = await sandbox.writeFile(
    join(work, 'ok.txt'),
    'x',
    BACKGROUND_CONTEXT,
  );
  assert.equal(inside.ok, true);
  // A brand-new path: canonicalization walks up to the existing parent.
  const nested = await sandbox.writeFile(
    join(work, 'new-dir', 'ok.txt'),
    'x',
    BACKGROUND_CONTEXT,
  );
  assert.equal(nested.ok, true);
  const rename = await sandbox.renameFile(
    join(work, 'ok.txt'),
    join(outside, 'moved.txt'),
    BACKGROUND_CONTEXT,
  );
  assert.equal(rename.ok, false); // destination outside the roots
});

test('in-process reads of service data are denied', async () => {
  const sandbox = env(spec());
  const denied = await sandbox.readTextFile(
    join(data, 'settings.json'),
    BACKGROUND_CONTEXT,
  );
  assert.equal(denied.ok, false);
  const listed = await sandbox.listDir(data, BACKGROUND_CONTEXT);
  assert.equal(listed.ok, false);
  // The work root stays readable even though it could sit under a deny.
  const ok = await sandbox.listDir(work, BACKGROUND_CONTEXT);
  assert.equal(ok.ok, true);
});

test('profile denies service data after the write roots that contain it', () => {
  // The last matching rule wins: a write root ($TMPDIR here) that contains
  // the data dir must not open it again.
  const profile = sandboxProfile(spec());
  assert.ok(
    profile.indexOf('(deny file-read* file-write*') >
      profile.indexOf('(allow file-write*'),
  );
  // allowRead never re-opens service data.
  assert.match(
    sandboxProfile(spec({ allowRead: [data] })),
    /\(deny file-read\* file-write\* \(subpath "[^"]*data"\)/,
  );
});

test('in-process gate enforces the same denies as the profile', async () => {
  writeFileSync(join(data, 'secret.json'), '{}');
  const code = (result: { ok: boolean; error?: unknown }) =>
    result.ok ? 'ok' : (result.error as FileError).code;
  // Service data stays closed even when the project lists it in allowRead,
  // and a write root that contains it does not make it writable.
  const sandbox = env(spec({ allowRead: [data] }));
  assert.equal(
    code(
      await sandbox.readTextFile(join(data, 'secret.json'), BACKGROUND_CONTEXT),
    ),
    'permission_denied',
  );
  assert.equal(
    code(
      await sandbox.writeFile(join(data, 'leak.txt'), 'x', BACKGROUND_CONTEXT),
    ),
    'permission_denied',
  );
  assert.equal(existsSync(join(data, 'leak.txt')), false);
  // allowRead removes exact deny entries only, like the profile.
  const ssh = join(homedir(), '.ssh');
  const exact = env(spec({ allowRead: [ssh] }));
  assert.equal(code(await exact.exists(ssh, BACKGROUND_CONTEXT)), 'ok');
  const nested = env(spec({ allowRead: [join(ssh, 'known_hosts')] }));
  assert.equal(
    code(await nested.exists(join(ssh, 'known_hosts'), BACKGROUND_CONTEXT)),
    'permission_denied',
  );
  // Read-only files inside a write root reject in-process edits too.
  const state = join(root, 'cli-home-in-process');
  mkdirSync(state, { recursive: true });
  const config = join(state, 'config.toml');
  writeFileSync(config, 'model = "safe"\n');
  const readOnly = env(spec({ extraWrite: [state], readOnly: [config] }));
  assert.equal(
    code(await readOnly.writeFile(config, 'evil', BACKGROUND_CONTEXT)),
    'permission_denied',
  );
  assert.equal(
    code(
      await readOnly.writeFile(
        join(state, 'session.jsonl'),
        '{}',
        BACKGROUND_CONTEXT,
      ),
    ),
    'ok',
  );
  assert.equal(readFileSync(config, 'utf8'), 'model = "safe"\n');
});

test(
  'seatbelt: service data stays unwritable under a write root',
  { skip: !darwin },
  async () => {
    const sandbox = env(spec({ runId: 'run-data' }));
    const result = await sandbox.exec(
      `echo x > ${join(data, 'shell-leak.txt')}`,
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.notEqual(result.value.exitCode, 0);
    assert.equal(existsSync(join(data, 'shell-leak.txt')), false);
    // The work root, also under $TMPDIR, stays writable.
    const inside = await sandbox.exec(
      'echo ok > still-writable.txt',
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(inside.ok && inside.value.exitCode, 0);
  },
);

test('seatbelt: shell writes obey the profile', { skip: !darwin }, async () => {
  const sandbox = env(spec());
  const ok = await sandbox.exec(
    'echo seatbelt > inside.txt',
    undefined,
    BACKGROUND_CONTEXT,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.exitCode, 0);
  assert.equal(
    readFileSync(join(work, 'inside.txt'), 'utf8').trim(),
    'seatbelt',
  );
  const denied = await sandbox.exec(
    `echo x > ${outside}/escape.txt`,
    undefined,
    BACKGROUND_CONTEXT,
  );
  assert.equal(denied.ok, true);
  if (denied.ok) assert.notEqual(denied.value.exitCode, 0);
  assert.equal(existsSync(join(outside, 'escape.txt')), false);
});

test('seatbelt: argv commands are wrapped too', { skip: !darwin }, async () => {
  const sandbox = env(spec());
  const ok = await sandbox.exec(
    ['/usr/bin/touch', join(work, 'argv.txt')],
    undefined,
    BACKGROUND_CONTEXT,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.exitCode, 0);
  assert.equal(existsSync(join(work, 'argv.txt')), true);
  const denied = await sandbox.exec(
    ['/usr/bin/touch', join(outside, 'argv-escape.txt')],
    undefined,
    BACKGROUND_CONTEXT,
  );
  assert.equal(denied.ok, true);
  if (denied.ok) assert.notEqual(denied.value.exitCode, 0);
});

test(
  'seatbelt: network off blocks external but not localhost or the socket',
  { skip: !darwin },
  async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const sockServer = createServer();
    const sockPath = join(root, 'blocked.sock');
    await new Promise<void>((resolve) => sockServer.listen(sockPath, resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const sandbox = env(spec({ network: false, socketPath: sockPath }));
      const local = await sandbox.exec(
        `/usr/bin/nc -z 127.0.0.1 ${port}`,
        undefined,
        BACKGROUND_CONTEXT,
      );
      assert.equal(local.ok, true);
      if (local.ok) assert.equal(local.value.exitCode, 0);
      const external = await sandbox.exec(
        '/usr/bin/nc -z -G 3 1.1.1.1 443',
        undefined,
        BACKGROUND_CONTEXT,
      );
      assert.equal(external.ok, true);
      if (external.ok) assert.notEqual(external.value.exitCode, 0);
      const socket = await sandbox.exec(
        `/usr/bin/nc -U -z ${sockPath}`,
        undefined,
        BACKGROUND_CONTEXT,
      );
      assert.equal(socket.ok, true);
      if (socket.ok) assert.notEqual(socket.value.exitCode, 0);
    } finally {
      server.close();
      sockServer.close();
    }
  },
);

test(
  'seatbelt: the socket stays closed with network on',
  { skip: !darwin },
  async () => {
    const sockPath = join(root, 'always-blocked.sock');
    const sockServer = createServer();
    await new Promise<void>((resolve) => sockServer.listen(sockPath, resolve));
    try {
      const sandbox = env(spec({ socketPath: sockPath }));
      const socket = await sandbox.exec(
        `/usr/bin/nc -U -z ${sockPath}`,
        undefined,
        BACKGROUND_CONTEXT,
      );
      assert.equal(socket.ok, true);
      if (socket.ok) assert.notEqual(socket.value.exitCode, 0);
    } finally {
      sockServer.close();
    }
  },
);

test(
  'seatbelt: stopping a run kills the sandboxed process tree',
  { skip: !darwin },
  async () => {
    const sandbox = env(spec());
    const marker = join(work, 'sleeper.txt');
    const exec = sandbox.exec(
      `echo started > ${marker}; sleep 30; echo done >> ${marker}`,
      undefined,
      BACKGROUND_CONTEXT,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(readFileSync(marker, 'utf8').trim(), 'started');
    await sandbox.cleanup(BACKGROUND_CONTEXT);
    await exec;
    // The sleep was killed: no 'done' appended even after it would have ended.
    assert.equal(readFileSync(marker, 'utf8').trim(), 'started');
  },
);

test(
  'seatbelt: git metadata writable, main checkout read-only',
  { skip: !darwin },
  async () => {
    const { execFileSync } = await import('node:child_process');
    // Repo lives under HOME — outside every write root — like a real project.
    const repo = join(outside, 'repo');
    const wt = join(outside, 'wt');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'init']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', wt, 'HEAD']);
    const { worktreeGitDir } = await import('../src/worker/sandbox.js');
    const gitDir = worktreeGitDir(wt);
    assert.ok(gitDir);
    const sandbox = env(spec({ workRoot: wt, gitDir }));
    const status = await sandbox.exec(
      'git -C ' + wt + ' status --porcelain',
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(status.ok, true);
    if (status.ok) assert.equal(status.value.exitCode, 0);
    // Worktree files are writable, but `git add` writes objects into the
    // main repo's .git — outside every write root, so it fails by design.
    const write = await sandbox.exec(
      'echo a > ' + join(wt, 'a.txt'),
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(write.ok, true);
    if (write.ok) assert.equal(write.value.exitCode, 0);
    const add = await sandbox.exec(
      'git -C ' + wt + ' add a.txt',
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(add.ok, true);
    if (add.ok) assert.notEqual(add.value.exitCode, 0);
    const mainWrite = await sandbox.exec(
      'echo x > ' + join(repo, 'blocked.txt'),
      undefined,
      BACKGROUND_CONTEXT,
    );
    assert.equal(mainWrite.ok, true);
    if (mainWrite.ok) assert.notEqual(mainWrite.value.exitCode, 0);
    assert.equal(existsSync(join(repo, 'blocked.txt')), false);
  },
);

test(
  'seatbelt: read-only files inside a writable root reject edits, renames and deletes',
  { skip: !darwin },
  async () => {
    // An external CLI's state dir is writable, its configuration is not.
    const state = join(root, 'cli-home');
    mkdirSync(state, { recursive: true });
    const config = join(state, 'config.toml');
    writeFileSync(config, 'model = "safe"\n');
    const sandbox = env(
      spec({ runId: 'run-ro', extraWrite: [state], readOnly: [config] }),
    );
    const run = async (command: string) => {
      const result = await sandbox.exec(command, undefined, BACKGROUND_CONTEXT);
      assert.equal(result.ok, true);
      return result.ok ? result.value.exitCode : -1;
    };
    assert.equal(await run(`echo session > ${state}/session.jsonl`), 0);
    assert.notEqual(await run(`echo 'model = "evil"' > ${config}`), 0);
    assert.notEqual(
      await run(`echo evil > ${state}/tmp && mv ${state}/tmp ${config}`),
      0,
    );
    assert.notEqual(await run(`rm ${config}`), 0);
    assert.equal(readFileSync(config, 'utf8'), 'model = "safe"\n');
  },
);
