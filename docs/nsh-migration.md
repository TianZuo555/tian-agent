# Native Shell desktop migration

## Scope and status

Phase 0 records the migration design. Implementation proceeds in the order below.
The TypeScript resident service, Pi SDK harness, tools, Inbox ingestion, Runs,
`tian.db`, and `pi-session.sqlite` remain service-owned. NSH replaces the desktop
client with a Rust host module and TSX screens on the macOS AppKit backend.
Electron remains runnable during the migration. Its removal needs a separate
phase and explicit user confirmation.

Work only in this worktree on `refactor/nsh`. Do not build or change the sibling
`tian-agent` checkout, `/tmp/nsh-main`, or the user's NSH fork. Do not use the live
Tian data directory for development. Do not manage the user's running service.
Use a private temporary directory and a service started from this checkout.

## Source baseline

Application baseline: `c7b2fab`; socket protocol 10; database version 8.
NSH reference: `longbridge/nsh` main at
`7ed95faf2b6473f3205ac0e756ec51fe2ec3b922` in `/tmp/nsh-main`.
Installed release CLI: `nsh 0.4.0 (e626a8d)`.
The reference can contain APIs newer than the release. Pin application crate
versions to the CLI version and check generated declarations and native behavior
before adopting an API. If a required feature is absent, record the constraint
and use a pinned upstream revision only after checking its build cost. Do not
silently depend on a mutable local reference path.

Primary application references are `src/main.ts`, `src/preload.ts`,
`src/desktop/`, `src/renderer/state.ts`, `src/renderer/components/`,
`src/shared/contracts.ts`, `src/shared/messages.ts`, `src/shared/service-paths.ts`,
and `src/service/{client,protocol,server}.ts`. NSH API patterns come from
`examples/rust-exports`, `examples/desktop`, and the gallery in the reference.

## Responsibility map

| Current responsibility                      | NSH destination                                                                   | Acceptance condition                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| BrowserWindow, native appearance, title bar | AppKit runner and `nsh/desktop` Window API; Rust only for missing host operations | Native window, safe traffic-light inset, minimum usable size, close/reopen/Quit verified          |
| Preload contextBridge and main IPC routing  | Typed TS adapter over `tian/native` Rust exports                                  | No Electron or Node runtime imports in screens; service argument validation remains authoritative |
| ServiceClient Unix connection               | Rust connection object exported with NSH macros                                   | Protocol handshake, bounded framing, errors, cancellation, reconnect, client release              |
| React store and subscriptions               | NSH signals, computed values, effects and owner cleanup                           | Late responses cannot replace newer events or the selected conversation; rewatch after reconnect  |
| Shell and navigation                        | TSX rail, content region, context pane; route signal                              | Chat / Goals / Skills / Inbox; Settings remembers its return view                                 |
| Pane resizing and collapse                  | `nsh/base` resizable panels and persisted preferences                             | No empty strips when collapsed; sensible narrow-window limits                                     |
| Chat rows and tool activity                 | Existing `ChatSnapshot` and `MessageRow` types, imported as types                 | Service remains the only transcript-to-row reducer                                                |
| Streaming Markdown                          | `nsh/base` TextView with streaming options                                        | Stable completed blocks; selectable prose, code, tables and links                                 |
| Streamdown, DOM diagrams and diff viewer    | TextView, native DiffView, app-specific diagram renderer later                    | Feature gaps remain explicit and keep the corresponding Electron path available                   |
| Local UI preferences                        | NSH Storage in a development-specific app namespace                               | Locale/theme/panes survive relaunch without writing service records                               |
| Menus, directory picker, shortcuts          | `nsh/desktop` menus, keymap, narrow Rust picker operation if required             | Native edit commands and input method behavior remain intact                                      |
| launchd and updates                         | Existing Node lifecycle and updater payload, called through a later host adapter  | Existing maintenance, backup, swap, health check and rollback rules retained                      |

### Navigation, state and subscriptions

