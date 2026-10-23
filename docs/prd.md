# Tian Agent — Product Requirements Document (PRD)

**English** | [简体中文](zh/prd.md)

Version: v0.4 (v0.3 + Project Manager and direct user assignment)
Status: Draft
Product Type: Always-on Personal Agent
Target Platforms: macOS first; Linux and Windows planned
Technical Direction: TypeScript resident service (launchd) + Pi Durable + Electron/React client + SQLite (see [D3](decisions.md#d3--retain-typescript-resident-service-and-electron-client))

Terminology follows [CONTEXT.md](../CONTEXT.md). Status labels: **[Existing]** Implemented with test coverage; **[Partial]** Core architecture present but incomplete; **[Missing]** Not started. Notes marked "Recommendation" represent designs pending alignment; items marked "Pending Verification" represent assumptions not yet verified in code.

---

## 1. Product Overview

### 1.1 Positioning

An always-on personal agent with persistent memory, proactive execution, and the ability to learn from experience. Users delegate long-term goals. The Chief plans tasks, wakes on demand, logs results, builds experience, and requests approvals when needed.

> Users manage goals; agents manage tasks. Conversations may conclude, but memory, goals, and responsibilities endure.

### 1.2 Reference Systems

| System        | Borrowed Capabilities                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| OpenClaw      | Gateway, Heartbeat, Cron, Layered memory, Dreaming, Hybrid retrieval                       |
| Hermes Agent  | Compact core memory, Session search, Background review, Self-improving skills              |
| OpenAI Dots   | Long-term goals, Autonomous research, Cross-application execution, Proactive notifications |
| Codex Desktop | Multi-agent workflows, Git worktrees, Task review, Execution controls                      |

### 1.3 Core Goals

1. **Persistent Memory**: Retain memory across conversations, process restarts, and model changes.
2. **Persistent Goals**: Support goals lasting from days to months.
3. **Proactive Execution**: Execute proactively via schedules, events, or manual triggers.
4. **Self-Improvement**: Learn from experience and reuse successful workflows.
5. **Human Control**: Review, intervene, revert, or cancel critical operations.
6. **Runtime Independence**: Decouple memory and goal lifecycles from specific models and runtimes.

### 1.4 Non-Goals (Early Phase)

- No model training or fine-tuning.
- No complex knowledge graphs.
- No autonomous financial transactions or irreversible high-risk actions.
- No comprehensive third-party application integration in the first release.
- No continuous model inference; wake on demand only.
- No cross-device synchronization or remote cloud hosting.

---

## 2. Core Entities

| Entity                 | Definition                                                            | Lifecycle            | Code Status                                                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal                   | A long-term outcome the user wishes to achieve or maintain            | Days to years        | **[Existing]** `goals` table, dedicated Goal conversations, scheduler                                                                                                                                                                                         |
| Task                   | A concrete unit of work in service of a Goal or created independently | Minutes to days      | **[Existing]** State machine, `owner`, `trigger`, `dedupe_key`, `assignee`/`report_to` ([D5](decisions.md#d5--tasks-evolve-from-todos-runs-execute-coding-tasks), [D12](decisions.md#d12--project-manager-dedicated-persistent-session-and-delegation-tasks)) |
| Run                    | A single isolated execution performed by a Worker for a coding task   | Minutes to hours     | **[Existing]** `runs` + `run_attempts`                                                                                                                                                                                                                        |
| Conversation (Session) | A persistent Pi session for Chief, Manager, or Worker roles           | Minutes to permanent | **[Existing]** Pi Durable in `pi-session.sqlite`; archive flags in `conversations.archived_at`; roles exposed via `ConversationInfo.role`                                                                                                                     |
| Memory                 | Facts and experience preserved across conversations                   | Permanent            | **[Existing]** SQLite storage, provenance, versioning, explicit Core selection ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection))                                                               |
| Skill                  | A reusable, verifiable workflow procedure                             | Permanent            | **[Partial]** `skills` table, versions, manual approvals; semantic matching and model extractors planned                                                                                                                                                      |

Constraints:

- A Goal contains multiple Tasks; a Task can link to zero or more Runs across multiple Conversations.
- Concluding a Conversation does not complete a Task; completing a Run does not complete a Task.
- Archiving collapses a conversation from the sidebar without deleting transcripts or terminating Tasks.
- Memory does not manage scheduling; Goals and Tasks persist in structured tables rather than natural language summaries in Memory.
- Skills maintain independent versions and verification records.

---

## 3. System Architecture

### 3.1 Principles

- **Host-Owned State**: Only the resident service writes to the database; frontends are not authoritative sources. **[Existing]**
- **Runtime-Agnostic**: Pi serves as the default runtime through the `WorkerRuntime` interface. **[Existing]**
- **Event-Driven**: State changes write to Events that drive notifications and background processing. **[Existing]** ([D6](decisions.md#d6--history-is-a-derived-index-of-pi-transcripts-business-facts-write-to-events))
- **Local-First**: Data defaults to `~/Library/Application Support/Tian Agent/`. **[Existing]**
- **Recoverable**: Restart recovery, failure recovery, and upgrade rollbacks. **[Existing]**
- **Auditable**: Critical decisions and external actions preserve provenance. **[Existing]**

### 3.2 Processes

| Process          | Responsibility                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Resident Service | Holds `tian.db` and `pi-session.sqlite` exclusively; runs models, tools, scheduling, notifications, and Runs |
| Electron App     | Desktop client connecting via Unix sockets; quitting the application leaves the service running              |
| Worker           | Headless Pi conversation inside the service running in the Run's worktree                                    |

### 3.3 PRD Modules to Code Mapping

| PRD Module            | Existing Implementation                                                                             | Planned Addition                      |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Agent Gateway         | `service/server.ts`, `openSession` bindings, Telegram adapter                                       | Approval buttons (M3)                 |
| Agent Orchestrator    | `worker/service.ts`, `worker/runs.ts`                                                               | —                                     |
| Agent Runtime Adapter | `worker/agents.ts`                                                                                  | —                                     |
| Memory Service        | `worker/memory.ts` (SQLite, provenance, versions, explicit Core)                                    | Vector retrieval (M4)                 |
| Memory Worker         | `worker/memory-worker.ts` (heuristic candidate extraction)                                          | Model extractor                       |
| Goal Store            | `worker/goals.ts`, `tasks` table in `worker/db.ts`                                                  | —                                     |
| Project Manager       | `worker/manager-tools.ts` (persistent sessions, see [agent-work.md](agent-work.md#project-manager)) | —                                     |
| Scheduler             | `worker/scheduler.ts` (cron, single-transaction triggers, budgets)                                  | —                                     |
| Skill Registry        | `worker/skills.ts`                                                                                  | Semantic task matching (M5+)          |
| Approval Service      | UI manual Land/Ship review                                                                          | `approvals` + controlled actions (M3) |
| Frontend              | React three-pane shell ([D1](decisions.md#d1--three-pane-shell-navigation--conversation--context))  | Approval interfaces (M3)              |

---

## 4. Memory System

### 4.1 Layers

| Layer       | PRD Name          | Implementation                                                   |
| ----------- | ----------------- | ---------------------------------------------------------------- |
| Core Memory | Core Memory       | Explicitly selected active memories injected under token budgets |
| History     | Episodic Memory   | Derived full-text index of Pi transcripts + Event audit table    |
| Semantic    | Semantic Memory   | M4: Consolidated by Memory Worker                                |
| Procedural  | Procedural Memory | M5: Skills                                                       |

Goals and Tasks belong to the Goal Store rather than the Memory system.

### 4.2 F01 — Core Memory (P0) [Existing]

Current State: Memory ownership follows agent roles ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects)). The Chief injects Global Core Memory only; Project Managers inject Global Core Memory plus their project's Core Memory. Core Memory is an **explicitly selected** subset of active facts (default 1,500 tokens per scope). New memories default to searchable; running `select` makes them persistent. Deselecting an item removes it from Core Memory without deleting it. Budget overages reject atomically. Agents read and write records using `remember`, `revise`, `forget`, `recall`, `select`, and `deselect`. Revisions and deletions keep version records. Users can promote, dismiss, select, deselect, or revise candidate and active memories in the Memory panel (this panel is currently hidden in the UI; see [memory.md](memory.md)). Not yet implemented: prioritized loading of Goal-level memories (the field exists but `wake()` does not filter by Goal), and final conclusions on prompt prefix cache impacts.

Requirements:

- Preserve user preferences, long-term facts, and project conventions. The Chief manages Global memory; Managers manage project memory.
- Scopes: Global and Project. Memories can associate with Goals to prioritize loading in Goal conversations.
- Token budgets configure per scope (default 1,500 tokens). Budgets cover fully rendered text including headers, metadata, and usage footers. Overages reject explicitly.
- Conversations use stable memory snapshots to preserve prompt prefix caching.

Design Highlights ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection)):

- Tools: `remember` (replaces `note`), `revise` (supersedes), `forget` (soft-deletes), `recall` (keyword AND search with relevance ranking), `select` / `deselect` (explicit Core management).
- Snapshots: Core Memory caches per version in conversations and refreshes only when a new user turn starts with incremented versions.

Acceptance:

- Restarts preserve memory; new conversations load appropriate Core Memory.
- Project private memories never appear in other project conversations or Chief Core Memory.
- User corrections supersede older facts, removing outdated items from Core Memory.

### 4.3 F02 — History and Retrieval (P0) [Existing]

Current State: Tables `history_entries`, `history_fts`, and `history_cursors` index Pi transcripts and `events` incrementally. The Chief searches and expands entries with citations (`conv:<id>#<entry>`, `event:<id>`) via `search_history` and `read_history`.

Requirements: Search across timestamps, Scopes, Conversations, and keywords for:

- User and agent messages, tool calls, and tool outputs.
- Task and Run state changes, approvals, user feedback, and external events.

Design Highlights:

- Transcripts remain authoritative in Pi storage. The file `tian.db` holds a rebuildable derived FTS5 index with trigram tokenization for Chinese text search.
- Queries under 3 characters fall back to `LIKE`. Multi-word queries combine with AND.
- `search_history` returns snippets with references. The tool `read_history` paginates raw transcripts without truncation.
- Search p95 latency stays under 300ms locally (excluding model inference).

### 4.4 F03 — Automatic Memory Extraction (P1 / M4) [Partial]

Current State: The background worker in `worker/memory-worker.ts` extracts candidate facts without occupying conversational turns. Triggers include task completions (`complete_task`), conversation idle transitions, and user corrections (`revise` / `forget`). Processing runs incremental collection, extraction, classification, deduplication, conflict resolution, and persistence. The `MemoryExtractor` defaults to a deterministic heuristic supporting offline tests.

Priorities: Stable preferences, project decisions, environment configs, problem solutions, and reusable workflows. Exclude casual chit-chat, unverified conjectures, and raw tool output repetitions.

Candidates record with `trust_level = agent_inferred` and do not enter Core Memory directly. Users promote or dismiss candidates from the Memory panel. Promoting transitions candidates to active without changing trust, superseding conflicting active memories atomically. Dismissing marks candidates as deleted to prevent repeated extraction. This panel is currently hidden in the UI, leaving candidate review temporarily without an entry point (see [memory.md](memory.md)).

### 4.5 F04 — Consolidation and Dreaming (P1 / M4) [Partial]

Current State: Candidate extraction and conflict detection are implemented. Consolidation relies on deterministic deduplication and manual user promotions. Automated dreaming loops are deferred.

Requirements: Explainable promotions; repeated unverified assertions do not gain artificial weight; version histories remain intact; failures do not corrupt existing data.

### 4.6 F05 — Provenance (P0) [Existing]

Memory fields in `memories`:

| Field                       | Description                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| `id`, `scope_id`, `seq`     | Immutable sequence number per scope                                     |
| `goal_id`                   | Optional association                                                    |
| `kind`                      | preference / fact / decision / outcome / environment                    |
| `content`                   | Single-line, maximum 1,000 Unicode characters                           |
| `source_type`, `source_ref` | user / agent / tool / external / legacy; references `conv:<id>#<entry>` |
| `trust_level`, `confidence` | user confirmed / agent inferred / third-party                           |
| `core`                      | Boolean Core Memory selection flag                                      |
| `status`, `superseded_by`   | candidate / active / superseded / deleted                               |
| `created_at`, `updated_at`  | Timestamps                                                              |

- Append-only records in `memory_versions` track creations, revisions, selections, and deletions with actor and reason details.
- Actors (who performed the write) and sources (who stated the fact) record separately. Stored text confirms `source: "user"` only when matching actual user input.
- External tool outputs never enter prompts as high-priority instructions.

---

## 5. Goals and Tasks (Goal Engine)

### 5.1 F06 — Persistent Goals (P0) [Existing]

Goal Fields: Objective, Success Criteria, Status, Constraints, Schedule / Trigger, Current State, Next Action, Last Execution, Scope, and Daily Budget in `goals`.

States: `active / paused / blocked / completed / cancelled`. Users manage goals in the Goals view.

Highlights:

- Dedicated Chief conversation per Goal (`openSession({ channel: 'goal', externalId: goalId, scopeId })`). Long-term state stores in Goal records and Memory rather than endless chat threads.
- The Chief calls `update_goal` after execution to record Current State, Next Action, and Last Execution. Progress measures against Success Criteria.

### 5.2 F07 — Task Orchestration (P0) [Partial]

Current State: Tasks maintain state machines, `owner`, `trigger`, `dedupe_key`, `attempts`, `max_attempts`, and `outcome`. The parameter `assignee = 'manager'` delegates project work to Project Managers ([D12](decisions.md#d12--project-manager-dedicated-persistent-session-and-delegation-tasks)). Runs support queues, attempts, follow-ups, timeouts, recovery, and review separation. Automated retry backoffs and pause/resume controls remain in development.

Requirements ([D5](decisions.md#d5--tasks-evolve-from-todos-runs-execute-coding-tasks)):

- States: `pending → running → waiting_approval → completed`, plus `paused / blocked / failed / cancelled`. Outcomes record separately (achieved, not_achieved, no_change).
- Unique `dedupe_key` prevents duplicate task creation during restarts.
- Coding tasks dispatch Runs (`runs.task_id`). Supervisors evaluate Task completion after Runs finish.

### 5.3 F08 — Scheduler (P0) [Existing]

| Trigger  | Example                            | Support                                                     |
| -------- | ---------------------------------- | ----------------------------------------------------------- |
| Schedule | Daily morning project health check | Yes                                                         |
| Manual   | User requests immediate execution  | Yes                                                         |
| Event    | Incoming GitHub issue              | Partial (Inbox file delivery acts as generic event gateway) |

Principle: Schedulers decide when to wake; the Chief decides what actions to take.

Highlights ([D7](decisions.md#d7--schedules-advance-via-single-transaction-triggers-wakeups-contain-goal-states-and-tasks-only)):

- Schedules store `goal_id`, cron expression, timezone, `next_fire_at`, `last_fired_at`, and `enabled`.
- Single transaction creates Task (`sched:<id>:<fireTime>`), delivers Goal notification, and advances `next_fire_at`.
- Missed triggers during shutdown merge into a single execution.
- Wakeup notifications include Goal states and Task descriptions without full history transcripts.
- Daily budgets cap executions per Goal. Excess runs create `blocked` Tasks with deduplicated user notices.
- User notifications deduplicate via `notify_user(goal, fingerprint, text)` in a 24-hour window. Tasks with `outcome = no_change` send no notifications.

---

## 6. Self-Improvement (M5)

### 6.1 F09 — Experience Extraction (P1) [Partial]

Current State: When Runs complete, fail, or abort via `stop_run`, `SkillRegistry.review` inspects execution traces. The default `RuleBasedExtractor` extracts candidates from completed runs or aborted attempts carrying structured procedure sections. Failed runs generate no candidates. Extracted items link to `run:<id>:attempt:<n>` references. Aborted attempts label candidates "stopped early" with reasons without marking injected skills as failed.

### 6.2 F10 — Self-Improving Skills (P2) [Partial]

Current State: The `skills` table maintains multi-version records under `candidate → approved → retired / superseded`. Approvals, retirements, and rollbacks require explicit user actions via IPC or UI. Dispatches match approved skills and record them in `runs.injected_skills`. Unapproved candidates never enter prompts. Failed runs mark skills as `verification = failed`, enabling manual rollbacks.

Roadmap: Semantic matching, automatic post-rollback verification, and dreaming integration ([D10](decisions.md#d10--skill-injections-require-manual-user-approval-experience-extraction-produces-candidates-only)).

---

## 7. Interaction and Execution Control

### 7.1 F11 — Multi-Channel Gateway (P0) [Partial]

Current State: Channels open stable conversations via `openSession`. All channels share scope memory. External inputs support `requestId` deduplication. The Telegram Bot adapter uses long polling and chat allow-lists ([D8](decisions.md#d8--telegram-adapter-long-polling-allow-listed-chats-and-cursor-tracked-forwarding)). The Inbox file drop acts as an external event entry point.

Requirements:

- Telegram uses long polling without public ingress ports, authorized via chat allow-lists.
- Tokens store in `<dataDir>/service.env` (0600).
- The desktop app and Telegram share goals, tasks, memory, and approvals.

### 7.2 F12 — Task Board (P1) [Existing]

Current State: Embedded inside the Goals view as a unified cross-scope board.

- **Unified Board**: Loads tasks, goals, notices, and inboxes across scopes. Multi-scope environments show scope badges.
- **Grouping**: Categorized into pending, running, waiting_approval, blocked, failed, paused, and completed groups with state colors.
- **Inline Add**: Dashed input row at the top of the task list adds new tasks immediately.
- **Goal Cards**: Hovering reveals Run now, Pause, Resume, Edit, and Cancel actions. Expanding shows Success Criteria, Current State, Next Action, and Schedules.

### 7.3 F13 — Permissions and Approvals (P0) [Partial]

Current State:

- The Chief has no shell or code-editing tools. Land, Ship, and Discard actions require explicit user execution in the UI.
- Workers operate inside isolated Git worktrees.
- Idempotency records via `operations` table and `requestId` tokens.

Permission Tiers:

| Tier             | Actions                                          | Default           |
| ---------------- | ------------------------------------------------ | ----------------- |
| Read             | Retrieve memory, inspect authorized files        | Allowed           |
| Safe Write       | Update internal state, log entries, write Memory | Allowed           |
| Controlled Write | Land, Ship, external messaging                   | Requires Approval |
| Sensitive        | Mass deletion, production deployments, payments  | Prohibited        |

Requirements (M3):

- `approvals` records operation types, target references, payload digests, requesters, statuses, deciders, channels, and timestamps.
- Chief calls `request_land` / `request_ship` to create approval requests without executing directly. Approving in Desktop or Telegram triggers the service action.
- Verification checks payload digests before execution. Rejected approvals cannot be reused.

### 7.4 F14 — Conversation Archiving and Shell Collapse (P2) [Existing]

Current State: Conversations archive and restore cleanly. Sidebars and context panes collapse without reflow issues.

Requirements:

- **Archiving**: `archiveConversation(id, archived)` writes `conversations.archived_at` and broadcasts snapshots. Archived items collapse into the Archive list. History search retains archived conversations.
- **Wakeup Targets**: Archived conversations do not act as default targets for scope notifications.
- **Sidebar Collapse**: `⌃⌘S` or title bar buttons toggle navigation, persisting state in `localStorage` with traffic light spacing.
- **Right Pane Collapse**: `⌘B` toggles the context pane without leaving placeholder strips.
- **Settings Navigation**: Opening Settings (`⌘,`) remembers previous views (`navReturn`) to return smoothly on close.

---

## 8. Storage

`tian.db` (written exclusively by the resident service):

| Table                                                             | Status   | Description                                                                                                                                                   |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`, `conversations`, `channel_sessions`                   | Existing | Scopes, sessions, archive markers, channel bindings ([D8](decisions.md#d8--telegram-adapter-long-polling-allow-listed-chats-and-cursor-tracked-forwarding))   |
| `tasks`                                                           | Existing | Goals, assignees, state machines, deduplication keys ([D5](decisions.md#d5--tasks-evolve-from-todos-runs-execute-coding-tasks))                               |
| `runs`, `run_attempts`, `agent_messages`                          | Existing | Task links, injected skills, bidirectional message threads                                                                                                    |
| `inbox`, `notifications`, `operations`                            | Existing | Notification outbox, notice deduplication, idempotency tracking                                                                                               |
| `memories`, `memory_versions`, `memory_meta`                      | Existing | Storage, audit versions, migration markers ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection))   |
| `memory_fts`, `history_entries`, `history_fts`, `history_cursors` | Existing | Derived indexes rebuildable from source transcripts ([D6](decisions.md#d6--history-is-a-derived-index-of-pi-transcripts-business-facts-write-to-events))      |
| `events`                                                          | Existing | Business fact audit logs                                                                                                                                      |
| `memory_worker_runs`                                              | Existing | Memory Worker extraction audit logs                                                                                                                           |
| `goals`, `schedules`, `user_notices`                              | Existing | Goal tracking, cron schedules, deduplicated notices                                                                                                           |
| `improvements`                                                    | Existing | Improvement Log ([D11](decisions.md#d11--improvement-log-writable-by-user-and-chief-automatic-fingerprinting-for-system-errors))                              |
| `telegram_chats`, `telegram_state`, `telegram_forward_cursor`     | Existing | Telegram mapping, polling offsets, forwarding cursors ([D8](decisions.md#d8--telegram-adapter-long-polling-allow-listed-chats-and-cursor-tracked-forwarding)) |
| `skills`                                                          | Existing | Multi-version Skill records ([D10](decisions.md#d10--skill-injections-require-manual-user-approval-experience-extraction-produces-candidates-only))           |
| `manager_messages`                                                | Existing | Project Manager message threads ([D12](decisions.md#d12--project-manager-dedicated-persistent-session-and-delegation-tasks))                                  |
| `approvals`                                                       | Branch   | Controlled action approval workflows (`m3-approvals` branch)                                                                                                  |

`pi-session.sqlite`: Holds Pi Durable sessions and transcripts as the sole source of truth for History.

Files: Notes (`notes/`), Inbox (`.tian/inbox/`), Run reports (`.tian/runs/`), Memory exports (`MEMORY.md`).

Schema updates advance `DATABASE_VERSION` and execute inside backup and rollback transactions.

---

## 9. MVP Scope and Milestones

MVP verifies three outcomes: cross-session persistent memory; autonomous scheduled execution without user presence; reliable recovery of goals, tasks, and reviews after restarts.

### M1 — Memory Foundation [Completed]

- `memories`, `memory_versions`, `memory_meta`, and FTS; legacy import; export files.
- Chief tools: `remember`, `revise`, `forget`, `recall`, `select`, `deselect`.
- Core Memory rendered within token budgets; session snapshot caching.
- `events` audit table; derived History indexes and search tools.
- Desktop Memory panel: view provenance, statuses, versions; promote, dismiss, revise.

### M2 — Persistent Agent [Completed]

- `goals`, task evolution, and `runs.task_id`.
- `schedules` and scheduler service; Goal conversations; `update_goal` and `notify_user` deduplication.
- Daily budgets and execution timeouts.
- UI: Goal management and unified task boards.

### M3 — Always-On UX [Partial]

- Completed: Telegram adapter, WeChat adapter, unified task boards, conversation archiving, sidebar collapse.
- In Progress: `approvals` table, controlled action tools, desktop approval dialogs, Telegram approval buttons.
- Test Scenarios A through E complete; Scenario F pending approval integration.

### M4 / M5 (Post-MVP)

- M4: Memory Worker model extractors, dreaming loops, vector hybrid search.
- M5: Multi-agent coordination, automated skill refinement.

---

## 10. Acceptance Scenarios

Automated test suites in `pnpm test` validate scenarios using ephemeral databases, real temporary Git repositories, and controlled Workers without live model calls.

| Scenario | Description                                           | Expected Outcome                                                                  | Current Coverage                              |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| A        | User states long-term preference, quits, and restarts | New conversations load preference into Core Memory                                | Complete (`memory.test.ts`)                   |
| B        | User queries a technical decision from prior week     | `search_history` finds records and returns citation                               | Complete (`history.test.ts`)                  |
| C        | Daily automated GitHub project check                  | Executes on schedule, logs findings, skips duplicate notifications when unchanged | Complete (`goals.test.ts`)                    |
| D        | Application crashes during run execution              | Restarts recover Task and Run states without duplicate external actions           | Complete (`service.test.ts`, `goals.test.ts`) |
| E        | User corrects a prior preference                      | Previous memory supersedes with audit logs; Core Memory drops old fact            | Complete (`memory.test.ts`)                   |
| F        | Agent requests code push                              | Operation halts until approved; rejected approvals block execution                | Partial (`m3-approvals` branch)               |
| G        | User archives a finished conversation                 | Sidebar hides conversation; History search finds it; wakeups bypass it            | Complete (`service.test.ts`)                  |
| H        | User collapses sidebar and restarts                   | Sidebar remains collapsed; title bar preserves traffic light area                 | Complete (`state.test.ts`)                    |
| I        | Chief delegates to Manager; user delegates directly   | Delegated tasks report back to Chief; direct tasks conclude quietly               | Complete (`manager.test.ts`)                  |

---

## 11. Non-Functional Requirements

| Dimension     | Target                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Durability    | Confirmed writes survive restarts and upgrades (WAL + upgrade backups) **[Existing]** |
| Recovery      | Recovers unfinished tasks and reconciles external states on boot                      |
| Retrieval     | Local searches achieve p95 < 300ms (excluding model inference)                        |
| Performance   | Background processing runs in resident service without blocking UI **[Existing]**     |
| Cost Control  | Background tasks configure independent models and token budgets **[Existing]**        |
| Privacy       | Local-first storage, scope isolation, explicit external network boundaries            |
| Security      | Minimal privileges, provenance tracking, approvals, prompt injection defenses         |
| Observability | Records triggers, search hits, task outcomes, and token usage heatmaps **[Existing]** |

---

## 12. Product Metrics

- **Memory Recall Accuracy**: Percentage of accurate historical fact retrievals when relevant.
- **Memory Contradiction Rate**: Frequency of referencing superseded or contradictory memories in responses.
- **Task Recovery Success Rate**: Percentage of tasks correctly restored, resumed, or safely stopped after restarts.
- **Autonomous Task Success Rate**: Percentage of tasks reaching success criteria without manual intervention.
- **Unnecessary Action Rate**: Frequency of duplicate executions, repeated notifications, or redundant tool calls.
- **Tokens per Completed Task**: Average token consumption per successful task.

---

## 13. Architecture Questions and Decisions

| #   | Question                                                           | Conclusion                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Should the always-on runtime run as a separate background process? | **Resolved**: Yes, launchd resident service ([D3](decisions.md#d3--retain-typescript-resident-service-and-electron-client)).                                                                                                              |
| 2   | What strategy governs Core Memory budgeting and updates?           | **Proposal**: 1,500 tokens per scope, explicit selection, atomic overage rejection, turn snapshots ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection)).                      |
| 3   | Should History reuse Pi native storage?                            | **Proposal**: Pi transcripts remain authoritative; `tian.db` maintains rebuildable FTS indexes ([D6](decisions.md#d6--history-is-a-derived-index-of-pi-transcripts-business-facts-write-to-events)).                                      |
| 4   | How do multiple gateways handle concurrent tasks?                  | **Proposal**: The resident service alone executes tasks; channels submit inputs only; deduplication via `dedupe_key` and Durable ([D8](decisions.md#d8--telegram-adapter-long-polling-allow-listed-chats-and-cursor-tracked-forwarding)). |
| 5   | How are permissions scoped across agents, goals, and tasks?        | **Proposal**: Goals declare allowed action categories; each controlled operation requires explicit approval.                                                                                                                              |
| 6   | Should Memory Worker run on low-cost models?                       | **Pending** (M4): Configurable via Magpie; heuristic extraction active in F03.                                                                                                                                                            |
| 7   | How do goals determine next steps and measure progress?            | **Proposal**: Chief updates Current State and Next Action after execution, evaluating against Success Criteria.                                                                                                                           |
| 8   | How are Worker write permissions restricted?                       | **Pending**: Git worktrees and approval gates enforce boundaries in MVP; OS sandboxes remain under evaluation.                                                                                                                            |

---

## 14. Product Principles

- **Memory ≠ Context**: Long-term memory is not an infinite conversation context.
- **Goal ≠ Conversation**: Conversations conclude; goals endure.
- **Activity ≠ Progress**: Running tools does not imply progress; completing a Run does not mean a Task is achieved.
- **Experience ≠ Verified Skill**: Unverified observations cannot become operational execution rules.
- **Autonomy ≠ Unlimited Authority**: Agents plan proactively while execution permissions remain under user control.
