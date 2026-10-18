import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The pre-daemon desktop runtime does not participate in the service lock. */
export async function checkDatabaseOwner(dataDir: string): Promise<void> {
  const database = join(dataDir, 'pi-session.sqlite');
  if (process.platform !== 'darwin' || !existsSync(database)) return;
  const pids = await new Promise<string>((resolve, reject) => {
    execFile(
      '/usr/sbin/lsof',
      ['-t', database],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error && (error as { code?: number }).code !== 1) reject(error);
        else resolve(String(stdout).trim());
      },
    );
  });
  if (pids)
    throw new Error(
      `An older application still owns the agent database (PID ${pids.replace(/\s+/g, ', ')}). Quit that application before starting the resident service.`,
    );
}