Use a small NSH-specific store; do not import the React store, DOM APIs, or
`window.tian`. Import shared domain types with `import type`. Keep route,
conversation selection, scope, drafts, tool disclosure state, and pane visibility
in signals. Components run once; reads in bindings track changes. Do not copy
React hooks or take reactive props apart into stale local values.

Register event listeners before initial requests. Version each list load so a
late response cannot overwrite an event. Serialize `unwatch(old)` and
`watch(new)` with selection and connection generations. Ignore a `view` event
whose conversation ID differs from the active ID. Reconnect rejects all pending
requests, clears the old watch, reloads lists, and re-establishes the selected
watch. Use one service client ID per window; release it on disposal. A disposed
screen must not leave a socket reader, timer, callback, or watch behind after HMR.

The service sends full chat snapshots, including `busy` and `streaming`; the
client must not invent token deltas or reconstruct Pi entries. Preserve row IDs
and key tool disclosures by `callId`. Use List with stable keys and follow-end
behavior where the installed runtime supports it. Reading older content must
not scroll to the end on every update. Keep a visible jump-to-latest action.
Measure long transcripts and updates to large tool outputs before claiming
performance parity.

### Text, images and localization

Use TextView Markdown for assistant prose, system notices, Run reports, and
Skill procedures. Keep user text and transcript markers plain. Enable streaming
repair only while a row streams. Fold tool arguments/output with base controls;
show running, pending, completed, and error states. TextView parses in Rust;
avoid adding a Markdown parser in QuickJS. Links are reported by default. Only
explicitly allowed external HTTP(S) links open through the native URL handler;
anchors need an in-document scroll implementation.

Check fenced code, incomplete Markdown, Chinese, tables, selection, copy, and
large outputs. Mermaid currently uses Pele and DOM/SVG. Initially show its source
as code and record rendered diagrams as a parity gap. TextView provides math
extension points; formula rendering also needs explicit verification.

Use NSH Image for asset, HTTP(S), and data URI images, with alt labels and error
states. The current `MessageRow` contains text and tool calls, with no image
attachment field. Do not promise image submission by porting a picker alone.
Any shared contract extension must be additive; ask before a breaking change.
Do not grant unrestricted local-file or network access to display images.

Import `en.ts` and `zh.ts` directly from `src/renderer/i18n/`; both are plain
modules. Add a small NSH resolver that uses a locale signal and Storage, with
the existing English fallback and parameter interpolation. Do not import the
React/DOM i18n entry. All new UI text enters `en.ts` first, with Chinese overrides
in `zh.ts`. If external imports fail, generate dictionaries mechanically from
those files and verify drift; never maintain hand-copied translations. Check
English and Chinese with missing overrides and interpolation.

### Accessibility and desktop behavior

Use `nsh/base` Button, Input, Tabs, Dialog and disclosure components for their
roles and behavior. Supply accessible names for icon controls and labels for
fields. Use native accessibility props, not DOM ARIA attributes. Announce
connection failures and operation outcomes; do not announce every streamed
fragment. Verify keyboard traversal, visible focus, dialog focus return, and
VoiceOver labels on macOS. Do not use automatic focus hacks. Observe
`reduceMotion()` and motion-reduce styles.

Use the native title bar first. A later custom header uses Window.setTitleBar,
`titleBar()` insets and `desktop.windowDrag`, with interactive areas excluded
from dragging. NSH's backdrop blur maps to NSVisualEffectView with within-window
blending; it does not promise the same material as Electron's under-window
vibrancy. Check both appearances and full screen with native controls visible.

Bind existing shortcuts through keymap: Command-K palette, Command-N new
conversation, Command-B context pane, Control-Command-S navigation,
Command-comma Settings, Command-1 through Command-4 destinations. Preserve
native Edit menu behavior. The composer uses native multiline Input submission:
Return sends, Shift-Return inserts a newline, Return during IME composition
commits composition. Test Chinese input on the actual backend.
The palette uses a base Dialog, labeled search Input and a keyboard-operated
result list. Search commands, scopes and conversations. Arrow keys move the
active result, Return executes, Escape closes and returns focus. Avoid claiming
a listbox role until the full keyboard and selection pattern works.

