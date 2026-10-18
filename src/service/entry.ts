import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ResidentServer } from './server.js';
import { servicePaths } from '../shared/service-paths.js';
import { telegramConfigFromEnv } from '../worker/telegram.js';

const { values } = parseArgs({
  options: { 'data-dir': { type: 'string' } },
  strict: true,
});
if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('The resident service requires Node.js 24 or later');
const paths = servicePaths(values['data-dir']);
if (existsSync(paths.environmentPath))
  process.loadEnvFile(paths.environmentPath);
// Channel configuration is read only here, after service.env is loaded; the
// Service itself never inspects process.env, so tests cannot reach the network.
const server = new ResidentServer(paths, {
  telegram: { config: telegramConfigFromEnv() },
});
let shutdown: Promise<void> | null = null;
function stop(): void {
  if (shutdown) return;
  const timeout = setTimeout(() => process.exit(1), 25_000);
  timeout.unref();
  shutdown = server.close().then(
    () => {
      clearTimeout(timeout);
      process.exit(0);
    },
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
void server
  .start()
  .then(() => {
    console.log(`Tian Agent resident service ready (PID ${process.pid})`);
  })
  .catch((error) => {
    console.error('Resident service failed:', error);
    process.exitCode = 1;
  });
