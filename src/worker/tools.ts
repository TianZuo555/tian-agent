import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { relevantMemorySection } from './relevant-context.js';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import type {
  AgentMessageRow,
  Db,
  ManagerMessageRow,
  RunRow,
  TaskRow,
} from './db.js';
import type { DataService } from './data.js';
import {
  ReadScopeParam,
  ScopeParam,
  coreMemorySection,
  memoryTools,
  resolveScope,
  toolErr as err,
  toolText as text,
} from './tools-memory.js';
import { historyTools, type HistoryDeps } from './tools-history.js';
import { improvementTools } from './tools-improvements.js';
import type { ImprovementStore } from './improvements.js';
import type { GoalStore } from './goals.js';
import { goalsTools } from './tools-goals.js';
import { workerModelLine, type WorkerModelChoice } from './run-model.js';
import { managerClause, managerName } from './manager-label.js';
import { describeRunProgress, type RunProgress } from './run-progress.js';

export interface ChiefDeps {
  scopes: Scopes;
  db: Db;
  data: DataService;
  goals: GoalStore;
  improvements: ImprovementStore;
  /** Open (or reuse) a goal's dedicated chief conversation. */
  openGoalConversation: (goalId: string, scopeId: string) => Promise<string>;
  /** Push task/goal updates to clients after chief tool writes. */
  emitUpdates: () => void;
  /** Refresh the Log view after an improvement write. */
  emitImprovements: () => void;
  /** Push the notices panel update for a scope. */
  emitNotices: (scopeId: string) => void;
  /** An extraction trigger fires when the chief completes a task (PRD §4.4). */
  onTaskCompleted?: (scopeId: string) => void;
  runReport: (id: string) => string;
  runDiff: (id: string) => Promise<string>;
  /** Live progress snapshot of a run (state, timing, last output, tool calls). */
  runProgress: (id: string) => Promise<RunProgress>;
  /** Stop a run's current attempt; the worktree stays for review or follow-up. */
  stopRun: (id: string, reason?: string) => Promise<RunRow>;
  /** Dispatch a headless worker run; resolves once the run is queued. */
  dispatch: (input: {
    projectRef: string;
    prompt: string;
    chiefConversationId: string | null;
    taskId?: number;
    operationId: string;
    model?: string;
    thinkingLevel?: string;
  }) => Promise<RunRow>;
  /** Model ids and thinking levels dispatch may pin for a worker. */
  workerModels: () => WorkerModelChoice[];
  /** Post a message into a run's mailbox — a reply or mid-run guidance. */
  sendRunMessage: (
    runId: string,
    body: string,
    operationId: string,
  ) => AgentMessageRow;
  /** Read the durable message thread between the chief and a run's worker. */
  runMessages: (runId: string) => AgentMessageRow[];
  /**
   * Hand a management assignment to a project's manager: creates the
   * delegated task (assignee='manager', reportTo=this conversation) and the
   * delegation thread row, then wakes the manager.
   */
  delegateToManager: (input: {
    projectId: string;
    chiefConversationId: string;
    title: string;
    briefing: string;
    goalId?: string | null;
    operationId: string;
  }) => Promise<{ task: TaskRow; message: ManagerMessageRow }>;
  /**
   * Post to a project's manager thread. With `replyTo` (a question seq) the
   * answer goes straight to the waiting manager; otherwise the manager is
   * woken. `delivered` reports which path was taken.
   */
  sendManagerMessage: (input: {
    projectId: string;
    body: string;
    replyTo?: number;
    taskId?: number;
    operationId: string;
  }) => Promise<{
    message: ManagerMessageRow;
    delivered: 'waiting' | 'woken';
  }>;
  /** Read the durable chief↔manager thread of a project. */
  managerMessages: (projectId: string) => ManagerMessageRow[];
  /**
   * Newest input entry of ANY kind (user submission, system wake, worker
   * input). This is the Core-snapshot turn marker: a notification-driven
   * request must still see memory written after the previous turn.
   */
  latestInputEntry: (conversationId: string) => Promise<string | null>;
  /**
   * The current request's input entry with its kind. `kind: "user"` can
   * confirm provenance; system wakes and worker input are traceable but never
   * confirm. Memory provenance is verified against this, never against a
   * model claim.
   */
  currentInput: (conversationId: string) => Promise<{
    entryId: string;
    kind: 'user' | 'system.notification' | 'worker.input';
    text: string;
  } | null>;
  /** Derived history backing search_history/read_history (event log + transcript index). */
  history: HistoryDeps;
}

