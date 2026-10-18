import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAppUpdate, type AppUpdateRequest } from './app-update.js';
import { recoverAppUpdate } from './recover-app.js';
import { atomicWrite } from '../worker/files.js';
const directory = resolve(process.argv[2] ?? '');
const request = JSON.parse(
  readFileSync(join(directory, 'request.json'), 'utf8'),
) as AppUpdateRequest;
if (
  request.directory !== directory ||
  !/^[a-f0-9-]{36}$/.test(request.id) ||
  directory !== join(request.paths.installationDir, 'app-updates', request.id)
)
  throw new Error('Invalid application update request');
void (
  process.argv[3] === 'recover'
    ? recoverAppUpdate(request)
    : runAppUpdate(request)
).catch((error) => {
  if (process.argv[3] === 'recover')
    atomicWrite(
      join(directory, 'result.json'),
      JSON.stringify({ phase: 'recovery-failed', message: String(error) }),
    );
  console.error(error);
  process.exitCode = 1;
});
