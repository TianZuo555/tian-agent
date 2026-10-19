import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { GLOBAL_SCOPE } from './scopes.js';
import type { AgentMessageRow, RunRow, TaskRow } from './db.js';
import type { GoalStore } from './goals.js';
import {
  coreMemorySection,
  memoryTools,
  resolveScope,
  toolErr as err,
  toolText as text,
  type MemoryToolDeps,
} from './tools-memory.js';
import { taskExecutionTools } from './tools-goals.js';
import type { HistoryDeps } from './tools-history.js';

export interface ManagerDeps extends MemoryToolDeps {
  goals: GoalStore;
  /** Push task updates to clients after a tool write. */
  emitUpdates: () => void;
  /** An extraction trigger fires when a task completes (PRD §4.4). */
  onTaskCompleted?: (scopeId: string) => void;
  latestInputEntry: (conversationId: string) => Promise<string | null>;
  /** Dispatch a headless worker run; resolves once the run is queued. */
  dispatch: (input: {
    projectRef: string;
    prompt: string;
    chiefConversationId: string | null;
    taskId?: number;
    operationId: string;
  }) => Promise<RunRow>;
  runReport: (id: string) => string;
  runDiff: (id: string) => Promise<string>;
  /** Post a message into a run's mailbox — a reply or mid-run guidance. */
  sendRunMessage: (runId: string, body: string, operationId: string) => unknown;
  runMessages: (runId: string) => AgentMessageRow[];
  /**
   * Queue a notification to the chief conversation this project reports to
   * and trigger delivery. `taskId` pins the report to that task's reportTo
   * conversation; without it the latest delegated task's reportTo is used.
   * The durable manager_messages row carries the record; the notification
   * is the wake.
   */
  wakeChief: (
    projectId: string,
    content: string,
    notificationId: string,
    taskId?: number | null,
  ) => Promise<void>;
  history: HistoryDeps;
}

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_SECONDS = 300;

/**
 * The project manager's extension: one persistent conversation per project,
 * bound via channel 'manager'. It manages this project's tasks, memory,
 * notes and coding runs — no shell, no coding tools — and reports to the
 * chief over the durable manager_messages thread. Memory writes are locked
 * to this project; global memory is read-only context.
 */
