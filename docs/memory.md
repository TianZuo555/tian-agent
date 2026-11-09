# Memory

**English** | [简体中文](zh/memory.md)

Memory persists inside SQLite (`tian.db`, written exclusively by the resident service) and tracks evidence, confirmation records, applicability conditions, and versions. Files on disk serve as one-way read-only exports ([D4](decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection)):

```text
<scope root>/memory/
  MEMORY.md        Atomic read-only snapshot rewritten after commits (generation time, active memories, Core flags, usage)
  legacy/          Imported legacy LOG.txt and TREE/ files (retired; not read at runtime)
```

## Schema

| Table                  | Content                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memories`             | Each record has `seq` (immutable index per scope), `kind`, provenance, `core` (explicit selection flag), `status` (candidate / active / superseded / deleted), `conditions` (environment / subject / version it applies to), `observed_at`, `verified_at`, and `valid_until`. Body text is single-line with a maximum of 1,000 Unicode characters. Candidates include `supersedes`, the target the reviewer may choose to replace. |
| `memory_evidence`      | Multiple pieces of evidence per fact: the actual `source_ref`, the original `excerpt`, the source actor, the `direct` / `paraphrase` / `inference` relation, and the observation time. Repeated facts add evidence; repetition never raises trust.                                                                                                                                                                                 |
| `memory_confirmations` | Separate user confirmation records: `source_ref`, the confirmed text, the method (`explicit-save` / `review` / `legacy`), and the time. `source: "user"` is not a substitute for confirmation.                                                                                                                                                                                                                                     |
| `memory_versions`      | Append-only audit records (create / promote / supersede / delete / import / select / deselect / evidence), recording actors, reasons, and previous and updated text.                                                                                                                                                                                                                                                               |
| `memory_meta`          | One-time migration markers (initial Core selection, History index format, evidence migration, candidate dismissal suppression).                                                                                                                                                                                                                                                                                                    |
| `memory_fts`           | FTS5 trigram full-text index. Chinese is searchable directly. Words shorter than 3 characters fall back to `LIKE`. Defaults to active memories; `include_history` queries historical records.                                                                                                                                                                                                                                      |

The legacy `memory_nodes` summary tree was renamed to `memory_nodes_retired` during migration. It remains on disk for forensic inspection, is never queried, and is not created in new databases.

## Ownership ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects))

| Role    | Writes           | Injected Core        | On-Demand Queries                                                                      |
| ------- | ---------------- | -------------------- | -------------------------------------------------------------------------------------- |
| Chief   | Global only      | Global only          | Global memory, notes, and History; any project's memory and notes (via `scope`)        |
| Manager | Own project only | Global + Own project | Own project's memory, notes, and History only; no Global query beyond the Core         |
| Worker  | None             | None                 | None (no memory, notes, or History tools; only the dispatch briefing and the worktree) |

- Writing tools (`remember`, `revise`, `promote`, `forget`, `select`, `deselect`) omit `scope` and `target` parameters. Roles fix the write destination. The `#seq` identifier always addresses the agent's owned memory.
- Project facts learned by the Chief route to the Project Manager (`send_manager_msg` or `delegate` briefings). Manager sessions ignore unrelated personal user facts, leaving Tian to tell the Chief directly.
- Cross-scope read-only results include a header indicating the owner. This prevents agents from confusing external sequence numbers with their own.
- Candidate extraction (Memory Worker) and the UI Memory panel operate by scope without role restrictions. Candidates attach to the origin scope, and UI actions register as user operations.

### Conversation Boundary

Scope and role align: the Global Scope holds only Chief conversations (including every Goal conversation), and a Project Scope holds only its Manager conversation and its Worker conversations. So every boundary below is enforced by Scope alone.

Daily conversation stays with the Chief. Daily conversation is the content of Global-scope conversations, Global History, and Global Notes. The boundary is set by channel, not by content: the system cannot reliably tell a "daily" sentence from a "project" sentence, but it can enforce which channels a Manager reads.

Information from daily conversation reaches a Manager through two channels only:

