// Real launchd upgrade transactions, isolated from the user's App and databases.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { servicePaths } from '../src/shared/service-paths.js';
import { ServiceClient } from '../src/service/client.js';
import { createManifest } from '../src/service/release.js';
import {
  installation,
  installService,
  launchAgentPaths,
  launchAgentDefinition,
  loadedPid,
  recoverServiceUpdate,
  serviceStatus,
  setLoginEnabled,
  uninstallService,
  updateJournal,
} from '../src/service/launchd.js';
import { DesktopController } from '../src/desktop/controller.js';

const root = mkdtempSync('/tmp/tian-upgrade-e2e-');
const paths = {
  ...servicePaths(join(root, 'data')),
  socketPath: join(root, 'agent.sock'),
};
const options = { paths, label: `dev.tian.agent.upgrade-test.${process.pid}` };
const original = join(root, 'original'),
  next = join(root, 'next'),
  broken = join(root, 'broken');
cpSync(resolve('dist/service'), original, { recursive: true });
let controller: DesktopController | undefined;
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
function title() {
  return use(
    async (client) => (await client.invoke('listTasks', ['global']))[0].title,
  );
}
try {
  // The initial release has no maintenance RPC or version fields. Explicit stop is the migration boundary.
  mkdirSync(paths.installationDir, { recursive: true });
  const legacyEntry = join(root, 'legacy.cjs');
  writeFileSync(
    legacyEntry,
    `const {createServer}=require('node:net');const{DatabaseSync}=require('node:sqlite');const{join}=require('node:path');const db=new DatabaseSync(join(process.env.TIAN_AGENT_DATA_DIR,'pi-session.sqlite'));db.exec("CREATE TABLE legacy_fixture(value TEXT); INSERT INTO legacy_fixture VALUES ('preserved')");const server=createServer(socket=>socket.end(JSON.stringify({type:'ready',info:{protocolVersion:1,pid:process.pid,startedAt:new Date().toISOString()}})+'\\n'));server.listen(process.env.TIAN_AGENT_SOCKET_PATH);process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));`,
  );
  const agent = launchAgentPaths(options.label);
  mkdirSync(dirname(agent.plist), { recursive: true });
  const xml = execFileSync(
    '/usr/bin/plutil',
    ['-convert', 'xml1', '-o', '-', '--', '-'],
    {
      input: JSON.stringify(launchAgentDefinition(options, legacyEntry)),
      encoding: 'utf8',
    },
  );
  writeFileSync(agent.plist, xml, { mode: 0o600 });
  writeFileSync(
    join(paths.installationDir, 'installation.json'),
    JSON.stringify({
      label: options.label,
      nodePath: process.execPath,
      entryPath: legacyEntry,
      dataDir: paths.dataDir,
      socketPath: paths.socketPath,
    }),
  );
  execFileSync('/bin/launchctl', ['bootstrap', agent.domain, agent.plist]);
  const deadline = Date.now() + 10000;
  while (!existsSync(paths.socketPath)) {
    if (Date.now() > deadline) throw new Error('Legacy fixture did not start');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  controller = new DesktopController(
    {
      paths,
      label: options.label,
      payloadDirectory: original,
      updaterDirectory: resolve('dist/updater'),
      appBundle: null,
      appVersion: '1.1.0',
      pid: process.pid,
      chooseApp: async () => null,
      quit: () => {},
    },
    () => {},
  );
  assert.equal((await controller.status()).legacyRunning, true);
  await assert.rejects(
    installService(options, original),
    /Stop the legacy service first/,
  );
  await controller.action('stop');
  assert.equal(await loadedPid(options.label), null);
  controller.close();
  const old = await installService(options, original);
  const retained = new DatabaseSync(join(paths.dataDir, 'pi-session.sqlite'), {
    readOnly: true,
  });
  assert.equal(
    retained.prepare('SELECT value FROM legacy_fixture').get()?.value,
    'preserved',
  );
  retained.close();
  console.log(
    'Legacy service detection, explicit shutdown, and migration preserve existing data: PASS',
  );
  await use((client) =>
    client.invoke('addTask', ['global', 'persistent original', null]),
  );
  await setLoginEnabled(options, false);
  assert.equal(existsSync(launchAgentPaths(options.label).plist), false);
  assert.equal((await serviceStatus(paths)).pid, old.pid);
  cpSync(original, next, { recursive: true });
  writeFileSync(join(next, 'revision.txt'), 'new release');
  writeFileSync(
    join(next, 'release.json'),
    JSON.stringify(createManifest(next)),
  );
  await assert.rejects(
    installService(options, next, {
      beforeCommit: async () => {
        await use(async (client) => {
          assert.equal(
            (await client.invoke('getActivity', [])).maintenance,
            true,
          );
          await assert.rejects(
            client.invoke('addTask', [
              'global',
              'must not write before commit',
              null,
            ]),
            /maintenance/,
          );
        });
        const database = new DatabaseSync(join(paths.dataDir, 'tian.db'));
        database.exec("UPDATE tasks SET title = 'migration-only state'");
        database.close();
        throw new Error('Injected startup validation failure');
      },
    }),
    /previous installation was restored/,
  );
  assert.equal((await serviceStatus(paths)).releaseId, old.releaseId);
  assert.equal(await title(), 'persistent original');
  assert.equal(updateJournal(paths)?.phase, 'rolled-back');
  console.log(
    'Failed validation restores the previous executable and database snapshot: PASS',
  );
  cpSync(original, broken, { recursive: true });
  writeFileSync(
    join(broken, 'service.cjs'),
    "throw new Error('Injected service startup failure');",
  );
  writeFileSync(
    join(broken, 'release.json'),
    JSON.stringify(createManifest(broken)),
  );
  await assert.rejects(
    installService(options, broken, { healthTimeoutMs: 1200 }),
    /previous installation was restored/,
  );
  assert.equal((await serviceStatus(paths)).releaseId, old.releaseId);
  assert.equal(await title(), 'persistent original');
  console.log('A release that cannot start automatically rolls back: PASS');
  const upgraded = await installService(options, next);
  assert.notEqual(upgraded.releaseId, old.releaseId);
  assert.equal(await title(), 'persistent original');
  assert.equal(updateJournal(paths)?.phase, 'committed');
  assert.ok(installation(paths)?.nodePath.startsWith(paths.installationDir));
  console.log(
    'Successful upgrade commits an independent runtime and preserves data: PASS',
  );
  // Emulate a dead coordinator after database changes but before commit.
  await use((client) => client.invoke('beginMaintenance', []));
  writeFileSync(join(paths.installationDir, 'maintenance.json'), '{}');
  const journal = updateJournal(paths)!;
  journal.phase = 'starting';
  writeFileSync(
    join(paths.installationDir, 'update.json'),
    JSON.stringify(journal),
  );
  const database = new DatabaseSync(join(paths.dataDir, 'tian.db'));
  database.exec("UPDATE tasks SET title = 'uncommitted update'");
  database.close();
  await recoverServiceUpdate(options);
  assert.equal(await title(), 'persistent original');
  assert.equal((await serviceStatus(paths)).releaseId, old.releaseId);
  console.log(
    'An interrupted pre-commit upgrade can be recovered from its durable journal: PASS',
  );
  const environment = {
    paths,
    label: options.label,
    payloadDirectory: original,
    updaterDirectory: resolve('dist/updater'),
    appBundle: null,
    appVersion: '1.1.0',
    pid: process.pid,
    chooseApp: async () => null,
    quit: () => {
      throw new Error('Unexpected App quit');
    },
  };
  controller = new DesktopController(environment, () => {});
  await controller.initialize();
  await controller.action('stop');
  controller.close();
  controller = new DesktopController(environment, () => {});
  await controller.initialize();
  assert.equal(await loadedPid(options.label), null);
  assert.equal((await controller.status()).connectOnLaunch, false);
  await controller.action('start');
  assert.equal((await controller.status()).connected, true);
  assert.equal(existsSync(launchAgentPaths(options.label).plist), false);
  await controller.action('login-enable');
  assert.ok(existsSync(launchAgentPaths(options.label).plist));
  console.log(
    'Stop persists across App restart; manual start and login preference remain independent: PASS',
  );
} finally {
  controller?.close();
  const journal = updateJournal(paths);
  if (journal && !['committed', 'rolled-back'].includes(journal.phase))
    await recoverServiceUpdate(options);
  await uninstallService(options);
  rmSync(root, { recursive: true, force: true });
}
