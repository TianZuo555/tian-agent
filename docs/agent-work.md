# Goals, Tasks, and Runs

**English** | [简体中文](zh/agent-work.md)

Users manage goals; agents manage tasks. A Goal is a long-term outcome. A Task is a concrete unit of work. A Run is a single execution performed by a Worker for a coding task inside an isolated Git worktree.

## Goals

A Goal belongs to a Scope and contains an objective, success criteria, constraints, current state, next action, last execution timestamp, and daily execution budget stored in the `goals` table. The Chief maintains records using `create_goal`, `update_goal`, and `list_goals`. Users create, edit, pause, resume, or cancel goals inside the Goals view.

- **Goal Conversation**: Each Goal obtains a dedicated Chief conversation via `openSession({ channel: 'goal', externalId: goalId, scopeId })`. This binding persists across restarts, and wakeup notifications deliver to this conversation only. Proposal: a Goal conversation always lives in the Global Scope, also for a Goal that concerns a project; the Goal keeps the project reference, and project work goes through `delegate` ([memory.md](memory.md#conversation-boundary-proposal)).
- **User Notices**: Calling `notify_user(goal, fingerprint, text)` records items needing user attention into `user_notices`. The same fingerprint for a Goal delivers at most once in a 24-hour window. Tasks with `outcome = no_change` produce no notice. The Goals view presents active notices.

## Tasks

Task state transitions follow: `pending → running → waiting_approval → completed`, with additional states `paused`, `blocked`, `failed`, and `cancelled`. The module `db.ts` validates transitions and rejects illegal moves. The system records `outcome` separately (achieved, not_achieved, or no_change) alongside a summary. The fields `trigger` (manual / schedule / event) and unique `dedupe_key` track origins. Restarts or repeat triggers never create duplicate Tasks.

## Scheduling

The `schedules` table persists cron rules, timezones, and the calculated `next_fire_at`. An internal timer sleeps until the earliest trigger point (capped at 60 seconds without blocking process termination). Each trigger executes in a single transaction:

1. Create a Task (`dedupe_key = sched:<schedule>:<fire_time>`).
2. Deliver a notification to the Goal conversation (containing Goal state and Task summary only; does not rebuild full history).
3. Advance `next_fire_at` from the current time. Triggers missed during sleep or shutdown merge into one event.

The Goal parameter `max_runs_per_day` caps daily executions. Excess executions create a `blocked` Task with deduplicated user notices rather than silently dropping work.

Coding tasks dispatch via `dispatch`, which accepts a `task` argument linking the Run to its parent Task (`runs.task_id`). Run completion does not equal Task completion. The dispatcher (Chief or Project Manager) evaluates the result, calls `complete_task` or `fail_task`, and updates the Goal state via `update_goal`.

## Project Manager

The Project Manager is an agent between the Chief and Workers. Exactly one persistent conversation exists per project (`channel_sessions` with `channel = 'manager'`, `external_id = project_id`), created during `addProject` with a required Manager name. In addition to Chief delegations, Tian can open this conversation directly via `openManager(projectId)` (the Manager button in the sidebar) to assign work.

- **Direct Assignment by Tian**: When turn inputs have `kind = 'user'`, the turn belongs to Tian. Work assigned here becomes the Manager's own Task (`add_task` → `start_task` → `complete_task` / `fail_task`), concluding quietly without notifying the Chief. The `ask_chief` tool blocks during Tian turns and prompts the Manager to ask Tian directly. The `report_chief` tool permits only delegated Tasks carrying `assignee = 'manager'` to report back. These tool guards prevent unnecessary notifications to the Chief.
- **Delegation as a Task**: The Chief calls `delegate(project, title, briefing, goal?)` in a single transaction to create a Task with `assignee = 'manager'` and `report_to = <chiefConversationId>`, records a `delegation` message, and wakes the Manager. The Manager executes the workflow: `start_task` → `dispatch` → `complete_task` / `fail_task`. Concluding a delegated Task notifies the Chief recorded in `report_to`. The Chief cannot call `start_task`, `complete_task`, or `fail_task` on delegated Tasks.
- **Reporting and Inquiries**: The Manager calls `report_chief(text, task?)` to provide updates. Calling `ask_chief(question, task?, wait_seconds?)` records a question and blocks until an answer arrives matching `reply_to`. Irrelevant messages are ignored. Timeouts close the question atomically. The Chief replies using `send_manager_msg(project, body, reply_to?, task?)`. Waiting questions return immediately without waking the agent. Late answers trigger a wakeup notification.
- **Redistribution**: The Manager calls `dispatch(prompt, task?)` to assign coding work to Workers. The parameter `chief_conversation_id` points to the Manager conversation. Worker questions and completion notices route back to the Manager, who closes the Task and reports to the Chief.
- **Scope Boundaries**: Manager tools lock to their project scope. Tasks, notes, history, and Runs operate within the project only. Dispatches accept project Tasks only. The Manager is the sole agent writer for project memory and notes. Global memory is read-only ([D18](decisions.md#d18--memory-ownership-by-role-chief-owns-global-managers-own-projects)). The Manager has no shell or coding tools.

### Dispatch Ownership (Proposal)

Only a project's Manager dispatches Workers in that project, and the Manager is the supervisor of every Run it dispatches. All coding work follows one path: Chief `delegate` → Manager → `dispatch` → Worker.

- Reason: the dispatch briefing is the Worker's only input ([memory.md](memory.md#worker)), and a useful briefing needs project memory, which only the Manager has. Run results also become project experience, which the Manager records.
- The Chief loses `dispatch`, `send_run_msg`, and `stop_run` on project Runs. It follows code work through Manager reports and the UI Run panel.
- Worker messaging tools follow the supervisor: `ask_chief` / `tell_chief` become `ask_manager` / `tell_manager`.
- Trade-off: a small change takes one more hop (delegation, then dispatch), with more latency and tokens.

Code gap: the Chief has `dispatch` (`tools.ts`), and Runs record the dispatcher as `chief_conversation_id`. The boundary removes the Chief tool, renames the Worker tools, and treats the dispatcher field as the Manager conversation.

## Run Lifecycle

```text
Execution Status:
dispatch → queued → running → collecting → done / failed
            │         │
            └── stop ─┴──→ interrupted

Review Status (recorded independently):
pending → landing → landed
       ↘ shipping → shipped
       ↘ discarding → discarded
```

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

## Chief ⇄ Worker Messaging

Each Run maintains a persistent bidirectional message thread in `agent_messages`:

- Worker `ask_chief(question, wait_seconds?)`: Blocks execution and queries supervisors. The question wakes the supervisor immediately via notifications. The supervisor replies with `send_run_msg`. If no answer arrives within the wait window, the Worker proceeds using its own judgment and records the decision in its report. Discarding a Run unblocks the question immediately with a stop command.
- Worker `tell_chief(text)`: Sends non-blocking progress updates.
- Worker `check_msgs`: Retrieves unread proactive instructions sent by supervisors.
- Supervisor `send_run_msg(run, body)`: Answers active questions or sends instructions to running Workers. Inspect the complete thread with `list_run_msgs(run)`.

## Progress and Cancellation

The Chief and Project Managers can inspect live Run progress and stop running attempts without shell access or scope violations.

- **`run_progress(id)`**: Returns execution status, attempt number, elapsed time, deadline, recent assistant text, and recent tool calls (names and truncated arguments). The data reads from `runs` rows and conversation entries. Discarded Runs show database row details only. This tool is the single source for supervisor progress checks.
- **`stop_run(id, reason?)`**: Acquires the Run lock, sets status to `interrupted`, records reasons and completion timestamps, logs attempt metrics, and aborts the Worker conversation. **The worktree and branch remain intact.** The `reviewStatus` stays `pending`. Users and supervisors can still inspect diffs, land, ship, or start follow-up attempts. Stopping is not discarding; it deletes no files.
- **No Overwrite**: Aborting causes `submission.wait()` to return. The collector inspects `status === 'interrupted'` under lock and exits without overwriting status to done or failed. The recovery loop does not resume interrupted attempts.
- **Boundaries**: The Chief can stop Runs belonging to the Global scope or direct dispatches only. Manager Runs must be stopped by their Project Manager.
- **Experience Review**: Stopping counts as an execution outcome. The system inspects report files (`TIAN_REPORT.md`) under a `stopped` flag. Documented procedure steps still produce Skill candidates (labeled "stopped early" with reasons), but **never** mark injected skills as `verification = failed`.

Message and notification IDs derive from callers. Durable replay does not generate duplicate messages. Read states persist in storage. Workers make decisions autonomously and escalate only for destructive operations, missing credentials, or fundamental ambiguities.

Reports collect from `TIAN_REPORT.md` into `<project root>/.tian/runs/`. Each round preserves its own report outside Git commits.

## Worker Runtimes (Proposal)

A Worker runs on a configurable runtime: Pi Durable (default) or an external coding agent CLI such as Codex or Cursor. The role rules do not change with the runtime: the Worker has no memory, its only inputs are the briefing and the worktree, and its supervisor is the project Manager.

Runtime and model selection uses Intents:

1. **Settings**: the user enables runtimes (Pi is always available; an external CLI must be installed and signed in) and defines Intents. An Intent maps a name to a runtime, a model, and a thinking level, for example `review` → Sol 6.1 and `simple` → DeepSeek 4.1 Flash.
2. **Project default**: each project has a default Intent (replacing `projects.agent_kind`).
3. **Dispatch**: the Manager chooses per Run in one of two mutually exclusive ways: an `intent`, or an explicit `runtime` + `model` (+ `thinking_level`). Passing both is an error; passing neither applies the project default Intent. Explicit choices must use an enabled runtime; Pi models are validated against the provider catalogs ([D13](decisions.md#d13--run-level-worker-models-and-thinking-levels)), and external models pass through unvalidated ([D21](decisions.md#d21--model-providers-are-pluggable-magpie-is-one-provider-proposal)). Each Intent carries a purpose description, and the Manager's `<state>` lists Intent names with their descriptions.

The Run stores the resolved runtime, model, and thinking level at creation, so a later edit to the Intent does not change existing Runs. A Run's runtime is fixed: follow-up Attempts and restart resumes use it, because resume depends on the runtime's session id. A different runtime needs a new Run.

Pi Durable Workers keep the current contract: mid-run messaging (`ask_manager`, `tell_manager`, `check_msgs`), durable replay, progress from conversation entries, and follow-up Attempts in the same conversation.

External Workers follow a baseline contract of one-shot execution plus resume:

- **Start**: the adapter runs the agent headless and non-interactive in the Run worktree, with the briefing as the prompt.
- **Progress**: the adapter reads the agent's structured event stream (for example Cursor `--output-format stream-json`, Codex `exec --json`) and feeds `run_progress`.
- **Result**: the attempt ends when the process exits. The final text or `TIAN_REPORT.md` is the report. The agent does not ask questions mid-run; it records open questions in the report.
- **Stop**: `stop_run` terminates the process. The worktree stays, as for Pi Workers.
- **Follow-up**: the Manager answers open questions with a follow-up Attempt. The adapter resumes the same external session (for example Cursor `--resume <chatId>`, Codex `exec resume`) with the session id stored on the Run.
- **Service restart**: an external Worker is a child process of the service and is not durable; a crash, a manual restart, or a machine reboot kills it (upgrades wait for idle, see [D9](decisions.md#d9--package-app-and-background-service-together-install-separately-coordinate-switches-with-an-independent-updater)). On startup the service resumes the external session automatically, inside the same Attempt, with these guards:
  - Before the resume, the service commits a snapshot of the worktree, so the work done before the restart stays inspectable.
  - The resume prompt states that the process was killed, names the last recorded tool call from the event stream, and tells the agent that this call may be incomplete: check the worktree state first and do not repeat a side effect without checking.
  - At most one automatic resume per Attempt. A second kill in the same Attempt, a missing session id, or a failed resume marks the Attempt `interrupted` (worktree kept, as with `stop_run`) and wakes the Manager.
  - The Manager receives a non-blocking notice for every automatic resume.
  - The Attempt keeps its original deadline and claims a concurrency slot at once, as Pi Workers do after a restart.
- **Security boundary**: the target is one Tian-owned Seatbelt boundary for every runtime ([todo-worker-sandbox.md](todo-worker-sandbox.md)). Tian wraps the whole external CLI process: writable worktree and the CLI's session storage, read-only CLI configuration, denied service socket, network allowed, and an environment allow-list that passes only the credentials that CLI needs. The CLI's own sandbox is off inside it (nested Seatbelt usually fails on macOS; to verify). This target is not a launch prerequisite, because per-CLI state layouts make it hard. Until it exists, the interim floor is: the environment allow-list (mandatory), the CLI's own sandbox flag (for example Codex `--sandbox workspace-write`, Cursor `--sandbox enabled`), and an explicit user opt-in per runtime in Settings, which states that the runtime can reach the service socket and its own configuration.

Concurrency has two limits:

1. **Global cap**: `MAX_ACTIVE_ATTEMPTS` moves to Settings (default 3) and counts Worker attempts of every runtime. It protects local resources (CPU, memory, builds, and tests).
2. **Per-runtime cap**: optional, unset by default. It protects external quotas and rate limits (for example Cursor at 2).

An attempt starts only when it holds both a global slot and a slot of its runtime. The queue is not strict FIFO: an attempt that waits only for a full runtime does not block later attempts whose runtime has a free slot. Chief and Manager turns have no cap; they are model calls, so several Managers can think and dispatch at the same time.

Mid-run messaging through a per-Run MCP server is an optional adapter capability for later, not part of the baseline. Reason: the baseline depends only on headless execution, structured output, and resume, which all mainstream agent CLIs provide, so a new runtime is cheap to add. Trade-off: an external Worker that meets a blocking ambiguity cannot stop and ask; one question and answer costs a full Attempt.
