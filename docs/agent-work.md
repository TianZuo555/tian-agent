# Goals, Tasks, and Runs

**English** | [简体中文](zh/agent-work.md)

Users manage goals; agents manage tasks. A Goal is a long-term outcome. A Task is a concrete unit of work. A Run is a single execution performed by a Worker for a coding task inside an isolated Git worktree.

## Goals

A Goal belongs to a Scope and contains an objective, success criteria, constraints, current state, next action, last execution timestamp, and daily execution budget stored in the `goals` table. The Chief maintains records using `create_goal`, `update_goal`, and `list_goals`. Users create, edit, pause, resume, or cancel goals inside the Goals view.

- **Goal Conversation**: Each Goal obtains a dedicated Chief conversation via `openSession({ channel: 'goal', externalId: goalId, scopeId: 'global' })`. The conversation always lives in the Global Scope, also for a Goal that concerns a project: the Goal keeps the project reference, and project work goes through `delegate` ([memory.md](memory.md#conversation-boundary)). This binding persists across restarts, and wakeup notifications deliver to this conversation only.
- **User Notices**: Calling `notify_user(goal, fingerprint, text)` records items needing user attention into `user_notices`. The same fingerprint for a Goal delivers at most once in a 24-hour window. Tasks with `outcome = no_change` produce no notice. The Goals view presents active notices.

## Tasks

Task state transitions follow: `pending → running → waiting_approval → completed`, with additional states `paused`, `blocked`, `failed`, and `cancelled`. The module `db.ts` validates transitions and rejects illegal moves. The system records `outcome` separately (achieved, not_achieved, or no_change) alongside a summary. The fields `trigger` (manual / schedule / event) and unique `dedupe_key` track origins. Restarts or repeat triggers never create duplicate Tasks.

## Scheduling

The `schedules` table persists cron rules, timezones, and the calculated `next_fire_at`. An internal timer sleeps until the earliest trigger point (capped at 60 seconds without blocking process termination). Each trigger executes in a single transaction:

1. Create a Task in the Global Scope (`dedupe_key = sched:<schedule>:<fire_time>`); a Goal's own Tasks are Chief work, also when the Goal concerns a project.
2. Deliver a notification to the Goal conversation (containing Goal state and Task summary only; does not rebuild full history).
3. Advance `next_fire_at` from the current time. Triggers missed during sleep or shutdown merge into one event.

The Goal parameter `max_runs_per_day` caps daily executions. Excess executions create a `blocked` Task with deduplicated user notices rather than silently dropping work.

Coding tasks dispatch via `dispatch`, which accepts a `task` argument linking the Run to its parent Task (`runs.task_id`). Run completion does not equal Task completion. The dispatching Project Manager evaluates the result, calls `complete_task` or `fail_task`, and reports to the Chief, who updates the Goal state via `update_goal`.

## Project Manager

The Project Manager is an agent between the Chief and Workers. Exactly one persistent conversation exists per project (`channel_sessions` with `channel = 'manager'`, `external_id = project_id`), created during `addProject` with a required Manager name. In addition to Chief delegations, Tian can open this conversation directly via `openManager(projectId)` (the Manager button in the sidebar) to assign work.

- **Direct Assignment by Tian**: When turn inputs have `kind = 'user'`, the turn belongs to Tian. Work assigned here becomes the Manager's own Task (`add_task` → `start_task` → `complete_task` / `fail_task`), concluding quietly without notifying the Chief. The `ask_chief` tool blocks during Tian turns and prompts the Manager to ask Tian directly. The `report_chief` tool permits only delegated Tasks carrying `assignee = 'manager'` to report back. These tool guards prevent unnecessary notifications to the Chief.
- **Delegation as a Task**: The Chief calls `delegate(project, title, briefing, goal?)` in a single transaction to create a Task with `assignee = 'manager'` and `report_to = <chiefConversationId>`, records a `delegation` message, and wakes the Manager. The Manager executes the workflow: `start_task` → `dispatch` → `complete_task` / `fail_task`. Concluding a delegated Task notifies the Chief recorded in `report_to`. The Chief cannot call `start_task`, `complete_task`, or `fail_task` on delegated Tasks.
- **Reporting and Inquiries**: The Manager calls `report_chief(text, task?)` to provide updates. Calling `ask_chief(question, task?, wait_seconds?)` records a question and blocks until an answer arrives matching `reply_to`. Irrelevant messages are ignored. Timeouts close the question atomically. The Chief replies using `send_manager_msg(project, body, reply_to?, task?)`. Waiting questions return immediately without waking the agent. Late answers trigger a wakeup notification.
- **Redistribution**: The Manager calls `dispatch(prompt, task?)` to assign coding work to Workers. The parameter `chief_conversation_id` points to the Manager conversation. Worker questions and completion notices route back to the Manager, who closes the Task and reports to the Chief.
- **Scope Boundaries**: Manager tools lock to their project scope. Tasks, notes, history, and Runs operate within the project only. Dispatches accept project Tasks only. The Manager is the sole agent writer for project memory and notes. Of Global memory it sees only the injected Global Core, read-only ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects)). The Manager has no shell or coding tools.

