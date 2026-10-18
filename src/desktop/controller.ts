import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  rmSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type {
  AppCandidate,
  DesktopAction,
  DesktopStatus,
} from '../shared/desktop.js';
import type { Emit } from '../shared/types.js';
import type { Args, CommandName, Result } from '../shared/contracts.js';
import type { ServicePaths } from '../shared/service-paths.js';
import { APP_VERSION } from '../shared/version.js';
import { hasKeys, readJsonFile } from '../shared/json-file.js';
import { atomicWrite } from '../worker/files.js';
import { ServiceClient } from '../service/client.js';
import {
  installation,
  installService,
  recoverServiceUpdate,
  serviceStatus,
  setLoginEnabled,
  startService,
  stopService,
  updateJournal,
  updateLocked,
  loadedPid,
} from '../service/launchd.js';
import { stageApp, type AppUpdateRequest } from './app-update.js';
export interface DesktopEnvironment {
  paths: ServicePaths;
  payloadDirectory: string;
  updaterDirectory: string;
  appBundle: string | null;
  appVersion: string;
  pid: number;
  chooseApp: () => Promise<string | null>;
  quit: () => void;
  updateJob?: string;
  label?: string;
}
export class DesktopController {
  private client: ServiceClient | null = null;
  private preferences: { connectOnLaunch: boolean };
  private candidate: {
    candidate: AppCandidate;
    request: AppUpdateRequest;
  } | null = null;
  private busy = false;
  constructor(
    private environment: DesktopEnvironment,
    private emit: Emit,
  ) {
    const file = this.preferencePath();
    const saved = readJsonFile(
      file,
      (value): value is { connectOnLaunch: boolean } =>
        hasKeys(value, { connectOnLaunch: 'boolean' }),
    );
    this.preferences = saved ?? { connectOnLaunch: true };
  }
  private preferencePath() {
    return join(this.environment.paths.installationDir, 'desktop.json');
  }
  private savePreference(connected: boolean) {
    this.preferences = { connectOnLaunch: connected };
    mkdirSync(this.environment.paths.installationDir, {
      recursive: true,
      mode: 0o700,
    });
    atomicWrite(this.preferencePath(), JSON.stringify(this.preferences));
  }
  private options() {
    return { paths: this.environment.paths, label: this.environment.label };
  }
  async initialize() {
    if (this.preferences.connectOnLaunch) {
      try {
        await this.connect();
      } catch (error) {
        this.emit('runtime', { status: 'failed', error: String(error) });
      }
    } else this.emit('runtime', { status: 'disconnected' });
  }
  private async connect() {
    this.client?.close();
    const client = new ServiceClient(
      this.environment.paths.socketPath,
      this.emit,
      { readyTimeoutMs: 3000 },
    );
    this.client = client;
    try {
      await client.start();
    } catch (error) {
      client.close();
      if (this.client === client) this.client = null;
      throw error;
    }
  }
  close() {
    this.client?.close();
    this.client = null;
  }
  async invoke<K extends CommandName>(
    command: K,
    args: Args<K>,
    clientId: number,
  ): Promise<Result<K>> {
    if (!this.client)
      throw new Error(
        'Disconnected from the background service. Open Settings to connect or install it.',
      );
    return this.client.invoke(command, args, clientId);
  }
  releaseClient(id: number) {
    this.client?.releaseClient(id);
  }
  async status(): Promise<DesktopStatus> {
    const paths = this.environment.paths,
      current = installation(paths);
    let service = this.client?.info ?? null;
    let activity: DesktopStatus['activity'] = null;
    const probe = new ServiceClient(paths.socketPath, undefined, {
      readyTimeoutMs: 350,
      requestTimeoutMs: 1500,
    });
    try {
      service = await probe.start();
      activity = await probe.invoke('getActivity', []);
    } catch {
      service = null;
    } finally {
      probe.close();
    }
    const journal = updateJournal(paths);
    let lastUpdate: DesktopStatus['lastUpdate'] = journal
      ? { phase: journal.phase, message: journal.message }
      : null;
    const pointer = join(paths.installationDir, 'last-app-update.json');
    const pointerData = readJsonFile(
      pointer,
      (value): value is { directory: string } =>
        hasKeys(value, { directory: 'string' }),
    );
    if (
      pointerData &&
      pointerData.directory.startsWith(
        join(paths.installationDir, 'app-updates') + '/',
      )
    ) {
      const result = join(pointerData.directory, 'result.json');
      if (
        (!journal ||
          (['committed', 'rolled-back'].includes(journal.phase) &&
            !journal.message)) &&
        existsSync(result)
      ) {
        const recorded = readJsonFile(
          result,
          (value): value is { phase: string; message?: string } =>
            hasKeys(value, { phase: 'string' }),
        );
        if (recorded) lastUpdate = recorded;
      }
    }
    return {
      appVersion: this.environment.appVersion,
      bundledServiceVersion: APP_VERSION,
      connected: !!this.client?.info,
      connectOnLaunch: this.preferences.connectOnLaunch,
      installed: !!current,
      legacyService: !!current && !current.version,
      legacyRunning:
        !!current &&
        !current.version &&
        (await loadedPid(this.environment.label)) !== null,
      loginEnabled: current?.loginEnabled ?? false,
      service,
      activity,
      canUpdateApp: !!this.environment.appBundle,
      lastUpdate,
    };
  }
  private async acknowledgeReady() {
    const directory = this.environment.updateJob;
    if (!directory) return;
    if (
      !directory.startsWith(
        join(this.environment.paths.installationDir, 'app-updates') + '/',
      )
    )
      throw new Error('Invalid update health-check path');
    const request = readJsonFile(
      join(directory, 'request.json'),
      (value): value is AppUpdateRequest =>
        hasKeys(value, {
          directory: 'string',
          destination: 'string',
          includeService: 'boolean',
        }),
    );
    if (!request)
      throw new Error('The application update request is missing or corrupt');
    if (
      request.destination !== this.environment.appBundle ||
      request.directory !== directory
    )
      throw new Error(
        'Application update health check does not match this installation',
      );
    if (request.includeService) {
      const service = await serviceStatus(this.environment.paths, 5000);
      if (service.serviceVersion !== this.environment.appVersion)
        throw new Error('Application and service versions do not match');
    }
    atomicWrite(
      join(directory, 'ready.json'),
      JSON.stringify({
        pid: this.environment.pid,
        version: this.environment.appVersion,
      }),
    );
  }
  private async launchUpdater(request: AppUpdateRequest, recover = false) {
    const previous = join(request.directory, 'helper.json');
    const helperRecord = readJsonFile(
      previous,
      (value): value is { pid: number } => hasKeys(value, { pid: 'number' }),
    );
    if (helperRecord) {
      const { pid } = helperRecord;
      try {
        process.kill(pid, 0);
        throw new Error('The application updater is still running');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    const fd = openSync(join(request.directory, 'helper.log'), 'a', 0o600);
    // Fixed executable and argv; the only variable is the staged directory,
    // which stageApp created under the app-updates root.
    const nodePath = join(request.directory, 'node');
    const entryPath = join(request.directory, 'updater/updater.cjs');
    const stagedDirectory = request.directory;
    try {
      await new Promise<void>((resolve, reject) => {
        const helper = spawn(
          nodePath,
          [entryPath, stagedDirectory, ...(recover ? ['recover'] : [])],
          { detached: true, stdio: ['ignore', fd, fd] },
        );
        helper.once('error', reject);
        helper.once('spawn', () => {
          try {
            atomicWrite(previous, JSON.stringify({ pid: helper.pid }));
            helper.unref();
            resolve();
          } catch (error) {
            helper.kill('SIGTERM');
            reject(error);
          }
        });
      });
    } finally {
      closeSync(fd);
    }
    this.environment.quit();
  }
  async action(
    action: DesktopAction,
    candidateId?: string,
  ): Promise<DesktopStatus | AppCandidate | null> {
    if (action === 'status') return this.status();
    if (action === 'ready') {
      await this.acknowledgeReady();
      return this.status();
    }
    if (this.busy)
      throw new Error('Another service or update operation is in progress');
    this.busy = true;
    try {
      switch (action) {
        case 'connect':
          await this.connect();
          this.savePreference(true);
          break;
        case 'disconnect':
          this.savePreference(false);
          this.close();
          this.emit('runtime', { status: 'disconnected' });
          break;
        case 'start':
          await startService(this.options());
          await this.connect();
          this.savePreference(true);
          break;
        case 'stop':
          await stopService(this.options());
          this.savePreference(false);
          this.close();
          this.emit('runtime', { status: 'disconnected' });
          break;
        case 'install':
          await installService(
            this.options(),
            this.environment.payloadDirectory,
          );
          await this.connect();
          this.savePreference(true);
          break;
        case 'login-enable':
          await setLoginEnabled(this.options(), true);
          break;
        case 'login-disable':
          await setLoginEnabled(this.options(), false);
          break;
        case 'recover': {
          const pointer = join(
            this.environment.paths.installationDir,
            'last-app-update.json',
          );
          const pointerData = readJsonFile(
            pointer,
            (value): value is { directory: string } =>
              hasKeys(value, { directory: 'string' }),
          );
          if (pointerData) {
            const { directory } = pointerData;
            if (
              !directory.startsWith(
                join(this.environment.paths.installationDir, 'app-updates') +
                  '/',
              )
            )
              throw new Error('Invalid application recovery path');
            const recorded = readJsonFile(
              join(directory, 'result.json'),
              (value): value is { phase: string } =>
                hasKeys(value, { phase: 'string' }),
            );
            const phase = recorded?.phase ?? 'prepared';
            if (!['committed', 'failed', 'rolled-back'].includes(phase)) {
              if (await updateLocked(this.environment.paths))
                throw new Error(
                  'The updater is still running or its lease has not expired yet',
                );
              const request = readJsonFile(
                join(directory, 'request.json'),
                (value): value is AppUpdateRequest =>
                  hasKeys(value, {
                    directory: 'string',
                    destination: 'string',
                    includeService: 'boolean',
                  }),
              );
              if (!request)
                throw new Error('The application update request is corrupt');
              if (request.destination !== this.environment.appBundle)
                throw new Error(
                  'Open the installed application to recover its update',
                );
              request.oldPid = this.environment.pid;
              atomicWrite(
                join(directory, 'request.json'),
                JSON.stringify(request),
              );
              await this.launchUpdater(request, true);
              break;
            }
          }
          await recoverServiceUpdate(this.options());
          break;
        }
        case 'choose-app': {
          if (!this.environment.appBundle)
            throw new Error(
              'App updates are available in packaged macOS applications',
            );
          const source = await this.environment.chooseApp();
          if (!source) return null;
          if (this.candidate)
            rmSync(this.candidate.request.directory, {
              recursive: true,
              force: true,
            });
          this.candidate = await stageApp(
            source,
            this.environment.appBundle,
            this.environment.appVersion,
            this.environment.paths,
            this.environment.pid,
            this.environment.label,
          );
          return this.candidate.candidate;
        }
        case 'cancel-app':
          if (!this.candidate || this.candidate.candidate.id !== candidateId)
            throw new Error('Application update selection expired');
          rmSync(this.candidate.request.directory, {
            recursive: true,
            force: true,
          });
          this.candidate = null;
          break;
        case 'apply-app': {
          if (!this.candidate || this.candidate.candidate.id !== candidateId)
            throw new Error('Application update selection expired');
          const status = await this.status();
          if (status.legacyRunning)
            throw new Error('先停止旧版服务并安装新版配套服务，再升级 App。');
          if (
            status.activity &&
            (status.activity.tasks ||
              status.activity.submissions ||
              status.activity.runs ||
              status.activity.reviews)
          )
            throw new Error(
              'Wait for running tasks and conversations to finish before updating the application',
            );
          const request = this.candidate.request;
          request.serviceWasRunning = !!status.service;
          request.includeService = status.installed;
          atomicWrite(
            join(request.directory, 'request.json'),
            JSON.stringify(request, null, 2),
          );
          cpSync(
            this.environment.updaterDirectory,
            join(request.directory, 'updater'),
            { recursive: true },
          );
          cpSync(
            join(this.environment.payloadDirectory, 'runtime/node'),
            join(request.directory, 'node'),
          );
          atomicWrite(
            join(
              this.environment.paths.installationDir,
              'last-app-update.json',
            ),
            JSON.stringify({ directory: request.directory }),
          );
          await this.launchUpdater(request);
          break;
        }
      }
      return this.status();
    } finally {
      this.busy = false;
    }
  }
}
