# Tian Agent NSH preview

The native macOS client lives here. It uses NSH 0.4.0, a Rust Unix socket
bridge, and TSX screens. The resident service and Electron client are unchanged.

## Run

Install the NSH release CLI and the repository dependencies once:

```sh
curl -fsSL https://nsh.dev/install.sh | sh
mise install
mise exec -- pnpm install
nsh --version
```

Start a temporary, model-free **real resident service** from the repository root:

```sh
mise exec -- pnpm exec tsx scripts/nsh-fixture.mts
```

The command prints a temporary data directory, socket, and the exact launch
command. In another terminal, use those printed values:

```sh
TIAN_AGENT_DATA_DIR=/tmp/tian-nsh-XXXXXX/data \
TIAN_AGENT_SOCKET_PATH=/tmp/tian-nsh-XXXXXX/agent.sock \
mise exec -- nsh run crates/tian-nsh --target macos --port 8873
```

The fixture owns its temporary directory and removes it when stopped with
Control-C. It creates two conversations and appends a live update every three
seconds, up to 1,000 updates. It makes no model calls and configures no messaging
channels. It does not install or control a launchd service.

For another existing development service, use its explicit temporary paths.
`TIAN_AGENT_DATA_DIR` is required. If `TIAN_AGENT_SOCKET_PATH` is absent, the
client uses `<dataDir>/agent.sock`. Both paths must be absolute; the socket path
must be at most 100 UTF-8 bytes. The preview rejects the standard live data
locations. It never creates service files, starts a service, or opens SQLite.
UI preferences use NSH Storage under `dev.tian.agent.nsh.preview`, separate from
service data. Quitting the client leaves the service running.

## Current behavior

- Native three-pane shell: Chat / Goals / Skills / Inbox / Settings navigation,
  transcript area, and context placeholder.
- Real conversations and scope labels. Selecting a conversation watches its
  service-owned chat snapshot. New snapshots update the transcript live.
- Read-only text and native Markdown rendering, including Chinese and code.
- English/Chinese dictionaries imported directly from `src/renderer/i18n`.
- Bounded Rust JSON framing and handshake checks; correlated requests, timeouts,
  reconnect, stale-response guards, and socket/watch cleanup.

Goals, Inbox, Skills, full Settings and the context pane are placeholders.
The composer, tool disclosures, archive controls, shortcuts, service lifecycle
and packaging belong to later phases. Electron remains available for these.

## Verify

From the repository root:

```sh
mise run verify
mise exec -- pnpm typecheck:tsc
mise exec -- cargo build --manifest-path crates/tian-nsh/Cargo.toml
mise exec -- cargo test --manifest-path crates/tian-nsh/Cargo.toml
mise exec -- nsh build crates/tian-nsh
mise exec -- nsh check crates/tian-nsh
```

With the fixture running, use its printed paths for native or headless
integration tests:

```sh
TIAN_AGENT_DATA_DIR=/tmp/tian-nsh-XXXXXX/data \
TIAN_AGENT_SOCKET_PATH=/tmp/tian-nsh-XXXXXX/agent.sock \
mise exec -- nsh test crates/tian-nsh --target macos

TIAN_AGENT_DATA_DIR=/tmp/tian-nsh-XXXXXX/data \
TIAN_AGENT_SOCKET_PATH=/tmp/tian-nsh-XXXXXX/agent.sock \
mise exec -- nsh test crates/tian-nsh
```

The integration test opens the real native window, reads both conversations,
waits for a new service event after the initial snapshot, and switches views and
language. A native screenshot was also inspected during Phase 1; screenshots
require `--target` and are separate from the portable test. The Rust tests exercise split
Unicode/frames, malformed and oversized input, protocol mismatch and read
cancellation. `tests/nsh-client.test.ts` tests RPC correlation, reconnect without
mutation replay, targeted events, and stale snapshot handling.

The mixed app builds an app-specific runner. Rust changes rebuild/restart it;
TSX changes use hot reload. Generated declarations and runners are under
`.nsh/`; Cargo artifacts are under `target/`. Commit `Cargo.lock` so application
dependency resolution is reproducible.

See [the migration plan](../../docs/nsh-migration.md) for phase gates and
remaining parity checks. Production identity and signing are not selected.
