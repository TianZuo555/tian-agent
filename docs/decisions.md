# Architecture Design Decisions

**English** | [简体中文](zh/decisions.md)

This document records architectural decisions that are **difficult to reverse and critical to understand**: why this architecture was chosen and what trade-offs were made. Implementation details and operational guides appear in [architecture.md](architecture.md), [memory.md](memory.md), [data.md](data.md), [agent-work.md](agent-work.md), [channels.md](channels.md), [service.md](service.md), and [improvement-log.md](improvement-log.md).

Each decision forms a section numbered D1 through D30, organized by domain. Current metadata: `DATABASE_VERSION = 13`, `SERVICE_PROTOCOL = 13`; the target client-facing API is Pi Server API v1 ([spec/protocol.md](spec/protocol.md)). Every schema change bumps the version; an older database is snapshotted for recovery and recreated empty, and the target server governs schema and protocol changes with upgrade transactions (see [service.md](service.md#service-upgrades)).

The earlier `docs/adr/` directory has been consolidated into this document:

| Former ADR | Current Section                                                        |
| ---------- | ---------------------------------------------------------------------- |
| 0001       | D1 Three-pane shell                                                    |
| 0002       | D2 Local Magpie gateway (superseded by D21)                            |
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
| —          | D19 Memory evidence, confirmation, and similarity                      |
| —          | D20 Notification delivery and Manager handoffs leave the Service class |
| —          | D21 Pluggable model providers                                          |
| —          | D22 Unified Seatbelt sandbox for Worker commands                       |
| —          | D23 Tian Sky visual language for the Native Shell clients              |
| —          | D24 Pi server is the single writer; clients are renderers              |
| —          | D25 Native Shell (NSH) is the client framework for six targets         |
| —          | D26 Tailscale is the trust boundary                                    |
| —          | D27 Chat-first information architecture: bots are Pi roles             |
| —          | D28 Pi Server API v1: one frame set, two transports                    |
| —          | D29 PostgreSQL is the server store                                     |
| —          | D30 Dreaming proposes, the user decides                                |

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

> Superseded by [D21](#d21--model-providers-are-pluggable-magpie-is-one-provider).

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
- Actors, sources, and confirmations record separately. `source: "user"` confirms only when stored text equals the whole current user input after whitespace normalization, or when the whole input is an anchored `记住：<text>` / `remember: <text>` save request with exactly equal text. System wakeups, worker outputs, notifications, excerpts, translations, and summaries fall back to `agent_inferred`. Confirmation records live in `memory_confirmations` and evidence in `memory_evidence` (see D19).
- Exact string deduplication per scope returns existing `#seq` values, appending evidence records if sources differ.
- Automatic extraction produces `candidate` records that never enter prompt injections until explicitly approved. Promotion only makes a candidate active; Core still needs an explicit `select`. Ordinary candidates never set a supersede target automatically. Only the user's explicit "Confirm this replaces #seq" supersedes a fact in the same transaction, and promotion fails rather than overwrite a target that changed while the candidate was pending (see D19).

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
- Forwards assistant messages using persistent cursors, one per chat and conversation (`telegram_recipient_cursor`). Several chats can share one Manager conversation, and each one gets every reply. A chat that joins a conversation starts at its newest entry; it does not get the earlier transcript. Messages split along line boundaries under 4,096 characters. Streaming fragments, thinking traces, and tool calls are filtered out.
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
- Only the Manager dispatches and supervises Workers (`agent_messages` senders `manager` / `worker`); the Chief delegates and steers through `send_manager_msg`. A project scope holds only its Manager and Worker conversations — channel entry points (`/scope <project>`, `createConversation` under a project) route to the Manager, and the Chief's History reads stay in Global.
- Tian can converse with Project Managers directly via `openManager(projectId)`. During Tian turns, `ask_chief` is blocked, and tasks assigned by Tian conclude quietly without notifying the Chief.

**Consequences**: Work delegation becomes an auditable task item. Routine project work bypasses the Chief while maintaining clean escalation pathways for delegated goals.

---

## D13 · Run-Level Worker Models and Thinking Levels

The dispatching Project Manager can specify distinct models and thinking levels per Worker Run during dispatch rather than adhering to global settings. (Before M6 the Chief could dispatch too; see [D12](#d12--project-manager-dedicated-persistent-session-and-delegation-tasks).)

**Context**: Complex tasks warrant advanced models and higher reasoning efforts, whereas simple operations run faster and cheaper on lightweight models.

**Decision**:

- Dispatches choose the worker one of two mutually exclusive ways: an `intent` (a named configuration in Settings → Workers: runtime, model, thinking level, purpose) or an explicit `runtime` + `model` (+ `thinking_level`). Passing both is an error; passing neither applies the project's default Intent (`projects.default_intent`, which replaced `projects.agent_kind` in schema v10). An empty default means Pi with the app-wide model.
- The service resolves the choice into a stored `runtime`/`model`/`thinking_level` triple before the Run exists, and validates Pi models against the provider catalogs — bad ids never create a run.
- Columns `runtime`, `model` and `thinking_level` store the resolved values in `runs`, and they publish inside `run.dispatched` events. The triple is fixed for the run's whole life: follow-up Attempts and restart resumes reuse it.
- The Manager's `<state>` lists the intents (with their purposes) and the Pi models with supported thinking levels.

**Consequences**: Managers assign appropriate compute resources to specific tasks without modifying global configurations, and named intents make repeated choices a single token instead of a parameter tuple.

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
- Cross-scope reads are asymmetric: the Chief reads a project's Memory and Notes read-only with ownership headers; the Manager's only view of Global is the injected Global Core — its `recall` has no scope switch.
- Project creation requires a Manager name, instantly establishing the dedicated Manager conversation.
- Project deletion guards: because Manager conversations create with the project, `removeProject` deletes the project and binding only if the Manager conversation has zero entries and no other conversations exist. If any transcript content exists, the deletion request is explicitly rejected to protect transcripts and memory.
- Protocol: `SERVICE_PROTOCOL` increases to 10 (mandatory `addProject` `managerName` argument and `ScopeInfo.managerName`).

**Consequences**: Establishes a single agent owner for each scope's memory. Chief prompts do not grow with the number of registered projects, and project details concentrate inside the Manager context. Tian's preferences no longer get trapped inside a project scope. Trade-offs: The Chief must query read-only or ask the Manager when recalling project details (one extra hop); the Chief cannot fix project memory directly and must inform the Manager instead. Memory Worker candidate extraction and the UI Memory panel continue operating per scope without role restrictions.

---

## D19 · Memory Evidence, Confirmation, and Similarity: Evidence Supports, Confirmation Reviews, Similarity Only Relates

The factual basis of a memory and whether the user reviewed it are two different things. Lexical or embedding similarity cannot prove that two statements mean the same thing or contradict each other, so similarity no longer discards candidates or picks replacement targets automatically.

**Context**: The old implementation treated strict equality between `source: "user"` and the whole user input as the only confirmation rule, so “记住：以后请用中文回答” distilled to “以后请用中文回答” fell back to `agent_inferred`. Relaxing the rule to substring matching would confirm negated or quoted content. At the same time, `similarity >= 0.8` counted as a duplicate and `0.45–0.8` within the same kind counted as a conflict. As a result, “use PostgreSQL” and “not use PostgreSQL” overwrote each other, only one of “coffee with sugar” and “without sugar” survived, and `Ubuntu with PostgreSQL` wrongly superseded `Ubuntu with Redis`.

**Decision**:

- `memory_evidence` stores multiple pieces of evidence: the actual `source_ref`, the original `excerpt`, the source actor, the `direct` / `paraphrase` / `inference` relation, and the observation time. The service validates tool-supplied `evidence_ref` / `excerpt`: the reference must exist and belong to the write scope, and the excerpt must occur in the original text. A current-input reference binds the trigger; history and notification references supply evidence only and cannot authorize user confirmation.
- `memory_confirmations` stores separate confirmation records: `explicit-save` (a verified explicit save request), `review` (Memory panel review), and `legacy` (upgrade migration). `trust_level` and `verified_at` derive from confirmation records; a model passing `source: "user"` cannot authorize itself.
- The confirmation rule stays strict equality. It additionally accepts only whole inputs anchored as `记住：<text>` / `请记住：<text>` / `remember: <text>` / `please remember: <text>` with no quotes in the text. `不是…` (negations), quoting others, excerpts, and rewrites still do not confirm. Only an anchored save request is a tool-side confirmation; equality with the whole input proves the source (`source: "user"`) only, and the item stays a candidate until panel review activates it.
- Similarity only lists related facts (`related`) in the review UI. It is never used for automatic deduplication, conflict detection, or promotion. Exact deduplication preserves case, numbers, negation, and conditions.
- An ordinary repeat of a candidate only adds evidence and never promotes it. Users confirm an existing candidate through the Memory panel or an anchored save request. Promotion is separate from Core selection; ordinary promotion never enters Core.
- Replacement comes only from an explicit choice. `supersedes` on a candidate is a review hint; ordinary confirmation and promotion (including the `promote` tool) only activate the candidate and never supersede the target implicitly. Only the panel's "Confirm this replaces #seq", which submits the target identity, supersedes in the same transaction. An unconfirmed `revise` first checks that the target exists and is not historical; otherwise it fails instead of writing an unrelated new fact.
- Candidate commits recheck source existence and the old fact's state inside the transaction. If the old fact was revised during extraction, promotion fails and asks for a fresh review. Dismissals suppress the exact text; whole-history similarity never permanently suppresses a new correction.
- Facts may carry `conditions` (environment / subject / version), so prod PostgreSQL and test SQLite coexist. `observed_at` (source time), `verified_at` (user review time), and `updated_at` (last state change) are separate. `valid_until` applies only to memories with an explicit validity period and is enforced in default reads and Core rendering: expired items cannot be selected into Core, and selected items leave Core and default `recall` when they expire. Trust never rises with repetition count, and preferences do not decay uniformly.
- Uncalibrated `confidence` is no longer written or shown, to avoid false precision; the upgrade clears old values. Legacy data keeps its text, status, versions, and candidate links and receives a `legacy` evidence record; original `user_confirmed` rows also receive a `legacy` confirmation record.

**Consequences**: Memory review becomes a normal entry point (the right-pane Memory tab), with expandable evidence, confirmation records, related facts, and times. All write paths (tools, candidates, panel) share one set of evidence, confirmation, and status rules. Trade-offs: lexical retrieval still needs an explicit query strategy and cannot pretend to understand semantics, and the user must decide whether a related fact is replaced instead of the system guessing.

---

## D20 · Notification Delivery and Manager Handoffs Leave the Service Class

The resident service is a composition root. It does not own delivery loops or manager conversations.

**Context**: `Service` mixed lifecycle, channels, sessions, inbox scans, notification delivery, goal commands, memory panel commands, and manager handoffs in one file. The notification loop held request coalescing, target selection, run-message copies, delivery, events, and error isolation. Manager delegation held conversation binding, task creation, thread messages, wakes, and idempotency. A change in one flow needed edits beside unrelated flows.

**Decision**:

- `NotificationOutbox` (`worker/outbox.ts`) owns the durable queue drain: one pass at a time, request coalescing, target resolution and persistence, per-notification failure isolation, and pause/resume for maintenance and shutdown.
- `ManagerLink` (`worker/manager-link.ts`) owns the one manager conversation per project: creation, startup reconciliation, wakes, delegated Tasks, and Chief → Manager messages.
- `Service` composes both and supplies their dependencies. It keeps lifecycle, channels, sessions, goals, runs, and UI commands.
- These are implementation parts. They add no Service, Task, Run, or Manager concept.

**Consequences**: Delivery and handoff rules have direct tests and single owners. The service class loses about 170 lines. Behavior stays the same: the queue is durable, failed deliveries retry on the next request or interval, and manager operations stay idempotent. Trade-off: new flows must queue through `service.outbox` and wake managers through `ManagerLink`, not through ad-hoc delivery code.

---

## D21 · Model Providers Are Pluggable; Magpie Is One Provider

Status: Accepted. Supersedes [D2](#d2--route-models-through-local-magpie-gateway).

Magpie stops being the only route for model traffic. It becomes one provider among several, and the user chooses the providers for Tian's own agents (Chief, Manager, Pi Worker). External Worker runtimes (Codex, Cursor, and others) manage their own models, credentials, and billing.

**Context**: D2 routed all model traffic through the local Magpie gateway. Two changes break that rule: external coding agents run on their own backends (Cursor CLI cannot point at a custom endpoint), and the user wants to choose providers other than Magpie.

**Decision**:

- Tian's own agents run on Pi and use providers that the user selects. Magpie is one of them.
- An external Worker runtime receives an opaque model string and uses its own authentication. Tian does not validate it against a provider catalog; [D13](#d13--run-level-worker-models-and-thinking-levels) validation applies to Pi Workers only. Token usage is recorded when the runtime's event stream reports it.
- Tian owns provider configuration. A Settings → Providers page manages it. Non-secret fields (provider type, base URL, enabled models) live in `settings.json`; secrets live in a 0600 file in the data directory, written only by the service, like `service.env`. At startup the service registers each configured provider with Pi. Tian does not read Pi CLI state (`~/.pi/agent/auth.json`), so changes in the Pi CLI do not affect the service. The UI never echoes a secret (last characters only).
- Magpie becomes a preset provider entry. `MAGPIE_*` environment variables stay as a compatibility input for one release.
- The Chief and every Manager always run as Pi Durable conversations; only Workers have a configurable runtime. They depend on custom tools, durable replay, Core Memory injection, and one long-lived conversation, which external CLIs do not provide.
- Settings holds a Chief model and a default Manager model; each project may override its Manager's model. Intents apply to Workers only. A model change applies from the next turn of the existing conversation (no new conversation) and invalidates the prompt prefix cache once.
- Tian implements pi-ai's `CredentialStore` (`read` / `list` / `modify` / `delete`) on top of its 0600 secret file. API keys and OAuth tokens share this store; pi-ai refreshes OAuth tokens inside `modify` under a lock.
- OAuth subscriptions (Anthropic Claude Pro/Max, OpenAI Sign in with ChatGPT, GitHub Copilot, OpenRouter) log in through `models.login(provider, 'oauth', { prompt, notify })`. The Settings → Providers page shows the `auth_url` / `device_code` events and answers the prompts.
- Built-in providers ship their catalogs with pi-ai. Only dynamic catalogs (Magpie and other gateways) need discovery at startup and an offline cache, as D2 does for Magpie today.
- External CLI credentials: the CLI's own sign-in state comes first (for example `codex login`); enabling a runtime in Settings runs an installed-and-signed-in check, and only a passing runtime can be enabled. A runtime that needs an API key gets it in Settings; the key is stored per runtime in the 0600 secret file and passed only to that runtime's process through the environment allow-list. `service:env` is not extended: runtime credentials never enter the service's global environment. An adapter reports an expired sign-in as "sign-in required" in the UI, not as a generic failure.

**Consequences**: Tian depends on pi-ai for provider auth and catalogs instead of one gateway. The service holds more secrets (provider keys, OAuth tokens, runtime keys) in one 0600 file, so the file and the environment allow-list become security-critical. Usage and cost tracking is per provider and is missing for external runtimes that do not report usage.

## D22 — Unified Seatbelt sandbox for Worker commands

Status: Accepted.

Every Worker command — for Pi Workers and external runtimes alike — runs inside one Tian-owned macOS Seatbelt profile, generated per Run at `<dataDir>/sandbox/<runId>.sb`. Projects opt out with `sandboxMode = 'off'`; the default is `workspace-write` for new and existing projects.

**Context**: the worktree boundary was instruction-only (`agent-work.md`); PRD §13 question 8 called for a real OS-level restriction. Each CLI also brings its own sandbox (Codex: Seatbelt), so two nested sandboxes would conflict.

**Decision**:

- `SandboxedExecutionEnv` wraps the worker `ExecutionEnv`: string commands run as `sandbox-exec -f <profile> /bin/bash -c <cmd>`, argv commands as `sandbox-exec -f <profile> <argv…>`; in-process file methods enforce the same rules in service code (deny/allow by canonical path), because Seatbelt cannot see them. The env factory applies the wrapper only to conversations that map to a Run and only when the project enables the sandbox; Chief and Manager conversations are never sandboxed.
- External runtimes: the adapter rewrites its spawn argv under `sandbox-exec` and relaxes the CLI's own sandbox (`codex --sandbox danger-full-access`) — the outer profile is the single boundary; the CLI's state dir (`$CODEX_HOME`, default `~/.codex`) joins the writable set, while its `config.toml`, `AGENTS.md`, and `AGENTS.override.md` stay read-only.
- Profile rules: deny reads/writes on the service data dir and common credential paths; deny writes everywhere then re-allow the work root, the Run's Git metadata (`git rev-parse --path-format=absolute --git-dir`), temp dirs, toolchain caches, and per-project extra roots; the main checkout stays read-only; the service socket is always denied; `sandboxNetwork = off` denies external network while localhost stays open.
- A startup self-test (`sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`) gates availability; when the sandbox is required but unavailable the Run fails closed — no silent unsandboxed fallback.
- The worker instructions tell the model that writes outside the working directory fail by design; `run.dispatched` records the sandbox mode and network flag.

**Consequences**: `sandbox-exec` is deprecated but still present on macOS; the self-test fails closed if Apple removes it. Nested sandbox conflicts with SwiftPM, Xcode builds, Chromium/Playwright, or the CLI's own sandboxing may still need per-project `off` or extra writable roots — those escape hatches are project settings, not new decisions.

## D23 — Tian Sky visual language for the Native Shell clients

Status: Accepted.

The Native Shell clients (macOS and iOS first) use the "Tian Sky" visual language in [design-language.md](design-language.md). The interactive mockup [`docs/design/client-mockup.html`](design/client-mockup.html) is its visual reference. The Electron client keeps the earlier ink-monochrome language until it is removed.

**Context**: The ink-monochrome language reserved colour for warnings and diffs, so the Chief, the Managers, and the Workers looked the same; the user had to open Context → Runs to see who was working ([persistent-agent-ui.md](research/persistent-agent-ui.md)). The NSH client is chat-first and must work on a phone, where a raw Worker CLI stream is unreadable and a screen holds little more than one conversation.

**Decision**:

- Surfaces stay achromatic. Colour carries only identity (the Chief's dawn-gradient orb, one hue per Manager), state (working, waiting, failed), and diff lines.
- One light source: the Chief, at the top left. Five elevation levels (L0–L4). Cards get a top rim highlight and no drop shadow; only floating layers cast shadows. Glass uses NSH `glassEffect`, with an opaque fallback and a glass-intensity setting.
- Every animation reports a state. Under reduced motion, state is shown by colour only.
- Workers appear as four phases (Understand, Edit, Verify, Report) that the server derives from tool calls with fixed rules. The raw CLI output is not shown.
- Chat body text is 15 px / 1.7 (14 px on the phone), at most 720 px wide. The UI spec uses this size.
- Selected rows use a fill only, never a left accent bar.
- Settings are grouped by owner: Agent (the account), Personal (this device), Operations (the server).

**Consequences**: The research recommendation not to copy coloured avatars is narrowed: identity now uses colour, limited to one hue per Manager and the single gradient of the Chief. The UI spec takes the 15 px / 1.7 size. D1's three-pane layout carries over to the macOS client; its `@pierre/diffs` detail is replaced by NSH `DiffView`. Phosphor remains the only icon set. Manager hue assignment and iOS app-extension support stay open ([design-language.md §14](design-language.md#14-open-questions)).

---

## D24 · Pi Server Is the Single Writer; Clients Are Renderers

The product becomes server-first: one Pi server owns all durable state, and every client is a renderer that submits idempotent intents. This supersedes the Electron-client half of D3; the TypeScript server half stays.

**Context**: The current client is an Electron app on the same Mac as the resident service, reached through a private Unix socket. That model cannot serve several devices: a phone, a web build, or a second computer has no socket, no file permissions, and no local database. Product logic also lives in the React renderer, which makes a second client a second implementation.

**Decision**:

- The Pi server is the only writer of durable state: the application database (PostgreSQL per D29), Pi Durable conversations, tools, Runs, schedules, and model keys. It runs on one machine and answers one protocol.
- Clients hold a cache and render server snapshots. They never compute durable state and never keep a write queue; a failed write is retried with the same `requestId`.
- Two transports, one frame set: a Unix socket when the client runs on the server machine, and WSS otherwise.
- Read state, presence, and unread counts are server state, so several devices agree without a sync service.

**Consequences**: The product reaches macOS, Windows, Linux, iOS, Android, and the web with one protocol. The server becomes a deployable thing with installs, upgrades, backups, and an incident surface, which the operations spec now covers. Authentication moves from file permissions to the transport ([D26](#d26--tailscale-is-the-trust-boundary)). The desktop app becomes one client among several, so a regression there is no longer a server outage.

---

## D25 · Native Shell (NSH) Is the Client Framework for All Six Targets

**Context**: React and Electron cover three desktop operating systems. Phones and the web need separate stacks, and the existing renderer depends on the React ecosystem (coss, Streamdown, Vite) that has no native counterpart.

**Decision**:

- One TSX UI on Native Shell, rendered by each platform's native backend: AppKit, Win32, GTK 4, UIKit, Android views, HTML.
- Platform code lives in a Rust host crate: transport, cache, keychain, notifications, menus, packaging. The TSX module keeps product logic and no platform branches.
- Electron is removed after the NSH client reaches parity, not before.

**Consequences**: One UI codebase instead of three. The trade-offs are real: TSX runs in QuickJS under a capability sandbox with no Node APIs, so the protocol transport must live in Rust; the React component library is replaced by `nsh/base` plus Tailwind; six packaging and signing pipelines replace one. NSH is young, so the client keeps a mixed Rust/TSX project and the server stays independent of the client framework, which limits the blast radius of a framework change.

---

## D26 · Tailscale Is the Trust Boundary

The server is reachable only from the owner's own devices on the tailnet, identified by Tailscale. There is no password system, and the server is never exposed to the public internet.

**Context**: Single user with several devices. A remote client cannot rely on Unix socket permissions, and a personal server should not grow an account service to serve one person.

**Decision**:

- The server verifies every remote peer with `tailscaled` `WhoIs`, records it as a device, and refuses revoked devices.
- A Tailscale ACL grants the owner's explicit identity (not `autogroup:member`) port 8787 on the server node and nothing else; Funnel stays off.
- TLS comes from a Tailscale certificate for the server's MagicDNS name; the WebSocket listener binds only to the tailnet interface.
- The first handshake creates a device record; revocation is per device and per node.

**Consequences**: Onboarding is `join the tailnet and open the app`, with no pairing codes or token lifecycle. Multi-user support would need a real authentication and tenancy layer, so it stays out of v1. The web build is tailnet-only by construction. Tailscale becomes a hard runtime dependency for remote clients; local clients keep the Unix socket path.

---

## D27 · Chat-First Information Architecture: Bots Are Pi Roles

**Context**: The current shell has four top-level views (Chat, Goals, Skills, Inbox) around a three-pane workbench. The product direction is a chat app of the kind that talks to bots: one list of conversations, one conversation at a time.

**Decision**:

- The home surface is the conversation list; the main surface is one conversation. Chat, Goals, Skills, and Inbox are no longer peers.
- A bot is the conversation identity of a Pi role: one Chief, one Manager per project, one Worker per Run. No external bot registry, no user-defined personas in v1.
- Goals, Inbox, Skills, Memory, Usage, and Settings move to the inspector, the command palette, Settings pages, or inline cards in a conversation.
- Worker Runs appear as nested threads under the Manager that dispatched them.

**Consequences**: Fewer surfaces and a natural mobile layout. Dashboard-style visibility is lost; badges, inline cards, and the palette have to carry discovery. The role model and its commands stay unchanged, so this is a presentation decision, not a domain change.

---

## D28 · Pi Server API v1: One Frame Set, Two Transports, Required Idempotency Keys

**Context**: Protocol 13 is Unix-socket only. Events are whole channel snapshots without a sequence or revision, so a reconnecting client cannot tell what it missed. `requestId` is optional and only on `submit`. The server accepts 1 MiB frames while the client allows 16 MiB, so a valid client frame can drop the connection. Protocol 14 is the breaking change.

**Decision**:

- Keep one frame set over both transports: `hello`/`welcome` with a protocol range and capability list, `request`/`result`, `event` with `seq` and `revision`.
- Resume by `seq`; a gap or an unavailable cursor forces a bounded full sync instead of patching events.
- Publish one frame limit (4 MiB), one in-flight request limit, and a streaming rate.
- Require a stable `requestId` for every write and deduplicate it on the server (7 days or the intent's turn plus 24 h).
- Add commands the chat-first client needs: `markRead`, `pageMessages`, `searchConversations`, `listDirectory`, `listDevices`, `revokeDevice`.

**Consequences**: Reconnect becomes cheap and correct, and the client can always recover from a lost frame. Every client must generate intent keys that survive retries and restarts, which is a client-core responsibility, not a view concern. The server supports two protocol majors, so client and server releases can move independently. `pickDir` stops being a server command for remote clients: project paths are server paths, browsed through `listDirectory`.

---

## D29 · PostgreSQL Is the Server Store

The target server stores application data in PostgreSQL running on the server machine, reached through a local socket. SQLite remains only inside Pi Durable until a Postgres storage backend passes its conformance suite.

**Context**: The server-first design makes storage a product surface: several clients read the same state, backups and upgrades become operational duties, and multi-user support may follow. SQLite served the single-process desktop model well, but it cannot answer concurrent readers off-process, has no standard operational tooling, and its SQL dialect (FTS5, `PRAGMA`) would leak into every future backend. Two hard constraints limit how far Postgres can go today: Pi Durable ships SQLite, JSONL, and memory backends only, and its `Storage` interface is the documented seam for a new backend; and the current application database is `node:sqlite` (synchronous) with 400 SQL call sites, 35 transaction sites, and two FTS5 tables.

**Decision**:

- The target server uses PostgreSQL for application data (projects, tasks, goals, memory, Inbox, Runs, settings, events). Postgres runs on the server machine and is reached through a local socket; it is not exposed on the tailnet and has no remote clients.
- The server process remains the only writer. A Postgres connection pool does not make multiple server processes supported.
- Pi Durable moves to Postgres only through a `Storage` backend that passes the package's conformance suite. Until then, SQLite stays the implementation inside the Pi library, not the application's store.
- Full-text search moves from FTS5 to PostgreSQL full-text search; memory and History ranking are re-tuned and re-tested, not translated line by line.
- The upgrade transaction changes shape: logical schema migrations plus a verified `pg_dump` taken before a release, with restore-based rollback. File snapshots and the SQLite exclusive lock no longer protect the data.
- This ADR changes the target only. The current Electron service keeps `node:sqlite` and its file-snapshot upgrades until the new server lands; the migration is a data import, not a runtime dual-write.

**Consequences**: Operations now include a database server: installation, upgrades, authentication (peer or socket auth), backups, and a restore test per release. Development and CI need Postgres. The synchronous `node:sqlite` call sites become asynchronous when the server is ported, which is the largest single piece of that work. In exchange, the store has concurrent readers, standard tooling, and a schema boundary that a future multi-user mode can extend. The client-side read cache is out of scope: it stays local to each device and never becomes a second source of truth.

---

## D30 · Dreaming Proposes, the User Decides: Offline Memory Review Writes Candidates Only

A Dream is a bounded background pass over one Scope. It reads that Scope's Memory and its recent History, asks a model which memories the conversation shows to be wrong or outdated and which lasting facts are missing, and writes the answers as Memory candidates with validated Evidence. A Dream never activates, replaces, deletes, or selects a memory. The user decides every change in the Memory panel, as for any other candidate.

**Context**: Anthropic's [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory) (2026-11-06) reports two results that apply here: an offline pass that checks notes against the original transcripts corrects notes that were wrong or that drifted, and a pass over many sessions finds patterns that one session cannot see. The same article warns that an incorrect note in the injected layer reaches every session, that dreaming costs compute, and that a wiki can grow larger than its sources. In this project, unconfirmed tool writes already stay candidates (D4, D19), so a wrong note cannot become active on its own. The remaining gaps are different: a confirmed fact drifts when the world changes, and the heuristic Memory Worker (F03) reads at most 200 new History rows line by line, so it cannot compare a memory with what was said later. F04 lists dreaming as deferred, and the 2026-10-18 [memory review](research/memory-review.md) advised against a full dreaming loop until test cases justify it. Claude Managed Agents Dreams cannot be reused: it operates on Managed Agents memory stores and sessions, and this project stores memory in its own database and calls models through the pluggable provider registry (D21).

**Decision**:

- **Unit of work.** One Dream reads one Scope and writes only to that Scope. The Global Dream reads Global Memory and Global History; a project Dream reads that project's Memory and History. No Dream reads another Scope, so the Conversation Boundary of D18 holds without new rules.
- **Inputs.** The Scope's active memories and open candidates (with `#seq`, kind, conditions, and expiry), plus History `message` rows with role `user` or `assistant` after the Dream's own cursor, oldest first. Tool calls, tool results, Events, `system.notification` rows, and `worker.input` rows are excluded. The input has a fixed token budget, estimated with the Core estimator (`ceil(UTF-8 bytes / 3)`). Rows that do not fit wait for the next Dream; the cursor advances only past rows the Dream actually read.
- **Execution.** A Dream is one model completion through the provider registry (`Models.completeSimple`), with no tools and no Pi Durable conversation. A Dream therefore writes no transcript, its output never enters History, and it cannot read its own earlier output as evidence. The model call happens outside any database transaction.
- **Outputs.** The model returns JSON with at most a fixed number of proposals of three types. Every proposal cites 1–3 pieces of evidence as `{ ref, excerpt }`.
  - `revise #seq`: an active memory that the conversation shows to be wrong, outdated, or narrower (new conditions or expiry). It becomes a candidate whose `supersedes` names `#seq`, inheriting conditions and expiry unless the proposal sets them. This is the same review hint that an unconfirmed `revise` tool call stages today. The fact is replaced only when the user picks "Confirm this replaces #seq" (D19).
  - `new`: a lasting fact that is absent from memory. It becomes an ordinary candidate with `supersedes = null`.
  - `support #seq`: new evidence for an existing active memory or candidate. It appends Evidence only. It never changes text, trust, status, or Core, and repetition never raises trust (D19).
- **Validation (service side, inside the commit transaction).** A proposal is dropped, and counted by reason, when any rule fails:
  - each evidence `ref` was part of this Dream's input, resolves in the Scope's History, and its `excerpt` occurs verbatim in the source text (`resolveMemoryEvidence`);
  - the text is one line of at most 1,000 Unicode characters and does not match the instruction patterns that already guard extraction;
  - for `revise` and `support`, the target `#seq` still exists with the same status and the same fact identity (text, conditions, expiry) that the Dream read; a target changed during the Dream drops the proposal;
  - for `revise`, the new identity differs from the target's identity;
  - the fact identity is not dismissed in this Scope; an exact duplicate of an active memory or candidate becomes evidence on it, as in the Memory Worker;
  - the proposal is within the per-Dream cap.
- **Hard limits.** A Dream never writes `active` rows, `core = true`, confirmation records, `verified_at`, deletions, or Core selections, and never calls `promote`, `forget`, `select`, or `deselect`. Candidates carry actor `worker`, trust `agent_inferred`, and a version reason that starts with `dream`. A Dream never edits Notes, `MEMORY.md`, prompts, or injected context. A model that returns invalid JSON or fails changes nothing: the run is recorded with its error, and the cursor stays.
- **Trigger and cost.** Dreaming is off unless `settings.json` sets `dreamModel` (`{ provider, modelId }`). Then a service timer runs at most one Dream per Scope per interval (24 hours), only when the Scope has enough new eligible messages, never while the service is paused or closing, and with a one-hour back-off after a failed run. Each run records its Scope, counts per outcome and drop reason, model, token usage, and error in a feature-owned `memory_dream_runs` table, and emits a `memory.dreamed` Event. Like `memory_worker_runs`, the table is created idempotently by its module and does not bump `DATABASE_VERSION`.
- **Prompt.** The prompt states what memory is for (what the Scope's owner must know in later conversations) and the output contract. It does not impose fixed rules about what to record (for example "record only failures"), which the article found to reduce the benefit of memory for strong models. History text is framed as data and is never followed as instructions.
- **Portability.** The Dream reads and writes only through `Db` and `MemoryStore` and uses no FTS5 query, so the PostgreSQL port (D29) moves it unchanged.

**Not in this decision** (each needs its own change and, where it crosses a boundary, its own decision): Core select/deselect suggestions; expiry suggestions without a conversation trigger; skill candidates from Run history (D10); a socket command, Settings UI, or protocol change for Dreaming; in-chat candidate cards for Dream output; wikis or other derived memory representations; embeddings; cadence by access frequency; a quality evaluation with live models.

**Consequences**: Confirmed facts get a path back to review when later conversation contradicts them, and the review panel gets fewer but evidence-backed candidates. All write paths keep one rule set: evidence supports, confirmation reviews, only the user replaces. Trade-offs: each Dream sends up to its input budget of conversation text to the configured provider and costs model tokens, so it stays opt-in; the per-Dream cap and the 24-hour interval bound both cost and review load, but a cap can also defer a real correction to the next Dream; a Dream sees only recent History after its cursor, so it cannot detect drift that no later conversation mentions. Whether model proposals are precise enough to be worth the review time is unknown until a quality evaluation runs; this decision ships the mechanism with offline tests and no quality claim.
