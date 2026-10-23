# Data, Recovery, and Search

**English** | [简体中文](zh/data.md)

## Storage

| Location            | Content                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tian.db`           | Projects, conversations, channel bindings, goals, tasks, schedules, runs, attempts, `agent_messages`, `manager_messages`, Inbox and read states, notifications and `user_notices`, idempotency records, `events`, `improvements`, `skills`, `telegram_*`, Memory Worker cycles, `memories`/`memory_versions`/`memory_meta`, and rebuildable history indexes |
| `pi-session.sqlite` | Pi Durable conversations, tasks, and transcripts                                                                                                                                                                                                                                                                                                            |
| Files               | Memory, notes, Inbox inputs, and reports                                                                                                                                                                                                                                                                                                                    |

Only the resident service writes to the database. The frontend is not an authoritative source. The two databases coordinate through operation IDs and startup reconciliation. No cross-database atomic transaction exists.

## Recovery and Notifications

The service stops in an orderly sequence upon receiving SIGTERM. The next startup restores conversations, collectors, and original deadlines. Recovery follows tool replay policies. It does not guarantee exactly-once delivery for arbitrary external operations.

Run results and completion notifications record in a single database transaction. The service delivers notifications to the dispatching conversation (Chief or Project Manager) with a stable `requestId`, then marks them delivered. After a crash, notifications redeliver and deduplicate through Durable. If the receiver is busy, notifications enter the follow-up queue.

## History and Events

Pi transcripts are the sole source for conversation content. The file `tian.db` contains only derived indexes that you can delete and rebuild. Business facts (Run state transitions, Inbox imports, notification deliveries) write to the `events` table and index into the same full-text search.

- `events`: `id` (derived from callers for idempotent replay), `at`, `type`, `actor`, `scope_id`, `goal_id`, `task_id`, `run_id`, `conversation_id`, `summary`, `payload`. The API offers only `record(event)` (`INSERT OR IGNORE`), `get(id)`, and `list(filter)`. Other modules call `record` directly.
- `history_entries`: `(conversation_id, entry_id)` forms the primary key. Stores scope, kind, role, timestamp, and text. User inputs, assistant text, tool calls, and tool results enter the index. Tool arguments and results enter as complete source units without truncation thresholds. Multi-message entries use `:msg:<n>` and tool calls use `:call:<n>`. Empty content and thinking blocks skip indexing. Events store with `conversation_id = ''` and reference as `event:<id>`.
- `history_fts`: Uses FTS5 with trigram tokenization. Chinese text is searchable directly. Words with fewer than 3 characters fall back to `LIKE`. Multi-word queries combine with AND.
- `history_cursors`: Tracks synchronization progress per conversation (events and Memory Worker use separate cursors). Paginates by ascending entry ID. Startup processes only new entries. Formatting versions record in `memory_meta`. Upgrades to the index format clear derived tables and all cursors. Rebuilding changes entry rowids, so all cursors become invalid. The next synchronization rebuilds from Pi transcripts and event logs. The Memory Worker restarts from the beginning and prevents duplicate candidates through deduplication.

Synchronization timing: Background catch-up runs after startup without blocking boot. Changes sync after delays on new inputs, watch notifications, or idle states. Queries lazily sync target scopes before searching. Synchronization pauses during maintenance mode.

Search results order by FTS rank, then by descending time. Results truncate at approximately 1,500 tokens (`ceil(utf8Bytes / 3)`). Chief search tools include:

- `search_history(query, scope?, since?, until?, limit?)`: Defaults to current conversation scope. Use `scope: "all"` to search all scopes. Returns `[2026-10-11 14:02] conv:12#345 user: ...snippet...`. Returns `(no matches)` when empty.
- `read_history(ref, offset?, limit?, around?)`: Paginates target entries from the raw transcript. Returns `chars a-b of n` and continuation offset. The parameter `around` shows neighboring turns. The reference `event:<id>` displays event details. Unicode paginates by code point.
