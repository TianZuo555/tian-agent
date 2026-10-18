import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ServicePaths } from '../shared/service-paths.js';
import { hasKeys, readJsonFile } from '../shared/json-file.js';
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
      const result = readJsonFile(
        join(directory, name, 'result.json'),
        (value): value is { phase: string } =>
          hasKeys(value, { phase: 'string' }),
      );
      return (
        !!result &&
        ['committed', 'rolled-back', 'failed'].includes(result.phase)
      );
    })
    .sort(
      (a, b) =>
        statSync(join(directory, b)).mtimeMs -
        statSync(join(directory, a)).mtimeMs,
    );
  for (const name of completed.slice(1)) {
    const helper = readJsonFile(
      join(directory, name, 'helper.json'),
      (value): value is { pid: number } => hasKeys(value, { pid: 'number' }),
    );
    if (helper) {
      try {
        process.kill(helper.pid, 0);
        continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
      }
    }
    rmSync(join(directory, name), { recursive: true, force: true });
  }
}