1. **Global Core**: the explicitly selected, budgeted subset of active Global Memory, injected read-only. The Manager has no on-demand Global query (`recall` reads its own project only). A Global fact outside Core reaches the Manager only through `ask_chief`; a fact the Manager needs often belongs in Global Core.
2. **Chief messages**: delegation briefings, `send_manager_msg`, and answers to `ask_chief`. The Chief writes these for the Manager; they persist in `manager_messages` and the Manager transcript.

A Manager does not read:

- Global-scope transcripts or Global History. `search_history` / `read_history` stay inside its project. A Global Memory source ref (`conv:<id>#<entry>`) may appear in results, but the Manager cannot expand it.
- Global Notes.
- Global Memory outside Core, including Global candidates, superseded memories, and deleted memories.

Test: if a fact is not in Global Core and not in a message addressed to the Manager, the Manager does not know it. To pass something from daily conversation, the Chief selects it into Global Core (about Tian, valid for all projects) or sends it as a Chief message (about this project). The Manager `recall` takes no scope parameter: it searches this project's Memory only, so a Global fact outside Core is never readable.

#### Chief

The rule is symmetric: curated artifacts cross the boundary, raw conversation does not. The Chief reads a project's active Memory and Notes read-only. The Chief does not read project History (Manager and Worker transcripts, project events, and Tian's direct conversation with the Manager): `search_history` queries the Global scope only, and `read_history` refuses a ref that belongs to a project. Project progress reaches the Chief only through Manager reports (`report_chief`, delegated Task outcomes) and Manager answers.

#### Worker

A Worker has no memory. It has no memory of its own across Runs, receives no injected context, and has no memory queries — its prompt carries only the dispatch briefing, and its tools expose no Memory, Notes, or History access. Its only inputs are the dispatch briefing and the worktree (code and repository docs such as `AGENTS.md`). When the briefing is not sufficient, the Worker asks its supervising Manager. Project conventions that a Worker needs while it codes belong in the repository, not only in project memory.

## Core Memory

Core Memory is an explicitly selected subset of active facts rather than a truncated summary:

- New memories recorded via `remember` default to searchable (`core = false`). Marking an item persistent requires setting `core = true` or running `select #seq`.
- Running `deselect #seq` removes an item from Core Memory without deleting it. The item stays active and searchable via `recall`.
- Scope budgets default to 1,500 tokens, calculated from the fully rendered text (`ceil(UTF-8 bytes / 3)`). This covers sequence numbers, types, trust tiers, timestamps, provenance, line breaks, and usage footers (`core: N selected · X/1500 tokens`).
- Selection requests exceeding budgets reject atomically and return current usage and overflow counts. Runtime memory does not silently evict or truncate facts. An item past its `valid_until` cannot be selected into Core; a selected item leaves the rendering when it expires.
- Revisions prioritize correction. If revised text fits, it retains its Core position. If it overflows, the new fact saves while leaving Core Memory, prompting manual reselection or budget cleanup.
- Snapshots remain stable within conversations. Core Memory refreshes only when a new user turn starts and memory versions have changed. In-conversation writes communicate status via tool return values.

## Tools

