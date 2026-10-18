import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ServicePaths } from '../shared/service-paths.js';
/** Called only after commit, when the old service has released all code and data handles. */
export function pruneServiceArtifacts(
  paths: ServicePaths,
  current: string,
  previous: string | undefined,
  backupId: string,
) {
  const releases = join(paths.installationDir, 'releases');
  if (existsSync(releases))
    for (const name of readdirSync(releases))
      if (/^[a-f0-9]{24}$/.test(name) && name !== current && name !== previous)
        rmSync(join(releases, name), { recursive: true, force: true });
  const backups = join(paths.installationDir, 'backups');
  if (existsSync(backups)) {
    const names = readdirSync(backups)
      .filter((name) => /^[a-f0-9-]{36}$/.test(name))
      .sort(
        (a, b) =>
          statSync(join(backups, b)).mtimeMs -
          statSync(join(backups, a)).mtimeMs,
      );
    const keep = new Set([backupId, ...names.slice(0, 3)]);
    for (const name of names)
      if (!keep.has(name))
        rmSync(join(backups, name), { recursive: true, force: true });
  }
}
export function pruneAppUpdates(paths: ServicePaths, currentId: string) {
  const directory = join(paths.installationDir, 'app-updates');
  if (!existsSync(directory)) return;
  const completed = readdirSync(directory)
    .filter((name) => {
      if (name === currentId || !/^[a-f0-9-]{36}$/.test(name)) return false;
      const result = join(directory, name, 'result.json');
      if (!existsSync(result)) return false;
      try {
        const { phase } = JSON.parse(readFileSync(result, 'utf8')) as {
          phase: string;
        };
        return ['committed', 'rolled-back', 'failed'].includes(phase);
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        statSync(join(directory, b)).mtimeMs -
        statSync(join(directory, a)).mtimeMs,
    );
  for (const name of completed.slice(1)) {
    const pidFile = join(directory, name, 'helper.json');
    if (existsSync(pidFile)) {
      const { pid } = JSON.parse(readFileSync(pidFile, 'utf8')) as {
        pid: number;
      };
      try {
        process.kill(pid, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
      }
    }
    rmSync(join(directory, name), { recursive: true, force: true });
  }
}