## Unix socket transport: verified limits and bridge design

The NSH source has no JS API for a Unix domain connection:

- `crates/nsh-core/src/runtime/net.rs`: `Net::connect(host: String, port: u16)`
  resolves host addresses and calls `tokio::net::TcpStream::connect`. Its Socket
  wraps TCP halves and a `std::net::TcpStream`. There is no path overload.
- `runtime/websocket.rs`: `WebSocket::connect` accepts only `ws` / `wss` URLs
  with a host. It does not accept `unix:` URLs or a socket-path option.
- `runtime/fs.rs`: file/directory operations only. It has no open/connect stream
  export. A socket filesystem entry does not become a connection via readFile.
- `docs/dev/js-modules.md` confirms the standard module catalog. Node's
  `node:net` and `child_process` imports are unavailable to TSX.

Build a mixed app under `crates/tian-nsh`, with a library crate registered by
`#[native_module("tian/native")]`. NSH generates its AppKit host, declarations,
and headless runner. Export a native connection class/module with async calls
and a cancellable event subscription. Use tokio UnixStream, serde_json and
NSH Callback/Later APIs. Keep socket IO and JSON framing in Rust. Return decoded
values over the generated native boundary, with a TS command adapter typed by
`Commands` / `AppEvents`. Do not expose arbitrary filesystem or process execution
as part of this bridge.

Protocol requirements follow the existing client:

1. Resolve `TIAN_AGENT_SOCKET_PATH`, otherwise `<TIAN_AGENT_DATA_DIR>/agent.sock`.
   Require absolute paths and at most 100 UTF-8 bytes for the socket. Development
   requires explicit temporary paths; production default resolution belongs to
   the lifecycle phase. Keep UI Storage separate from service data.
2. Read newline-delimited UTF-8 JSON, handling split Unicode, split frames,
   multiple frames, blank lines and EOF. Bound received frames at 16 MiB and
   outbound requests at 1 MiB: the server calls `jsonPeer` with a 1 MiB receive
   limit. Also bound queued output. Fail malformed input cleanly.
3. Validate the `ready.info` protocol and metadata before requests. Protocol 10
   is required. Mirror the value mechanically or test it against the TS source.
4. Send `{ type: "request", id, command, args, clientId }`; correlate results,
   propagate service errors, bound pending work and timeouts, and honor targeted
   event client IDs. `watch(id)` returns void; messages arrive in `view` events.
5. On disconnect, reject pending work and retry with capped exponential delay
   (500 ms to 30 s). Do not replay mutations. On reconnect, the store fetches
   fresh snapshots. On close, release the client and shut down IO without
   sending any service stop command.

Cost: one small transport implementation and its protocol tests, plus native
compilation of the app-specific runner. Mixed apps cannot use the stock prebuilt
host. A first build downloads/builds NSH, QuickJS and AppKit dependencies; later
TSX changes stay hot, Rust changes restart the client. This is a macOS/Unix
bridge; future Windows support needs a different local transport. A TCP proxy
adds a listener, authentication and another process, so it is excluded.

## Service lifecycle, packaging and updates

Phase 1 only connects. It does not install, start, stop, restart, or update a
service. Use a temporary service from this checkout and no model calls for
acceptance. Quitting the NSH client leaves that service running. An unavailable
service produces a recoverable, localized connection state.

The later lifecycle phase must account for DesktopController preferences,
connection controls, service status/activity, launchd installation and login
state, maintenance, recovery, and readiness acknowledgments. Reuse the existing
Node lifecycle/updater payload through narrowly named host operations. Keep
service/database migration rules in TypeScript. Test with a temporary data dir
and distinct launchd label only; the current live installation is out of scope.