/**
 * The chief's extension: sections inject memory wake + live world state into
 * every request; tools are the narrow envelope — no shell, no coding tools.
 */
export function chiefExtension(deps: ChiefDeps) {
  const { scopes, db, data } = deps;
  const goalTools = goalsTools({
    db,
    goals: deps.goals,
    openGoalConversation: deps.openGoalConversation,
    resolveScope: (conversationId, param) =>
      resolveScope(deps, conversationId, param),
    emitUpdates: deps.emitUpdates,
    emitNotice: deps.emitNotices,
    onTaskCompleted: deps.onTaskCompleted,
  });

  const preamble = section(
    'preamble',
    () => `You are Tian's chief of staff (大内总管) — a personal chief-of-staff agent, not a coding agent.

The user is Tian. Answer in the language they use (Chinese by default). Be direct, brief, and concrete.

MEMORY. Your memory outlives every session — without it you do not know who Tian is or what was decided. Yours is the General memory: who Tian is, his preferences, people, cross-project decisions and outcomes. It is already loaded into context (see <memory>), do not re-read it.
- remember "<one line>" whenever you learn something lasting about Tian or across projects. Judge what is worth keeping; never record trivia. Set source "user" when Tian states it explicitly.
- When Tian corrects something, call revise on that memory's #seq — never append a contradicting line. forget #seq removes a memory that should not exist at all.
- recall "<query>" keyword search over General memory (Chinese included; all words must appear, words under 3 characters use substring matching); results carry #seq, kind, trust, date and source. Pass include_history to see superseded or deleted memories.
- Core Memory is a small explicit selection, not everything you know. New memories are searchable but NOT resident: call select #seq when a fact must be visible every turn, and deselect #seq to free budget without forgetting. Over-budget selections are rejected with current usage — nothing is silently dropped or evicted. A memory leaving Core is still active and searchable.
- Project detail is not yours. Each project's manager keeps that project's memory and notes (conventions, architecture, project decisions and outcomes); they are not in your context and you cannot write them. When you learn something about a project, hand it to its manager (send_manager_msg, or the delegate briefing) so it records it. For a quick answer, recall / list_notes / read_note / search_notes with scope set to the project read its memory and notes — read only. Its #seq numbers belong to that project: revise, forget, select and deselect always act on General memory.
- Dispatched workers read only the project's exported memory/MEMORY.md and never write memory.

WORLD. <state> shows unread inbox, active goals, pending tasks and active runs — re-check it each turn rather than asking. check_inbox reads messages; send_msg posts to any scope's inbox. Goals are long-lived outcomes Tian delegated to you; each belongs to a scope with success criteria, constraints, a current state and a next action, and gets its own conversation (create_goal, list_goals). Schedules wake a goal on a cron (add_schedule); a wake hands you one task — work it in that conversation and END it with complete_task(outcome: achieved | not_achieved | no_change, summary) or fail_task(reason), then update_goal with the new current state and next action. outcome=no_change means nothing changed worth telling Tian: do not notify. When a decision or attention is genuinely needed, notify_user(goal, fingerprint, text) reaches Tian deduped for a day per fingerprint; list_goals shows schedules, remove_schedule drops one. dispatch(project, prompt, task) records code work on a task id from <state>.

DISPATCH. You command, others execute. You have no shell and cannot edit code — real work is dispatched to coding agents via dispatch(project, prompt): they work in an isolated git worktree, unattended. dispatch returns at once with a run id; when the run finishes you are woken with its report and diffstat — collect it, note what matters, and report back to Tian. dispatch(project, prompt, task, model, thinking_level) can pin a worker's model and effort — pick from the worker models line in <state> when a task needs a stronger or cheaper worker. IMPORTANT: worker changes live on the run's branch inside the worktree — the project's main checkout stays untouched until Tian lands the run from the Runs panel, so never expect them in the project directory itself. Use list_runs to see what is live and run_progress(run) to read its state, elapsed time, last words and recent tool calls — that is how you answer "how is it going" instead of guessing. If a run is going the wrong way, stop_run(run, reason) ends the current attempt and keeps its worktree: its work stays reviewable, landable, and open to a follow-up. Stopping is not discarding — only Tian discards. Tian can also follow up, land, ship or discard a run from the UI.

WORKER QUESTIONS. Workers can ask you questions mid-run with ask_chief — you are woken with the question and the run id while the worker waits. Answer at once with send_run_msg(run, body): short, concrete, self-contained. If only Tian can decide, say so, give your best interim guidance, and tell Tian afterwards. send_run_msg also steers a run proactively; list_run_msgs reviews a thread.

MANAGERS. Every project has a project manager — a persistent agent that owns that project's tasks, memory, notes and runs, and dispatches its own workers. <state> and list_scopes show every project with its manager's name (for example '- tian-agent (/path) — manager: 阿七'). Address the manager by its name when you talk about it. delegate(project, title, briefing, goal?) hands it a management task: the task is assigned to the manager and you are woken when it closes with the outcome. Its questions arrive as '[<project> manager asks]' wakes — answer with send_manager_msg(project, body, reply_to) so a waiting manager gets it directly; without reply_to the manager is woken with new guidance. Delegated tasks are the manager's — do not start_task/complete_task/fail_task or send_run_msg its runs yourself; steer with send_manager_msg. Goals stay yours: when a delegated goal task closes, update_goal with the result. list_manager_msgs(project) reads the thread. Delegate substantial multi-step project work; keep one-off questions and quick code changes on dispatch yourself.

SCOPES. This conversation is bound to one scope. Task, inbox, goal and history tools take an optional scope parameter to work across scopes — to answer "how are my projects" from General, query them. Memory and notes follow ownership instead: your memory and notes tools default to General and write only General; a scope parameter on recall and the note readers reads a project read-only.

HISTORY. Everything said or done stays searchable across sessions. When Tian asks about a past discussion, decision, or what happened before, run search_history(query) instead of guessing: it returns dated lines with refs like conv:12#345 or event:<id> — cite the ref in your answer and use read_history(ref) to expand the surrounding context. The scope defaults to this conversation's scope; pass scope "all" to search everything. If nothing matches, say plainly that no record was found — never invent history.

LOG. Use log_improvement for durable product feedback: broken behavior, recurring friction, a concrete idea, or a win worth repeating. Log it when Tian reports it (source "user") or when you notice it while working; skip routine task noise and one-off model hiccups. Entries appear in Tian's Log view, where he triages them and promotes one into a task. Run list_improvements before logging if you are unsure whether it is already there — do not duplicate an open entry.`,
    { tag: false },
  );

  // The chief's Core is General only (D18): project detail stays with that
  // project's manager and is read on demand with recall(scope).
  const memorySection = coreMemorySection(deps, { withProject: false });
  /** Memory and notes reads default to General; a scope reads a project. */
  const readScope = (conversationId: string, param?: string): string =>
    param ? resolveScope(deps, conversationId, param) : GLOBAL_SCOPE;
  /** Header that marks another scope's memory or notes as read-only. */
  const readOnlyNote = (scope: string): string => {
    if (scope === GLOBAL_SCOPE) return '';
    const project = db.getProject(scope);
    return `[${project?.name ?? scope} — read-only; owned by ${project ? managerName(project) : 'its manager'}. To change it, tell the manager with send_manager_msg.]\n`;
  };

  const stateSection = section('state', (input) => {
    const scope = db.conversationScope(String(input.conversationId));
    const lines: string[] = [];
    try {
      const unread = scopes.unreadMessages(scope);
      if (unread.length > 0) {
        lines.push(`unread inbox (${unread.length}):`);
        for (const m of unread.slice(0, 10))
          lines.push(
            `  [${m.ts}] ${m.from}: ${m.body.split('\n')[0].slice(0, 140)}`,
          );
      }
      const goals = deps.goals
        .listGoals(scope)
        .filter((g) => g.status === 'active');
      if (goals.length > 0) {
        lines.push(`active goals (${goals.length}):`);
        for (const g of goals.slice(0, 10)) {
          const schedule = g.schedules[0];
          lines.push(
            `  ${g.id} ${g.objective}${g.nextAction ? ` — next: ${g.nextAction}` : ''}${schedule?.enabled ? ` (cron ${schedule.cron})` : ''}`,
          );
        }
      }
      const tasks = db
        .listTasks(scope)
        .filter((t) =>
          ['pending', 'running', 'waiting_approval', 'blocked'].includes(
            t.status,
          ),
        );
      if (tasks.length > 0) {
        lines.push(`tasks (${tasks.length}):`);
        for (const t of tasks.slice(0, 10))
          lines.push(
            `  #${t.id} [${t.status}] ${t.assignee === 'manager' ? '(manager) ' : ''}${t.title}${t.due ? ` (due ${t.due})` : ''}${t.goalId ? ` [goal ${t.goalId}]` : ''}`,
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
    const models = workerModelLine(deps.workerModels());
    if (models) lines.push(models);
    const project = scope === GLOBAL_SCOPE ? null : db.getProject(scope);
    // Every project carries its manager's name (or `无`): the chief addresses
    // the manager by that name and knows which projects it can delegate to.
    const projects = db.listProjects();
    if (projects.length > 0) {
      lines.push(`projects (${projects.length}):`);
      for (const p of projects.slice(0, 20))
        lines.push(`- ${p.name} (${p.rootPath})${managerClause(p)}`);
      if (projects.length > 20)
        lines.push(`… and ${projects.length - 20} more projects`);
    }
    const header = [
      `scope: ${project ? `${project.name} (${project.rootPath})${managerClause(project)}` : 'General'}`,
      `now: ${new Date().toISOString().slice(0, 16)}`,
    ];
    return lines.length > 0
      ? [...header, '', ...lines].join('\n')
      : header.join('\n');
  });

  const recall = defineTool({
    name: 'recall',
    description:
      "Keyword search over General memory, or a project's memory read-only (Chinese included; every word must appear, words under 3 characters fall back to substring matching). Active memories by default; each hit shows #seq, kind, trust, date and source. Results are relevance-ranked and bounded by limit and a token budget.",
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
      scope: ReadScopeParam,
    }),
    execute: async (args, api) => {
      try {
        const scope = readScope(String(api.conversationId), args.scope);
        return text(
          readOnlyNote(scope) +
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

  const listScopes = defineTool({
    name: 'list_scopes',
    description:
      "List all scopes: General plus every registered project (id, name, path, and its manager's name).",
    parameters: Type.Object({}),
    execute: async () => {
      const projects = db.listProjects();
      const lines = [
        `global — General`,
        ...projects.map(
          (p) => `${p.id} — ${p.name} (${p.rootPath})${managerClause(p)}`,
        ),
      ];
      return text(lines.join('\n'));
    },
  });

  const addTask = defineTool({
    name: 'add_task',
    replay: 'safe',
    description: "Add a todo item to a scope's task list.",
    parameters: Type.Object({
      title: Type.String(),
      due: Type.Optional(Type.String({ description: 'ISO date or datetime.' })),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const id = data.addTask(
        scope,
        args.title,
        args.due ?? null,
        `task:${api.taskId}:${api.callId}`,
      );
      return text(
        `task #${id} added in [${scope === GLOBAL_SCOPE ? 'global' : scope}].`,
      );
    },
  });

  const listTasks = defineTool({
    name: 'list_tasks',
    description:
      'List tasks of a scope (incomplete first). Tasks may belong to a goal.',
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
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const tasks = db.listTasks(scope, args.status);
      if (tasks.length === 0) return text('(no tasks)');
      return text(
        tasks
          .map(
            (t) =>
              `#${t.id} [${t.status}] ${t.assignee === 'manager' ? '(manager) ' : t.owner === 'agent' ? '(agent) ' : ''}${t.title}${t.due ? ` due:${t.due}` : ''}${t.goalId ? ` goal:${t.goalId}` : ''}`,
          )
          .join('\n'),
      );
    },
  });

  const doneTask = defineTool({
    name: 'done_task',
    replay: 'safe',
    description: 'Mark a task completed by id (or reopen it as pending).',
    parameters: Type.Object({ id: Type.Number() }),
    execute: async (args, api) => {
      data.doneTask(args.id, true, `done-task:${api.taskId}:${api.callId}`);
      return text(`task #${args.id} done.`);
    },
  });

  const checkInbox = defineTool({
    name: 'check_inbox',
    description: 'Read unread inbox messages of a scope and mark them read.',
    parameters: Type.Object({ scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const unread = data.checkInbox(scope);
      if (unread.length === 0) return text('(inbox empty)');
      return text(
        unread
          .map(
            (m) => `[${m.ts}] ${m.from}${m.to ? ` → ${m.to}` : ''}:\n${m.body}`,
          )
          .join('\n---\n'),
      );
    },
  });

  const sendMsg = defineTool({
    name: 'send_msg',
    description:
      "Post a message to a scope's inbox (a project, General, or broadcast with empty to).",
    parameters: Type.Object({
      body: Type.String(),
      scope: ScopeParam,
      to: Type.Optional(
        Type.String({
          description:
            'Recipient hint, e.g. a scope name; empty = whoever reads.',
        }),
      ),
      thread: Type.Optional(Type.String()),
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const id = data.sendMessage(scope, args.body, args.to, args.thread);
      return text(
        `message ${id} posted to [${scope === GLOBAL_SCOPE ? 'global' : scope}] inbox.`,
      );
    },
  });

  const listNotes = defineTool({
    name: 'list_notes',
    description:
      "List the General markdown notes, or a project's notes read-only.",
    parameters: Type.Object({ scope: ReadScopeParam }),
    execute: async (args, api) => {
      try {
        const scope = readScope(String(api.conversationId), args.scope);
        const names = scopes.listNotes(scope);
        return text(
          readOnlyNote(scope) +
            (names.length === 0 ? '(no notes)' : names.join('\n')),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const readNote = defineTool({
    name: 'read_note',
    description:
      'Read a General note, or a project\'s note read-only. Pass a search_notes hit like "plan.md:42" to open a bounded window around that line.',
    parameters: Type.Object({
      name: Type.String({
        description: 'Note name, optionally with ":<line>" from search_notes.',
      }),
      scope: ReadScopeParam,
    }),
    execute: async (args, api) => {
      try {
        const scope = readScope(String(api.conversationId), args.scope);
        return text(
          readOnlyNote(scope) + scopes.readNoteWindow(scope, args.name),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const writeNote = defineTool({
    name: 'write_note',
    description:
      "Create or overwrite a General note. Project notes are the manager's.",
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
    }),
    execute: async (args) => {
      scopes.writeNote(GLOBAL_SCOPE, args.name, args.content);
      return text(`note "${args.name}" written in [global].`);
    },
  });

  const appendNote = defineTool({
    name: 'append_note',
    description:
      "Append text to a General note. Project notes are the manager's.",
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
    }),
    execute: async (args) => {
      scopes.appendNote(GLOBAL_SCOPE, args.name, args.content);
      return text(`appended to "${args.name}" in [global].`);
    },
  });

  const searchNotes = defineTool({
    name: 'search_notes',
    description:
      "Keyword search over the General notes, or a project's notes read-only: every word must appear on the line (case-insensitive). Returns bounded file:line hits that read_note can open (pass the same scope).",
    parameters: Type.Object({
      query: Type.String({
        description: 'One or more words; all must appear.',
      }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100, description: 'Default 40.' }),
      ),
      scope: ReadScopeParam,
    }),
    execute: async (args, api) => {
      try {
        const scope = readScope(String(api.conversationId), args.scope);
        return text(
          readOnlyNote(scope) +
            scopes.searchNotes(scope, args.query, args.limit),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const dispatch = defineTool({
    name: 'dispatch',
    replay: 'safe',
    description:
      'Dispatch a task to a worker coding agent in an isolated git worktree of a project. Returns immediately with a run id — you are woken with the report and diffstat when it finishes. Only for work that changes files; answer questions yourself.',
    parameters: Type.Object({
      project: Type.Optional(
        Type.String({
          description:
            "Project name or id. Default: this conversation's scope (must be a project).",
        }),
      ),
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
      model: Type.Optional(
        Type.String({
          description:
            'Worker model id from the worker models line in <state>. Default: the app-wide model.',
        }),
      ),
      thinking_level: Type.Optional(
        Type.String({
          description:
            "Worker thinking level — one of off, minimal, low, medium, high, xhigh, max that the chosen model lists in <state>. Default: the model's own.",
        }),
      ),
    }),
    execute: async (args, api) => {
      const scope = resolveScope(
        deps,
        String(api.conversationId),
        args.project,
      );
      if (scope === GLOBAL_SCOPE)
        return err('dispatch needs a project scope — pass a project name.');
      try {
        const run = await deps.dispatch({
          projectRef: scope,
          prompt: args.prompt,
          chiefConversationId: String(api.conversationId),
          taskId: args.task,
          operationId: `dispatch:${api.taskId}:${api.callId}`,
          model: args.model,
          thinkingLevel: args.thinking_level,
        });
        return text(
          `dispatched run ${run.id} on ${run.agentKind}${
            run.model
              ? ` [model ${run.model}${run.thinkingLevel ? ` think:${run.thinkingLevel}` : ''}]`
              : ''
          } — worktree ${run.worktreePath ?? '(in place, not a git repo)'}. I'll report when it finishes.`,
        );
      } catch (e) {
        return err(`dispatch failed: ${e instanceof Error ? e.message : e}`);
      }
    },
  });

  const readRunReport = defineTool({
    name: 'read_run_report',
    description: 'Read the report of a dispatched run by its ID.',
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args) => text(deps.runReport(args.id)),
  });
  const readRunDiff = defineTool({
    name: 'read_run_diff',
    description: 'Read the Git diff of a dispatched run by its ID.',
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args) => text(await deps.runDiff(args.id)),
  });

  const runProgress = defineTool({
    name: 'run_progress',
    description:
      'Check on a live run: how long it has been running, when its deadline is, what it last said, and the last few tool calls it made. Use it when Tian asks how a run is going or when a run went quiet — do not guess.',
    parameters: Type.Object({
      id: Type.String({ description: 'Run id from list_runs or a question.' }),
    }),
    execute: async (args) => {
      try {
        return text(describeRunProgress(await deps.runProgress(args.id)));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const stopRun = defineTool({
    name: 'stop_run',
    replay: 'safe',
    description:
      'Stop a run whose current attempt is going the wrong way. The worker is aborted and the run ends interrupted, but its worktree and branch stay: review, land, or follow up afterwards. Not a discard — nothing is deleted.',
    parameters: Type.Object({
      id: Type.String({ description: 'Run id from list_runs.' }),
      reason: Type.Optional(
        Type.String({
          description:
            'One line Tian can read later explaining why it was stopped.',
        }),
      ),
    }),
    execute: async (args) => {
      try {
        const run = await deps.stopRun(args.id, args.reason);
        return text(
          `run ${run.id} stopped [${run.status}] — its worktree${run.worktreePath ? ` ${run.worktreePath}` : ''} is kept. Tian can land or discard it from the Runs panel; you can also read_run_diff or ask for a follow-up.`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const listRuns = defineTool({
    name: 'list_runs',
    description:
      'List dispatched runs of a scope (or all scopes) with status and how long a live one has been running.',
    parameters: Type.Object({ scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = args.scope
        ? resolveScope(deps, String(api.conversationId), args.scope)
        : null;
      const runs = db.listRuns(scope);
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

  const sendRunMsg = defineTool({
    name: 'send_run_msg',
    replay: 'safe',
    description:
      'Reply to a run worker waiting on ask_chief, or send it mid-run guidance. A waiting worker receives it immediately; otherwise it reads it on its next check.',
    parameters: Type.Object({
      run: Type.String({
        description: 'Run id from the question or list_runs.',
      }),
      body: Type.String({
        description: 'Short, concrete, self-contained answer or instruction.',
      }),
    }),
    execute: async (args, api) => {
      try {
        const run = db.getRun(args.run);
        if (
          run?.chiefConversationId &&
          db.isManagerConversation(run.chiefConversationId)
        )
          return err(
            `run ${args.run} is steered by the ${db.getProject(run.projectId)?.name ?? run.projectId} manager — use send_manager_msg.`,
          );
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
      "Read the durable message thread between you and a run's worker.",
    parameters: Type.Object({ run: Type.String() }),
    execute: async (args) => {
      try {
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

  const delegate = defineTool({
    name: 'delegate',
    replay: 'safe',
    description:
      "Hand a management task to a project's manager — a persistent agent that owns that project's tasks, memory, notes and coding runs. Creates a task assigned to the manager; you are woken when it closes with the outcome. For one-off code changes prefer dispatch.",
    parameters: Type.Object({
      project: Type.String({
        description: 'Project name or id (must be a project, not global).',
      }),
      title: Type.String({
        description: 'One line: what the manager should achieve.',
      }),
      briefing: Type.String({
        description:
          'Full management briefing — the context, constraints, and what to report back. The manager sees this project only.',
      }),
      goal: Type.Optional(
        Type.String({
          description:
            'Goal id this task advances; must belong to the same project.',
        }),
      ),
    }),
    execute: async (args, api) => {
      const scope = resolveScope(
        deps,
        String(api.conversationId),
        args.project,
      );
      if (scope === GLOBAL_SCOPE)
        return err('delegate needs a project scope — pass a project name.');
      const project = db.getProject(scope);
      if (!project) return err(`Unknown project: ${scope}`);
      const goal = args.goal ? deps.goals.getGoal(args.goal) : null;
      if (args.goal && !goal) return err(`Unknown goal: ${args.goal}`);
      if (goal && goal.scopeId !== scope)
        return err(
          `goal ${goal.id} belongs to ${goal.scopeId}, not ${scope} — delegate it to that project instead.`,
        );
      try {
        const { task } = await deps.delegateToManager({
          projectId: scope,
          chiefConversationId: String(api.conversationId),
          title: args.title,
          briefing: args.briefing,
          goalId: goal?.id ?? null,
          operationId: `delegate:${api.taskId}:${api.callId}`,
        });
        return text(
          `delegated as task #${task.id} to ${managerName(project)}, the ${project.name} manager. You'll be woken when it closes.`,
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const sendManagerMsg = defineTool({
    name: 'send_manager_msg',
    replay: 'safe',
    description:
      "Send a message to a project's manager — an answer to its ask_chief, or new guidance on its thread. An answer goes straight to the waiting manager; anything else wakes it.",
    parameters: Type.Object({
      project: Type.String({ description: 'Project name or id.' }),
      body: Type.String({
        description: 'Short, concrete, self-contained answer or instruction.',
      }),
      reply_to: Type.Optional(
        Type.Number({
          description:
            'Question seq the manager is waiting on (from its ask_chief wake).',
        }),
      ),
      task: Type.Optional(
        Type.Number({
          description: 'Delegated task id this message refers to.',
        }),
      ),
    }),
    execute: async (args, api) => {
      const scope = resolveScope(
        deps,
        String(api.conversationId),
        args.project,
      );
      if (scope === GLOBAL_SCOPE)
        return err(
          'send_manager_msg needs a project scope — pass a project name.',
        );
      const project = db.getProject(scope);
      if (!project) return err(`Unknown project: ${scope}`);
      try {
        const result = await deps.sendManagerMessage({
          projectId: scope,
          body: args.body,
          replyTo: args.reply_to,
          taskId: args.task,
          operationId: `send-mgr-msg:${api.taskId}:${api.callId}`,
        });
        return text(
          result.delivered === 'waiting'
            ? 'answer handed to the waiting manager.'
            : 'message delivered — the manager was woken.',
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const listManagerMsgs = defineTool({
    name: 'list_manager_msgs',
    description:
      "Read the durable message thread between you and a project's manager — delegations, reports, questions and answers.",
    parameters: Type.Object({
      project: Type.String({ description: 'Project name or id.' }),
    }),
    execute: async (args, api) => {
      const scope = resolveScope(
        deps,
        String(api.conversationId),
        args.project,
      );
      const project = db.getProject(scope);
      if (!project) return err(`Unknown project: ${scope}`);
      try {
        const messages = deps.managerMessages(scope);
        if (messages.length === 0)
          return text(`(no messages with ${managerName(project)} yet)`);
        return text(
          messages
            .map(
              (m) =>
                `#${m.seq} [${m.kind}]${m.taskId != null ? ` task:#${m.taskId}` : ''}${m.replyTo ? ` re:#${db.managerMessage(m.replyTo)?.seq ?? m.replyTo}` : ''} [${m.createdAt}] ${m.sender === 'chief' ? 'you' : 'manager'}:\n${m.body}`,
            )
            .join('\n---\n'),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  return defineExtension({
    name: 'chief',
    sections: [
      preamble,
      memorySection,
      stateSection,
      relevantMemorySection(deps, false),
    ],
    tools: [
      ...memoryTools(deps, {
        actor: 'chief',
        ownScope: () => GLOBAL_SCOPE,
        owner: 'General memory',
      }),
      recall,
      listScopes,
      addTask,
      listTasks,
      doneTask,
      checkInbox,
      sendMsg,
      listNotes,
      readNote,
      writeNote,
      appendNote,
      searchNotes,
      dispatch,
      listRuns,
      readRunReport,
      readRunDiff,
      runProgress,
      stopRun,
      sendRunMsg,
      listRunMsgs,
      delegate,
      sendManagerMsg,
      listManagerMsgs,
      ...historyTools(deps.history),
      ...goalTools,
      ...improvementTools(deps),
    ],
  });
}
