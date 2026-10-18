import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppReplacement, type AppUpdateRequest } from './app-update.js';
import { recoverServiceUpdate, updateJournal } from '../service/launchd.js';
import { atomicWrite } from '../worker/files.js';
export async function recoverAppUpdate(request: AppUpdateRequest) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      process.kill(request.oldPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') break;
      throw error;
    }
    if (Date.now() > deadline)
      throw new Error('The application did not quit for recovery');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const replacement = new AppReplacement(
    request.stagedApp,
    request.destination,
    request.id,
  );
  const committed = request.includeService
    ? updateJournal(request.paths)?.phase === 'committed'
    : existsSync(join(request.directory, 'ready.json'));
  await recoverServiceUpdate({ paths: request.paths, label: request.label });
  if (committed) replacement.commit();
  else replacement.rollback();
  atomicWrite(
    join(request.directory, 'result.json'),
    JSON.stringify({ phase: committed ? 'committed' : 'rolled-back' }),
  );
  await promisify(execFile)('/usr/bin/open', ['-n', request.destination]);
}
