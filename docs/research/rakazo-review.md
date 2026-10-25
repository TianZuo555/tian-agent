# Rakazo Research: Could Tian Agent Build the Same Thing?

**English** | [简体中文](../zh/research/rakazo-review.md)

Research Date: 2026-10-25. Research only. This document records analysis and recommendations. It does not change [docs/prd.md](../prd.md) or [docs/decisions.md](../decisions.md).

## Conclusions

Tian Agent can build the same product class. The bot layer is already close. The real gap is one layer: **a computer that the agent can see and operate**.

Do not copy Rakazo's stack. Rakazo is built for self-hosted multi-user servers. Tian Agent is a single-user local desktop app with a resident service. The cost and the benefit of each capability differ.

Recommended order:

1. **L0 read-only browser tools.** Lowest cost, covers most of the value.
2. **L1 controlled browser plus user takeover.** Do this only after L0 proves useful.
3. **L2 Docker desktop sandbox.** Skip it. Keep OS isolation for Workers as a separate decision.

Take three cheap items without waiting: artifact attachments, lateness context for late Routines, and a structured activity feed for the Chief.

## Sources

- `https://github.com/elie222/rakazo`, Apache-2.0, default branch `main`, inspected 2026-10-25 by shallow clone.
- Size: 2,350 TypeScript files; 584,909 lines including tests; 288,193 lines excluding tests; 864 test files.
- Key files read: `VISION.md`, `docs/run-execution.md`, `docs/computer-runtime.md`, `packages/adapters/src/builtin-tools.ts`, `packages/adapters/src/action-approval.ts`, `packages/adapters/src/web-ssrf.ts`, `packages/db/prisma/schema.prisma`, `infra/sandboxes/supervisor/src/egress-probe.ts`, `infra/compose/restrict-computer-egress.sh`.
- Tian Agent files read: `README.md`, `docs/prd.md`, `CONTEXT.md`, `docs/decisions.md`, `package.json`, `src/worker/*`, `src/worker/agents.ts`.

## What Rakazo Is

Rakazo is not a chat agent with a plugin store. Its product core is **a durable AI teammate plus a durable personal computer**.

| Layer              | What it does                                                                                                                         | Where it lives                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Teammate           | Each Bot has one continuous thread, memory, routines, sections, archive, child bots                                                  | `Bot`, `Thread`, `Routine`, `BotSection` tables                      |
| Execution          | Pi runs inside the API process; tools are ordinary Pi tools                                                                          | `packages/adapters/src/pi-runtime.ts`                                |
| Computer           | `SandboxProvider` (Docker, E2B, Daytona, Boat, Railway, CreateOS) gives each active bot its own X display and its own Chrome profile | `packages/adapters/src/computer-*.ts`, `infra/sandboxes/supervisor/` |
| Screen             | noVNC behind a token-gated websocket gateway; separate view and control capabilities; database leases with fences                    | `docs/computer-runtime.md`                                           |
| Web pages          | `browser_navigate`, `browser_snapshot`, `browser_act` by element ref                                                                 | `packages/adapters/src/builtin-tools.ts`                             |
| Terminal and files | PTY server bound to the control token; file browser; activity feed                                                                   | `computer.terminalUrl`, `computer.command` events                    |
| Surround           | Spaces, Better Auth, billing, Composio and Pipedream connectors, MCP, Expo and web clients                                           | `apps/*`                                                             |

The important fact for Tian Agent: **Rakazo uses the same Pi runtime that Tian Agent uses** (`@earendil-works/pi-*` 1.3.0 against `pi-durable` and `pi-ai` 1.3.0). Its agent-layer design transfers directly. Its infrastructure layer does not.

## Capability Comparison

| Capability                           | Rakazo                           | Tian Agent                                                 | Gap size                   |
| ------------------------------------ | -------------------------------- | ---------------------------------------------------------- | -------------------------- |
| Resident runtime                     | API process plus worker          | launchd resident service (D3)                              | None                       |
| Desktop client                       | Electron plus web plus Expo      | Electron only                                              | Small                      |
| Persistent memory                    | Memories with revisions          | Core Memory with evidence, confirmation, budgets (D4, D19) | **Tian Agent is stronger** |
| Goals, tasks, schedules              | Routines and tickets             | Goals, Tasks, Schedules, boards                            | **Tian Agent is stronger** |
| Agent hierarchy                      | Parent and child bots, subagents | Chief, Manager, Worker (D12, D18)                          | Comparable                 |
| Isolated code execution              | Container per computer           | Git worktree only (`docs/prd.md` §7.3)                     | **Real gap**               |
| Browser and GUI control              | Full stack                       | None; the Chief has no shell tools                         | **Real gap**               |
| Artifacts in chat                    | Artifact table plus attachments  | Report file on disk                                        | Real gap, small fix        |
| Multi-user, billing, SaaS connectors | Yes                              | Explicit non-goal (`docs/prd.md` §1.4)                     | Not a gap                  |
| Mobile                               | Expo                             | None                                                       | Non-goal for now           |

