# Architecture Design Decisions

**English** | [简体中文](zh/decisions.md)

This document records architectural decisions that are **difficult to reverse and critical to understand**: why this architecture was chosen and what trade-offs were made. Implementation details and operational guides appear in [architecture.md](architecture.md), [memory.md](memory.md), [data.md](data.md), [agent-work.md](agent-work.md), [channels.md](channels.md), [service.md](service.md), and [improvement-log.md](improvement-log.md).

Each decision forms a section numbered D1 through D18, organized by domain. Current metadata: `DATABASE_VERSION = 7`, `SERVICE_PROTOCOL = 10`. Every schema or protocol change is governed by upgrade transactions (see [service.md](service.md#service-upgrades)).

The earlier `docs/adr/` directory has been consolidated into this document:

| Former ADR | Current Section                                                        |
| ---------- | ---------------------------------------------------------------------- |
| 0001       | D1 Three-pane shell                                                    |
| 0002       | D2 Local Magpie gateway                                                |
| 0003       | D3 TypeScript service + Electron client                                |
| 0004       | D4 Memory with SQLite single-source writes                             |
| 0005       | D5 Tasks evolved from todos, executed via Runs                         |
| 0006       | D6 History as derived index, Events for business facts                 |
| 0007       | D7 Scheduling via single-transaction triggers                          |
| 0008       | D8 Telegram adapter                                                    |
| 0009       | D9 Packaged app with separate service installation (duplicate number)  |
| 0009       | D10 Skill manual approval injection gate (duplicate number)            |
| 0010       | D11 Improvement Log                                                    |
| —          | D12 Project Manager: persistent session and delegation tasks           |
| —          | D13 Run-level worker models and thinking levels                        |
| —          | D14 Manager naming: labels vs session bindings (superseded by D18)     |
| —          | D15 Folding duplicate dispatches and pausing runs                      |
| —          | D16 Run progress visibility and attempt interruption                   |
| —          | D17 WeChat integration via official iLink protocol                     |
| —          | D18 Memory ownership by role: Chief owns Global, Managers own projects |

---

## D1 · Three-Pane Shell: Navigation / Conversation / Context

The desktop UI adopts a three-pane layout: left pane for scopes and conversations, center pane for chat, and right pane for context inspection (Tasks / Runs). The Memory panel implementation remains intact, but its tab is hidden. The right pane is **permanent, resizable via dragging, and collapsible**, rather than an overlay drawer.

**Context**: An earlier version used a fixed 320px tabbed pane that competed visually with the left sidebar. A subsequent drawer experiment covered the chat area, preventing users from reading Chief instructions while reviewing diffs.

**Decision**:

- `PaneDivider` instances persist widths in `localStorage` (`tian.navWidth`, `tian.contextWidth`) as local view state outside the database.
- The right pane provides single-context inspection to prevent stacked information overload.
- Runs expand in place: clicking a Run renders diffs via `@pierre/diffs`, with Land, Ship, and Discard actions situated above the diff.
- Collapsing sidebars animates smoothly without vertical placeholder bars, using transforms and fixed widths to prevent text reflow.
- Archiving hides conversations from the sidebar and removes them as wake targets without deleting transcripts. The field `conversations.archived_at` acts as the single source of truth.

**Consequences**: Center chat width adjusts dynamically. The chat container centers with `max-w-3xl` rather than filling full widths. Pane widths and collapse states do not synchronize across devices. Narrow windows enforce `minWidth: 880`. Archived conversations remain searchable in History.

---

## D2 · Route Models Through Local Magpie Gateway

All model traffic routes through the local Magpie gateway (default `http://127.0.0.1:3425/v1`), which forwards requests upstream. The desktop application does not connect directly to external provider APIs or parse keys from `~/.pi/agent/auth.json`.

**Context**: Early versions branched by provider and read keys from environment variables. Upstream endpoints reside behind Magpie, and the gateway alone manages model capabilities, reasoning levels, context windows, and modalities.

**Decision**:

- Startup calls `GET /v1/models` and registers a single `magpie` provider using Pi's `openai-completions` adapter (`src/worker/magpie.ts`).
- Filters for models supporting `/v1/chat/completions`.
- Caches catalogs in `settings.json` so the UI opens offline and displays cached catalogs with an `offline` indicator.
- Uses placeholder authentication (`MAGPIE_API_KEY` defaults to `magpie`).
- Maps `reasoning_levels` to Pi `thinkingLevelMap` (`none` → `off`), setting unsupported levels to `null`.

**Consequences**: Switching models requires changing a single identifier without application releases. Cost tracking defaults to 0 tokens cost (the gateway does not report pricing), and the UI displays token volume heatmaps. Outages return streaming errors with proactive catalog warning badges.

---

## D3 · Retain TypeScript Resident Service and Electron Client

The project continues with its Node resident service (launchd) and Electron/React desktop client instead of migrating to a Rust host and GPUI desktop.

**Context**: PRD architectural goals—host-owned state, local-first storage, crash recovery, and auditable events—are already implemented in TypeScript using exclusive locks, Unix sockets, atomic upgrades, and Durable deduplication. The primary agent execution runtime (Pi Durable) is a TypeScript library.

**Decision**: The resident service remains the sole state owner. The React renderer acts as the frontend client. Runtime flexibility is achieved via `WorkerRuntime` and `AgentRuntime` interfaces rather than rewriting the service in another language.

**Consequences**: Cross-platform expansion replaces launchd service managers rather than rewriting backend code. Specialized performance requirements will be addressed with focused modules if bottlenecks emerge.

---

## D4 · Memory Uses SQLite as Single Source of Writes; Core Memory Changes to Explicit Selection

Memory storage migrated from text files (`LOG.txt` and `TREE/`) into `tian.db`, adding provenance, confidence levels, statuses, and versions. Core Memory is no longer a recursive summary tree; instead, it consists of a small set of facts **explicitly selected** by users or supervisors. Remaining memories stay searchable. Files on disk serve as one-way read-only exports.

**Context**: Append-only text files cannot represent supersession, corrections, or versions. Recursive summary trees solved token lengths but failed to preserve critical facts: eight short facts merged into a single root summary that obscured original details. Outdated summaries also risked reintroducing superseded facts.

**Decision**:

- Each memory receives an immutable, ascending `seq` within its scope.
- `memories.core` indicates Core status: new entries default to `core = false`. Setting `core = true` or calling `select #seq` adds items to Core. Calling `deselect #seq` removes items from Core without deleting them.
- Token budgets cover the **fully rendered text** (headers, types, confidence, line breaks, and usage footers). Overages reject atomically.
- Superseding creates a new memory record and marks the prior record as `superseded`. Outdated records leave Core Memory immediately.
- Deletions update record statuses without physical removal. All mutations append audit records in `memory_versions`.
- Stored text matching current user input confirms `source: "user"`. System wakeups, worker outputs, and summaries fall back to `agent_inferred`.
- Exact string deduplication per scope returns existing `#seq` values, appending evidence records if sources differ.
- Automatic extraction produces `candidate` records that never enter prompt injections until explicitly approved.

**Consequences**: Active memories export to `<scope>/memory/MEMORY.md` for human and worker reading. Manual file edits do not write back to SQLite. Legacy `memory_nodes` tables are retired. Managing Core Memory becomes an explicit action for users and agents.

---

## D5 · Tasks Evolve from Todos; Runs Execute Coding Tasks

The system evolved the existing `tasks` table to support Goal links, assignees, state machines, triggers, and deduplication keys rather than creating a separate table. Runs represent isolated coding executions linked via `task_id`.

**Context**: Existing code already maintained simple todo tasks and durable execution runs. Adding a third task concept would create confusion.

**Decision**:

- Tasks belong to users or agents (`owner`). Legacy open todos became `pending`; completed todos became `completed`.
- States: `pending → running → waiting_approval → completed`, along with `paused`, `blocked`, `failed`, and `cancelled`. States and outcomes are tracked separately.
- Each Task has a unique `dedupe_key` (such as `sched:<scheduleId>:<fireTime>`).
- Non-coding tasks execute directly in Goal conversations without spawning Runs.
- The Schedule view merged into the Goals view, displaying goals alongside grouped task boards.

**Consequences**: The system exposes three clear concepts: Goal, Task, and Run. Run completion does not equal Task completion; supervisors evaluate Run outcomes to conclude parent Tasks.

---

## D6 · History is a Derived Index of Pi Transcripts; Business Facts Write to Events

Audit facts and conversation search reside in two database areas: `events` stores immutable business facts, while `history_entries`, `history_fts`, and `history_cursors` maintain rebuildable search indexes. Pi's `pi-session.sqlite` remains the sole source for transcripts.

**Context**: Querying raw Pi sessions directly is complex due to forks and pagination. Supervisors need keyword search across messages, tool calls, task transitions, and approvals without stuffing raw history into prompts.

**Decision**:

- **Event Table**: Records `events` with idempotent IDs (`INSERT OR IGNORE`).
- **Derived Indexes**: `history_entries` indexes transcripts by `(conversation_id, entry_id)`. Full-text search uses FTS5 with trigram tokenization for Chinese text search. Events index into the same table with `conversation_id = ''`.
- **Incremental Sync**: `history_cursors` tracks synchronization per conversation, processing entries in ascending order.
- **Search Mechanics**: Terms shorter than 3 characters fall back to `LIKE`. Search results rank by relevance and truncate at ~1,500 tokens.
- **Source Boundaries**: Tool arguments and results index as complete units without arbitrary truncation. The tool `read_history` paginates raw transcripts by reference.

**Consequences**: The History index can be deleted and rebuilt at any time. Rebuilding does not lose business facts. Events provide a consistent audit log for approvals, runs, and tasks.

---

## D7 · Schedules Advance via Single-Transaction Triggers; Wakeups Contain Goal States and Tasks Only

When a schedule fires, the service performs three actions in a single transaction: creates or reuses a Task, writes a notification to the Goal conversation, and advances `next_fire_at` from the current time. Missed triggers during system sleep or shutdown merge into one execution.

**Context**: Distributing task creation, notification delivery, and schedule advancement across multiple transactions risks duplicate runs, lost wakeups, or storm replays after crashes.

**Decision**:

- Single transaction writes Task, Notification, and `next_fire_at`.
- Deduplication keys use trigger slots: `dedupe_key = sched:<scheduleId>:<fireTimeISO>`.
- Advances timestamps from `now`: `next_fire_at = cron.next(now)`.
- Wakeup notifications contain Goal objectives, success criteria, constraints, state, next action, and Task description only; they do not duplicate conversation histories.
- Daily budgets enforce limits based on midnight in the local timezone. Overages create a single `blocked` Task with deduplicated user notices.
- Internal timers sleep until the earliest `next_fire_at` (capped at 60 seconds).

**Consequences**: Schedulers decide when to wake; supervisors decide what actions to take. Repeated triggers become idempotent operations. Missing runs during shutdown do not trigger backlog storms.

---

## D8 · Telegram Adapter: Long Polling, Allow-Listed Chats, and Cursor-Tracked Forwarding

The Telegram adapter runs inside the service using long polling, allow-listed chat authorization, and stable session mappings. Supervisor replies forward back to the originating chat without public ingress endpoints.

**Context**: Channels require message delivery without exposing public webhook ports. The adapter must fail independently without halting core services if tokens are absent.

**Decision**:

- Uses Bot API `getUpdates` with exponential backoff on network errors. Offset updates commit to SQLite after Durable confirms turns.
- Enforces an allow-list via `TELEGRAM_ALLOWED_CHAT_IDS`. Unauthorized chats are ignored.
- Tracks active scopes per chat in `telegram_chats`. Switching scopes via `/scope` routes messages to distinct conversations.
- Forwards assistant messages using persistent cursors (`telegram_forward_cursor`). Messages split along line boundaries under 4,096 characters. Streaming fragments, thinking traces, and tool calls are filtered out.
- The adapter interface isolates network operations for testing with mock clients.

**Consequences**: Approvals and Goal notifications can reuse this channel (command entry points are reserved in the adapter, and proactive push reuses the forwarding pipeline). Outbound forwarding achieves at-least-once delivery across process lifecycles: if the process crashes between a successful send and cursor persistence in the database, one duplicate message will be resent upon restart. Telegram provides no client-side deduplication key, which represents the theoretical lower bound of polling. Permanent remote errors (such as bot blockings) pause subsequent forwarding for that conversation and log errors on every trigger rather than skipping silently. Non-text messages and forum topics are unhandled. When the allow-list is empty, the adapter starts but admits no chats.

---

## D9 · Package App and Background Service Together; Install Separately; Coordinate Switches with an Independent Updater

Each release packages the Electron desktop application, companion background service, and an independent updater inside an application bundle. The background service runs independently under launchd, storing data in a stable directory. Upgrades use an external updater to coordinate backups, process termination, file swaps, and startup verification.

**Context**: Replacing the application bundle does not update the installed launchd background service. Running mismatched versions causes protocol and database schema conflicts.

**Decision**:

- Bundles include the Electron application, service payload, pinned Node runtime, and updater binary.
- Application bundles live in `/Applications`; data and service releases reside in `~/Library/Application Support/Tian Agent/`.
- Upgrades execute as multi-step transactions: validate manifest hashes → verify idle state and enter maintenance → terminate older processes and snapshot databases → launch the new service in maintenance mode → replace application bundle → verify client mounting → commit and clear maintenance.
- Failures prior to commit restore previous application bundles, services, and database snapshots.

**Consequences**: The system ensures version synchronization between clients and services. Upgrades preserve transactional safety with automated rollback capabilities.

---

## D10 · Skill Injections Require Manual User Approval; Experience Extraction Produces Candidates Only

Skills follow the lifecycle `candidate → approved → retired / superseded`. Transitions from candidate to approved require explicit user approval. Agents have no write permissions on the `skills` table. Dispatches match approved skills by name or keyword, and `runs.injected_skills` records what was injected.

**Context**: Unverified runs must not establish global operational rules. Experience extraction must not inject unapproved instructions into future prompts.

**Decision**:

- The `skills` table stores multi-version records keyed by `(scope_id, name, version)`. Approving a new version supersedes the prior version without deleting history.
- Approvals are restricted to user actions via IPC or UI.
- The `ExperienceExtractor` interface defaults to a deterministic rule-based extractor: completed runs with documented step sequences produce candidate skills. Failed runs produce no candidates.
- Two-tier injection defense: matching approved skills records entries in `runs.injected_skills`; runtime prompt rendering re-verifies that target records maintain `approved` status before outputting instructions.
- If a run fails while using a skill, the skill marks `verification = failed`, enabling manual rollback to earlier approved versions.

**Consequences**: Workers receive only user-approved procedures. The system maintains auditable records of all injected guidelines.

---

## D11 · Improvement Log: Writable by User and Chief; Automatic Fingerprinting for System Errors

The `improvements` table records product issues, operational friction, ideas, and wins in `tian.db`. System exceptions log to this table automatically and aggregate via error fingerprints. It remains separate from audit Events and Memory.

**Context**: Audit events record factual state changes, not usability friction or bug reports. Log files redirected to `service.log` lack structured deduplication and UI visibility.

**Decision**:

- Entries belong to a scope and contain `kind`, `status`, severity, summary, details, and source (user, chief, system).
- Both the Chief tool `log_improvement` and the desktop Log view write to the same table.
- A centralized `reportIssue` sink captures errors across startup, listeners, Inbox, History, notifications, scheduler, runs, and Telegram. Matching fingerprints aggregate by incrementing `occurrences`. Text redacts authentication tokens and secrets.
- Automatic capture is best-effort and does not block primary application flows.
- Promoting an improvement creates a pending Task with deduplication key `improvement:<id>` in the same transaction.

**Consequences**: Repetitive errors collapse into actionable counts. Friction and bug reports convert into tracked tasks with one click.

---

## D12 · Project Manager: Dedicated Persistent Session and Delegation Tasks

Each project maintains a dedicated persistent conversation for a Project Manager agent. The Chief delegates project management by creating discrete Tasks assigned to the Manager, who executes work, concludes tasks, and reports back.

**Context**: Direct Chief oversight of all project details cluttered conversation transcripts. Verbal delegation without structured IDs made tracking pending work difficult.

**Decision**:

- Delegations create a Task with `assignee = 'manager'` and `report_to = <chiefConversationId>`, log a delegation message, and wake the Manager. Concluding the Task notifies the Chief.
- The `manager_messages` table stores threads with `kind` (delegation, message, question, answer, report), `task_id`, and `reply_to`. Managers query supervisors via `ask_chief`, which blocks until an answer arrives.
- Tool constraints restrict Managers to their project scope: task execution, Run dispatches, and project memory. Managers have no shell or coding tools.
- Tian can converse with Project Managers directly via `openManager(projectId)`. During Tian turns, `ask_chief` is blocked, and tasks assigned by Tian conclude quietly without notifying the Chief.

**Consequences**: Work delegation becomes an auditable task item. Routine project work bypasses the Chief while maintaining clean escalation pathways for delegated goals.

---

## D13 · Run-Level Worker Models and Thinking Levels

Supervisors can specify distinct models and thinking levels per Worker Run during dispatch rather than adhering to global settings.

**Context**: Complex tasks warrant advanced models and higher reasoning efforts, whereas simple operations run faster and cheaper on lightweight models.

**Decision**:

- Dispatches accept optional `model` and `thinking_level` parameters. Omitting them inherits default settings.
- The service resolves and validates worker configurations against the Magpie model catalog before creating Runs.
- Columns `model` and `thinking_level` store configurations in `runs`, and values publish inside `run.dispatched` events.
- Supervisor prompt headers list available models and supported thinking levels.

**Consequences**: Supervisors assign appropriate compute resources to specific tasks without modifying global configurations.

---

## D14 · Manager Naming: Labels vs Session Bindings

Projects support naming their Project Manager. Names serve as conversational labels while session bindings define existence.

> Superseded by [D18](#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects): Manager naming is mandatory during project creation, eliminating unconfigured states.

---

## D15 · Fold Duplicate Dispatches and Support Manual Run Interruption

Identical dispatches from the same supervisor collapse into a single Run. Users can manually stop active Runs in the context pane without deleting worktrees.

**Context**: Accidental duplicate dispatches waste compute resources and confuse supervisors. Furthermore, users lacked safe cancellation options between waiting for completion and discarding the worktree entirely.

**Decision**:

- Content-based deduplication: dispatches inspect active runs with matching prompts, projects, and supervisors, reusing active Runs rather than spawning duplicates.
- Manual stop command: `stopRun(id)` terminates timeouts, aborts worker sessions, snapshots the worktree with a commit, marks status as `interrupted`, and posts notifications.
- Worktrees, diffs, and review statuses remain intact: users can inspect changes, land, ship, discard, or resume with follow-up attempts.

**Consequences**: Duplicate dispatches fold cleanly. Users gain safe cancellation tools that preserve partial work.

---

## D16 · Run Progress Visibility and Attempt Interruption

Supervisors can inspect real-time Worker progress and stop active attempts gracefully without shell permissions.

**Context**: Supervisors could not tell whether a running Worker was making progress or hanging, and lacked non-destructive cancellation tools.

**Decision**:

- `run_progress(id)` returns status, attempt numbers, elapsed time, deadlines, recent assistant text, and recent tool calls read from transcripts.
- `stop_run(id, reason?)` uses the non-destructive stop pipeline from D15, setting status to `interrupted` while keeping worktrees intact for review.
- Interrupted attempts trigger experience reviews with a `stopped` flag, extracting valid procedure candidates without marking injected skills as failed.

**Consequences**: Supervisors safely manage long-running tasks and abort stuck runs without destroying partial code changes.

---

## D17 · WeChat Integration via Official iLink Protocol

WeChat operates as an additional messaging channel via Tencent's official iLink Bot protocol (the ClawBot plugin), using QR login and long polling.

**Context**: Reverse-engineered client hooks or unofficial web protocols present stability and compliance risks. The official iLink protocol provides stable HTTP/JSON communication.

**Decision**:

- Implements integration via the `@wechatbot/wechatbot` SDK behind a `WechatClient` interface.
- Requires allow-listing via `WECHAT_ALLOWED_USER_IDS`.
- Mirrors the Telegram architecture: stable session bindings, command routing, and cursor-tracked forwarding.
- 24-Hour Keepalive: Sends minimal single-character probes (`.`) during long periods of silence (after 11 hours of inactivity with >30 minutes remaining in the window) to preserve reply windows without exhausting message quotas.
- Displays QR codes in Settings → Channels for easy pairing.

**Consequences**: WeChat acts as an authorized channel alongside Desktop, Telegram, and Inbox, sharing unified scope memory. The keepalive strategy balances open reply windows against quota consumption: at worst, an approximate one-hour blind spot remains (11-hour interval + 30-minute margin), and the window inevitably closes if the user remains silent after two heartbeat probes, requiring an inbound user message to reopen. Limitations: No group chat or slash command menus. Whether probing truly extends the 24-hour reply window depends on Tencent backend server behavior (the developer community confirmed only that bot-originated messages do not refresh tokens; extending windows via probes remains unverified). Therefore, probe rejections are handled as normal execution branches rather than fatal errors.

---

## D18 · Memory Ownership by Role: Chief Owns Global, Managers Own Projects

The Chief writes Global memory only (facts about Tian and facts shared across projects). Each Project Manager exclusively maintains detailed memory and notes for its project. Manager naming is mandatory during project registration.

**Context**: Allowing the Chief to write to any scope created two agent writers for project memory and bloated Chief prompt contexts.

**Decision**:

- Memory writing tools (`remember`, `revise`, `forget`, `select`, `deselect`) lock to agent roles: the Chief writes Global memory; Managers write project memory.
- Core Memory injection: Chief sessions inject Global Core Memory only; Manager sessions inject Global Core Memory plus their project's Core Memory.
- Cross-scope queries are read-only and marked with ownership headers.
- Project creation requires a Manager name, instantly establishing the dedicated Manager conversation.
- Project deletion guards: because Manager conversations create with the project, `removeProject` deletes the project and binding only if the Manager conversation has zero entries and no other conversations exist. If any transcript content exists, the deletion request is explicitly rejected to protect transcripts and memory.
- Protocol: `SERVICE_PROTOCOL` increases to 10 (mandatory `addProject` `managerName` argument and `ScopeInfo.managerName`).

**Consequences**: Establishes a single agent owner for each scope's memory. Chief prompts do not grow with the number of registered projects, and project details concentrate inside the Manager context. Tian's preferences no longer get trapped inside a project scope. Trade-offs: The Chief must query read-only or ask the Manager when recalling project details (one extra hop); the Chief cannot fix project memory directly and must inform the Manager instead. Memory Worker candidate extraction and the UI Memory panel continue operating per scope without role restrictions.