export function managerExtension(deps: ManagerDeps) {
  const { db, scopes, data } = deps;
  /** The calling conversation's own scope — the project it manages. */
  const own = (conversationId: string): string =>
    db.conversationScope(conversationId);
  /** Guard: the run must belong to this manager's project. */
  const ownRun = (conversationId: string, runId: string): RunRow => {
    const run = db.getRun(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (run.projectId !== own(conversationId))
      throw new Error(`run ${runId} belongs to another project`);
    return run;
  };

  const preamble = section(
    'preamble',
    (input) => {
      const scope = own(String(input.conversationId));
      const project = db.getProject(scope);
      return `You are the project manager of ${project?.name ?? scope} (${project?.rootPath ?? scope}) — you run this project for Tian's chief and for Tian.

ROLE. The chief delegates project work to you as tasks; you turn them into coding runs and close them with an outcome. Tian can also talk to you directly in this conversation. You have no shell and no file tools — dispatch(prompt, task?) sends code work to a worker in an isolated git worktree, and the worker's questions and finished report come back to you. You are woken by delegated tasks, chief messages and run events; work, report, and go idle.

TIAN. Tian may also talk to you directly in this conversation. A message that is not a '[...]' system wake is from Tian: work he gives you becomes your own tasks (add_task, then start_task / complete_task / fail_task) and closes silently — the chief is not notified. Answer him directly in your reply; ask him in your reply instead of ask_chief; do not report_chief about his requests unless he explicitly asks you to tell the chief.

DELEGATED TASKS. A wake starting '[delegated task #N from chief]' assigns task #N to you — work it with start_task, dispatch runs with task: N, then close it with complete_task(outcome, summary) or fail_task(reason): closing a delegated task reports the outcome to the chief automatically. Delegated tasks appear first in <state> tagged [delegated]. Tasks you add yourself (add_task) are yours and close silently. Goals stay with the chief — a delegated task may carry a goal id, but update_goal is not yours to call.

REPORTING UP. The chief cannot see your work unless you say so. report_chief(text, task?) posts a status or decision — finished milestones, choices you took, blockers worth escalating. ask_chief(question, task?) blocks until the chief answers — only for decisions you genuinely cannot make (cross-project tradeoffs, missing credentials, an ambiguous delegation). Chief messages that are not answers wake you directly.

MEMORY. You read global and this project's memory (injected below), but you write ONLY this project's — remember/revise/forget/select/deselect always target this project; global stays the chief's domain. Record project decisions, conventions and outcomes.

RUNS. dispatch gets a full briefing (the worker sees nothing else); send_run_msg answers a waiting worker or steers a run; list_runs/read_run_report/read_run_diff/list_run_msgs follow progress. A finished run wakes you — judge the result, close its task, and report_chief what matters. Worker changes live on the run's branch until Tian lands them.

HISTORY & NOTES. search_history reads this project's past sessions, tool calls and events; read_history expands a ref. Notes are this project's long documents — keep plans and standing context there.`;
    },
    { tag: false },
  );

  const stateSection = section('state', (input) => {
    const scope = own(String(input.conversationId));
    const lines: string[] = [];
    try {
      const goals = deps.goals
        .listGoals(scope)
        .filter((g) => g.status === 'active');
      if (goals.length > 0) {
        lines.push(`active goals (${goals.length}):`);
        for (const g of goals.slice(0, 10))
          lines.push(
            `  ${g.id} ${g.objective}${g.nextAction ? ` — next: ${g.nextAction}` : ''}`,
          );
      }
      const tasks = db
        .listTasks(scope)
        .filter((t) =>
          ['pending', 'running', 'waiting_approval', 'blocked'].includes(
            t.status,
          ),
        );
      if (tasks.length > 0) {
        const delegated = tasks.filter((t) => t.assignee === 'manager');
        const rest = tasks.filter((t) => t.assignee !== 'manager');
        lines.push(`tasks (${tasks.length}):`);
        for (const t of [...delegated, ...rest].slice(0, 10))
          lines.push(
            `  #${t.id} [${t.status}] ${t.assignee === 'manager' ? '[delegated] ' : ''}${t.title}${t.due ? ` (due ${t.due})` : ''}${t.goalId ? ` [goal ${t.goalId}]` : ''}`,
          );
      }
      const running = db
        .listRuns(scope)
        .filter((r) => ['running', 'queued', 'collecting'].includes(r.status));
      if (running.length > 0)
        lines.push(`active runs: ${running.map((r) => r.id).join(', ')}`);
    } catch {
      // scope dirs not created yet — nothing to report
    }
    const project = db.getProject(scope);
    const header = [
      `project: ${project ? `${project.name} (${project.rootPath})` : scope}`,
      `now: ${new Date().toISOString().slice(0, 16)}`,
    ];
    return lines.length > 0
      ? [...header, '', ...lines].join('\n')
      : header.join('\n');
  });

  // ---- tasks -------------------------------------------------------------

  const addTask = defineTool({
    name: 'add_task',
    replay: 'safe',
    description: "Add a task to this project's task list.",
    parameters: Type.Object({
      title: Type.String(),
      due: Type.Optional(Type.String({ description: 'ISO date or datetime.' })),
    }),
    execute: async (args, api) => {
      const scope = own(String(api.conversationId));
      const id = data.addTask(
        scope,
        args.title,
        args.due ?? null,
        `task:${api.taskId}:${api.callId}`,
      );
      return text(`task #${id} added.`);
    },
  });

  const listTasks = defineTool({
    name: 'list_tasks',
    description: "List this project's tasks (incomplete first).",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([
          Type.Literal('pending'),
          Type.Literal('running'),
          Type.Literal('waiting_approval'),
          Type.Literal('completed'),
          Type.Literal('paused'),
          Type.Literal('blocked'),
          Type.Literal('failed'),
          Type.Literal('cancelled'),
        ]),
      ),
    }),
    execute: async (args, api) => {
      const tasks = db.listTasks(own(String(api.conversationId)), args.status);
      if (tasks.length === 0) return text('(no tasks)');
      return text(
        tasks
          .map(
            (t) =>
              `#${t.id} [${t.status}] ${t.assignee === 'manager' ? '[delegated] ' : t.owner === 'agent' ? '(agent) ' : ''}${t.title}${t.due ? ` due:${t.due}` : ''}${t.goalId ? ` goal:${t.goalId}` : ''}`,
          )
          .join('\n'),
      );
    },
  });

  // ---- memory --------------------------------------------------------------

  const recall = defineTool({
    name: 'recall',
    description:
      "Keyword search over this project's or the global memory (Chinese included; every word must appear, words under 3 characters fall back to substring matching). Active memories by default; each hit shows #seq, kind, trust, date and source.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Search words; several words must all appear. Single characters work via substring matching.',
      }),
      include_history: Type.Optional(
        Type.Boolean({
          description:
            'Include superseded and deleted memories (marked with their status). Default: false.',
        }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100, description: 'Default 20.' }),
      ),
      scope: Type.Optional(
        Type.String({
          description:
            '"global" or this project (default). Other projects are not readable.',
        }),
      ),
    }),
    execute: async (args, api) => {
      try {
        const conversationId = String(api.conversationId);
        const ownScope = own(conversationId);
        let scope = ownScope;
        if (args.scope === GLOBAL_SCOPE) scope = GLOBAL_SCOPE;
        else if (args.scope) {
          if (resolveScope(deps, conversationId, args.scope) !== ownScope)
            throw new Error(
              "a project manager reads only this project's and global memory",
            );
        }
        return text(
          scopes.memory(scope).recall(args.query, {
            includeHistory: args.include_history ?? false,
            limit: args.limit,
          }),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  // ---- notes ---------------------------------------------------------------

  const listNotes = defineTool({
    name: 'list_notes',
    description: "List this project's markdown notes.",
    parameters: Type.Object({}),
    execute: async (_args, api) => {
      const names = scopes.listNotes(own(String(api.conversationId)));
      return text(names.length === 0 ? '(no notes)' : names.join('\n'));
    },
  });

  const readNote = defineTool({
    name: 'read_note',
    description:
      'Read one of this project\'s notes. Pass a search_notes hit like "plan.md:42" to open a bounded window around that line.',
    parameters: Type.Object({
      name: Type.String({
        description: 'Note name, optionally with ":<line>" from search_notes.',
      }),
    }),
    execute: async (args, api) => {
      try {
        return text(
          scopes.readNoteWindow(own(String(api.conversationId)), args.name),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const writeNote = defineTool({
    name: 'write_note',
    description: "Create or overwrite one of this project's notes.",
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
    }),
    execute: async (args, api) => {
      const scope = own(String(api.conversationId));
      scopes.writeNote(scope, args.name, args.content);
      return text(`note "${args.name}" written.`);
    },
  });

  const appendNote = defineTool({
    name: 'append_note',
    description: "Append text to one of this project's notes.",
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
    }),
    execute: async (args, api) => {
      const scope = own(String(api.conversationId));
      scopes.appendNote(scope, args.name, args.content);
      return text(`appended to "${args.name}".`);
    },
  });

  const searchNotes = defineTool({
    name: 'search_notes',
    description:
      "Keyword search over this project's notes: every word must appear on the line (case-insensitive). Returns bounded file:line hits that read_note can open.",
    parameters: Type.Object({
      query: Type.String({
        description: 'One or more words; all must appear.',
      }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100, description: 'Default 40.' }),
      ),
    }),
    execute: async (args, api) => {
      try {
        return text(
          scopes.searchNotes(
            own(String(api.conversationId)),
            args.query,
            args.limit,
          ),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  // ---- runs ----------------------------------------------------------------

  const dispatch = defineTool({
    name: 'dispatch',
    replay: 'safe',
    description:
      'Dispatch a coding task to a worker agent in an isolated git worktree of this project. Returns immediately with a run id — you are woken with the report and diffstat when it finishes. Only for work that changes files.',
    parameters: Type.Object({
      prompt: Type.String({
        description:
          'Full task briefing for the worker — it sees nothing else.',
      }),
      task: Type.Optional(
        Type.Number({
          description:
            'Task id this run advances (from list_tasks). The run is recorded on the task.',
        }),
      ),
    }),
    execute: async (args, api) => {
      const scope = own(String(api.conversationId));
      try {
        const run = await deps.dispatch({
          projectRef: scope,
          prompt: args.prompt,
          chiefConversationId: String(api.conversationId),
          taskId: args.task,
          operationId: `dispatch:${api.taskId}:${api.callId}`,
        });
        return text(
          `dispatched run ${run.id} on ${run.agentKind} — worktree ${run.worktreePath ?? '(in place, not a git repo)'}. You will be woken when it finishes.`,
        );
      } catch (e) {
        return err(`dispatch failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  });

  const listRuns = defineTool({
    name: 'list_runs',
    description: "List this project's dispatched runs with status.",
    parameters: Type.Object({}),
    execute: async (_args, api) => {
      const runs = db.listRuns(own(String(api.conversationId)));
      if (runs.length === 0) return text('(no runs)');
      return text(
        runs
          .slice(0, 30)
          .map(
            (r) =>
              `${r.id} [${r.status}] ${r.agentKind} in ${r.projectId}${r.finishedAt ? ` finished:${r.finishedAt}` : ''}\n  ${r.prompt.split('\n')[0].slice(0, 100)}`,
          )
          .join('\n'),
      );
    },
  });

  const readRunReport = defineTool({
    name: 'read_run_report',
    description: "Read the report of one of this project's runs by its ID.",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args, api) => {
      try {
        ownRun(String(api.conversationId), args.id);
        return text(deps.runReport(args.id));
      } catch (e) {
        return err(String(e));
      }
    },
  });
  const readRunDiff = defineTool({
    name: 'read_run_diff',
    description: "Read the Git diff of one of this project's runs by its ID.",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args, api) => {
      try {
        ownRun(String(api.conversationId), args.id);
        return text(await deps.runDiff(args.id));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const sendRunMsg = defineTool({
    name: 'send_run_msg',
    replay: 'safe',
    description:
      'Reply to a run worker waiting on ask_chief, or send it mid-run guidance. A waiting worker receives it immediately; otherwise it reads it on its next check.',
    parameters: Type.Object({
      run: Type.String({
        description: "One of this project's run ids (see list_runs).",
      }),
      body: Type.String({
        description: 'Short, concrete, self-contained answer or instruction.',
      }),
    }),
    execute: async (args, api) => {
      try {
        ownRun(String(api.conversationId), args.run);
        deps.sendRunMessage(
          args.run,
          args.body,
          `send-run-msg:${api.taskId}:${api.callId}`,
        );
        return text(`message delivered to run ${args.run}.`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const listRunMsgs = defineTool({
    name: 'list_run_msgs',
    description:
      "Read the durable message thread between you and one of this project's run workers.",
    parameters: Type.Object({ run: Type.String() }),
    execute: async (args, api) => {
      try {
        ownRun(String(api.conversationId), args.run);
        const messages = deps.runMessages(args.run);
        if (messages.length === 0) return text('(no messages)');
        return text(
          messages
            .map(
              (m) =>
                `[${m.createdAt}] ${m.sender === 'chief' ? 'you' : 'worker'}:\n${m.body}`,
            )
            .join('\n---\n'),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  // ---- history -------------------------------------------------------------

  const searchHistory = defineTool({
    name: 'search_history',
    description:
      "Search this project's recorded history — past conversations, tool calls and events — with keyword or phrase matching (Chinese works; several words must all appear). Returns dated lines with a ref for read_history. An empty result means nothing was recorded; never invent history.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Keywords or a phrase; several words must all appear. Words shorter than 3 characters fall back to substring matching.',
      }),
      since: Type.Optional(
        Type.String({ description: 'ISO timestamp lower bound.' }),
      ),
      until: Type.Optional(
        Type.String({ description: 'ISO timestamp upper bound.' }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 50, description: 'Default 20.' }),
      ),
    }),
    execute: async (args, api) => {
      try {
        const lines = await deps.history.history.search(args.query, {
          scopeId: own(String(api.conversationId)),
          since: args.since ?? null,
          until: args.until ?? null,
          limit: args.limit,
        });
        return text(lines.length > 0 ? lines.join('\n') : '(no matches)');
      } catch (e) {
        return err(String(e));
      }
    },
  });

  /** Scope a history ref points to, or null when it cannot be determined. */
  const refScope = (ref: string): string | null => {
    const trimmed = ref.trim();
    if (trimmed.startsWith('event:'))
      return (
        deps.history.events.get(trimmed.slice('event:'.length))?.scopeId ?? null
      );
    const match = /^conv:([^#\s]+)#/.exec(trimmed);
    if (!match) return null;
    try {
      return db.conversationScope(match[1]);
    } catch {
      return db.runByConversation(match[1])?.projectId ?? null;
    }
  };

  const readHistory = defineTool({
    name: 'read_history',
    description:
      'Read the full content behind a search_history ref from this project. "conv:<id>#<entry>" returns a page of that entry; "event:<id>" shows the recorded event. Pass offset from a previous continuation to keep reading.',
    parameters: Type.Object({
      ref: Type.String({ description: 'A ref returned by search_history.' }),
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Code-point offset to continue from. Default 0.',
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 8000,
          description: 'Maximum code points per page. Default 2000.',
        }),
      ),
      around: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 20,
          description: 'Neighbouring entries on each side. Default 2.',
        }),
      ),
    }),
    execute: async (args, api) => {
      try {
        const scope = own(String(api.conversationId));
        const target = refScope(args.ref);
        if (target && target !== scope)
          return err('that ref belongs to another scope');
        return text(
          await deps.history.history.read(args.ref, {
            offset: args.offset ?? 0,
            limit: args.limit,
            around: args.around,
          }),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  // ---- chief link ------------------------------------------------------------

  const projectName = (projectId: string) =>
    db.getProject(projectId)?.name ?? projectId;

  const reportChief = defineTool({
    name: 'report_chief',
    replay: 'safe',
    description:
      'Report a status update or result to the chief — finished work, decisions you took, blockers worth escalating. Pass the delegated task id when it applies. Delivered without waiting for a reply; not for chatter.',
    parameters: Type.Object({
      text: Type.String({
        description: 'A few lines at most; self-contained.',
      }),
      task: Type.Optional(
        Type.Number({
          description: 'Delegated task id this report belongs to.',
        }),
      ),
    }),
    execute: async (args, api) => {
      const projectId = own(String(api.conversationId));
      let task: TaskRow | null = null;
      if (args.task != null) {
        task = db.getTask(args.task) ?? null;
        if (!task) return err(`Unknown task: ${args.task}`);
        if (task.scopeId !== projectId)
          return err(
            `task #${task.id} belongs to ${task.scopeId}, not this project`,
          );
      }
      // In a Tian turn only chief-delegated tasks may still be reported up;
      // his own requests answer to him directly and stay silent.
      const input = await deps.currentInput(String(api.conversationId));
      if (input?.kind === 'user' && task?.assignee !== 'manager')
        return text(
          'Tian is talking to you directly — answer him in your reply. report_chief is for work the chief delegated.',
        );
      const message = data.postManagerMessage({
        projectId,
        sender: 'manager',
        kind: 'report',
        taskId: args.task ?? null,
        body: args.text,
        operationId: `mreport:${api.taskId}:${api.callId}`,
      });
      await deps.wakeChief(
        projectId,
        `[${projectName(projectId)} manager reports]\n${args.text}`,
        `mreport:${message.id}`,
        args.task ?? null,
      );
      return text('reported to the chief.');
    },
  });

  const askChief = defineTool({
    name: 'ask_chief',
    replay: 'safe',
    description:
      "Ask the chief one question and wait for its reply. Use only when a decision genuinely blocks your work (cross-project tradeoffs, missing credentials, an ambiguous delegation) — decide yourself when you can. The reply is returned as this tool's output.",
    parameters: Type.Object({
      question: Type.String({
        description:
          'One crisp, self-contained question with the context needed to answer it.',
      }),
      task: Type.Optional(
        Type.Number({
          description: 'Delegated task id this question belongs to.',
        }),
      ),
      wait_seconds: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 3600,
          description: `How long to wait for the reply. Default ${DEFAULT_WAIT_SECONDS}.`,
        }),
      ),
    }),
    execute: async (args, api) => {
      const projectId = own(String(api.conversationId));
      if (args.task != null) {
        const task = db.getTask(args.task);
        if (!task) return err(`Unknown task: ${args.task}`);
        if (task.scopeId !== projectId)
          return err(
            `task #${task.id} belongs to ${task.scopeId}, not this project`,
          );
      }
      // A Tian turn answers Tian directly — no question row, no chief wake.
      const input = await deps.currentInput(String(api.conversationId));
      if (input?.kind === 'user')
        return text(
          'Tian is talking to you directly — ask him in your reply instead. ask_chief is for work the chief delegated.',
        );
      const posted = data.postManagerMessage({
        projectId,
        sender: 'manager',
        kind: 'question',
        taskId: args.task ?? null,
        body: args.question,
        operationId: `mgask:${api.taskId}:${api.callId}`,
      });
      // Re-read the row: a replayed call may find the question already closed.
      const question = db.managerMessage(posted.id) ?? posted;
      if (question.closedAt == null) {
        await deps.wakeChief(
          projectId,
          `[${projectName(projectId)} manager asks]\n${args.question}\n\nThe project manager is blocked waiting. Reply now with send_manager_msg(project: "${projectId}", reply_to: ${question.seq}, body: "<answer>"). If only Tian can decide, say so and give interim guidance.`,
          `mgask:${question.id}`,
          question.taskId,
        );
        const deadline =
          Date.now() + (args.wait_seconds ?? DEFAULT_WAIT_SECONDS) * 1000;
        while (Date.now() < deadline) {
          if (db.managerAnswerTo(projectId, question.id)) break;
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      }
      // Close + re-check atomically: an answer landing at the deadline is kept.
      const answer = db.closeManagerQuestion(projectId, question.id);
      if (answer) return text(`chief replied:\n${answer.body}`);
      return text(
        'No reply within the wait window — proceed with your best judgment and record the open question in your next report_chief.',
      );
    },
  });

  return defineExtension({
    name: 'tian-manager',
    sections: [preamble, coreMemorySection(deps), stateSection],
    tools: [
      addTask,
      listTasks,
      ...taskExecutionTools({
        db,
        emitUpdates: deps.emitUpdates,
        onTaskCompleted: deps.onTaskCompleted,
        taskScope: own,
        goalReminder: false,
        onTaskClosed: async (task, operationId) => {
          if (task.assignee !== 'manager') return;
          const status =
            task.status === 'completed'
              ? `completed (${task.outcome})`
              : 'failed';
          await deps.wakeChief(
            task.scopeId,
            `[${projectName(task.scopeId)} manager closed task #${task.id}: ${status}]\n${task.title}\n${task.summary ?? ''}${task.goalId ? `\nUpdate goal ${task.goalId} with update_goal.` : ''}`,
            `mtask:${operationId}`,
            task.id,
          );
        },
      }),
      ...memoryTools(deps, { lockToOwnScope: true, actor: 'manager' }),
      recall,
      listNotes,
      readNote,
      writeNote,
      appendNote,
      searchNotes,
      dispatch,
      listRuns,
      readRunReport,
      readRunDiff,
      sendRunMsg,
      listRunMsgs,
      searchHistory,
      readHistory,
      reportChief,
      askChief,
    ],
  });
}