- `remember`: Inserts a new memory; `core` is optional. `source: "user"` records a user source only when the request comes from a real user turn and the statement equals the whole input (or an anchored `remember: …` save request). Only a save request is a confirmation; equality with the whole input proves the source only, and the item stays a candidate. Unconfirmed tool writes are always candidates, never active.
- `promote`: Activates a candidate only when the current real user turn is an anchored `remember: <candidate text>` / `记住：<candidate text>` save request. Memory panel review uses the same confirmation record. Ordinary repetition, model inference, and a forged `source` cannot promote.
- Tools may pass `evidence_ref` / `excerpt` to cite an original history or notification entry. The service checks that the reference exists, belongs to the current scope, and that the excerpt occurs in the original text. A historical reference supplies evidence only; it cannot authorize a current user confirmation.
- `revise`: Supersedes an existing memory (creates a new `seq`, marks the older memory superseded, and links to the new entry). Corrections use `revise` instead of creating contradictory active entries. Revisions reference the current correction rather than old sources. Only an anchored save request or panel review performs the replacement. An unconfirmed revision (including a sentence identical to the user's words) only stages a candidate and keeps the target active; a missing or historical target `#seq` is an error, never an unrelated new fact. Omitted `conditions` / `valid_until` are inherited from the target, as in a direct revision, so a confirmed replacement does not turn a conditional or temporary fact into an unconditional, permanent one.
- `forget`: Soft-deletes memories; physical deletion never occurs.
- `select` / `deselect`: Manages Core status explicitly. Operations are idempotent via durable `taskId:callId`.
- `recall`: Keyword search. Multi-word queries match non-consecutive words with AND logic. Queries under 3 characters use substring matching. Results rank by FTS relevance and include `#seq`, type, date, conditions, and source reference. The `limit` caps result count, and token budgets enforce boundaries across full output strings. Queries returning no results return `(no matches)`.

## Provenance

Actors (who wrote the record: user / chief / manager / worker), sources (who stated the fact), and confirmations (who reviewed the stored text) record separately. Write targets follow agent roles:

- The service records `pi.user` entries during genuine user turns. Wakeups for goals, schedules, runs, and inboxes write `system.notification` entries. Worker turns use `worker.input`.
- The label `source: "user"` confirms the source only when stored text matches the whole current user input exactly after whitespace normalization (case, negation, punctuation, and paths are preserved). The single relaxation is an input anchored with `记住：` / `请记住` / `remember:` / `please remember` whose remaining text is exactly equal and contains no quotes. System wakeups, worker inputs, and summarized notifications fall back to `agent_inferred`. Source and confirmation are distinct: equality with the whole input proves the source only, and the item stays a candidate; only an anchored save request or panel review writes a confirmation record and activates it. Regardless of confirmation, `sourceRef` binds to the latest input entry (`conv:<id>#<entry>`).
- Image-only and empty inputs bind without user confirmation.
- Confirmed entries record references like `conv:<conversation>#<entry>`, readable directly by `read_history`.
- Revisions in the desktop Memory panel mark as `user_confirmed` with source `ui:memory-panel` and write to `memory_confirmations`.
- `observed_at` is when the source happened; `verified_at` is when the user reviewed or explicitly saved the fact. `select` / `deselect` change the view only, never a fact's times.
- `valid_until` applies only to memories with an explicit validity period. It normalizes to UTC ISO on write (a bare date means UTC midnight; a time must carry `Z` or an offset). Expired items leave default `recall`, Core, and the next `MEMORY.md` export, but remain reviewable via `include_history`. There is no frequency-based decay.
- `MEMORY.md` is a **timestamped snapshot**, rewritten only after commits. Without a new write, an old file can still list an expired item; the header time marks the snapshot. Runtime reads (Core, `recall`) filter by the current time every time and do not depend on the file.

## Deduplication and Idempotency

- Fact identity = text + `conditions` + `valid_until`. Within the same scope, a write with the same whitespace-normalized text, conditions, and expiry returns the existing `#seq`. Case sensitivity is preserved (`Foo` and `foo` remain distinct). `revise` and `promote` use the same identity rule; a revision that changes only conditions or expiry is versioned and supersedes the old row, never leaving two active rows.
- Duplicate writes that supply new evidence references or user confirmations append to `memory_evidence` / `memory_confirmations` and an `evidence` version record. They advance version numbers and update exports; repeating the same reference is idempotent. Calling `revise` with identical text follows this evidence path (`changed = false`, `evidenceAdded = true`). If wider metadata causes Core overflow, the entry leaves Core and reports `coreDropped`.
- Repeat requests with `core: true` validate budgets against final rendered collections. Budget overages roll back the entire transaction.
- Superseded and deleted records do not revive. Identical new content creates a fresh active record.
- Similarity only lists related facts in the review UI; it **never** discards candidates or decides replacements. Differences in negation, numbers, versions, and `with` / `without` are not absorbed by lexical similarity.
- Tool operations use durable `taskId:callId` operation IDs for idempotent replay. Concurrent outdated revisions reject under transactional checks.

## Candidate Extraction

The background worker in `worker/memory-worker.ts` runs inside the resident service without consuming Chief conversational turns. Triggers include task completions, conversation idle events (busy to idle transitions with 5-minute sweeps), and user corrections (`revise` / `forget`). It reads incremental History indexes and runs Extract → Classify → Deduplicate (exact-text deduplication and dismissed-text suppression only) → Persist. Related facts are review hints only and never set `supersedes` automatically. Automatic runs throttle to a 30-second minimum interval. Processing pauses during maintenance and shutdown.

- Candidates store as `status = candidate` and `trust_level = agent_inferred`. They never enter `wake()` prompt injections or read-only exports. Extraction and persistence execute in a single transaction. Errors roll back cursors.
- A candidate can list related active facts (the `supersedes` target always comes first, regardless of the similarity threshold and the five-item cap). Only when the user chooses "Confirm this replaces #seq" in the Memory panel does promotion supersede that fact, in the same transaction, with an optimistic check on the full old fact identity (any change to text, conditions, or expiry fails). Ordinary confirmation and promotion (including the `promote` tool) only activate the candidate; `supersedes` on the candidate is a review hint and never replaces a fact on its own. Promotion does not add the item to Core Memory.
- When the user revises a candidate during review, the old candidate stays as `superseded` history linked to the new version, and the new text becomes the active version. The returned `superseded` is the old candidate, not the new version.
- When extraction finds a fact identical to an active or candidate memory, it creates no candidate but appends the new source as evidence on that memory (trust does not rise: extraction is not confirmation) and notifies an open Memory panel to refresh.
- After a dismissal, the same full fact (scope, case-sensitive text, conditions, and expiry) is not extracted again. The suppression key includes the scope; whole-history similarity never permanently suppresses a new correction.
- The `MemoryExtractor` interface defaults to a deterministic heuristic (`Intl.Segmenter` multilingual tokenization; Chinese and English pattern tables in source) supporting offline tests. A Magpie-backed model extractor is reserved but not connected (PRD open question 6).

## Dreaming

Dreaming ([D30](decisions.md#d30--dreaming-proposes-the-user-decides-offline-memory-review-writes-candidates-only)) is an opt-in offline review in `worker/memory-dream.ts`. One Dream reads one Scope: its active memories and open candidates, plus that Scope's History `message` rows for `user` and `assistant` turns after the Dream's own cursor. It asks one model completion which memories the conversation shows to be wrong, outdated, or too narrow, and which lasting facts are missing. Every answer becomes a candidate with validated evidence; the user decides, as for any other candidate. Dreaming is off by default.

- **Enable.** Set `dreamModel` in `settings.json` to `{ "provider": "<provider id>", "modelId": "<model id>" }`. An absent setting, or a model that is no longer in the provider catalog, means off. There is no Settings page and no socket command yet (D30 "Not in this decision").
- **Inputs.** Memories with `#seq`, kind, conditions, and expiry; then History rows with `ref` and timestamp. Tool calls, tool results, Events, `system.notification` rows, and `worker.input` rows never enter the prompt. A prompt is bounded by `DREAM_INPUT_BUDGET` (24,000 estimated tokens, `ceil(UTF-8 bytes / 3)`). Rows that do not fit wait for the next Dream, and the cursor advances only past rows the Dream read. A row that alone exceeds the remaining budget is shown truncated, but its evidence excerpts validate against the full original text.
- **Model call.** One `Models.completeSimple` completion through the provider registry, with no tools, outside any database transaction, capped at `DREAM_MAX_OUTPUT_TOKENS` (4,000). The prompt states what memory is for and the JSON contract. It does not impose fixed rules about what to record, and it frames History as data that is never followed as instructions.
- **Proposals.** At most `DREAM_MAX_PROPOSALS` (8), each one of `revise #seq`, `new`, or `support #seq`, each citing 1–3 evidence items `{ ref, excerpt }`.
  - `revise` becomes a candidate with `supersedes = #seq`. Conditions and expiry carry over unless the proposal sets them.
  - `new` becomes an ordinary candidate with `supersedes = null`; its kind defaults to `fact`.
  - `support` appends evidence to the target and changes nothing else: not text, status, trust, Core, or `verified_at`.
- **Validation.** A proposal is dropped and counted by reason when a rule fails: `cap` (beyond the per-Dream cap); `invalid` (unknown type, missing fields, bad kind, or text that is not one line of at most 1,000 Unicode code points); `evidence` (no evidence, more than 3 items, a `ref` outside this Dream's input, or an `excerpt` that is not verbatim in its source, checked by `resolveMemoryEvidence`); `instruction` (text matching the extraction instruction patterns); `target` (the target no longer exists, changed status or fact identity between the read and the commit, or is not active for `revise`); `unchanged` (a `revise` that changes nothing); `dismissed` (the identity was dismissed in this scope). An exact duplicate of an active memory or candidate adds evidence to it and counts as a duplicate.
- **Hard limits.** A Dream never writes an `active` row, `core = true`, a confirmation record, `verified_at`, a deletion, or a Core selection, and never calls `promote`, `forget`, `select`, or `deselect`. Candidates carry actor `worker`, trust `agent_inferred`, and a version reason that starts with `dream`.
- **Gates.** At most one Dream per Scope per `DREAM_INTERVAL_MS` (24 hours), only when at least `DREAM_MIN_NEW_MESSAGES` (20) eligible rows are pending, never while the service is paused or closing, and with a `DREAM_FAILURE_BACKOFF_MS` (1 hour) back-off after a failed run. The service checks the gates every 15 minutes.
- **Failures.** A model error or unparsable output changes no memory and keeps the cursor; the run is recorded with its error.
- **Records.** Each run writes `memory_dream_runs` (scope, start and finish time, model, counts per outcome and drop reason, token usage, error) and a `memory.dreamed` Event; a failed run names its error in the Event summary. Like `memory_worker_runs`, the table is created idempotently by its module and does not bump `DATABASE_VERSION`.
- **Scope.** A Dream reads and writes one Scope only, so the [Conversation Boundary](#conversation-boundary) holds without new rules. The Global Dream sees Global Memory and Global History; a project Dream sees that project only, and a ref from another Scope is dropped.

## Relevant Context

- Core Memory is an explicit snapshot that stays stable per turn. A separate `<relevant_context>` with its own budget (default 1,200 tokens) lexically retrieves Memory, Notes, and History for the current input and the running Task. It never loads all memory and never crosses the [Conversation Boundary](#conversation-boundary): the Chief's relevant context searches Global only, and a Manager's searches its own project only.
- Retrieval uses the shared `planSearch` and a few explicit aliases (such as `中文` ↔ `Chinese`, `postgres` ↔ `PostgreSQL`). This is explainable lexical retrieval, not semantic understanding.
- Workers receive no relevant context ([Worker](#worker)).
- Old transcript evidence of superseded or deleted memories does not return through task-related History: only the sentences that carry the old assertion are removed from the History entry, and unrelated sentences in the same entry stay retrievable. If the old assertion cannot be located in the entry (for example, a rewritten claim that cites the whole entry), the whole entry is omitted.
- Extraction runs log to `memory_worker_runs` (trigger, source, candidate, and duplicate counts) and record `memory.extracted` audit events.

## File Locations and User Review

- Project memory lives in `<project root>/memory/`. Global memory lives in `<dataDir>/scopes/global/memory/`. Long documentation stores as Markdown in `<scope root>/notes/`.
- Opening a scope for the first time imports legacy `LOG.txt` files inside an atomic transaction. Files move to `memory/legacy/` only after commits succeed. Legacy trees move to legacy folders and are not imported.
- Initialization completes and commits before running business transactions. Rollbacks reload stores from committed states.
- Database upgrades perform deterministic Core selections for legacy data (prioritizing user-confirmed items, preferences, and decisions against token budgets). Remaining active items stay searchable.
- The Context Pane contains a Memory panel. It displays candidates, Core facts, and searchable non-resident items alongside Core token usage. Users can promote, dismiss, select, deselect, or revise records (operator: `user`), and expand evidence, confirmation records, and times. All changes persist in version history.

Agents and users determine what to remember. Vector indexes are not present in MVP; Dreaming is opt-in and works without them (see [Dreaming](#dreaming)). Note searches share query plans with Memory and History (`worker/search.ts`), returning bounded snippets with `file.md:<line>` references.