Package with `nsh package crates/tian-nsh --target macos`. Confirm the installed
CLI's exact output flags before documenting an output path. Bundle the existing
service payload, pinned Node runtime and independent updater with a verified
manifest. NSH's generated package alone does not supply those resources.
Development packages can use a distinct provisional app ID and ad hoc signing.
Production app ID, Developer ID, entitlements, notarization and distribution
channel require user decisions before release. Do not overwrite the installed
Electron application during development.

NSH `.nshpkg` Ed25519 signatures protect downloaded TSX packages. They do not
replace macOS codesigning, notarization, or the existing full-app/service update
transaction. Initial distribution uses a full app bundle. Keep the current
maintenance → backup → service switch → app swap → mounted-client health check
→ commit/rollback sequence. Adapt the readiness signal to a mounted native
screen; a connected socket alone is insufficient. OTA screen delivery and an
update server remain deferred. Never weaken the existing same-identity,
same-team, version, manifest, idle-state or rollback checks for the port.

## Ordered phases and verification gates

Every completed phase runs `mise run verify`, plus the TypeScript fallback
compiler where types change. Rust phases run cargo build/test, NSH build/check,
and the native run command. Use temporary state. Record actual results, commit,
push `refactor/nsh`, and create a PR against main. Do not merge. GitHub allows
only one open PR for the same head/base pair: while that PR remains open, later
phase commits update it. Distinct per-view PRs require the preceding PR to be
closed or merged by the user, or a user-approved change to the branch rule.

| Phase | Deliverable                                                                                              | Main risks and verification                                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | This plan and D21                                                                                        | Source-check transport claims and ownership; `mise run verify`; no Rust application exists yet                                                                                                                                                          |
| 1     | Native three-pane shell; real conversation list; selected transcript read-only; live events              | cargo protocol tests for fragmentation, handshake, bounds, disconnect and cleanup; TS stale selection/event tests; NSH headless and macOS tests against a temporary real service; launch `nsh run --target macos`; verify app quit leaves service alive |
| 2     | Chat composer, submit/abort, streaming TextView, tool folding, archive/restore, scopes and Manager entry | No model calls in tests; controlled service fixtures for busy, errors and streaming; reconnect and rapid selection; Return/Shift-Return/IME; scrolling, copy, long tools and Chinese; record Mermaid/math gaps                                          |
| 3     | Goals, Task Board, notices, schedules; context Tasks/Runs and review                                     | Cross-scope filtering, create/edit/status/run-now/schedule errors; native diff/report; explicit Land/Ship/Discard consent; tests never perform those actions on user projects                                                                           |
| 4     | Inbox                                                                                                    | Cross-scope entries, unread metadata, empty/error states, event-driven reload without stale responses; temporary mailbox files                                                                                                                          |
| 5     | Skills                                                                                                   | Candidate/approved/history views, approve/retire/rollback; version and verification states; fixture-only mutation tests                                                                                                                                 |
| 6     | Settings and project management; Memory review parity                                                    | Locale/theme persistence, catalogs/offline errors/model changes, usage, Improvement Log, WeChat status and relogin; project picker and Manager names; Memory evidence/confirmation/Core rules; no live credential or channel changes                    |
| 7     | Command palette and complete keyboard/menu parity                                                        | Filtering, arrows, Return, Escape, focus return, shortcuts in/out of inputs, Settings return route, pane persistence/resizing, VoiceOver smoke check                                                                                                    |
| 8     | Service lifecycle; packaged app; updater                                                                 | Isolated launchd install/restart/recovery; codesign verification of an ad hoc development bundle; full upgrade/rollback with two throwaway bundles and temporary data; production signing/distribution waits for identity decisions                     |
| Final | Electron removal after user confirmation                                                                 | Document parity matrix and remaining gaps first; remove Electron-only code/dependencies in a dedicated PR; rerun all checks and packaged startup/quit/upgrade tests                                                                                     |

A phase completes only when its acceptance gate passes. A successful bundle or
headless test does not prove AppKit input, accessibility or lifecycle behavior.
Report what runs, what is stubbed, and the next phase at each boundary. Record
blocked checks with their actual failure rather than marking them passed.
