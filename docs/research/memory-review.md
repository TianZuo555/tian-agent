# Memory System Research: OpenClaw, Hermes, and Tian Agent

**English** | [简体中文](../zh/research/memory-review.md)

Research Date: 2026-10-18. This document records architectural analysis and improvement recommendations at the time of study. It preserves facts and conclusions from that date and does not supersede [D4](../decisions.md). Recommendations such as removing the summary tree, switching to explicit Core Memory selection, multi-word and short-word search, provenance validation, transcript pagination, and exact deduplication have been implemented. For current implementations, see [memory.md](../memory.md), [D4](../decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection), and [D6](../decisions.md#d6--history-is-a-derived-index-of-pi-transcripts-business-facts-write-to-events). In this text, "current implementation" refers to the system state on the research date.

## Conclusions

Retain Tian Agent's SQLite single-source storage, Global and Project scopes, provenance and version audit logs, derived History indexes, and user correction tools. Transition Core Memory into a compact set of explicitly selected facts, while routing remaining active memories, notes, and history through on-demand search. Prioritize correctness and retrieval gaps before adding vector embeddings.

Remove the recursive summary tree that compressed memories sequentially and demanded immediate Chief consolidation. That mechanism addressed token length without deciding which facts deserved persistence. It introduced extra tool calls, redundant summarizations, and concurrency invalidations.

Borrow Hermes patterns for compact persistent facts, capacity feedback, and exact deduplication. Borrow OpenClaw patterns for traceable search, provenance constraints, pre-compaction flushes, and background consolidation. Avoid file-only storage, complex multi-backend architectures, full dreaming loops, or knowledge graphs.

## Research Scope and Sources

- Inspected official documentation and open-source repositories for OpenClaw and Hermes. OpenClaw background systems were evaluated from documentation without running full deployments. Hermes was analyzed from code without end-to-end benchmarking.
- Upstream commits: OpenClaw `c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0`, Hermes `9e01b44dd23978f9ff40b7837467f3a9f1582130`.
- Evaluated against checkout code. Earlier PRD sections for F01, F02, and F05 had drifted behind implementation.
- Executed 18 memory and history test suites with zero failures; performed five targeted reproductions using temporary databases. Tested without live model calls to evaluate system mechanics rather than model generation quality.

## System Comparison

| Dimension           | OpenClaw Default Core                             | Hermes Built-in Memory                                    | Tian Agent (At Research Date)                                       |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Authoritative Store | Workspace Markdown; SQLite holds search and state | `MEMORY.md`, `USER.md`; SQLite stores sessions            | Memory in SQLite; Markdown is a read-only export; Notes in Markdown |
| Persistent Content  | Curated long-term facts and user profiles         | Two small memory files                                    | Active memory and summary nodes for Global and Project scopes       |
| Budget              | Injected budget; detailed notes stay in history   | 2,200 + 1,375 characters default                          | ~1,500 tokens per scope (`ceil(UTF-8 bytes / 3)`)                   |
| Budget Management   | Curate, organize, and truncate on overflow        | Rejects over-budget writes; agent merges or deletes       | Tasks summarize regardless of budget; injections truncate edges     |
| Long-term Search    | Keywords + vectors, MMR reranking                 | Small files stay in context; external providers available | `recall`: trigram FTS / `LIKE`, ordered by sequence                 |
| Session Search      | Dedicated session search; semantic search         | `session_search`: FTS, pagination, scrolling              | `search_history` / `read_history`: messages, tools, events          |
| Auto-Organization   | Pre-compaction flush, background dreaming         | Explicit memory tools and background review               | Chief writes and processes `nap`; no background extraction          |
| Correction          | Supersession and organization                     | Patch / remove with capacity checks                       | Supersede / soft delete / version audit logs                        |
| Snapshots           | Refreshes eligible core content per turn          | Freezes at session start                                  | Freezes within turn; refreshes on new user turns                    |

File-first and database-first designs serve different needs. Tian Agent benefits from SQLite for its resident service, multi-channel inputs, concurrent sessions, UI corrections, and auditability.

## Lessons from OpenClaw

### Separate Compact Core Facts from Searchable Archives

OpenClaw separates user profiles (`USER.md`), curated memories (`MEMORY.md`), daily logs, and transcripts. Retaining long-term facts does not require injecting everything into every prompt.

Tian Agent should focus on selecting Core Memory facts explicitly rather than adding daily log files. Existing History, Event, and Note stores provide sufficient detail and audit trails.

### Connect Search Results to Underlying Evidence

OpenClaw searches snippets with `memory_search` and inspects origins with `memory_get`. Hybrid search balances fuzzy semantic queries with exact identifiers, using MMR to suppress redundant results.

Tian Agent should align search query syntax, ranking, budgets, and citation formats across Memory and Notes first. Vector embeddings can serve as derived rebuildable indexes later if evaluations demonstrate measurable improvements in recall.

### Run Maintenance in Background Without Blocking Responses

Flushing before compaction gives agents an opportunity to persist unsaved observations. Background dreaming manages consolidation under budget and conflict rules.

Tian Agent can adopt incremental cursor-based review: process immediate requests when users state preferences, and defer extraction until tasks complete or conversations idle.

### Validate Provenance During System Operations

OpenClaw categorizes sources into owner, agent, untrusted, and system, preventing recalled content from re-extracting with artificially inflated weights.

Tian Agent must record verified evidence references. An agent stating `source = "user"` does not constitute user confirmation without runtime verification.

## Lessons from Hermes

### Use Token Budgets for Selection, Not Complete History

Hermes uses small defaults (2,200 characters for `MEMORY.md` and 1,375 characters for `USER.md`). Capacity overages report usage and active lines, allowing agents to prune or combine items in batches.

Tian Agent should let models inspect budget usage and select facts explicitly. Unselected facts remain active and searchable in SQLite.

### Enforce Exact Deduplication and Clean Mutations

Hermes ignores exact duplicates and requires unique matches for patch operations. These practical constraints simplify maintenance.

Tian Agent already maintains `#seq` identifiers and supersession chains. Adding exact string deduplication and idempotent operation IDs avoids duplicate entries.

### Support Continued Reading from Session Searches

Hermes allows agents to scroll forward and inspect full message text from search hits without requiring prior summarization.

Tian Agent has search tools for history; the primary improvement is supporting offset-based pagination across long tool outputs.

### Avoid Freezing Snapshots Across Long Conversations

Hermes freezes snapshots at conversation launch, requiring new sessions to observe updates. Tian Agent shares memory across desktop, Telegram, and WeChat channels. Updating snapshots at the start of new user turns aligns better with user expectations.

## Existing Strengths in Tian Agent

- Centralized writes for `memories` and `memory_versions` via the resident service; revisions preserve historical links.
- Clear injection boundaries between Global and Project scopes with explicit cross-scope query tools.
- History derives from Pi transcripts as a rebuildable index, indexing Chief, Worker, and Event records.
- Multi-word AND search, short-word substring matching, relevance ranking, timestamps, and citations.
- Worker read-only access to memory with desktop UI support for corrections and dismissals.
- Versioned refreshes on new user turns without forcing session termination.

Relevant code: [memory.ts](../../src/worker/memory.ts), [history.ts](../../src/worker/history.ts), [tools.ts](../../src/worker/tools.ts), [tools-memory.ts](../../src/worker/tools-memory.ts).

## Confirmed Issues and Priorities

### P0: Outdated Summaries Reintroduce Corrected Facts

Location: `nextMerge()`, `revise()`, and `nap()` in `memory.ts`.

Reproduction:

1. Write "user drinks coffee" and "project uses SQLite". Conversation A receives inputs for range 0–1.
2. In another channel, user corrects preference to "user drinks tea". Sequence #2 supersedes the old entry.
3. Conversation A finishes summarizing its earlier input: "user drinks coffee; project uses SQLite".
4. Calling `nap()` accepts the outdated summary. Core Memory now contains both coffee and tea.

Fix: Validate source revisions and hashes within the submission transaction. Reject outdated submissions.

### P1: Summary Trees Compress Too Early and Ignore Budgets

Location: `wake()` in `memory.ts`, `mergeNotice()` in `tools-memory.ts`, and mandatory `nap` instructions in `tools.ts`.

Reproduction: In a clean database, insert 8 short facts. After all merges finish, 7 summary records write. With a 1,500-token budget, `wake()` outputs only the single root summary `#0-7 ...`.

Fix: Stop mandatory summarization. Display original important facts when budgets permit.

### P1: Memory Retrieval Weaker Than History Search

Location: `recall()` in `memory.ts`.

Reproduction: After saving `Project uses SQLite for durable memory`, querying `recall('SQLite')` succeeds, but `recall('SQLite memory')` returns empty because the query is evaluated as a single strict phrase.

Fix: Share the multi-word AND search rules and token budget truncations from History. Rank results by relevance and display provenance.

### P1: Provenance Missing from Corrections and Injections

Location: `tools-memory.ts`, `memory.ts`, `wake()`, `recall()`.

- Source references lacked entry-level precision (`conv:<id>` without entry offsets).
- Revisions through the Chief defaulted to `actor = chief` and marked user corrections as `agent_inferred`.
- Revisions reused old source references rather than pointing to the correction turn.
- Core and recall outputs omitted confidence, provenance, and timestamps.

Fix: Distinguish actors from originators, attach entry references, and format provenance clearly in recalled text.

### P1: Exact Duplicate Memory Insertions

Reproduction: Repeatedly running `remember` with identical text creates multiple active records and schedules duplicate summary tasks.

Fix: Implement exact string deduplication per scope after whitespace normalization. Return existing `#seq` values and record supplementary evidence versions.

### P1: History Search Truncates Long Messages Without Pagination

Location: `history.ts`.

Tool results truncated at 2,000 characters and arguments truncated at 400 characters during indexing. Reading entries truncated at 1,200 characters without continuation offsets.

Fix: Preserve source boundaries during indexing. Provide pagination offsets in `read_history` to expand entries from raw transcripts.

### P2: Length Limits, Exports, and Unused Schema Fields

- **280 UTF-8 Byte Limit**: Restricts Chinese text to approximately 93 characters. Separate individual item length rules from total prompt token budgets.
- **Export Redundancy**: Exports contained both raw entries and summary nodes. Export active facts clearly.
- **Confidence Field**: Unused by selection or ranking logic. Keep discrete `trust_level` values.
- **Goal Associations**: Memory fields supported `goal_id`, but injections did not prioritize them.
- **Documentation Drift**: PRD documentation lagged behind implementation.

## Target Architecture

Retain core entities while simplifying selection and maintenance:

```text
Pi Transcripts + Events ───────────> Derived History Index ──> search / read
                │
                └─ Cursor-based Background Extraction ──> Memory (SQLite with Provenance)
                                                                ├─ Explicit Core ──> Prompt Injection
                                                                └─ Searchable ─────> On-Demand Search
Notes (Markdown documents) ─────────────────────────────────────> Chunk Index / Search
```

Mark Core entries with an explicit flag. Group user preferences by kind in prompt sections.

Selection rules: Prioritize explicit long-term preferences, active constraints, and project conventions. Defer temporary notes and execution logs to History and Notes. When Core Memory fills, prompt agents to merge or remove entries. Deselecting an item preserves it in active storage and search.

## Phased Implementation Roadmap

| Step | Work Item                                                                      | Success Criteria                                                                    |
| ---- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1    | Fix outdated summary submissions, validate provenance, add exact deduplication | Outdated submissions reject; corrections link to fresh evidence; duplicates merge   |
| 2    | Add multi-word search, ranking, and budgets to Memory; add History pagination  | Non-consecutive queries match; long outputs paginate; entries include citations     |
| 3    | Implement explicit Core selection and phase out the summary tree               | Key preferences remain visible without forced summarization; full history preserved |
| 4    | Add Note snippet search and cursor-based background review                     | Cursor tracking, idempotency, and bounded review runs without excess model calls    |
| 5    | Evaluate vector embeddings against benchmarks                                  | Clear gains on fuzzy and multilingual search; graceful fallback to keyword search   |

Avoid dedicated vector databases, external plugin frameworks, or deep multi-phase dreaming until verified test cases justify their operational overhead.

## Verification Record

Command: `mise exec -- pnpm exec tsx --test tests/memory.test.ts tests/history.test.ts`.

Result: 18 / 18 passed. Retrieval latency across 5,000 fixture entries in History was approximately 1.2ms. This measures local test performance and does not represent live p95 latency with transcript synchronization.

Reproduction script results:

| Scenario                               | Observed Result                                        |
| -------------------------------------- | ------------------------------------------------------ |
| 8 facts complete all merges            | 7 summary writes; Core contains only one root summary  |
| Search non-consecutive `SQLite memory` | `(no matches)`                                         |
| Write identical text twice             | Two active Memory records created                      |
| Submit outdated summary after revision | Core contains both old "coffee" and new "tea"          |
| Chief corrects preference for user     | `agent_inferred`, still referencing older conversation |
| 94 common Chinese characters           | Rejected for exceeding 280-byte limit                  |

These scenarios test storage and selection behavior, not model memory quality. This research added documentation only and did not modify runtime code.

## Sources

- [OpenClaw Memory overview](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Memory architecture](https://docs.openclaw.ai/concepts/memory-architecture)
- [OpenClaw Memory search](https://docs.openclaw.ai/concepts/memory-search)
- [OpenClaw Hybrid Search source](https://github.com/openclaw/openclaw/blob/c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0/extensions/memory-core/src/memory/hybrid.ts)
- [OpenClaw repository](https://github.com/openclaw/openclaw/tree/c7dcd3412d3a88f6fbb84e4b251b3ce6f4b985a0)
- [Hermes Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes MemoryStore source](https://github.com/NousResearch/hermes-agent/blob/9e01b44dd23978f9ff40b7837467f3a9f1582130/tools/memory_tool_store.py)
- [Hermes Session Search source](https://github.com/NousResearch/hermes-agent/blob/9e01b44dd23978f9ff40b7837467f3a9f1582130/tools/session_search_tool.py)
- [Decision D4](../decisions.md#d4--memory-uses-sqlite-as-single-source-of-writes-core-memory-changes-to-explicit-selection)
- [Decision D6](../decisions.md#d6--history-is-a-derived-index-of-pi-transcripts-business-facts-write-to-events)
