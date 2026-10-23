# Memory

**English** | [简体中文](zh/memory.md)

Memory persists inside SQLite (`tian.db`, written exclusively by the resident service) and tracks provenance, confidence, and versions. Files on disk serve as one-way read-only exports ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection)):

```text
<scope root>/memory/
  MEMORY.md        Atomic read-only view rewritten after commits (active memories, Core flags, usage)
  legacy/          Imported legacy LOG.txt and TREE/ files (retired; not read at runtime)
```

## Schema

| Table             | Content                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`        | Each record has `seq` (immutable index per scope), `kind`, provenance, confidence, `core` (explicit selection flag), and `status` (candidate / active / superseded / deleted). Body text is single-line with a maximum of 1,000 Unicode characters. Candidates include `supersedes` pointing to target entries. |
| `memory_versions` | Append-only audit records (create / promote / supersede / delete / import / select / deselect / evidence), recording actors, reasons, and previous and updated text.                                                                                                                                            |
| `memory_meta`     | One-time migration markers (initial Core selection, History index format).                                                                                                                                                                                                                                      |
| `memory_fts`      | FTS5 trigram full-text index. Chinese is searchable directly. Words shorter than 3 characters fall back to `LIKE`. Defaults to active memories; `include_history` queries historical records.                                                                                                                   |

The legacy `memory_nodes` summary tree was renamed to `memory_nodes_retired` during migration. It remains on disk for forensic inspection, is never queried, and is not created in new databases.

## Ownership ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects))

| Role    | Writes           | Injected Core            | On-Demand Queries                            |
| ------- | ---------------- | ------------------------ | -------------------------------------------- |
| Chief   | Global only      | Global only              | Any project's memory and notes (via `scope`) |
| Manager | Own project only | Global + Own project     | Global memory (`recall scope=global`)        |
| Worker  | None             | None (reads `MEMORY.md`) | Project `memory/MEMORY.md` and `notes/`      |

- Writing tools (`remember`, `revise`, `forget`, `select`, `deselect`) omit `scope` and `target` parameters. Roles fix the write destination. The `#seq` identifier always addresses the agent's owned memory.
- Project facts learned by the Chief route to the Project Manager (`send_manager_msg` or `delegate` briefings). Manager sessions ignore unrelated personal user facts, leaving Tian to tell the Chief directly.
- Cross-scope read-only results include a header indicating the owner. This prevents agents from confusing external sequence numbers with their own.
- Candidate extraction (Memory Worker) and the UI Memory panel operate by scope without role restrictions. Candidates attach to the origin scope, and UI actions register as user operations.

## Core Memory

Core Memory is an explicitly selected subset of active facts rather than a truncated summary:

- New memories recorded via `remember` default to searchable (`core = false`). Marking an item persistent requires setting `core = true` or running `select #seq`.
- Running `deselect #seq` removes an item from Core Memory without deleting it. The item stays active and searchable via `recall`.
- Scope budgets default to 1,500 tokens, calculated from the fully rendered text (`ceil(UTF-8 bytes / 3)`). This covers sequence numbers, types, confidence tiers, timestamps, provenance, line breaks, and usage footers (`core: N selected · X/1500 tokens`).
- Selection requests exceeding budgets reject atomically and return current usage and overflow counts. Runtime memory does not silently evict or truncate facts.
- Revisions prioritize correction. If revised text fits, it retains its Core position. If it overflows, the new fact saves while leaving Core Memory, prompting manual reselection or budget cleanup.
- Snapshots remain stable within conversations. Core Memory refreshes only when a new user turn starts and memory versions have changed. In-conversation writes communicate status via tool return values.

## Tools

- `remember`: Inserts a new memory; `core` is optional; `source: "user"` confirms only when the request originates from a real user turn.
- `revise`: Supersedes an existing memory (creates a new `seq`, marks the older memory superseded, and links to the new entry). Corrections use `revise` instead of creating contradictory active entries. Revisions reference the current correction rather than old sources.
- `forget`: Soft-deletes memories; physical deletion never occurs.
- `select` / `deselect`: Manages Core status explicitly. Operations are idempotent via durable `taskId:callId`.
- `recall`: Keyword search. Multi-word queries match non-consecutive words with AND logic. Queries under 3 characters use substring matching. Results rank by FTS relevance and include metadata. The `limit` caps result count, and token budgets enforce boundaries across full output strings. Queries returning no results return `(no matches)`.