### Dispatch Ownership

Only a project's Manager dispatches Workers in that project, and the Manager is the supervisor of every Run it dispatches. All coding work follows one path: Chief `delegate` → Manager → `dispatch` → Worker. The service rejects any dispatch whose supervising conversation is not a Manager conversation.

- Reason: the dispatch briefing is the Worker's only input ([memory.md](memory.md#worker)), and a useful briefing needs project memory, which only the Manager has. Run results also become project experience, which the Manager records.
- The Chief has no `dispatch`, `send_run_msg`, or `stop_run` on Runs. It follows code work through Manager reports, the run inspection tools, and the UI Run panel, and steers through `send_manager_msg`.
- Worker messaging tools follow the supervisor: `ask_manager` / `tell_manager` / `check_msgs`. Runs record the supervisor in `chief_conversation_id`, which now always holds the Manager conversation; `agent_messages` senders are `manager` and `worker`.
- Trade-off: a small change takes one more hop (delegation, then dispatch), with more latency and tokens.

## Run Lifecycle

```text
Execution Status:
dispatch → queued → running → collecting → done / failed
            │         │           │
            └── stop ─┴─ discard ─┴──→ interrupted
done / failed / interrupted ── follow-up ──→ queued (next attempt)

Review Status (recorded independently):
pending → landing → landed
       ↘ shipping → shipped → landing
       ↘ discarding → discarded
landing / shipping / shipped ── discard ──→ discarding
```

- One module owns these rules: [`src/shared/run-lifecycle.ts`](../src/shared/run-lifecycle.ts). It holds both transition tables, the gate for each action (stop, follow-up, land, ship, discard), and the status a person or an agent reads. `Db.patchRun` refuses any status change the tables do not allow. The service, the agent tools, and the Run panel all use the same gates, so the UI shows a button only when the service accepts the action. Change a rule in that module and in its test, `tests/run-lifecycle.test.ts`, never at a call site.
- A failed land or ship keeps its `landing` or `shipping` status and the error. It stays retryable and discardable, and the Run panel shows the stored error. A deadline that passes while an attempt waits for a slot moves `queued` straight to `collecting`. A queued attempt that cannot start fails directly.
- Agents read the Review after the status once a Review began, for example `done, landed` or `interrupted, discarded` (`list_runs`, `run_progress`).
- Git projects must create an isolated worktree. Worktree failures stop execution immediately. Non-Git projects reject runs by default and require `allowInPlace` to edit files in place.
- Runs store the dispatch directory, base branch, execution mode, and deadline.
- Follow-up attempts create new attempts, inputs, results, and reports while reusing the same Worker conversation and worktree.
- Dispatches use stable operation IDs and turn inputs use stable request IDs. Durable submission status determines completion. An idle agent does not mean success. Git commit failures transition Runs into failed states.
- Run state transitions and reviews execute serially. Discard operations abort Workers first; collectors cannot overwrite discarded states.
- A global cap limits worker attempts that run model work at the same time (`MAX_ACTIVE_ATTEMPTS`, default 3). Excess attempts wait in queue order outside the Run lock, so `stop` and `discard` still work while a Run waits. A Run that waited keeps its original timeout, but its clock starts when the attempt begins. Attempts that had already started before a restart claim their slot at once and never wait.
- Git subprocesses disable interactive prompts (`GIT_TERMINAL_PROMPT=0`) and time out after 10 minutes; hooks on commit or merge can run slowly. `gh` calls keep a 120-second limit with `GH_PROMPT_DISABLED=1`.
- Land merges the Run branch into the designated base branch. It requires the main checkout to sit on that branch without uncommitted tracked changes. Landed Runs cannot accept follow-up attempts.
- Ship pushes the branch and creates or reuses a Pull Request.
- Started land, ship, and discard operations record in storage before execution for crash recovery.

