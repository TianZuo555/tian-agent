import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lock, check } from 'proper-lockfile';
import { SERVICE_LABEL, type ServicePaths } from '../shared/service-paths.js';
import { atomicWrite } from '../worker/files.js';
import { ServiceClient } from './client.js';
import { checkDatabaseOwner } from './ownership.js';
import { verifyRelease } from './release.js';
import { pruneServiceArtifacts } from './cleanup.js';
import type { ServiceInfo } from '../shared/types.js';

const execute = promisify(execFile);
export interface LaunchAgentOptions {
  paths: ServicePaths;
  label?: string;
  nodePath?: string;
}
interface Installation {
  label: string;
  nodePath: string;
  entryPath: string;
  dataDir: string;
  socketPath: string;
  releaseId: string;
  version: string;
  loginEnabled: boolean;
}
export interface UpdateJournal {
  id: string;
  phase:
    | 'preparing'
    | 'backed-up'
    | 'starting'
    | 'committed'
    | 'rolled-back'
    | 'failed';
  message?: string;
  previousPlist: string | null;
  previousInstallation: string | null;
  previousLogin: boolean;
  previousRunning: boolean;
  keepStopped?: boolean;
  backupReady: boolean;
  backupFiles: string[];
  releaseId: string;
}
export function launchAgentPaths(label = SERVICE_LABEL) {
  if (!/^[a-zA-Z0-9.-]+$/.test(label))
    throw new Error('Invalid launch agent label');
  if (process.platform !== 'darwin' || !process.getuid)
    throw new Error('LaunchAgent installation requires macOS');
  return {
    label,
    domain: `gui/${process.getuid()}`,
    target: `gui/${process.getuid()}/${label}`,
    plist: join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`),
  };
}
const localPlist = (paths: ServicePaths) =>
  join(paths.installationDir, 'launch-agent.plist');
const journalPath = (paths: ServicePaths) =>
  join(paths.installationDir, 'update.json');
const markerPath = (paths: ServicePaths) =>
  join(paths.installationDir, 'maintenance.json');
const readOptional = (path: string) =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;
export function installation(paths: ServicePaths): Installation | null {
  const value = readOptional(join(paths.installationDir, 'installation.json'));
  return value ? (JSON.parse(value) as Installation) : null;
}
export function updateJournal(paths: ServicePaths): UpdateJournal | null {
  const value = readOptional(journalPath(paths));
  return value ? (JSON.parse(value) as UpdateJournal) : null;
}
function saveJournal(paths: ServicePaths, journal: UpdateJournal) {
  atomicWrite(journalPath(paths), JSON.stringify(journal, null, 2));
}
export async function loadedPid(label?: string): Promise<number | null> {
  try {
    const result = await execute('/bin/launchctl', [
      'print',
      launchAgentPaths(label).target,
    ]);
    const pid = /\bpid = (\d+)/.exec(result.stdout)?.[1];
    return pid ? Number(pid) : 0;
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== 'number') throw error;
    return null;
  }
}
export async function updateLocked(paths: ServicePaths) {
  if (!existsSync(paths.installationDir)) return false;
  return check(paths.installationDir, {
    lockfilePath: join(paths.installationDir, 'update.lock'),
    stale: 60_000,
  });
}
async function assertNotUpdating(options: LaunchAgentOptions) {
  const journal = updateJournal(options.paths);
  if (
    (await updateLocked(options.paths)) ||
    existsSync(markerPath(options.paths)) ||
    (journal && !['committed', 'rolled-back'].includes(journal.phase))
  )
    throw new Error(
      'An update is in progress or needs recovery. Use Recover update first.',
    );
}
async function unload(options: LaunchAgentOptions): Promise<void> {
  const agent = launchAgentPaths(options.label);
  const pid = await loadedPid(options.label);
  if (pid === null) return;
  await execute('/bin/launchctl', ['bootout', agent.target]);
  if (!pid) return;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() > deadline)
      throw new Error('The previous service did not stop within 30 seconds');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function withClient<T>(
  paths: ServicePaths,
  action: (client: ServiceClient) => Promise<T>,
  timeout = 1500,
): Promise<T> {
  const client = new ServiceClient(paths.socketPath, undefined, {
    readyTimeoutMs: timeout,
    requestTimeoutMs: 30_000,
  });
  try {
    await client.start();
    return await action(client);
  } finally {
    client.close();
  }
}
export async function serviceStatus(paths: ServicePaths, timeoutMs = 1_000) {
  return withClient(paths, async (client) => client.info!, timeoutMs);
}
async function boot(options: LaunchAgentOptions, timeoutMs = 30_000) {
  const agent = launchAgentPaths(options.label);
  const plist = existsSync(localPlist(options.paths))
    ? localPlist(options.paths)
    : agent.plist;
  if (!existsSync(plist))
    throw new Error(
      'The resident service is not installed. Install the bundled service first.',
    );
  if ((await loadedPid(options.label)) === null)
    await execute('/bin/launchctl', ['bootstrap', agent.domain, plist]);
  else await execute('/bin/launchctl', ['kickstart', agent.target]);
  return serviceStatus(options.paths, timeoutMs);
}
export async function startService(options: LaunchAgentOptions) {
  await assertNotUpdating(options);
  if (installation(options.paths) && !installation(options.paths)!.version)
    throw new Error(
      'Install the bundled service to migrate this older installation first.',
    );
  return boot(options);
}
export async function stopService(options: LaunchAgentOptions): Promise<void> {
  await assertNotUpdating(options);
  if ((await loadedPid(options.label)) === null) return;
  // The initial release has no maintenance RPC. Explicit stop still uses its normal SIGTERM shutdown.
  const current = installation(options.paths);
  if (current && !current.version) {
    await unload(options);
    return;
  }
  await withClient(options.paths, (client) =>
    client.invoke('beginMaintenance', []),
  );
  try {
    await unload(options);
  } catch (error) {
    await withClient(options.paths, (client) =>
      client.invoke('finishMaintenance', []),
    ).catch(() => {});
    throw error;
  }
}
export function launchAgentDefinition(
  options: LaunchAgentOptions,
  entryPath: string,
  releaseId = 'development',
) {
  const { label } = launchAgentPaths(options.label);
  return {
    Label: label,
    ProgramArguments: [
      options.nodePath ?? process.execPath,
      entryPath,
      '--data-dir',
      options.paths.dataDir,
    ],
    WorkingDirectory: homedir(),
    EnvironmentVariables: {
      HOME: homedir(),
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TIAN_AGENT_DATA_DIR: options.paths.dataDir,
      TIAN_AGENT_SOCKET_PATH: options.paths.socketPath,
      TIAN_AGENT_RELEASE_ID: releaseId,
    },
    RunAtLoad: true,
    KeepAlive: true,
    ThrottleInterval: 10,
    ExitTimeOut: 30,
    ProcessType: 'Background',
    Umask: 0o077,
    StandardOutPath: options.paths.logPath,
    StandardErrorPath: options.paths.logPath,
  };
}
function writePlist(
  options: LaunchAgentOptions,
  xml: string,
  loginEnabled: boolean,
) {
  const agent = launchAgentPaths(options.label);
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  atomicWrite(localPlist(options.paths), xml);
  chmodSync(localPlist(options.paths), 0o600);
  if (loginEnabled) {
    atomicWrite(agent.plist, xml);
    chmodSync(agent.plist, 0o600);
  } else rmSync(agent.plist, { force: true });
}
export async function setLoginEnabled(
  options: LaunchAgentOptions,
  enabled: boolean,
) {
  await assertNotUpdating(options);
  const current = installation(options.paths);
  if (!current) throw new Error('Install the service first');
  const xml = readFileSync(localPlist(options.paths), 'utf8');
  writePlist(options, xml, enabled);
  atomicWrite(
    join(options.paths.installationDir, 'installation.json'),
    JSON.stringify({ ...current, loginEnabled: enabled }, null, 2),
  );
}
export async function withUpdateLock<T>(
  paths: ServicePaths,
  action: () => Promise<T>,
): Promise<T> {
  mkdirSync(paths.installationDir, { recursive: true, mode: 0o700 });
  const release = await lock(paths.installationDir, {
    lockfilePath: join(paths.installationDir, 'update.lock'),
    stale: 60_000,
    update: 10_000,
    retries: 0,
  });
  try {
    return await action();
  } finally {
    await release();
  }
}
function backupDirectory(paths: ServicePaths, journal: UpdateJournal) {
  if (!/^[a-f0-9-]{36}$/.test(journal.id))
    throw new Error('Invalid update recovery record');
  return join(paths.installationDir, 'backups', journal.id);
}
const databaseFiles = [
  'tian.db',
  'tian.db-wal',
  'tian.db-shm',
  'pi-session.sqlite',
  'pi-session.sqlite-wal',
  'pi-session.sqlite-shm',
];
function snapshot(paths: ServicePaths, journal: UpdateJournal) {
  const destination = backupDirectory(paths, journal);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of databaseFiles)
    if (existsSync(join(paths.dataDir, file))) {
      cpSync(join(paths.dataDir, file), join(destination, file));
      journal.backupFiles.push(file);
    }
  journal.backupReady = true;
  journal.phase = 'backed-up';
  saveJournal(paths, journal);
}
async function rollback(options: LaunchAgentOptions, journal: UpdateJournal) {
  if (!journal.backupReady) {
    rmSync(markerPath(options.paths), { force: true });
    if ((await loadedPid(options.label)) !== null)
      await withClient(options.paths, (client) =>
        client.invoke('finishMaintenance', []),
      );
    else if (journal.previousRunning) await boot(options);
    journal.phase = 'rolled-back';
    saveJournal(options.paths, journal);
    return;
  }
  await unload(options);
  await checkDatabaseOwner(options.paths.dataDir);
  const release = await lock(options.paths.dataDir, {
    lockfilePath: join(options.paths.dataDir, 'service.lock'),
    stale: 10_000,
    update: 5_000,
    retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
  });
  try {
    if (journal.backupReady) {
      const directory = backupDirectory(options.paths, journal);
      for (const file of journal.backupFiles)
        if (!databaseFiles.includes(file) || !existsSync(join(directory, file)))
          throw new Error(
            'Database backup is incomplete; recovery has been stopped',
          );
      for (const file of databaseFiles)
        rmSync(join(options.paths.dataDir, file), { force: true });
      for (const file of journal.backupFiles)
        cpSync(join(directory, file), join(options.paths.dataDir, file));
    }
    const installPath = join(
      options.paths.installationDir,
      'installation.json',
    );
    if (journal.previousPlist)
      writePlist(options, journal.previousPlist, journal.previousLogin);
    else {
      rmSync(localPlist(options.paths), { force: true });
      rmSync(launchAgentPaths(options.label).plist, { force: true });
    }
    if (journal.previousInstallation)
      atomicWrite(installPath, journal.previousInstallation);
    else rmSync(installPath, { force: true });
    rmSync(markerPath(options.paths), { force: true });
  } finally {
    await release();
  }
  if (journal.previousRunning) await boot(options);
  journal.phase = 'rolled-back';
  saveJournal(options.paths, journal);
}
export async function recoverServiceUpdate(options: LaunchAgentOptions) {
  return withUpdateLock(options.paths, async () => {
    const journal = updateJournal(options.paths);
    if (!journal) return;
    if (journal.phase === 'committed') {
      rmSync(markerPath(options.paths), { force: true });
      if ((await loadedPid(options.label)) !== null) {
        if (journal.keepStopped) await unload(options);
        else
          await withClient(options.paths, (client) =>
            client.invoke('finishMaintenance', []),
          );
      }
      journal.message = undefined;
      saveJournal(options.paths, journal);
      return;
    }
    if (journal.phase === 'rolled-back') return;
    await rollback(options, journal);
  });
}
export interface InstallHooks {
  beforeCommit?: (info: ServiceInfo) => Promise<void>;
  keepStopped?: boolean;
  healthTimeoutMs?: number;
}
/** Stages immutable code and runtime; keeps all writes gated until validation commits. */
export async function installService(
  options: LaunchAgentOptions,
  buildDirectory: string,
  hooks: InstallHooks = {},
) {
  return withUpdateLock(options.paths, async () => {
    const pending = updateJournal(options.paths);
    if (
      existsSync(markerPath(options.paths)) ||
      (pending && !['committed', 'rolled-back'].includes(pending.phase))
    )
      throw new Error(
        'Recover the previous update before installing another release',
      );
    const { manifest, id } = verifyRelease(buildDirectory);
    const runtimeVersion = (
      await execute(join(buildDirectory, 'runtime/node'), ['--version'])
    ).stdout.trim();
    if (Number(runtimeVersion.replace(/^v/, '').split('.')[0]) < 24)
      throw new Error('Node.js 24 or later is required');
    const releaseDirectory = join(
      options.paths.installationDir,
      'releases',
      id,
    );
    if (!existsSync(releaseDirectory)) {
      const staging = releaseDirectory + '.staging-' + randomUUID();
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      try {
        cpSync(buildDirectory, staging, { recursive: true });
        verifyRelease(staging);
        renameSync(staging, releaseDirectory);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    } else verifyRelease(releaseDirectory);
    mkdirSync(join(options.paths.installationDir, 'logs'), {
      recursive: true,
      mode: 0o700,
    });
    chmodSync(options.paths.dataDir, 0o700);
    const previous = installation(options.paths);
    const previousPid = await loadedPid(options.label);
    // An unmanaged or legacy backend must be shut down by its owner before adoption.
    if (previousPid !== null && previous && !previous.version)
      throw new Error(
        'Stop the legacy service first, then install the bundled service to migrate it.',
      );
    if (previousPid === null) await checkDatabaseOwner(options.paths.dataDir);
    const journal: UpdateJournal = {
      id: randomUUID(),
      phase: 'preparing',
      previousPlist:
        readOptional(localPlist(options.paths)) ??
        readOptional(launchAgentPaths(options.label).plist),
      previousInstallation: readOptional(
        join(options.paths.installationDir, 'installation.json'),
      ),
      previousLogin: previous?.loginEnabled ?? true,
      previousRunning: previousPid !== null,
      backupReady: false,
      keepStopped: hooks.keepStopped ?? false,
      backupFiles: [],
      releaseId: id,
    };
    saveJournal(options.paths, journal);
    if (previousPid !== null) {
      try {
        await withClient(options.paths, (client) =>
          client.invoke('beginMaintenance', []),
        );
      } catch (error) {
        journal.phase = 'rolled-back';
        journal.message = String(error);
        saveJournal(options.paths, journal);
        throw error;
      }
    }
    try {
      atomicWrite(
        markerPath(options.paths),
        JSON.stringify({ id: journal.id }),
      );
      await unload(options);
      await checkDatabaseOwner(options.paths.dataDir);
      const release = await lock(options.paths.dataDir, {
        lockfilePath: join(options.paths.dataDir, 'service.lock'),
        stale: 10_000,
        update: 5_000,
        retries: { retries: 12, minTimeout: 1000, maxTimeout: 1000 },
      });
      try {
        snapshot(options.paths, journal);
        const nodePath = join(releaseDirectory, 'runtime/node'),
          entryPath = join(releaseDirectory, 'service.cjs');
        const definition = launchAgentDefinition(
          { ...options, nodePath },
          entryPath,
          id,
        );
        const xml = execFileSync(
          '/usr/bin/plutil',
          ['-convert', 'xml1', '-o', '-', '--', '-'],
          { input: JSON.stringify(definition), encoding: 'utf8' },
        );
        writePlist(options, xml, previous?.loginEnabled ?? true);
        atomicWrite(
          join(options.paths.installationDir, 'installation.json'),
          JSON.stringify(
            {
              label: launchAgentPaths(options.label).label,
              nodePath,
              entryPath,
              dataDir: options.paths.dataDir,
              socketPath: options.paths.socketPath,
              releaseId: id,
              version: manifest.version,
              loginEnabled: previous?.loginEnabled ?? true,
            } satisfies Installation,
            null,
            2,
          ),
        );
        journal.phase = 'starting';
        saveJournal(options.paths, journal);
      } finally {
        await release();
      }
      const info = await boot(options, hooks.healthTimeoutMs);
      if (
        info.releaseId !== id ||
        info.serviceVersion !== manifest.version ||
        info.databaseVersion !== manifest.database
      )
        throw new Error('The new service failed version verification');
      await withClient(options.paths, async (client) => {
        const activity = await client.invoke('getActivity', []);
        if (!activity.maintenance)
          throw new Error('The new service did not start in maintenance mode');
        await client.invoke('listScopes', []).then(
          () => {
            throw new Error('The new service accepted requests before commit');
          },
          (error) => {
            if (!String(error).includes('maintenance')) throw error;
          },
        );
      });
      await hooks.beforeCommit?.(info);
      // This is the point after which database snapshots must never be restored automatically.
      saveJournal(options.paths, { ...journal, phase: 'committed' });
      journal.phase = 'committed';
      try {
        rmSync(markerPath(options.paths), { force: true });
        if (hooks.keepStopped) await unload(options);
        else
          await withClient(options.paths, (client) =>
            client.invoke('finishMaintenance', []),
          );
      } catch (error) {
        journal.message =
          'Upgrade committed; choose Recover update to resume work: ' +
          String(error);
        saveJournal(options.paths, journal);
      }
      try {
        pruneServiceArtifacts(
          options.paths,
          id,
          previous?.releaseId,
          journal.id,
        );
      } catch (error) {
        console.error('Old service files could not be cleaned up:', error);
      }
      return {
        ...info,
        label: launchAgentPaths(options.label).label,
        plist: launchAgentPaths(options.label).plist,
        logPath: options.paths.logPath,
        dataDir: options.paths.dataDir,
      };
    } catch (error) {
      if (journal.phase === 'committed') throw error;
      journal.message = String(error);
      try {
        await rollback(options, journal);
      } catch (recoveryError) {
        journal.phase = 'failed';
        journal.message += `; recovery failed: ${String(recoveryError)}`;
        saveJournal(options.paths, journal);
        throw new Error(journal.message);
      }
      throw new Error(
        'Upgrade failed; the previous installation was restored. ' +
          String(error),
      );
    }
  });
}
export async function uninstallService(
  options: LaunchAgentOptions,
): Promise<void> {
  await stopService(options);
  rmSync(launchAgentPaths(options.label).plist, { force: true });
  rmSync(localPlist(options.paths), { force: true });
  rmSync(join(options.paths.installationDir, 'installation.json'), {
    force: true,
  });
}