## Provenance

Actors (who wrote the record: user / chief / manager / worker) and sources (who stated the fact) record separately. Write targets follow agent roles:

- The service records `pi.user` entries during genuine user turns. Wakeups for goals, schedules, runs, and inboxes write `system.notification` entries. Worker turns use `worker.input`.
- The label `source: "user"` confirms only when stored text matches current user input exactly after whitespace normalization. System wakeups, worker inputs, and summarized notifications fall back to `agent_inferred`. Regardless of confirmation, `sourceRef` binds to the latest input entry (`conv:<id>#<entry>`).
- Image-only and empty inputs bind without user confirmation.
- Confirmed entries record references like `conv:<conversation>#<entry>`, readable directly by `read_history`.
- Revisions in the desktop Memory panel mark as `user_confirmed` with source `ui:memory-panel`.

## Deduplication and Idempotency

- Matching text within the same scope after whitespace normalization returns the existing `#seq` without creating duplicates. Case sensitivity is preserved (`Foo` and `foo` remain distinct).
- Duplicate writes that supply new user confirmations or source references upgrade confidence ratings and append `evidence` version records. They advance version numbers and update exports. Calling `revise` with identical text follows this evidence-enhancement path (`changed = false`, `evidenceAdded = true`). If wider metadata causes Core overflow, the entry leaves Core and reports `coreDropped`.
- Repeat requests with `core: true` validate budgets against final rendered collections. Budget overages roll back the entire transaction.
- Superseded and deleted records do not revive. Identical new content creates a fresh active record.
- Tool operations use durable `taskId:callId` operation IDs for idempotent replay. Concurrent outdated revisions reject under transactional checks.

## Candidate Extraction

The background worker in `worker/memory-worker.ts` runs inside the resident service without consuming Chief conversational turns. Triggers include task completions, conversation idle events (busy to idle transitions with 5-minute sweeps), and user corrections (`revise` / `forget`). It reads incremental History indexes, runs extraction, classification, deduplication, conflict resolution, and persistence. Automatic runs throttle to a 30-second minimum interval. Processing pauses during maintenance and shutdown.

- Candidates store as `status = candidate` and `trust_level = agent_inferred`. They never enter `wake()` prompt injections or read-only exports. Extraction and persistence execute in a single transaction. Errors roll back cursors.
- Candidates matching active memories in kind with overlapping phrasing record as superseding candidates (`supersedes`). Promoting them in the UI supersedes the older memory in the same transaction without automatically adding the item to Core Memory.
- Dismissing candidates prevents duplicate extraction from the same source.
- The `MemoryExtractor` interface defaults to a deterministic heuristic supporting offline tests.
- Extraction runs log to `memory_worker_runs` and record `memory.extracted` audit events.

## File Locations and User Review

- Project memory lives in `<project root>/memory/`. Global memory lives in `<dataDir>/scopes/global/memory/`. Long documentation stores as Markdown in `<scope root>/notes/`.
- Opening a scope for the first time imports legacy `LOG.txt` files inside an atomic transaction. Files move to `memory/legacy/` only after commits succeed. Legacy trees move to legacy folders and are not imported.
- Initialization completes and commits before running business transactions. Rollbacks reload stores from committed states.
- Database upgrades perform deterministic Core selections for legacy data (prioritizing user-confirmed items, preferences, and decisions against token budgets). Remaining active items stay searchable.
- The Context Pane contains a Memory panel. It displays candidates, Core facts, and searchable non-resident items alongside Core token usage. Users can promote, dismiss, select, deselect, or revise records (operator: `user`). All changes persist in version history. This panel is currently hidden in the UI. `ContextPane.tsx` filters out the `memory` tab from the tab strip. Panel components and commands (`memoryPromote`, `memoryDismiss`, `memorySelect`, `memoryDeselect`, `memoryRevise`) remain intact for future restoration. While hidden, candidates can only be reviewed through Agent tools.

Agents and users determine what to remember. Vector indexes and dreaming are not present in MVP. Note searches share query plans with Memory and History (`worker/search.ts`), returning bounded snippets with `file.md:<line>` references.
