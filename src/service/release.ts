import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION, DATABASE_VERSION } from '../shared/version.js';
import { SERVICE_PROTOCOL } from '../shared/service-paths.js';
export interface ReleaseManifest {
  version: string;
  protocol: number;
  database: number;
  platform: string;
  arch: string;
  files: Record<string, string>;
}
export function payloadFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(relative: string) {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? relative + '/' + name : name;
      if (path === 'release.json') continue;
      const stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink())
        throw new Error('Service payload must not contain symbolic links');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile())
        files[path] = createHash('sha256')
          .update(readFileSync(join(directory, path)))
          .digest('hex');
      else throw new Error('Invalid service payload file');
    }
  }
  walk('');
  return files;
}
export function createManifest(directory: string): ReleaseManifest {
  return {
    version: APP_VERSION,
    protocol: SERVICE_PROTOCOL,
    database: DATABASE_VERSION,
    platform: process.platform,
    arch: process.arch,
    files: payloadFiles(directory),
  };
}
export function verifyRelease(directory: string): {
  manifest: ReleaseManifest;
  id: string;
} {
  const manifest = JSON.parse(
    readFileSync(join(directory, 'release.json'), 'utf8'),
  ) as ReleaseManifest;
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw new Error('The update is for a different platform or architecture');
  if (
    manifest.protocol !== SERVICE_PROTOCOL ||
    manifest.database !== DATABASE_VERSION
  )
    throw new Error(
      'This updater cannot install this protocol or database version',
    );
  if (
    typeof manifest.version !== 'string' ||
    !manifest.files ||
    !manifest.files['service.cjs'] ||
    !manifest.files['runtime/node']
  )
    throw new Error('Incomplete service release');
  const actual = payloadFiles(directory);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw new Error('Service release checksum verification failed');
  return {
    manifest,
    id: createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex')
      .slice(0, 24),
  };
}