## Manager ⇄ Worker Messaging

Each Run maintains a persistent bidirectional message thread in `agent_messages` between the supervising Manager and the Worker:

- Worker `ask_manager(question, wait_seconds?)`: Blocks execution and queries the Manager. The question wakes the Manager immediately via notifications. The Manager replies with `send_run_msg`. If no answer arrives within the wait window, the Worker proceeds using its own judgment and records the decision in its report. Discarding a Run unblocks the question immediately with a stop command.
- Worker `tell_manager(text)`: Sends non-blocking progress updates.
- Worker `check_msgs`: Retrieves unread proactive instructions sent by the Manager.
- Manager `send_run_msg(run, body)`: Answers active questions or sends instructions to running Workers. Inspect the complete thread with `list_run_msgs(run)`.

## Progress and Cancellation

The Project Manager inspects live Run progress and stops its own project's running attempts; the Chief reads progress, reports, diffs, and threads but cannot stop or message a Run.

- **`run_progress(id)`**: Returns execution status, attempt number, elapsed time, deadline, recent assistant text, and recent tool calls (names and truncated arguments). The data reads from `runs` rows and conversation entries. Discarded Runs show database row details only. This tool is the single source for supervisor progress checks.
- **`stop_run(id, reason?)`**: Acquires the Run lock, sets status to `interrupted`, records reasons and completion timestamps, logs attempt metrics, and aborts the Worker conversation. **The worktree and branch remain intact.** The `reviewStatus` stays `pending`. Users and supervisors can still inspect diffs, land, ship, or start follow-up attempts. Stopping is not discarding; it deletes no files.
- **No Overwrite**: Aborting causes `submission.wait()` to return. The collector inspects `status === 'interrupted'` under lock and exits without overwriting status to done or failed. The recovery loop does not resume interrupted attempts.
- **Boundaries**: Only the Project Manager stops and messages its own project's Runs — a foreign project id is refused. The Chief has no stop or send tools; it steers through `send_manager_msg`.
- **Experience Review**: Stopping counts as an execution outcome. The system inspects report files (`TIAN_REPORT.md`) under a `stopped` flag. Documented procedure steps still produce Skill candidates (labeled "stopped early" with reasons), but **never** mark injected skills as `verification = failed`.

Message and notification IDs derive from callers. Durable replay does not generate duplicate messages. Read states persist in storage. Workers make decisions autonomously and escalate only for destructive operations, missing credentials, or fundamental ambiguities.

Reports collect from `TIAN_REPORT.md` into `<project root>/.tian/runs/`. Each round preserves its own report outside Git commits.

## Worker Runtimes

A Worker runs on a configurable runtime. Pi Durable is built in and always enabled; Codex is the first external runtime, and other coding agent CLIs plug in as adapters of the same shape. The role rules do not change with the runtime: the Worker has no memory, its only inputs are the briefing and the worktree, and its supervisor is the project Manager.

Runtime and model selection uses Intents:

