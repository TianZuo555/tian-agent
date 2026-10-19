import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const SERVICE_LABEL = 'dev.tian.agent';
export const SERVICE_PROTOCOL = 4;

export interface ServicePaths {
  dataDir: string;
  socketPath: string;
  installationDir: string;
  environmentPath: string;
  logPath: string;
}

/** Desktop and standalone clients resolve the same data directory. */
export function servicePaths(
  dataDir = process.env.TIAN_AGENT_DATA_DIR,
): ServicePaths {
  const directory =
    dataDir ?? join(homedir(), 'Library', 'Application Support', 'Tian Agent');
  if (!isAbsolute(directory))
    throw new Error('The service data directory must be absolute');
  const resolved = resolve(directory);
  const socketPath =
    process.env.TIAN_AGENT_SOCKET_PATH ?? join(resolved, 'agent.sock');
  if (!isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 100)
    throw new Error(
      'Use an absolute Unix socket path of at most 100 UTF-8 bytes (TIAN_AGENT_SOCKET_PATH)',
    );
  return {
    dataDir: resolved,
    socketPath,
    installationDir: join(resolved, 'service'),
    environmentPath: join(resolved, 'service.env'),
    logPath: join(resolved, 'service', 'logs', 'service.log'),
  };
}
