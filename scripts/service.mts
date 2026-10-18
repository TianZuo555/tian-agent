import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { servicePaths } from '../src/shared/service-paths.js';
import {
  installService,
  launchAgentPaths,
  serviceStatus,
  startService,
  stopService,
  uninstallService,
} from '../src/service/launchd.js';

const { values, positionals } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    label: { type: 'string' },
    'build-dir': { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
});
const paths = servicePaths(values['data-dir']);
const options = { paths, label: values.label };
const action = positionals[0];
try {
  switch (action) {
    case 'install':
      console.log(
        JSON.stringify(
          await installService(
            options,
            resolve(values['build-dir'] ?? 'dist/service'),
          ),
          null,
          2,
        ),
      );
      break;
    case 'start':
      console.log(JSON.stringify(await startService(options), null, 2));
      break;
    case 'restart':
      await stopService(options);
      console.log(JSON.stringify(await startService(options), null, 2));
      break;
    case 'stop':
      await stopService(options);
      console.log('Resident service stopped.');
      break;
    case 'uninstall':
      await uninstallService(options);
      console.log(
        'LaunchAgent removed. Conversations, tasks, and memory were preserved.',
      );
      break;
    case 'status':
      console.log(
        JSON.stringify(
          {
            ...(await serviceStatus(paths)),
            label: launchAgentPaths(values.label).label,
            dataDir: paths.dataDir,
            logPath: paths.logPath,
          },
          null,
          2,
        ),
      );
      break;
    default:
      throw new Error(
        'Usage: pnpm exec tsx scripts/service.mts install|start|stop|restart|status|uninstall [--data-dir /absolute/path]',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
