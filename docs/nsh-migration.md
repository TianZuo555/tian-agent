# Native Shell client migration plan

## Status and implementation gate

**Plan only. Server-first client implementation is paused.**

The product direction is server-first: **Pi Server + NSH clients over Tailscale**.
The earlier local resident-service/sidecar topology is superseded. The protocol and UI specifications must land in `main` before client
implementation starts. The source of truth is [`docs/spec/`](spec/README.md):

| Specification                    | Authority                                                                 |
| -------------------------------- | ------------------------------------------------------------------------- |
| [Protocol](spec/protocol.md)     | Transport, topology, commands, subscriptions, recovery, and compatibility |
| [Clients](spec/clients.md)       | Client responsibilities and server boundaries                             |
| [UI](spec/ui.md)                 | Layout, navigation, interactions, and screen acceptance criteria          |
| [Operations](spec/operations.md) | Deployment, lifecycle, and update responsibilities                        |

These specifications take precedence over this migration plan. The plan records
migration order and verification work; it does not define another contract.
Do not start Phase 1 or add client code for the server-first client. Wait for the
specifications to land in `main` and for the user to resume that work.

An initial local-client skeleton was committed before this direction changed.
Its implementation has been reverted from this branch. The remaining changes
are planning documents. Historical commits and test results from that prototype
do not establish acceptance for the server-first product.

Work only in `/Users/tian/Workspace/tian-agent-nsh`, on `refactor/nsh`. Do not
change or build the sibling `tian-agent` checkout or modify either NSH reference
checkout. Keep Electron available until the new client meets the agreed UI
specification. Removing Electron requires a separate final phase and explicit
user confirmation.

### Design fixture (`crates/tian-nsh`)

On 2026-11-06 the user asked for a first NSH build of the "Tian Sky" visual
language (the design change set on `main`: `docs/design-language.md` and the
mockup in `docs/design/`). `crates/tian-nsh` is that design fixture. It renders the
mockup's sample data with no transport, no server connection, and no resident
service. It is not Phase 1, and it satisfies no acceptance criterion above. It
exists so the visual language can be judged natively: AppKit text and fonts,
motion, glass, and the three-pane window.

The user subsequently requested the full iOS frontend from the light-and-shadow mockup, with the latest SVG identities. `crates/tian-nsh/IOS.tsx` is that native frontend preview; [its guide](../crates/tian-nsh/IOS.md) records the screens, local interactions, and verification commands. It uses the same sample data boundary as the desktop fixture.

The gate and the phase order below are unchanged. Connecting a client to Pi
Server still waits for `docs/spec/` to land in `main`.

## Planning inputs

Application baseline: `c7b2fab`. The current code has Electron main/preload,
React screens, a TypeScript resident service, application-owned chat snapshots,
and a local Unix socket protocol. These describe the existing implementation;
they do not define the future client/server contract.

NSH reference: `longbridge/nsh` main at
`7ed95faf2b6473f3205ac0e756ec51fe2ec3b922`, read-only at `/tmp/nsh-main`.
The release CLI inspected during planning was `nsh 0.4.0 (e626a8d)`.
Reference examples and release-generated APIs can differ. Once implementation
is authorized, select and pin a version that supports the landed specifications.
Do not depend on a mutable local checkout.

Relevant existing sources:

- Product vocabulary and current behavior: `CONTEXT.md`, `docs/prd.md`, and
  `docs/architecture.md`. Future behavior follows [`docs/spec/`](spec/README.md).
- Desktop integration: `src/main.ts`, `src/preload.ts`, and `src/desktop/`.
- Client state and views: `src/renderer/state.ts` and
  `src/renderer/components/`.
- Existing application shapes: `src/shared/contracts.ts`,
  `src/shared/types.ts`, and `src/shared/messages.ts`.
- Existing local transport: `src/service/client.ts`,
  `src/service/protocol.ts`, and `src/service/server.ts`.
- NSH patterns: `examples/rust-exports`, `examples/desktop`, and the gallery;
  `docs/dev/` pages for components, modules, text, scrolling, accessibility,
  macOS, tooling, and packaging.

## Transport and topology — superseded

**Superseded — to be replaced by docs/spec/protocol.md.**

The [protocol specification](spec/protocol.md) is the source of truth.

The intended topology is Pi Server with NSH clients connected over Tailscale.
The landed protocol specification is authoritative for endpoint discovery,
transport, identity, authentication, authorization, commands, subscriptions,
streaming, reconnect, compatibility, and error behavior.

This plan deliberately selects none of those mechanisms. Tailscale describes
the connectivity direction; it does not by itself define the application
protocol or its authorization rules. The old Unix socket protocol must not be
exposed remotely or treated as the future contract without the specification.

