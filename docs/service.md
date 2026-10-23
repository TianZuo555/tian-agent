# Resident Service and Upgrades

**English** | [简体中文](zh/service.md)

The Chief, Workers, Scheduler, and all storage systems run inside a local resident Node service managed by macOS launchd. The desktop application operates as a client. When the desktop application exits, the service continues to run. Packaging layout and upgrade examples appear in [D9](decisions.md#d9--package-app-and-background-service-together-install-separately-coordinate-switches-with-an-independent-updater).

## Installation and Operations

Run `mise run service:install` (or `pnpm service:install`) to install or update the service. You can also trigger this inside application Settings under "Service & Upgrades". The installer copies application artifacts and a pinned Node runtime into an isolated release. The LaunchAgent operates without dependencies on the development checkout, system Node, terminal sessions, or Electron processes.

| Operation                      | Command                                           |
| ------------------------------ | ------------------------------------------------- |
| Install / update and start     | `pnpm service:install`                            |
| View status and PID            | `pnpm service:status`                             |
| Start / stop                   | `pnpm service:start` / `pnpm service:stop`        |
| Restart                        | `pnpm service:restart`                            |
| Remove autostart and keep data | `pnpm service:uninstall`                          |
| Foreground debugging           | Run `pnpm build:service`, then `pnpm service:run` |

Default paths:

- Data directory: `~/Library/Application Support/Tian Agent/` (configurable with `TIAN_AGENT_DATA_DIR` or CLI `--data-dir`). Reuses existing databases and Memory.
- LaunchAgent: `~/Library/LaunchAgents/dev.tian.agent.plist`.
- Service release: `<dataDir>/service/releases/<hash>/`.
- Service logs: `<dataDir>/service/logs/service.log`.
- Socket connection: `<dataDir>/agent.sock` (configurable with `TIAN_AGENT_SOCKET_PATH`). Permissions are 0600 for the socket and 0700 for the data directory.

The application and the service must share matching directories and socket paths. Storage and sockets use exclusive locks. When an older application holds database locks, the new service refuses to open storage. Exit the older application first. Model credentials do not live in the launchd plist. Write them to `<dataDir>/service.env` (0600) using `mise run service:env`, then restart the service.

## Three Independent States

Login autostart, service execution, and application connections stay independent:

- Application launch connects to existing services based on preferences. It does not start stopped services.
- Quitting the application disconnects the socket only. Selecting "Disconnect window" persists the preference to skip automatic reconnection.
- Disabling login autostart removes the LaunchAgent plist entry. The installation files remain on disk. You can start the service manually. If the service crashes within the current user session, launchd restarts it.
- Stopping the service calls `bootout`. This prevents launchd KeepAlive from restarting it immediately. Reopening the desktop application does not reverse a manual stop.
- The service cannot execute tasks while macOS sleeps or powers down.

## Service Upgrades

The "Service & Upgrades" panel in Settings operates even when the service is offline. You can inspect versions, connect, disconnect, start, stop, toggle autostart, install companion services, and recover interrupted upgrades.

The service rejects upgrades and stop requests while active work is in progress. It checks Durable tasks, queued submissions, Runs, and review operations before proceeding. Legacy services without version metadata trigger an explicit warning. Confirm that ongoing tasks are safe to pause, stop the legacy service, and install the new release. Data persists across upgrades. Newer applications do not connect to older service protocols.

Upgrades execute as atomic transactions: validate release manifests (dynamic chunks, platform, architecture, protocol, database version, Node runtime) → acquire upgrade mutex and verify idle state → record persistent maintenance flags → stop the older service and back up databases under lock → start the new service in maintenance mode → verify versions, commit, clear maintenance flags, and resume operations.

- Failures before commit: Restore database snapshots, older service definitions, and operational states.
- Failures after commit: The system does not restore the older database automatically. Use the recovery option in Settings to complete activation.
- Upgrade logs write to `<dataDir>/service/update.json`. Maintenance flags live in `service/maintenance.json`. Snapshots live in `service/backups/<transaction-id>/`.
- Successful upgrades preserve the current release, the previous release, and the three most recent database backups. Text memory formats do not change across upgrades.

## Application Upgrades

Packaged macOS applications support "Import New App Version...". When you select a newer `.app` bundle, the updater validates application identifiers, versions, companion service compatibility, and platform architecture. If the current application has a developer signature, the update must match the same signature. Unsigned local development builds require explicit confirmation in the dialog. The target directory must have write permissions.

After confirmation, an independent updater process waits for the current application to exit, stages new files on the same disk, and swaps the application bundle atomically. The companion service updates alongside the application. If the service was never installed, only the application updates. If the service was stopped, it remains stopped after the update. The updater commits and clears maintenance only after the new application completes renderer mounting and version checks. Verification failures restore older bundles and services.

Updates currently read from local `.app` bundles selected by users. Remote update feeds, download sources, code signing, and notarization remain future work.
