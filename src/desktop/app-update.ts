import { execFile, spawn, type ChildProcess } from 'node:child_process';
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gt, valid } from 'semver';
import { verifyRelease } from '../service/release.js';
import { atomicWrite } from '../worker/files.js';
import {
  installService,
  installation,
  loadedPid,
  withUpdateLock,
  updateJournal,
} from '../service/launchd.js';
import type { ServicePaths } from '../shared/service-paths.js';
import type { AppCandidate } from '../shared/desktop.js';
import { pruneAppUpdates } from '../service/cleanup.js';

const execute = promisify(execFile);
export interface BundleInfo {
  identifier: string;
  version: string;
  executable: string;
  team: string | null;
}
export async function bundleInfo(bundle: string): Promise<BundleInfo> {
  if (
    !bundle.endsWith('.app') ||
    !existsSync(join(bundle, 'Contents/Info.plist'))
  )
    throw new Error('Choose a macOS .app bundle');
  const property = async (key: string) =>
    (
      await execute('/usr/bin/plutil', [
        '-extract',
        key,
        'raw',
        '-o',
        '-',
        join(bundle, 'Contents/Info.plist'),
      ])
    ).stdout.trim();
  const [identifier, version, executable] = await Promise.all([
    property('CFBundleIdentifier'),
    property('CFBundleShortVersionString'),
    property('CFBundleExecutable'),
  ]);
  if (
    !valid(version) ||
    !executable ||
    executable.includes('/') ||
    executable === '..'
  )
    throw new Error('Invalid application metadata');
  let team: string | null = null;
  try {
    const signature = await execute('/usr/bin/codesign', [
      '-dv',
      '--verbose=4',
      bundle,
    ]);
    team = /^TeamIdentifier=(.*)$/m.exec(signature.stderr)?.[1]?.trim() ?? null;
    if (team === 'not set') team = null;
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== 'number') throw error;
  }
  return { identifier, version, executable, team };
}
export interface AppUpdateRequest {
  id: string;
  directory: string;
  stagedApp: string;
  destination: string;
  oldPid: number;
  currentVersion: string;
  paths: ServicePaths;
  label?: string;
  includeService: boolean;
  serviceWasRunning: boolean;
}
export async function stageApp(
  source: string,
  destination: string,
  currentVersion: string,
  paths: ServicePaths,
  oldPid: number,
  label?: string,
): Promise<{ candidate: AppCandidate; request: AppUpdateRequest }> {
  destination = realpathSync(destination);
  source = realpathSync(source);
  try {
    accessSync(dirname(destination), constants.W_OK);
  } catch {
    throw new Error(
      'This application location is read-only. Move the app to a writable Applications folder before updating.',
    );
  }
  const [current, next] = await Promise.all([
    bundleInfo(destination),
    bundleInfo(source),
  ]);
  if (current.identifier !== next.identifier)
    throw new Error('The update belongs to a different application');
  if (!valid(currentVersion) || !gt(next.version, currentVersion))
    throw new Error('Choose an application with a newer version');
  if (current.team && next.team !== current.team)
    throw new Error('The update was not signed by the same developer');
  if (next.team) {
    await execute('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      source,
    ]);
  }
  const payload = join(source, 'Contents/Resources/service');
  const release = verifyRelease(payload);
  if (release.manifest.version !== next.version)
    throw new Error('The application and its service versions do not match');
  if (!existsSync(join(source, 'Contents/Resources/updater/updater.cjs')))
    throw new Error('The update does not contain an updater');
  const id = randomUUID(),
    directory = join(paths.installationDir, 'app-updates', id),
    stagedApp = join(directory, 'Candidate.app');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    cpSync(source, stagedApp, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    verifyRelease(join(stagedApp, 'Contents/Resources/service'));
    if (next.team)
      await execute('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        stagedApp,
      ]);
    const request: AppUpdateRequest = {
      id,
      directory,
      stagedApp,
      destination,
      oldPid,
      currentVersion,
      paths,
      label,
      includeService: !!installation(paths),
      serviceWasRunning: (await loadedPid(label)) !== null,
    };
    atomicWrite(
      join(directory, 'request.json'),
      JSON.stringify(request, null, 2),
    );
    return {
      candidate: {
        id,
        version: next.version,
        serviceVersion: release.manifest.version,
        signed: !!next.team,
      },
      request,
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
/** Both renames are on the destination volume; the old bundle survives until commit. */
export class AppReplacement {
  private pending: string;
  private backup: string;
  constructor(
    private candidate: string,
    private destination: string,
    id: string,
  ) {
    this.pending = join(dirname(destination), `.tian-update-${id}.app`);
    this.backup = join(dirname(destination), `.tian-previous-${id}.app`);
  }
  stage() {
    if (existsSync(this.pending) || existsSync(this.backup))
      throw new Error('Application update paths already exist');
    cpSync(this.candidate, this.pending, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
  }
  swap() {
    renameSync(this.destination, this.backup);
    try {
      renameSync(this.pending, this.destination);
    } catch (error) {
      renameSync(this.backup, this.destination);
      throw error;
    }
  }
  rollback() {
    if (existsSync(this.backup)) {
      rmSync(this.destination, { recursive: true, force: true });
      renameSync(this.backup, this.destination);
    }
    rmSync(this.pending, { recursive: true, force: true });
  }
  commit() {
    rmSync(this.backup, { recursive: true, force: true });
    rmSync(this.pending, { recursive: true, force: true });
  }
}
async function waitForExit(pid: number, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() > deadline)
      throw new Error('The application did not quit; the update was cancelled');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function launch(bundle: string, job?: string): Promise<ChildProcess> {
  const info = await bundleInfo(bundle);
  return new Promise((resolve, reject) => {
    const fd = job ? openSync(join(job, 'app.log'), 'a', 0o600) : null;
    const child = spawn(
      join(bundle, 'Contents/MacOS', info.executable),
      job ? ['--tian-update-job', job] : [],
      { detached: true, stdio: fd === null ? 'ignore' : ['ignore', fd, fd] },
    );
    if (fd !== null) closeSync(fd);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(child);
    });
  });
}
async function waitForReady(request: AppUpdateRequest, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (existsSync(join(request.directory, 'ready.json'))) {
      const ready = JSON.parse(
        readFileSync(join(request.directory, 'ready.json'), 'utf8'),
      ) as { pid: number; version: string };
      if (ready.pid !== child.pid || !gt(ready.version, request.currentVersion))
        throw new Error('Invalid application health response');
      return;
    }
    if (child.exitCode !== null)
      throw new Error('The updated application exited before becoming ready');
    if (Date.now() > deadline)
      throw new Error('The updated application failed its startup check');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
export async function runAppUpdate(request: AppUpdateRequest) {
  const result = (phase: string, message?: string) =>
    atomicWrite(
      join(request.directory, 'result.json'),
      JSON.stringify({ phase, message }, null, 2),
    );
  const replacement = new AppReplacement(
    request.stagedApp,
    request.destination,
    request.id,
  );
  let child: ChildProcess | undefined;
  let committed = false,
    oldExited = false;
  try {
    result('waiting-for-exit');
    await waitForExit(request.oldPid);
    oldExited = true;
    replacement.stage();
    const activate = async () => {
      replacement.swap();
      child = await launch(request.destination, request.directory);
      await waitForReady(request, child);
    };
    result('installing');
    if (request.includeService)
      await installService(
        { paths: request.paths, label: request.label },
        join(request.stagedApp, 'Contents/Resources/service'),
        { beforeCommit: activate, keepStopped: !request.serviceWasRunning },
      );
    else await withUpdateLock(request.paths, activate);
    committed = true;
    result('committed');
    replacement.commit();
    rmSync(request.stagedApp, { recursive: true, force: true });
    pruneAppUpdates(request.paths, request.id);
  } catch (error) {
    if (
      committed ||
      (request.includeService &&
        updateJournal(request.paths)?.phase === 'committed' &&
        existsSync(join(request.directory, 'ready.json')))
    ) {
      result(
        'committed',
        'The upgrade succeeded; old files may need cleanup: ' + String(error),
      );
      return;
    }
    if (child?.pid && child.exitCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child.pid, 10_000).catch(async () => {
        child?.kill('SIGKILL');
        if (child?.pid) await waitForExit(child.pid, 5_000);
      });
    }
    replacement.rollback();
    result('failed', String(error));
    if (oldExited) await launch(request.destination);
    throw error;
  }
}
