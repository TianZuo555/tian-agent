// Exercises a real, isolated per-user LaunchAgent. Never opens the user's agent data.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { servicePaths } from '../src/shared/service-paths.js';
import { ServiceClient } from '../src/service/client.js';
import { installService, uninstallService } from '../src/service/launchd.js';

if (process.platform !== 'darwin')
  throw new Error('This smoke test requires macOS launchd');
const buildDirectory = resolve('dist/service');
if (!existsSync(join(buildDirectory, 'service.cjs')))
  throw new Error('Run pnpm build:service first');
const root = mkdtempSync('/tmp/tian-launchd-');
const paths = {
  ...servicePaths(join(root, 'data')),
  socketPath: join(root, 'agent.sock'),
};
const options = { paths, label: `dev.tian.agent.test.${process.pid}` };
const clients: ServiceClient[] = [];
const memory = join(paths.dataDir, 'scopes/global/memory');
mkdirSync(memory, { recursive: true });
writeFileSync(
  join(memory, 'LOG.txt'),
  '2026-01-01 00:00 Shared persistent memory\n',
);

try {
  const installed = await installService(options, buildDirectory);
  const app = new ServiceClient(paths.socketPath);
  clients.push(app);
  await app.start();
  const first = await app.invoke('openSession', [
    { channel: 'app', externalId: 'desktop', scopeId: 'global' },
  ]);
  const telegram = await app.invoke('openSession', [
    { channel: 'telegram', externalId: 'test-chat', scopeId: 'global' },
  ]);
  assert.notEqual(first.conversationId, telegram.conversationId);
  await app.invoke('addTask', [
    'global',
    'Survives the App and daemon restart',
    null,
  ]);
  app.close();
  const reconnected = new ServiceClient(paths.socketPath, undefined, {
    readyTimeoutMs: 40_000,
    reconnectDelayMs: 200,
  });
  clients.push(reconnected);
  assert.equal((await reconnected.start()).pid, installed.pid);
  assert.match(
    (await reconnected.invoke('memoryDump', ['global'])).items[0].content,
    /Shared persistent memory/,
  );

  // A hard crash leaves the storage lease behind; launchd must restart and recover it.
  process.kill(installed.pid, 'SIGKILL');
  const deadline = Date.now() + 45_000;
  while (!reconnected.info || reconnected.info.pid === installed.pid) {
    if (Date.now() > deadline)
      throw new Error('launchd did not restart the daemon');
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(
    (await reconnected.invoke('listTasks', ['global']))[0].title,
    'Survives the App and daemon restart',
  );
  const restored = await reconnected.invoke('openSession', [
    { channel: 'telegram', externalId: 'test-chat', scopeId: 'global' },
  ]);
  assert.equal(restored.conversationId, telegram.conversationId);
  console.log(
    'LaunchAgent installation, App disconnect, crash restart, sessions, and shared memory: PASS',
  );
} finally {
  for (const client of clients) client.close();
  await uninstallService(options);
  rmSync(root, { recursive: true, force: true });
}