Read the table this way: Tian Agent already owns the layer Rakazo spent its first release on. Tian Agent does not own the layer Rakazo spends most of its code on.

## The Part That Is Actually Hard

The GUI stack is where Rakazo's mass sits:

- `packages/adapters` is about 200,000 lines including tests. A large part is computer, browser, sandbox provider, and their conformance suites.
- `infra/sandboxes` holds a Docker supervisor that manages X displays, per-bot Chrome profiles, noVNC transports, PTY servers, clipboard bridges, profile persistence across releases, and profile checkpoint generation fences.
- `docs/computer-runtime.md` documents failure modes that took real time to find: noVNC stalls on Android when WebCodecs is present, duplicate frame bytes must be dropped from model context, stale element refs must be rejected instead of retargeted, teardown must finish before a display slot is reused.

None of this is a weekend port. Most of it exists because Rakazo serves many tenants from one server over the network.

Tian Agent does not have that constraint. The desktop app already runs on the machine that would host the browser. That removes the entire remote-screen problem.

## Where Rakazo Is Worth Copying

### 1. Element-ref browser tools before pixel tools

Rakazo gives the model `browser_snapshot` (accessibility-style tree with `e1`, `e2`, … refs) and `browser_act` (click, fill, type, upload, fill_secret). Pixel clicks through `computer_act` exist, but the tool descriptions tell the model to prefer refs for web pages and to fall back to pixels only when the page tool refuses. This is the correct order. Ref-based tools are cheaper, more reliable, and easier to audit.

### 2. Three-way split of screen access: view, control, takeover

- View is a read-only capability.
- Control is a separate capability. Only one holder at a time, enforced by a lease.
- `request_takeover` asks the human for exclusive control when protected input is needed: password, 2FA, CAPTCHA, judgment.

This maps directly to a Tian Agent requirement: the user must be able to watch and interrupt. The lease model is small and worth keeping even for a local app.

### 3. Untainted versus tainted runs

`packages/core/src/action-approval.ts` splits tools into two groups: tools whose results are the product's own state (memory, history, secrets list) and tools whose results carry outside text (pages, shell output, connectors, other bots). The second group **taints the run**. After a run is tainted, connector reads on a connector the run has not already used require approval, because injected text could now choose the arguments. `outboundSiteGate` applies the same idea to `web_fetch`: a site named in the owner's own words is trusted; a site chosen after outside content entered the run is not.

Tian Agent has no equivalent rule. Worker prompts say "do not push"; that is an instruction, not a boundary (`docs/prd.md` §7.3 admits this). The taint rule is a few hundred lines and it converts prompt discipline into enforcement. Copy this regardless of which L level is chosen.

### 4. Secrets never enter the model

`request_secret` shows a card to the user. The value is stored server-side and `browser_act fill_secret` types it into the field for the origin it was saved for. The model never sees the value. Command credentials are exported to the shell as environment variables instead.

Tian Agent's Chief has no credential path at all today. Any GUI capability must come with a rule like this one, or the first password the agent types is a permanent leak in the transcript.

### 5. Deny by default for anything that leaves the machine

`web-ssrf.ts` refuses private, loopback, link-local, and metadata addresses after DNS resolution, checks each redirect hop, and caps body size and redirect count. For full computers, `restrict-computer-egress.sh` blocks the Docker host, RFC1918, CGNAT, link-local, and multicast, and `egress-probe.ts` **proves the rules are present before the first restricted computer starts**. If the proof fails, the computer refuses to start instead of running open.

That last part is the design lesson. Do not assume a firewall rule exists. Verify it, and fail closed.

### 6. Lateness context for scheduled work

`docs/run-execution.md` states that a timer run which starts more than 15 minutes after its scheduled occurrence tells the agent both times, in the routine's own timezone. The agent can then adapt instead of assuming the current time is the scheduled time. Tian Agent's scheduler (`src/worker/scheduler.ts`) has no such rule. This is a small prompt change with real effect.

### 7. Artifacts belong to the thread, not the filesystem

Rakazo has an `Artifact` table tied to bot, group, run, and thread. Generated images, videos, plots, and files attach to chat. Tian Agent writes `TIAN_REPORT.md` into the worktree and reads it back with `read_run_report`. The intermediate step works, but the user never sees a picture the agent made.

## Where Tian Agent Should Diverge

### Skip the Docker desktop sandbox

Rakazo needs Docker because its computers serve remote users. Tian Agent's computer is the machine the user sits at. A local hidden `BrowserWindow` gives the same observation and action ability with no container, no noVNC, no X display, no per-bot Chrome profile, no supervisor, and no screen gateway.

