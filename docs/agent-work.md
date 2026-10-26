# Goals, Tasks, and Runs

**English** | [简体中文](zh/agent-work.md)

Users manage goals; agents manage tasks. A Goal is a long-term outcome. A Task is a concrete unit of work. A Run is a single execution performed by a Worker for a coding task inside an isolated Git worktree.

## Goals

A Goal belongs to a Scope and contains an objective, success criteria, constraints, current state, next action, last execution timestamp, and daily execution budget stored in the `goals` table. The Chief maintains records using `create_goal`, `update_goal`, and `list_goals`. Users create, edit, pause, resume, or cancel goals inside the Goals view.

- **Goal Conversation**: Each Goal obtains a dedicated Chief conversation via `openSession({ channel: 'goal', externalId: goalId, scopeId })`. This binding persists across restarts, and wakeup notifications deliver to this conversation only.
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
