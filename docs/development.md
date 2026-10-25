# Development and Verification

**English** | [简体中文](zh/development.md)

The repository declares its toolchain, tasks, and local environment variables in `mise.toml` via [mise](https://mise.jdx.dev/). It pins Node 26 and pnpm 12.5.1. Mise switches versions automatically when you enter the directory. Development builds need Node 24+. Each mise task wraps a `package.json` script. Systems without mise can run `pnpm <script>` directly. Run `mise tasks ls` to list all tasks.

## Common Commands

```sh
mise install        # Install pinned Node and pnpm versions
mise run setup      # Run pnpm install and install the resident service
mise run start      # Start the desktop application
mise run check      # Run typecheck and lint
mise run doctor     # Run React Doctor only
mise run verify     # Run check, doctor, and test before commits
```

Type checking uses [`tsrs`](https://github.com/oxc-project/tsrs), the Rust port of the TypeScript 7 compiler. The command `pnpm typecheck` runs `tsrs --noEmit`. It is ten times faster than `tsc` and uses one third of the memory. It enforces TypeScript 7 rules. Therefore, `tsconfig.json` cannot use options removed in TypeScript 7 (such as `baseUrl`, ES5 target, or AMD modules). Path aliases do not need `baseUrl`. The script `pnpm typecheck:tsc` remains available as a check; it runs the reference `tsc` from TypeScript 7. Diagnostics from both checkers must match exactly. Lint runs `oxlint --deny-warnings`, so warnings fail the gate like errors; `oxfmt --check` enforces formatting.

## Local Environment Variables

The file `mise.toml` reads `.env` at the repository root via `[env] _.file`. Start from the template:

```sh
cp .env.example .env
```

| Variable                             | Description                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` | Model gateway endpoint and key; defaults to `http://127.0.0.1:3425/v1`            |
| `TELEGRAM_BOT_TOKEN`                 | Telegram bot token; the adapter stays inactive when empty                         |
| `TELEGRAM_ALLOWED_CHAT_IDS`          | Comma-separated list of allowed chat IDs                                          |
| `WECHAT_ALLOWED_USER_IDS`            | Comma-separated list of allowed WeChat IDs (`...@im.wechat`); inactive when empty |
| `TIAN_AGENT_DATA_DIR`                | Data directory; `mise run service:env` writes here                                |
| `TIAN_AGENT_SOCKET_PATH`             | Unix socket path (absolute path, 100 bytes maximum)                               |

The file `.env` only affects the application and pnpm tasks inside the mise shell. Launchd starts the resident service and cannot read shell environment variables. Run `mise run service:env` to copy non-empty `MAGPIE_*`, `TELEGRAM_*`, and `WECHAT_*` variables to `<dataDir>/service.env` with 0600 permissions. Then run `mise run service:restart`. Other development variables do not enter the service environment. Agent shell commands (for example, Worker `bash` calls) do not receive these variables.

## Tests

| Command                             | Coverage                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                         | Ephemeral databases, real temporary Git repositories, and controlled Workers. Tests permissions, memory, Inbox, Run states, UI sync, and multi-client service. Builds service artifacts first; does not call models. |
| `pnpm test:runtime`                 | Runs built service artifacts outside the checkout under standard Node. Connects sandbox preload with renderer; service continues running after Electron exits.                                                       |
| `pnpm test:launchd`                 | Installs an ephemeral LaunchAgent, terminates process, validates automatic restart, recovery, and reconnection, then deletes the agent.                                                                              |
| `pnpm test:upgrade`                 | Validates upgrade transactions: write rejections during maintenance, rollback on start failure, database backup recovery, uncompleted upgrade recovery, and independent preferences.                                 |
| `pnpm test:app-upgrade`             | Builds two macOS applications to verify settings panel, reconnection, rollback, companion upgrade, and UI confirmation. Temporarily modifies versions; do not run in parallel with packaging.                        |
| `pnpm tsx scripts/e2e-dispatch.mts` | Manual integration verification executing real worker tasks. Needs model credentials.                                                                                                                                |

## React Code Quality

[React Doctor](https://react.doctor) scans `src/**` for correctness, performance, accessibility, security, and maintainability. It runs during `mise run verify`. Configuration lives in `doctor.config.ts`. Fix the root cause for new diagnostics. If a finding is an intended exception or false positive, add `// react-doctor-disable-next-line <rule>` with an explanatory comment. Do not disable entire rules without updating `doctor.config.ts`.
