import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  readlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ResidentServer } from '../src/service/server.js';
import { ServiceClient } from '../src/service/client.js';
import { servicePaths } from '../src/shared/service-paths.js';
import { createManifest, verifyRelease } from '../src/service/release.js';
import { AppReplacement } from '../src/desktop/app-update.js';
import { DesktopController } from '../src/desktop/controller.js';
import { Db } from '../src/worker/db.js';

function temporary() {
  return mkdtempSync('/tmp/tian-upgrade-test-');
}
function pathsAt(root: string) {
  return {
    ...servicePaths(join(root, 'data')),
    socketPath: join(root, 'agent.sock'),
  };
}
async function running(root: string) {
  const paths = pathsAt(root),
    server = new ResidentServer(paths);
  await server.start();
  const client = new ServiceClient(paths.socketPath);
  await client.start();
  return { paths, server, client };
}

test('release verification covers runtime and every chunk before any service is stopped', () => {
  const root = temporary();
  try {
    mkdirSync(join(root, 'runtime'));
    writeFileSync(join(root, 'runtime/node'), 'runtime');
    writeFileSync(join(root, 'service.cjs'), 'entry');
    writeFileSync(join(root, 'chunk.cjs'), 'chunk');
    writeFileSync(
      join(root, 'release.json'),
      JSON.stringify(createManifest(root)),
    );
    const initial = verifyRelease(root);
    assert.ok(initial.id);
    writeFileSync(join(root, 'chunk.cjs'), 'modified chunk');
    assert.throws(() => verifyRelease(root), /checksum/);
    writeFileSync(
      join(root, 'release.json'),
      JSON.stringify(createManifest(root)),
    );
    assert.notEqual(verifyRelease(root).id, initial.id);
    writeFileSync(join(root, 'runtime/node'), 'modified runtime');
    assert.throws(() => verifyRelease(root), /checksum/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance gates every client and duplicate maintenance requests cannot reopen admission', async () => {
  const root = temporary();
  const { server, client } = await running(root);
  const second = new ServiceClient(client.socketPath);
  try {
    await second.start();
    await client.invoke('beginMaintenance', []);
    await assert.rejects(second.invoke('beginMaintenance', []), /maintenance/);
    await assert.rejects(
      second.invoke('addTask', ['global', 'must not be admitted', null]),
      /maintenance/,
    );
    assert.equal((await client.invoke('getActivity', [])).maintenance, true);
    await client.invoke('finishMaintenance', []);
    await second.invoke('addTask', [
      'global',
      'admitted after maintenance',
      null,
    ]);
    assert.equal((await client.invoke('listTasks', ['global'])).length, 1);
  } finally {
    client.close();
    second.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('pending work refuses maintenance and leaves the original service usable', async () => {
  const root = temporary();
  const { paths, server, client } = await running(root);
  try {
    const database = new DatabaseSync(join(paths.dataDir, 'tian.db'));
    database
      .prepare(
        'INSERT INTO runs(id,project_id,agent_kind,prompt,status,started_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        'pending',
        'project',
        'durable-worker',
        'test',
        'queued',
        new Date().toISOString(),
      );
    database.close();
    await assert.rejects(
      client.invoke('beginMaintenance', []),
      /still running/,
    );
    assert.equal((await client.invoke('getActivity', [])).maintenance, false);
    await client.invoke('addTask', ['global', 'still usable', null]);
  } finally {
    client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a staged service stays in maintenance across restart until the update commits', async () => {
  const root = temporary();
  const paths = pathsAt(root);
  mkdirSync(paths.installationDir, { recursive: true });
  const marker = join(paths.installationDir, 'maintenance.json');
  writeFileSync(marker, '{}');
  const server = new ResidentServer(paths);
  const client = new ServiceClient(paths.socketPath);
  try {
    await server.start();
    await client.start();
    assert.equal((await client.invoke('getActivity', [])).maintenance, true);
    await assert.rejects(
      client.invoke('addTask', ['global', 'blocked', null]),
      /maintenance/,
    );
    await assert.rejects(
      client.invoke('finishMaintenance', []),
      /not committed/,
    );
    rmSync(marker);
    await client.invoke('finishMaintenance', []);
    await client.invoke('addTask', ['global', 'after commit', null]);
  } finally {
    client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('disconnect persists across App restart and never stops the independent service', async () => {
  const root = temporary();
  const { paths, server, client } = await running(root);
  const environment = {
    paths,
    payloadDirectory: 'unused',
    updaterDirectory: 'unused',
    appBundle: null,
    appVersion: '1.1.0',
    pid: process.pid,
    chooseApp: async () => null,
    quit: () => {
      throw new Error('Must not quit');
    },
  };
  const first = new DesktopController(environment, () => {});
  let second: DesktopController | undefined;
  try {
    await first.initialize();
    assert.equal((await first.status()).connected, true);
    await first.action('disconnect');
    await client.invoke('addTask', ['global', 'service still running', null]);
    second = new DesktopController(environment, () => {});
    await second.initialize();
    assert.equal((await second.status()).connected, false);
    await assert.rejects(
      second.invoke('listTasks', ['global'], 1),
      /Disconnected/,
    );
    await second.action('connect');
    assert.equal(
      (await second.invoke('listTasks', ['global'], 1))[0].title,
      'service still running',
    );
  } finally {
    first.close();
    second?.close();
    client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('application replacement preserves symlinks and supports recovery after helper loss', () => {
  const root = temporary(),
    old = join(root, 'Installed.app'),
    candidate = join(root, 'Candidate.app');
  mkdirSync(old);
  mkdirSync(candidate);
  writeFileSync(join(old, 'version'), 'old');
  writeFileSync(join(candidate, 'version'), 'new');
  symlinkSync('version', join(candidate, 'link'));
  try {
    const replacement = new AppReplacement(candidate, old, 'test');
    replacement.stage();
    replacement.swap();
    assert.equal(readFileSync(join(old, 'version'), 'utf8'), 'new');
    assert.equal(readlinkSync(join(old, 'link')), 'version');
    new AppReplacement(candidate, old, 'test').rollback();
    assert.equal(readFileSync(join(old, 'version'), 'utf8'), 'old');
    const retry = new AppReplacement(candidate, old, 'test');
    retry.stage();
    retry.swap();
    retry.commit();
    assert.equal(readFileSync(join(old, 'version'), 'utf8'), 'new');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an older service refuses a newer database without rewriting its version', () => {
  const root = temporary();
  try {
    const database = new DatabaseSync(join(root, 'tian.db'));
    database.exec('PRAGMA user_version = 99');
    database.close();
    assert.throws(() => new Db(root), /newer service/);
    const check = new DatabaseSync(join(root, 'tian.db'));
    assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 99);
    check.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