Source findings from the earlier local-topology investigation remain useful
only as framework constraints:

- NSH `net` exposes `connect(host, port)` backed by TCP. The inspected source
  has no Unix socket path overload.
- Its WebSocket connection API accepts `ws` and `wss` URLs. The inspected API
  has no Unix socket option.
- `fs/promises` exposes file and directory operations, with no socket
  connection API.
- TSX runs in QuickJS. It cannot import the Node ServiceClient unchanged.

These findings do **not** justify a Rust Unix socket bridge for the new product.
After the protocol lands, check whether NSH's standard network APIs satisfy it.
Add Rust host integration only for a capability the specified client requires.
Evaluate its build, lifecycle, cancellation, and maintenance costs at that time.

The following questions belong to the protocol specification:

| Area                | Input needed before implementation                                 |
| ------------------- | ------------------------------------------------------------------ |
| Server connection   | Endpoint configuration, discovery, and connection setup            |
| Identity and access | Client identity, credentials, authorization, and revocation        |
| Application model   | Command/result shapes, identifiers, ownership, and errors          |
| Live updates        | Subscription scope, ordering, cursors, snapshots, and resume rules |
| Recovery            | Disconnect behavior, retries, deduplication, and mutation outcomes |
| Compatibility       | Version negotiation and unsupported-client/server behavior         |

The client must follow those answers. Do not invent a replacement protocol in
this migration plan or make breaking changes to the current shared contracts.

## Provisional responsibility map

This map identifies work to assess after the specifications land. Final screen
structure, behavior, and acceptance criteria come from the UI specification.

| Existing responsibility                  | Candidate NSH responsibility                                          | Dependency                                      |
| ---------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| Electron windows and desktop integration | macOS AppKit host and `nsh/desktop` APIs                              | UI specification and app lifecycle requirements |
| Preload/main command routing             | Typed client adapter for Pi Server                                    | Protocol specification                          |
| React state and subscriptions            | NSH signals, computed values, effects, and owner cleanup              | Server state/update contract                    |
| Navigation and three-pane shell          | TSX navigation, content, and context regions                          | UI layout and routing specification             |
| Chat transcript                          | Native message list and streaming content                             | Message and stream contract                     |
| Markdown and code                        | `nsh/base` TextView where it meets the UI requirements                | Rendering acceptance fixtures                   |
| Tool activity                            | Accessible disclosure controls                                        | Tool event and state model                      |
| Images and attachments                   | NSH Image and supported native attachment controls                    | Protocol payloads and UI specification          |
| Localization                             | Existing English/Chinese dictionaries through an NSH resolver         | Confirmed screen copy and preference ownership  |
| Accessibility                            | Base controls, native labels, focus, keyboard behavior, announcements | UI acceptance criteria and macOS checks         |
| Desktop service management               | Reassess for a remote server product                                  | Protocol/UI specifications; no assumed sidecar  |
| App packaging and updates                | Native client bundle and client updater                               | App identity, signing, and release decisions    |

### Navigation and client state

Confirm destinations, routing, selection, Settings return behavior, scope
presentation, context panes, and persistence against the UI specification.
The current app's Chat / Goals / Skills / Inbox / Settings structure is an
inventory, not a commitment to the new layout.

Use NSH's reactive model rather than porting React hooks or DOM state directly.
Components run once; bindings track changing values. Release subscriptions,
timers, and tasks with their owners. Design late-response rejection and
reconnect handling from the specified update ordering and resume rules.

Separate transient client state, such as drafts and panel visibility, from
server-owned application state. Decide preference synchronization and offline
behavior from the specifications. Do not assume local Storage is authoritative
across clients.

### Streaming chat and tool activity

Inventory the current composer, busy/stop control, transcript markers,
notifications, tool grouping, archive controls, scope and Manager entry points,
and model selection. Map each to the new UI and protocol before porting it.

The existing `ChatSnapshot`/`MessageRow` shapes can inform that review. They are
not imposed on Pi Server. Keep transcript interpretation in the layer assigned
by the protocol specification.

Use native list keys and scrolling behavior suited to long transcripts.
Readers who scroll back must be able to remain there during updates. Verify
following the latest message, jumping to the end, conversation switching, and
large tool output. Test composition, cancellation, uncertain submission
outcomes, and reconnect using the specified semantics.

### Markdown, images, and localization

Assess `nsh/base` TextView for assistant prose, notices, reports, and procedures.
It parses Markdown/HTML in Rust and supports streaming repair. Check incomplete
Markdown, code fences, tables, Chinese text, selection, copy, and links.
Mermaid currently depends on Pele and DOM/SVG; rendered diagrams need an
explicit native solution or an agreed fallback. Math rendering also needs
separate verification. Do not claim parity from a successful text bundle.

