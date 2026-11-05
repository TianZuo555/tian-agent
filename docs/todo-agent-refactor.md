# Agent Roles, Providers, and Worker Runtimes Refactor (M6 TODO)

**English** | [简体中文](zh/todo-agent-refactor.md)

This document tracks the M6 refactor ([prd.md](prd.md#m6--role-boundaries-providers-worker-runtimes-partial)). The design lives in the linked documents; this file holds only the work list. Each phase ships and is verified on its own with `mise run verify`. Tests use fakes and make no model calls.

## Design Sources

| Topic                                 | Document                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Roles and terms                       | [CONTEXT.md](../CONTEXT.md) (Chief, Worker, Manager, Scope, Intent)           |
| Conversation and memory boundary      | [memory.md](memory.md#conversation-boundary)                                  |
| Dispatch ownership                    | [agent-work.md](agent-work.md#dispatch-ownership)                             |
| Goal conversations in Global          | [agent-work.md](agent-work.md#goals)                                          |
| Worker runtimes, Intents, concurrency | [agent-work.md](agent-work.md#worker-runtimes)                                |
| Project entry routing                 | [channels.md](channels.md#telegram)                                           |
| Providers and credentials             | [D21](decisions.md#d21--model-providers-are-pluggable-magpie-is-one-provider) |
| Sandbox                               | [todo-worker-sandbox.md](todo-worker-sandbox.md)                              |

## Phase 1: Role and Memory Boundaries

This phase only tightens and removes. It adds no feature.

- [x] **Scope and role align.** Goal conversations move to the Global Scope (`openSession({ channel: 'goal', … })` in `src/worker/service.ts`); a Goal keeps its project reference. New Chief conversations open only in Global. Decided later: schema bumps do not migrate data — an older database is snapshotted to `tian.db_v<N>.backup` and recreated empty, so no Chief conversation is carried into a Project Scope ([service.md](service.md#service-upgrades); `DATABASE_VERSION` is now 13). Test: every conversation in a Project Scope is a Manager or Worker conversation; an older database is snapshotted and recreated empty.
- [x] **Project entry points route to the Manager.** Telegram and WeChat `/scope <project>`, and desktop entries under a project, open the Manager conversation. Manager replies forward to the chat. Test: a message after `/scope <project>` lands in the Manager conversation, and the reply returns to the chat.
- [x] **The Manager sees only Global Core.** Remove `scope` from the Manager `recall` (`src/worker/manager-tools.ts`) and update the `MEMORY` prompt section. Test: the Manager `recall` returns no Global row, also with `include_history=true`.
- [x] **The Chief reads no project History.** Limit the Chief `search_history` / `read_history` (`src/worker/tools-history.ts`) to Global. Read-only project Memory and Notes stay. Test: a term from a project transcript is not found from the Chief; `read_history` on a project ref fails.
- [x] **A Worker has no memory.** Remove `<relevant_context>` and the notes pointer from the Worker prompt (`src/worker/agents.ts`); remove the Worker `recall` and `read_history` (`src/worker/worker-tools.ts`). Test: the Worker prompt has no `<relevant_context>`; the Worker tool list has no memory or history tool.
- [x] **Only the Manager dispatches.** Remove the Chief `dispatch` (`src/worker/tools.ts`) and the Chief `send_run_msg` / `stop_run` on project Runs. Rename the Worker `ask_chief` / `tell_chief` to `ask_manager` / `tell_manager`. Bump `SERVICE_PROTOCOL` if contracts change. Test: the Chief tool list has no `dispatch`; a Worker question wakes the Manager.
- [x] **Docs.** Remove the "Proposal" markers and "Code gap" paragraphs from memory.md (Conversation Boundary), agent-work.md (Dispatch Ownership, Goal Conversation), and channels.md. Update D12 and D18. Add an acceptance scenario for the boundary to PRD §10. Mirror every change in `docs/zh/`.

## Phase 2: Providers (D21)

- [x] **Credential store.** Implement pi-ai `CredentialStore` (`read` / `list` / `modify` / `delete`) on a 0600 secret file in the data directory, written only by the service. Test: the file mode is 0600; `list()` returns no secret.
- [x] **Provider registry.** Register each configured provider with Pi at startup. Magpie becomes a preset entry (`src/worker/magpie.ts`). `MAGPIE_*` environment variables stay as a compatibility input for one release.
- [x] **Dynamic catalogs.** Generalize the Magpie discovery and offline cache to every gateway provider. Built-in providers use the pi-ai catalogs.
- [x] **Settings → Providers.** Add, edit, and remove providers. A secret shows its last characters only. UI strings go in `src/renderer/i18n/en.ts` and `zh.ts`; the page passes the `jsx-a11y` rules.
- [x] **OAuth login.** `models.login(provider, 'oauth', { prompt, notify })`; the page shows `auth_url` / `device_code` events and answers prompts. Test with a fake provider.
- [x] **Role models.** A Chief model, a default Manager model, and a per-project Manager override. A change applies from the next turn of the existing conversation.
- [x] **Docs.** Set D21 to accepted and D2 to superseded; update the index table and metadata at the top of decisions.md. Update the PRD header (Technical Direction) and PRD §13 question 6. Mirror in `docs/zh/`.

## Phase 3: Runtime Abstraction and Intents (Pi Only)

- [x] **Multi-runtime `WorkerRuntime`** (`src/worker/runs.ts`). A Run's runtime is fixed at creation. The Run stores the resolved runtime, model, and thinking level. Follow-up Attempts use the same runtime.
- [x] **Intents in Settings.** Each Intent has a name, runtime, model, thinking level, and purpose description.
- [x] **Project default Intent** replaces `projects.agent_kind` (schema migration).
- [x] **Dispatch choice.** `dispatch` accepts `intent`, or an explicit `runtime` + `model` (+ `thinking_level`). Both is an error; neither applies the project default Intent. Explicit choices use an enabled runtime. The Manager `<state>` lists Intent names and descriptions. Revise D13. Test: each of the three cases.
- [x] **Concurrency.** Move `MAX_ACTIVE_ATTEMPTS` to Settings (default 3). Add an optional per-runtime cap. An attempt waiting only for a full runtime does not block later attempts. Chief and Manager turns stay uncapped. Test: queue order when one runtime is full.
- [x] **Docs.** Rewrite the Intent and concurrency parts of Worker Runtimes as current state. Mirror in `docs/zh/`.

## Phase 4: First External Runtime: Codex

- [x] **Adapter.** Run `codex exec --json` in the Run worktree with the briefing as the prompt. Parse the event stream for `run_progress`. Store the session id on the Run. The report is the final text or `TIAN_REPORT.md`. Check flags and event formats against the Codex source.
- [x] **Stop.** `stop_run` terminates the process tree; the worktree stays.
- [x] **Follow-up.** `codex exec resume <session>` in a new Attempt.
- [x] **Restart resume.** The service stop kills the codex process group. Automatic resume in the same Attempt, with the five guards in [agent-work.md](agent-work.md#worker-runtimes): snapshot commit first, resume prompt with the last tool call, at most one automatic resume per Attempt, non-blocking Manager notice, original deadline and immediate slot. The last tool call is stored on `runs.external_last_call`, so it survives the restart. A missing session id or a failed resume ends the Attempt as `interrupted`.
- [x] **Enable flow.** Installed-and-signed-in check in Settings. An expired sign-in shows "sign-in required", not a generic failure.
- [x] **Interim security floor.** Environment allow-list (mandatory), `--sandbox workspace-write`, and a per-runtime opt-in that states the runtime can reach the service socket and its own configuration.
- [x] **Usage.** Record token usage when the event stream reports it.
- [x] **Tests** with a fake `codex` binary: start, progress, stop, follow-up, restart resume, and a second kill in one Attempt that ends as `interrupted`.
- [x] **Docs.** Rewrite the external contract in Worker Runtimes as current state. Mirror in `docs/zh/`.

## Phase 5: Unified Seatbelt Sandbox

Target state. It does not block phases 1–4.

- [x] Finish [todo-worker-sandbox.md](todo-worker-sandbox.md) phases 0–3 for Pi Workers.
- [x] Verify nested Seatbelt on macOS: Codex inside an outer profile. (Real `codex exec` run OK; ~/.codex must be fully writable.)
- [x] Map Codex state: `$CODEX_HOME` writable; `config.toml`, `AGENTS.md`, and `AGENTS.override.md` read-only.
- [x] Wrap the external CLI process in the shared profile: writable worktree and session storage, read-only configuration, denied service socket, network allowed. Turn off the CLI's own sandbox inside.
- [x] Remove the interim opt-in warning for sandboxed runtimes. Update PRD §13 question 8. Mirror in `docs/zh/`.
