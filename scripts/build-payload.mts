import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { createManifest } from '../src/service/release.js';
execFileSync(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'build',
    '--config',
    'vite.service.config.mts',
  ],
  { stdio: 'inherit' },
);
mkdirSync('dist/service/runtime', { recursive: true });
cpSync(realpathSync(process.execPath), 'dist/service/runtime/node');
chmodSync('dist/service/runtime/node', 0o755);
writeFileSync(
  'dist/service/release.json',
  JSON.stringify(createManifest(resolve('dist/service')), null, 2),
);
execFileSync(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'build',
    '--config',
    'vite.updater.config.mts',
  ],
  { stdio: 'inherit' },
);