1. **Settings → Workers**: the user sets the global concurrency cap, optional per-runtime caps, and defines Intents. An Intent maps a name to a runtime, a model, a thinking level, and a purpose description, for example `review` → `magpie:sol-6.1` on Pi.
2. **Project default**: each project has a `default_intent` (it replaced `projects.agent_kind`, dropped in schema v10). Empty means the built-in default: Pi runtime with the app-wide model.
3. **Dispatch**: the Manager chooses per Run in one of two mutually exclusive ways: an `intent`, or an explicit `runtime` + `model` (+ `thinking_level`). Passing both is an error; passing neither applies the project default Intent. Explicit choices must use an enabled runtime; Pi models are validated against the provider catalogs ([D13](decisions.md#d13--run-level-worker-models-and-thinking-levels)), and external models pass through unvalidated ([D21](decisions.md#d21--model-providers-are-pluggable-magpie-is-one-provider)). The Manager's `<state>` lists Intent names, their resolved targets, and their purpose descriptions.

The Run stores the resolved runtime, model, and thinking level at creation, so a later edit to the Intent does not change existing Runs. A Run's runtime is fixed: follow-up Attempts and restart resumes use it, because resume depends on the runtime's session id. A different runtime needs a new Run.

Pi Durable Workers keep the current contract: mid-run messaging (`ask_manager`, `tell_manager`, `check_msgs`), durable replay, progress from conversation entries, and follow-up Attempts in the same conversation.

### External Runtimes

Codex is the first external runtime (`src/worker/codex.ts`). External Workers follow a baseline contract of one-shot execution plus resume:

- **Start**: the adapter runs `codex exec --json --sandbox <mode> --skip-git-repo-check <prompt>` headless in the Run worktree, with the briefing as the prompt. The exec flags go before `resume`, because `codex exec resume` rejects `--sandbox`.
- **Progress**: the adapter reads the JSONL event stream (`thread.started`, `item.started`, `item.completed`, `turn.completed`) and feeds `run_progress`; the latest tool call is stored on `runs.external_last_call`; reported token usage is recorded as a `run.usage` event.
- **Result**: the attempt ends when the process exits. The final agent message or `TIAN_REPORT.md` is the report. The agent does not ask questions mid-run; it records open questions in the report.
- **Stop**: `stop_run` kills the process group. The worktree stays, as for Pi Workers.
- **Follow-up**: a follow-up Attempt runs `codex exec … resume <session> <prompt>`; the session id lives on `runs.external_session`.
- **Service restart**: an external Worker is a child process of the service and is not durable; a crash, a manual restart, or a machine reboot kills it, and a service stop kills its process group (upgrades wait for idle, see [D9](decisions.md#d9--package-app-and-background-service-together-install-separately-coordinate-switches-with-an-independent-updater)). The adapter records the launched Attempt in `runs.external_attempt` before codex reports a session. On startup the service resumes the external session automatically, inside the same Attempt, with these guards:
  - Before the resume, the adapter kills a process group that a hard crash left alive (`runs.external_pid`, checked against the process command), then commits a snapshot of the worktree, so the work done before the restart stays inspectable.
  - The resume prompt states that the process was killed, names the last recorded tool call (read from `runs.external_last_call`, so it survives the restart), and tells the agent that this call may be incomplete: check the worktree state first and do not repeat a side effect without checking.
  - The Manager gets a non-blocking notice through the notification outbox; the resume does not wait for it.
  - The Attempt keeps its original deadline and claims its concurrency slots at once, without queueing.
  - At most one automatic resume per Attempt (`runs.auto_resumed` records it). A second kill in the same Attempt, a missing session id, or a failed resume ends the Attempt as `interrupted` (worktree kept, as with `stop_run`) and notifies the Manager.
- **Enable check**: external runtimes start disabled. Settings → Workers probes `codex --version` and `codex login status`, and the service switches a runtime on only when the probe passes; an expired sign-in shows 'sign-in required', never a generic failure.
- **Security boundary**: the child inherits an environment allow-list only (PATH, HOME, `CODEX_*` — service socket paths and provider keys stay on the service side). When the project sandbox is on (default), the spawn argv is rewritten under the per-Run Seatbelt profile and the CLI's own sandbox relaxes to `danger-full-access`, so the Tian profile is the single boundary. In that profile `$CODEX_HOME` is writable (sessions, logs, auth refresh, the app-server socket), but its `config.toml`, `AGENTS.md`, and `AGENTS.override.md` are read-only; with the project sandbox off the CLI's `--sandbox workspace-write` remains the interim floor ([D22](decisions.md#d22--unified-seatbelt-sandbox-for-worker-commands), [todo-worker-sandbox.md](todo-worker-sandbox.md)).

Concurrency has two limits, both live-editable under Settings → Workers:

1. **Global cap** (default 3): counts Worker attempts of every runtime. It protects local resources (CPU, memory, builds, and tests).
2. **Per-runtime cap**: optional, unset by default. It protects external quotas and rate limits (for example Cursor at 2).

An attempt starts only when it holds both a slot of its runtime and a global slot, acquired in that order. The queue is not strict FIFO: an attempt that waits only for a full runtime does not block later attempts whose runtime has a free slot. Chief and Manager turns have no cap; they are model calls, so several Managers can think and dispatch at the same time.

Mid-run messaging through a per-Run MCP server is an optional adapter capability for later, not part of the baseline. Reason: the baseline depends only on headless execution, structured output, and resume, which all mainstream agent CLIs provide, so a new runtime is cheap to add. Trade-off: an external Worker that meets a blocking ambiguity cannot stop and ask; one question and answer costs a full Attempt.
