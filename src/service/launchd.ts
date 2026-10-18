import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SERVICE_LABEL, type ServicePaths } from '../shared/service-paths.js';
import { atomicWrite } from '../worker/files.js';
import { ServiceClient } from './client.js';
import { checkDatabaseOwner } from './ownership.js';

const execute = promisify(execFile);
export interface LaunchAgentOptions {
  paths: ServicePaths;
  label?: string;
  nodePath?: string;
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

async function loadedPid(label?: string): Promise<number | null> {
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

export async function stopService(options: LaunchAgentOptions): Promise<void> {
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

export async function serviceStatus(paths: ServicePaths, timeoutMs = 1_000) {
  const client = new ServiceClient(paths.socketPath, undefined, {
    readyTimeoutMs: timeoutMs,
  });
  try {
    return await client.start();
  } finally {
    client.close();
  }
}

export async function startService(options: LaunchAgentOptions) {
  const agent = launchAgentPaths(options.label);
  if (!existsSync(agent.plist))
    throw new Error(
      'The resident service is not installed. Run pnpm service:install first.',
    );
  if ((await loadedPid(options.label)) === null)
    await execute('/bin/launchctl', ['bootstrap', agent.domain, agent.plist]);
  else await execute('/bin/launchctl', ['kickstart', agent.target]);
  return serviceStatus(options.paths, 30_000);
}

export function launchAgentDefinition(
  options: LaunchAgentOptions,
  entryPath: string,
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

/** Installs a self-contained release outside the checkout, then loads its LaunchAgent. */
export async function installService(
  options: LaunchAgentOptions,
  buildDirectory: string,
) {
  const agent = launchAgentPaths(options.label);
  const bundle = join(buildDirectory, 'service.cjs');
  if (!existsSync(bundle))
    throw new Error('Build the service before installing it');
  const nodePath = realpathSync(options.nodePath ?? process.execPath);
  const version = (await execute(nodePath, ['--version'])).stdout.trim();
  if (Number(version.replace(/^v/, '').split('.')[0]) < 24)
    throw new Error('Node.js 24 or later is required');
  const release = createHash('sha256')
    .update(readFileSync(bundle))
    .digest('hex')
    .slice(0, 16);
  const releaseDirectory = join(
    options.paths.installationDir,
    'releases',
    release,
  );
  mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });
  chmodSync(options.paths.dataDir, 0o700);
  cpSync(buildDirectory, releaseDirectory, { recursive: true });
  mkdirSync(join(options.paths.installationDir, 'logs'), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await stopService(options);
  await checkDatabaseOwner(options.paths.dataDir);
  const entryPath = join(releaseDirectory, 'service.cjs');
  const definition = launchAgentDefinition({ ...options, nodePath }, entryPath);
  const xml = execFileSync(
    '/usr/bin/plutil',
    ['-convert', 'xml1', '-o', '-', '--', '-'],
    { input: JSON.stringify(definition), encoding: 'utf8' },
  );
  atomicWrite(agent.plist, xml);
  chmodSync(agent.plist, 0o600);
  atomicWrite(
    join(options.paths.installationDir, 'installation.json'),
    JSON.stringify(
      {
        label: agent.label,
        nodePath,
        entryPath,
        dataDir: options.paths.dataDir,
        socketPath: options.paths.socketPath,
      },
      null,
      2,
    ),
  );
  const info = await startService(options);
  return {
    ...info,
    label: agent.label,
    plist: agent.plist,
    logPath: options.paths.logPath,
    dataDir: options.paths.dataDir,
  };
}

export async function uninstallService(
  options: LaunchAgentOptions,
): Promise<void> {
  await stopService(options);
  rmSync(launchAgentPaths(options.label).plist, { force: true });
  rmSync(join(options.paths.installationDir, 'installation.json'), {
    force: true,
  });
}