Also use what already exists on the host. The `cua-driver` skill drives real macOS applications through the accessibility tree and window geometry. That covers the "operate a GUI app" case that Rakazo solves with a whole Linux desktop image, at the cost of one process call.

### Keep the worktree as the only code boundary, and say so

Tian Agent's PRD already marks this as an open question (§13, question 8). Do not bundle that decision into the GUI work. If Worker isolation is worth solving, solve it with a purpose-built sandbox around the shell tool. Do not import a desktop stack to get it.

### Keep the memory design

Rakazo's memory is thinner than Tian Agent's. Rakazo has `MemoryDocument`, `MemoryRevision`, and a memory scope string on the Bot. Tian Agent has provenance, evidence, confirmation, supersession, explicit Core selection, per-scope budgets, a separate relevance budget, and review UI (D4, D18, D19). Do not regress toward Rakazo's model while adding files and GUI control.

## Proposed Stages

### L0: Read-only browser (about 1 to 2 thousand lines)

- Hidden `BrowserWindow` in the Electron main process with its own session partition (`persist:agent`). Not the user's profile.
- `browse(url)` loads a page, waits for idle, and returns the document title, extracted text, and a bounded list of interactive elements with refs.
- `snapshot()` returns the same structure without navigating.
- Screenshots use `webContents.capturePage()`. Send image bytes only when the model reports `input` includes `image` in the Magpie catalog (`src/worker/magpie.ts` already parses this).
- New Pi extension with two tools. Give it to the Chief and to Managers. Do not give it to Workers in this stage.
- Domain allowlist in settings. Default: public web only. Refuse private, loopback, link-local, and metadata destinations after DNS resolution, and refuse on every redirect hop.
- Maximum page size, maximum element count, and a hard timeout. Reject stale refs.

Value: the Chief can read a document, check a service status, read a PR discussion, or open a bug report. None of that needs a container.

Cost: one extension, one main-process module, one IPC channel, one settings row, tests. No new process, no new image, no Docker.

### L1: Controlled browser plus takeover (about 3 to 6 thousand lines)

- Add `act(click/fill/type/upload by ref)` and `request_takeover()`.
- Embed the agent's browser in the Context Pane with `WebContentsView` so the user can watch.
- Single-holder lease: either the agent or the user controls the page. Release on run end, on timeout, and on window close.
- Credential cards: the user types the secret in the app; the agent types it into a field for the saved origin only.
- Taint tracking: after any page or shell result enters the run, outbound destinations the run was not given require approval.

This is where real security review is needed. Do not start it before L0 shows actual use.

### L2: Skip

No Docker supervisor, no X displays, no noVNC, no per-bot Chrome profiles, no multi-provider sandbox abstraction. Revisit only if Tian Agent becomes a multi-user product or gains a remote server mode. Both are listed as roadmap items in `README.md`, so record this as a decision with a trigger, not as a permanent no.

### Immediate small items (independent of L levels)

1. Artifact attachments: let agents attach images and files to a message and let the Chat view render them.
2. Lateness context in `src/worker/scheduler.ts`: tell the agent scheduled time and actual time when a wake is more than 15 minutes late.
3. Structured activity events for the Chief: today `run_progress` covers Workers only. Extend the same event shape to the Chief's tool calls so the user can see what the Chief did.

## Open Questions

1. **Vision model availability.** Magpie must expose at least one model whose catalog entry includes `image` in `modalities.input`. Without one, L0 must be DOM-text only. Check the live catalog before planning screenshots.
2. **Permission model for the Chief.** The Chief currently has no shell and no file-write tools by design (`docs/prd.md` §7.3). A browser with any logged-in state changes that posture. Decide before L1 whether the agent browser may ever share the user's cookies.
3. **Ownership.** Should browser tools belong to the Chief extension (`src/worker/tools.ts`), or become a shared extension installed for Chief and Managers like `CodingTools`? The second matches Rakazo and keeps one implementation.
4. **Resident service versus Electron main.** The hidden browser must live where `BrowserWindow` exists, which is the Electron main process. The resident service owns all state (`docs/prd.md` §3.1). Define the IPC contract in `src/shared/contracts.ts` so the service stays authoritative and the browser is a tool endpoint, not a second writer.

## References

- Rakazo: `https://github.com/elie222/rakazo`
- Rakazo vision: `VISION.md` in that repository
- Rakazo computer runtime: `docs/computer-runtime.md` in that repository
- Tian Agent decisions: [D3](../decisions.md#d3--retain-typescript-resident-service-and-electron-client), [D4](../decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection), [D18](../decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects), [D19](../decisions.md#d19--memory-evidence-confirmation-and-similarity-evidence-supports-confirmation-reviews-similarity-only-relates)
- Tian Agent architecture: [docs/architecture.md](../architecture.md)