Determine image sources, attachment transport, limits, alt text, and failure
states from the specifications. Grant only the file/network capabilities those
features require. A native picker alone does not establish attachment support.

Keep English defaults and the key set in `src/renderer/i18n/en.ts`, with Chinese
overrides in `zh.ts`. Prefer direct imports of these plain dictionaries into an
NSH resolver. Do not import the React/DOM i18n entry. If bundling requires
another format, generate it mechanically and verify drift. Add new UI copy to
`en.ts` first. Check fallback, interpolation, and locale changes.

### Accessibility, chrome, and keyboard

Use `nsh/base` controls for their roles and behavior. Name icon-only controls,
label fields, show focus, and announce status/error changes without announcing
every streamed fragment. Verify keyboard traversal, modal focus return,
VoiceOver behavior, and reduced motion on macOS. Do not use automatic-focus
hacks.

Window chrome and material must follow the UI specification. NSH's native
backdrop blur differs from Electron's under-window vibrancy. Test traffic-light
clearance, resizing, both appearances, and full screen when custom chrome is
required.

Inventory existing shortcuts: Command-K, Command-N, Command-B,
Control-Command-S, Command-comma, and Command-1 through Command-4. Confirm their
meaning in the new UI before binding them. Preserve native edit commands and
IME behavior. If the specified composer sends on Return, test Shift-Return and
Return during Chinese composition on the native backend.

Implement the command palette after its command set and interaction pattern are
specified. Verify search, selection, arrows, Return, Escape, and focus return.
Claim accessibility roles only when the complete interaction pattern works.

## Service lifecycle and application updates

The existing `src/desktop/` code manages local connection preferences, launchd,
service installation, maintenance, backups, application replacement, readiness,
and rollback. Audit it as migration input. The server-first topology does not
imply that these local service controls belong in each NSH client.

Do not build a sidecar installer, start or stop a local service, or port the
service/database as part of this client plan. Server deployment and server
updates need their own specified owner and workflow. Client behavior during a
server upgrade must follow the protocol's compatibility and recovery rules.

Client packaging is a later phase. Evaluate `nsh package --target macos` after
the application structure is agreed. Production app identity, Developer ID,
entitlements, notarization, distribution, and the client updater require
explicit decisions before release. Use separate development identity and
throwaway state for tests; do not overwrite the installed Electron application.

NSH `.nshpkg` signatures protect downloaded screen packages. They do not replace
macOS codesigning, notarization, or a full client updater. Do not select OTA
screen delivery or couple client/server release transactions before the specs
establish the update model.

## Provisional phases after the specifications land

These phases are an ordering proposal. Reconcile them with the landed protocol
and UI specifications before writing code. No phase below is authorized to
start while the implementation gate is closed.

| Phase | Proposed deliverable                                  | Verification focus                                                                               |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0     | This plan, updated by the landed specifications       | Review topology, ownership, dependencies, and acceptance gates                                   |
| 1     | Minimal native client and specified server connection | Isolated server fixture, connection/access behavior, disconnect, cleanup, native window          |
| 2     | Chat                                                  | Composer, stream rendering, tools, stop, submission recovery, scrolling, Markdown, Chinese input |
| 3     | Goals and related context views, if specified         | Scope boundaries, task/goal actions, schedules, reports, explicit review controls                |
| 4     | Inbox, if specified                                   | Cross-client update behavior, filters, read state, empty/error states                            |
| 5     | Skills, if specified                                  | Versions, review actions, verification states, authorization failures                            |
| 6     | Settings and project management, if specified         | Connection/account settings, locale/theme, models, usage, and other specified panels             |
| 7     | Command palette and desktop interaction completion    | Commands, shortcuts, focus, accessibility, resizing, and persistence                             |
| 8     | Client packaging and updates                          | Signed development package, startup/quit, upgrade/rollback, server compatibility                 |
| Final | Electron removal, after user confirmation             | Agreed parity matrix, remaining gaps, dedicated removal PR, full verification                    |

Keep `mise run verify` green at each implemented phase. Check both TypeScript
compilers when types change. Rust phases need Cargo build/tests, NSH build/check,
and the actual macOS run command. Separate deterministic tests from native
input/accessibility checks. Use protocol fixtures without model calls and
throwaway client/server state; never use the user's live data.

Commit and push logical phase changes to `refactor/nsh`, with PRs against
`main`; never merge them automatically. GitHub permits one open PR per
head/base pair. Resolve the per-phase PR arrangement before implementation if
the preceding PR remains open. PRs must state what changed, verification
results, and unresolved risks.

**Next action: stop and wait for the protocol and UI specifications to land in
`main` before the server-first client starts. The design fixture does not change
this gate.**
