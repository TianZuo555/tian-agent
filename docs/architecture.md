# Architecture

**English** | [简体中文](zh/architecture.md)

## Processes

| Process          | Responsibility                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer         | React + Tailwind + coss. Manages view state and subscriptions; rejects outdated responses; uses application-owned `ChatSnapshot` for chat.                                    |
| Preload          | Exposes typed commands and cancellable subscriptions via `contextBridge`; keeps sandbox and context isolation active; disables Node integration.                              |
| Main             | Manages windows, directory pickers, and IPC routing; connects to the resident service via Unix sockets; never opens databases.                                                |
| Resident Service | Holds application databases and Pi storage exclusively; executes models, tools, Inbox, notifications, and Runs. Reconnecting clients fetch fresh snapshots and subscriptions. |

The Chief, Project Managers, and Workers share the service Harness and Pi storage. Each agent selects its extension set explicitly. All three run as Durable conversations with lifecycles independent from the desktop client.

## Desktop Client

- Navigation: Four primary views: Chat, Goals, Skills, and Inbox. The gear icon at the bottom of the sidebar or `⌘,` opens full-page Settings (pressing again or clicking close returns to the previous view). Both sidebar (`⌃⌘S`) and right context pane (`⌘B`) collapse cleanly from header buttons.
- Conversation Archiving: Hovering conversation rows reveals Archive / Restore buttons (`archiveConversation`). Archived sessions collapse into the bottom Archive section and no longer receive unaddressed scope-level wakeups.
- Cross-Scope Boards: The Goals view consolidates goals, tasks, and notices across all scopes. The Inbox view operates identically, showing scope badges for multi-project setups.
- Context Pane: Tabbed view for Tasks and Runs (matches the active conversation scope). The Memory panel implementation remains intact (candidate, Core, and retrievable partitions, Core token usage, and promote, dismiss, select, and revise commands). However, its tab is hidden from the tab strip, leaving no entry point in the UI (see [memory.md](memory.md)).
- Command Palette (`⌘K`): Creates conversations, switches views, and toggles sidebars and panels.
- Settings: Model selection, Gateway status, daily usage heatmaps, Improvement Log, and Service Upgrades (see [service.md](service.md)).
- Chat Rendering: Markdown renders through Streamdown. Mermaid diagrams load lazily on demand.
- Application components must pass oxlint `jsx-a11y` rules at error level (see `.oxlintrc.json`).
- Content Security Policy: `index.html` carries the strict production policy (`script-src 'self'`, no inline scripts, no `object-src`). The Vite dev server swaps in a relaxed policy for HMR through a `serve`-only plugin in `vite.renderer.config.mts`; packaged builds keep the strict policy.

## Module Map

| Module                         | Responsibility                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `service/server.ts`            | Service lifecycle, exclusive locks, Unix socket RPC, client isolation                                                                   |
| `service/client.ts`            | Requests, events, automatic reconnection; closing clients does not stop the service                                                     |
| `service/launchd.ts`           | Service upgrade transactions, backups, rollbacks, recovery, and LaunchAgent operations                                                  |
| `desktop/controller.ts`        | Connection preferences, service management, and local update triggers                                                                   |
| `desktop/app-update.ts`        | Application bundle verification, staging, swap, health checks, and rollback                                                             |
| `shared/contracts.ts`          | IPC and socket schemas, return types, and message contracts                                                                             |
| `shared/messages.ts`           | Transforms Pi transcripts into chat snapshots                                                                                           |
| `worker/service.ts`            | Application wiring, projects, chief/manager sessions, channel bindings, delegation, Inbox, and notifications                            |
| `worker/commands.ts`           | Business command handlers shared across transports                                                                                      |
| `worker/agents.ts`             | Pi API adapter and capability configurations for Chief, Manager, and Worker roles                                                       |
| `worker/magpie.ts`             | Magpie gateway provider: model discovery and schema mapping                                                                             |
| `worker/settings.ts`           | Model selection and cached model catalogs                                                                                               |
| `worker/tools.ts`              | Chief extension: tasks, memory, notes, Inbox, dispatch, delegation                                                                      |
| `worker/manager-tools.ts`      | Project Manager extension: project-locked tasks, memory, notes, runs, report_chief                                                      |
| `worker/tools-memory.ts`       | Memory tools and scope resolution shared by Chief and Project Managers                                                                  |
| `worker/tools-goals.ts`        | Goal management tools and shared task execution tools (`taskExecutionTools`)                                                            |
| `worker/tools-improvements.ts` | Chief improvement tools: `log_improvement`, `list_improvements`                                                                         |
| `worker/tools-history.ts`      | History search tools: `search_history`, `read_history`                                                                                  |
| `worker/worker-tools.ts`       | Worker messaging tools: `ask_chief`, `tell_chief`, `check_msgs`                                                                         |
| `worker/goals.ts`              | Goal storage, user notifications (`user_notices`), and daily execution budgets                                                          |
| `worker/skills.ts`             | Multi-version Skill registry, approval state machine, prompt injection, and experience reviews                                          |
| `worker/files.ts`              | Atomic file publishing via temporary files and renames                                                                                  |
| `worker/scheduler.ts`          | Cron parsing and single-transaction execution triggers                                                                                  |
| `worker/runs.ts`               | Run state machine, attempts, collection, recovery, and review operations                                                                |
| `worker/run-progress.ts`       | Run progress snapshot types and tool output formatting (`run_progress`)                                                                 |
| `worker/manager-label.ts`      | Project Manager naming and label resolution ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects)) |
| `worker/data.ts`               | Task, memory, and Inbox operations and update events                                                                                    |
| `worker/db.ts`                 | Business databases, channel bindings, notification outbox, idempotency records                                                          |
| `worker/scopes.ts`             | Scope directory management, notes, and Inbox file ingestion                                                                             |
| `worker/memory.ts`             | SQLite memory engine, provenance, versioning, explicit Core selection (see [memory.md](memory.md))                                      |
| `worker/provenance.ts`         | Evidence validation distinguishing user turns from system wakeups                                                                       |
| `worker/search.ts`             | Shared search query planner, token estimators, and code point pagination                                                                |
| `worker/memory-worker.ts`      | Background candidate memory extraction: triggers, cursors, heuristic extractors                                                         |
| `worker/history.ts`            | Derived full-text indexes for transcripts and events, incremental sync, search                                                          |
| `worker/events.ts`             | Business event auditing (`events` table)                                                                                                |
| `worker/improvements.ts`       | Improvement Log, exception fingerprinting, task promotion (see [improvement-log.md](improvement-log.md))                                |
| `worker/usage.ts`              | Daily token usage aggregation per scope                                                                                                 |
| `worker/dispatch.ts`           | Worktree lifecycle, commits, diffs, merges, and PR operations                                                                           |
| `worker/telegram.ts`           | Telegram Bot long polling, allow-listing, session mapping, reply forwarding                                                             |
| `worker/wechat.ts`             | WeChat iLink QR login, allow-listing, session mapping, reply forwarding, 24h keepalive                                                  |
| `worker/channel-host.ts`       | Shared channel host adapter and response text extraction                                                                                |

