// Builds two real macOS Apps and exercises replacement with hidden, isolated windows.
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { inc } from 'semver';
import { bundleInfo, stageApp } from '../src/desktop/app-update.js';
import { servicePaths } from '../src/shared/service-paths.js';
import {
  installService,
  recoverServiceUpdate,
  serviceStatus,
  uninstallService,
  updateJournal,
} from '../src/service/launchd.js';
import { ServiceClient } from '../src/service/client.js';

if (process.platform !== 'darwin') throw new Error('This test requires macOS');
const root = mkdtempSync('/tmp/tian-app-upgrade-');
const packagePath = resolve('package.json'),
  packageBytes = readFileSync(packagePath),
  metadata = JSON.parse(packageBytes.toString()) as { version: string };
const output = resolve(`out/Tian Agent-darwin-${process.arch}/Tian Agent.app`);
const base = join(root, 'Base.app'),
  candidate = join(root, 'New.app'),
  installed = join(root, 'Installed.app');
const paths = {
  ...servicePaths(join(root, 'data')),
  socketPath: join(root, 'agent.sock'),
};
const options = {
  paths,
  label: `dev.tian.agent.app-upgrade-test.${process.pid}`,
};
const environment = {
  ...process.env,
  TIAN_AGENT_DATA_DIR: paths.dataDir,
  TIAN_AGENT_SOCKET_PATH: paths.socketPath,
  TIAN_AGENT_SERVICE_LABEL: options.label,
  TIAN_AGENT_SHOW_WINDOW: '0',
};
let helper: ChildProcess | undefined;
async function waitUntil(
  check: () => boolean | Promise<boolean>,
  message: string,
  timeout = 30000,
) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
function appPids() {
  if (!existsSync(installed)) return [];
  const executable = join(realpathSync(installed), 'Contents/MacOS/Tian Agent');
  return execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match?.[2]?.replace(/^\/private\/tmp\//, '/tmp/') ===
        executable.replace(/^\/private\/tmp\//, '/tmp/')
        ? [Number(match![1])]
        : [];
    });
}
async function stopApps() {
  for (const pid of appPids()) process.kill(pid, 'SIGTERM');
  await waitUntil(() => appPids().length === 0, 'Test App did not exit', 10000);
}
async function use<T>(action: (client: ServiceClient) => Promise<T>) {
  const client = new ServiceClient(paths.socketPath, undefined, {
    readyTimeoutMs: 5000,
  });
  try {
    await client.start();
    return await action(client);
  } finally {
    client.close();
  }
}
async function startApp() {
  rmSync(join(paths.dataDir, 'DevToolsActivePort'), { force: true });
  const info = await bundleInfo(installed);
  const app = spawn(
    join(installed, 'Contents/MacOS', info.executable),
    ['--remote-debugging-port=0'],
    { env: environment, stdio: 'ignore' },
  );
  await once(app, 'spawn');
  await waitUntil(
    () => existsSync(join(paths.dataDir, 'DevToolsActivePort')),
    'Test App did not expose its renderer',
  );
  return app;
}
async function evaluate(expression: string) {
  const port = readFileSync(
    join(paths.dataDir, 'DevToolsActivePort'),
    'utf8',
  ).split('\n')[0];
  const pages = (await (
    await fetch(`http://127.0.0.1:${port}/json`)
  ).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = pages.find((value) => value.type === 'page');
  assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('Cannot connect to test renderer')),
      { once: true },
    );
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails)
          reject(new Error(JSON.stringify(message)));
        else resolve(message.result?.result?.value);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  } finally {
    socket.close();
  }
}
async function executeUpdate(oldPid: number, failStartup: boolean) {
  const staged = await stageApp(
    candidate,
    installed,
    metadata.version,
    paths,
    oldPid,
    options.label,
  );
  if (failStartup) {
    const info = await bundleInfo(staged.request.stagedApp);
    writeFileSync(
      join(staged.request.stagedApp, 'Contents/MacOS', info.executable),
      '#!/bin/sh\nexit 33\n',
      { mode: 0o755 },
    );
  }
  const node = join(base, 'Contents/Resources/service/runtime/node'),
    entry = join(base, 'Contents/Resources/updater/updater.cjs');
  helper = spawn(node, [entry, staged.request.directory], {
    env: environment,
    stdio: 'ignore',
  });
  const completion = once(helper, 'exit');
  process.kill(oldPid, 'SIGTERM');
  const [code] = await completion;
  const result = JSON.parse(
    readFileSync(join(staged.request.directory, 'result.json'), 'utf8'),
  ) as { phase: string; message?: string };
  assert.equal(
    code,
    failStartup ? 1 : 0,
    (result.message ?? '') +
      (existsSync(join(staged.request.directory, 'app.log'))
        ? '\n' + readFileSync(join(staged.request.directory, 'app.log'), 'utf8')
        : ''),
  );
  assert.equal(
    result.phase,
    failStartup ? 'failed' : 'committed',
    result.message ?? '',
  );
  return staged.request.directory;
}
try {
  execFileSync('pnpm', ['package'], { stdio: 'inherit' });
  cpSync(output, base, { recursive: true, verbatimSymlinks: true });
  try {
    writeFileSync(
      packagePath,
      JSON.stringify(
        { ...metadata, version: inc(metadata.version, 'patch') },
        null,
        2,
      ) + '\n',
    );
    execFileSync('pnpm', ['package'], { stdio: 'inherit' });
    cpSync(output, candidate, { recursive: true, verbatimSymlinks: true });
  } finally {
    writeFileSync(packagePath, packageBytes);
  }
  cpSync(base, installed, { recursive: true, verbatimSymlinks: true });
  await installService(options, join(base, 'Contents/Resources/service'));
  await use((client) =>
    client.invoke('addTask', [
      'global',
      'survives both App and service upgrade',
      null,
    ]),
  );
  let app = await startApp();
  await waitUntil(
    async () =>
      Boolean(
        await evaluate(
          '!!document.querySelector(\'button[aria-label="Open settings"]\')',
        ),
      ),
    'Settings control did not become ready',
  );
  await evaluate(
    'document.querySelector(\'button[aria-label="Open settings"]\').click()',
  );
  await waitUntil(
    async () =>
      Boolean(await evaluate("document.body.innerText.includes('服务与升级')")),
    'Service controls did not render',
  );
  await evaluate("window.tian.desktop('disconnect')");
  assert.equal(
    (
      (await evaluate("window.tian.desktop('status')")) as {
        connected: boolean;
      }
    ).connected,
    false,
  );
  assert.ok((await serviceStatus(paths)).pid);
  await evaluate("window.tian.desktop('connect')");
  console.log(
    'Packaged settings, disconnect, reconnect, and independent service: PASS',
  );
  await executeUpdate(app.pid!, true);
  assert.equal((await bundleInfo(installed)).version, metadata.version);
  assert.equal((await serviceStatus(paths)).serviceVersion, metadata.version);
  assert.equal(
    (await use((client) => client.invoke('listTasks', ['global'])))[0].title,
    'survives both App and service upgrade',
  );
  await stopApps();
  console.log(
    'A failed App startup restores both the previous App and service: PASS',
  );
  app = await startApp();
  const job = await executeUpdate(app.pid!, false);
  assert.equal(
    (await bundleInfo(installed)).version,
    inc(metadata.version, 'patch'),
  );
  assert.equal(
    (await serviceStatus(paths)).serviceVersion,
    inc(metadata.version, 'patch'),
  );
  assert.ok(existsSync(join(job, 'ready.json')));
  assert.equal(
    (await use((client) => client.invoke('listTasks', ['global'])))[0].title,
    'survives both App and service upgrade',
  );
  console.log(
    'Real App replacement, renderer health acknowledgment, paired service upgrade, and data preservation: PASS',
  );
} finally {
  writeFileSync(packagePath, packageBytes);
  if (helper?.exitCode === null) helper.kill('SIGKILL');
  await stopApps();
  const journal = updateJournal(paths);
  if (journal && !['committed', 'rolled-back'].includes(journal.phase))
    await recoverServiceUpdate(options);
  if (existsSync(join(paths.installationDir, 'installation.json')))
    await uninstallService(options);
  if (existsSync(base)) {
    rmSync(output, { recursive: true, force: true });
    cpSync(base, output, { recursive: true, verbatimSymlinks: true });
  }
  rmSync(root, { recursive: true, force: true });
  execFileSync('pnpm', ['build:service'], { stdio: 'inherit' });
}
