# Tian Agent

**English** | [简体中文](docs/README.md)

An always-on personal agent system: a **Chief** manages Global memory about Tian and facts shared across projects, planning, and reporting; each project has a named **Project Manager** created during registration to maintain its detailed memory and receive delegated work from the Chief. Coding tasks are executed unattended by **Workers** inside isolated Git worktrees. Persistent bidirectional communication channels connect every layer: Workers can ask questions and receive answers during execution, while supervisors can issue commands or safely halt runs mid-flight.

The Chief runs inside a local resident Node background service managed by macOS `launchd` (with automatic crash recovery). The Electron App serves as its desktop workstation, and integrated Telegram Bot and WeChat (iLink / ClawBot) channels provide convenient remote chat entry points. Conversations may conclude, but memory, goals, and responsibilities endure.

Detailed product requirements and roadmap are available in [docs/prd.md](docs/prd.md), ubiquitous language and core concepts in [CONTEXT.md](CONTEXT.md), architectural design decisions in [docs/decisions.md](docs/decisions.md), and design system specifications in [docs/design-language.md](docs/design-language.md).

## Features

- **Three-Pane Desktop Shell**: Navigation rail, conversation transcript, and a collapsible context inspector (Tasks / Runs / Memory). Features Streamdown Markdown, on-demand Mermaid diagrams, a global ⌘K command palette, and smooth panel collapse with dark/light themes.
- **Model Gateway & Effort Control**: Automatically discovers models from the local Magpie gateway (`/v1/models`) with offline catalog caching. Allows supervisors to pin specific models and thinking levels per worker run (D13). Daily usage heatmaps in Settings.
- **Projects & Scopes**: Register local directories as project scopes, each with exactly one Manager whose name is required at registration (D18). Coding tasks run in isolated Git worktrees by default to protect main checkouts.
- **Layered Memory System**: SQLite storage tracking evidence, independent user confirmations, applicable conditions, and version history; explicit Core Memory token budgeting; background Memory Worker extracts candidates for in-app review, promotion, rejection, selection, or revision. A separate budgeted task-related context retrieves relevant Memory, Notes, and History without loading everything. The Chief owns Global memory and Notes; each Manager owns its Project's memory and Notes. Chief conversations receive Global Core Memory, while Manager conversations receive Global and their own Project's Core Memory (D4, D18, D19).
- **Goals & Tasks**: Users manage long-term goals; agents manage actionable tasks. Cron expressions schedule goal wakeups with daily run budgets and deduplicated user notices.
- **Runs & Review**: Headless workers execute coding tasks with support for multi-round follow-ups. Reviews support Land (merge to base checkout), Ship (push branch & open PR), or Discard. Duplicate identical dispatches are cleanly folded (D15).
- **Live Progress & Clean Interruption**: Supervisors query real-time worker execution progress via `run_progress` (recent assistant output and tool calls). Users can stop Runs in the App, and supervisors can halt them with `stop_run` (D15, D16), snapshotting the worktree and preserving partial commits for review or resumption.
- **Bidirectional Messaging**: Workers query supervisors via `ask_chief` and block for answers; supervisors dispatch instructions or replies via `send_run_msg` across persistent threads.
- **Project Managers**: Persistent per-project conversations created during project registration, with required Manager names. The Chief delegates project management as discrete Tasks with structured question-and-answer workflows; users can also directly open a Manager session from the sidebar to assign tasks directly, which resolve quietly without notifying the Chief (D12, D18).
- **Multi-Channel Access**: Independent conversations across Desktop App, Telegram Bot (long polling + chat allow-listing), WeChat (official iLink / ClawBot QR scan channel, 24h window keepalive), and `.tian/inbox` file-drop mailboxes, all sharing unified scope memory (D8, D17).
- **Resident Service & Atomic Upgrades**: Decoupled from the desktop App lifecycle; runs under `launchd`. Atomic service upgrades include database snapshots, automatic rollback on failure, and companion app update coordination (D3, D9).
- **Improvement Log**: Capture product friction, ideas, and runtime exceptions automatically fingerprinted and deduplicated, with one-click promotion to actionable Tasks (D11).

## Quick Start

```sh
mise install
mise run setup    # pnpm install + pnpm service:install
mise run start    # Start desktop App
mise run verify   # typecheck + lint + react-doctor + test
```

Toolchain details (Node 26 + pnpm 12.5.1), environment variables, and testing guidelines are documented in [docs/development.md](docs/development.md).

## Documentation

| Document                                                         | Description                                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [docs/development.md](docs/development.md)                       | Toolchain (mise), common commands, local env vars, test suites, and React Doctor standards      |
| [docs/decisions.md](docs/decisions.md)                           | Architectural design decisions D1–D18: rationales and trade-offs                                |
| [docs/architecture.md](docs/architecture.md)                     | Process model, desktop client, module map, permissions, and scope isolation                     |
| [docs/service.md](docs/service.md)                               | Resident service: installation, operations, exclusive locks, and transactional upgrade/rollback |
| [docs/agent-work.md](docs/agent-work.md)                         | Goals, task lifecycle, scheduling, Run state machines, Manager delegation, and messaging        |
| [docs/memory.md](docs/memory.md)                                 | SQLite memory engine, explicit Core Memory, provenance tracking, and candidate extraction       |
| [docs/channels.md](docs/channels.md)                             | Channels and session bindings, Telegram / WeChat setup, and the Inbox file drop protocol        |
| [docs/data.md](docs/data.md)                                     | Schema design, crash recovery, notifications, History full-text search, and Event auditing      |
| [docs/improvement-log.md](docs/improvement-log.md)               | Improvement Log: entry lifecycle, exception deduplication, and Task promotion                   |
| [docs/prd.md](docs/prd.md)                                       | Product Requirements Document (PRD): vision, core entities, requirements matrix, and roadmap    |
| [docs/design-language.md](docs/design-language.md)               | Visual language specification: ink surfaces, monochrome accents, Coder tokens, and Phosphor     |
| [docs/research/memory-review.md](docs/research/memory-review.md) | Memory system research comparing OpenClaw, Hermes, and Tian Agent designs                       |

## Roadmap

All model interactions currently route through the local Magpie gateway. Planned enhancements include Keychain credential management, remote server connectivity, hybrid local/cloud protocols, additional specialized worker roles, automated scheduled briefings, remote update feeds, and macOS production code signing with notarization.

References: [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable), [OptMem](https://github.com/VictorTaelin/OptMem), [launchd](https://www.launchd.info/), [coss](https://coss.com/ui).