## Permissions and Scopes

The Chief enables the `chief` extension only: tasks, memory, notes, Inbox, Improvement Log, dispatch, delegation (`delegate` / `send_manager_msg` / `list_manager_msgs`), Run inspections, and Run messaging (`send_run_msg` / `list_run_msgs` / `run_progress` / `stop_run`). It does not have shell or direct file-editing tools (`bash/read/write/edit`). It reads run outputs via `read_run_report` and `read_run_diff`. Service startup re-applies extension limits to existing conversations. Memory and notes follow role ownership ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects)): the Chief writes Global memory only and receives Global Core Memory. Project memories and notes query read-only when given an explicit `scope`.

Project Managers enable the `manager` extension based on channel bindings (`channel = 'manager'`, `external_id = project_id`). Exactly one persistent conversation exists per project, created with `addProject` (where manager naming is required). Startup reconciles legacy projects. The channel `manager` is reserved; public `openSession` rejects it. Users open it via `openManager(projectId)`. Manager conversations carry `role: 'manager'` in `ConversationInfo` and pin to the top of project sections in the sidebar. Manager tools lock to their project scope: task execution (concluding delegated Tasks with `assignee = 'manager'`), Run dispatches (`chief_conversation_id` points to the Manager), and exclusive write access to project memory and notes. Project Managers have no shell or coding tools. Upstream communication routes through `report_chief` and `ask_chief` across `manager_messages` threads. Notifications route to the delegating Chief via `report_to`.

Tian can converse directly with Project Managers to assign work. When turn inputs have `kind = 'user'`, the turn belongs to Tian. Tool guards intercept `ask_chief` and `report_chief` to prevent unnecessary notifications to the Chief. Tasks created by Tian use `add_task` (`assignee = NULL`) and conclude quietly without Chief notification. Memory writes during Tian turns record as `user_confirmed`.

Workers enable `CodingTools` and messaging extensions. They operate inside isolated Git worktrees and lack memory writing tools. Running Workers call `ask_chief` to query supervisors, `tell_chief` to send progress updates, and `check_msgs` to read supervisor instructions. Workers edit the current directory only and read memory and notes as read-only documents. Worktrees provide Git isolation; they do not enforce operating system sandboxes. Worker shell commands do not inherit service-only variables (`TELEGRAM_*`, `WECHAT_*`, `MAGPIE_*`, `TIAN_AGENT_*`).

Scopes divide into `global` and user-registered projects. Conversations bind to scopes. Project settings include `autoLand`, `allowInPlace`, `runTimeoutMin`, `baseBranch`, and `promptPreamble`. The default worker type is `durable-worker`. Setting `runTimeoutMin = 0` indicates unlimited execution time per attempt. A positive integer enforces a hard timeout that aborts the attempt and begins artifact collection.
