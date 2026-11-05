import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { relevantMemorySection } from './relevant-context.js';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import type { AgentMessageRow, Db, ManagerMessageRow, TaskRow } from './db.js';
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
import { managerClause, managerName } from './manager-label.js';
import { describeRunProgress, type RunProgress } from './run-progress.js';

export interface ChiefDeps {
  scopes: Scopes;
  db: Db;
  data: DataService;
  goals: GoalStore;
  improvements: ImprovementStore;
  /** Open (or reuse) a goal's dedicated chief conversation. */
  openGoalConversation: (goalId: string) => Promise<string>;
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
  /** Read the durable message thread between a run's worker and its manager. */
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
    // The chief works General tasks only — a project's tasks are its
    // manager's (M6); delegated tasks carry assignee='manager' on top.
    taskScope: () => GLOBAL_SCOPE,
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
- Workers see none of this: a worker receives only its manager's briefing and the worktree — no memory, notes or history.

WORLD. <state> shows unread inbox, active goals, pending tasks and active runs — re-check it each turn rather than asking. check_inbox reads the General inbox; send_msg posts to any scope's inbox. Goals are long-lived outcomes Tian delegated to you; each keeps a project or General reference and gets its own conversation in General (create_goal, list_goals). Schedules wake a goal on a cron (add_schedule); a wake hands you one task — work it in that conversation and END it with complete_task(outcome: achieved | not_achieved | no_change, summary) or fail_task(reason), then update_goal with the new current state and next action. outcome=no_change means nothing changed worth telling Tian: do not notify. When a decision or attention is genuinely needed, notify_user(goal, fingerprint, text) reaches Tian deduped for a day per fingerprint; list_goals shows schedules, remove_schedule drops one. Coding work never runs in this conversation — delegate it to a project manager.

PROJECT WORK. You command, others execute. You have no shell and cannot edit code — and you do not dispatch workers yourself. Every project has a manager that owns its tasks and runs and dispatches its own workers; hand project work to it with delegate(project, title, briefing, goal?) — a task is assigned to the manager and you are woken when it closes with the outcome. Collect it, note what matters, and report back to Tian. Runs stay inspectable for you: list_runs shows what is live anywhere, run_progress(run) reads a live run's state, elapsed time and recent tool calls, read_run_report(run) and read_run_diff(run) read a finished run's report and diff, list_run_msgs(run) reads its worker↔manager thread — that is how you answer "how is it going" instead of guessing. IMPORTANT: worker changes live on the run's branch inside the worktree — the project's main checkout stays untouched until Tian lands the run from the Runs panel, so never expect them in the project directory itself. Only a run's manager steers or stops it — to change course, send_manager_msg the manager. Tian can stop, follow up, land, ship or discard a run from the UI.

MANAGERS. Every project has a project manager — a persistent agent that owns that project's tasks, memory, notes and runs, and dispatches its own workers. <state> and list_scopes show every project with its manager's name (for example '- tian-agent (/path) — manager: 阿七'). Address the manager by its name when you talk about it. Its questions arrive as '[<project> manager asks]' wakes — answer with send_manager_msg(project, body, reply_to) so a waiting manager gets it directly; without reply_to the manager is woken with new guidance. Project tasks and runs are the manager's — do not start_task/complete_task/fail_task them, and a worker's questions go to its manager, not you. Goals stay yours: when a delegated goal task closes, update_goal with the result. list_manager_msgs(project) reads the thread. Delegate all project work — a quick question, a code change, or a multi-step job alike.

SCOPES. You live in General — every conversation of yours is General. Read tools take an optional scope to look into a project (list_tasks, list_goals, list_runs, recall and the note readers) — reads cross scopes, writes stay General: your tasks, notes and memory are General's. send_msg can post to a project's inbox; for real work use delegate instead.

HISTORY. Everything said or done in General stays searchable across sessions. When Tian asks about a past discussion, decision, or what happened before, run search_history(query) instead of guessing: it returns dated lines with refs like conv:12#345 or event:<id> — cite the ref in your answer and use read_history(ref) to expand the surrounding context. History covers General only — project transcripts belong to their managers; read the project's memory and notes, or ask the manager. If nothing matches, say plainly that no record was found — never invent history.

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
      // All goals are the chief's — a project scope on a goal is the
      // project reference, not another owner (M6).
      const goals = deps.goals
        .listGoals(null)
        .filter((g) => g.status === 'active');
      if (goals.length > 0) {
        lines.push(`active goals (${goals.length}):`);
        for (const g of goals.slice(0, 10)) {
          const schedule = g.schedules[0];
          const project =
            g.scopeId === GLOBAL_SCOPE
              ? ''
              : ` [${db.getProject(g.scopeId)?.name ?? g.scopeId}]`;
          lines.push(
            `  ${g.id}${project} ${g.objective}${g.nextAction ? ` — next: ${g.nextAction}` : ''}${schedule?.enabled ? ` (cron ${schedule.cron})` : ''}`,
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
      // Oversight over every project's runs — the chief never owns one.
      const running = db
        .listRuns(null)
        .filter((r) => ['running', 'queued', 'collecting'].includes(r.status));
      if (running.length > 0)
        lines.push(
          `active runs: ${running.map((r) => `${r.id} (${r.projectId})`).join(', ')}`,
        );
    } catch {
      // scope dirs not created yet — nothing to report
    }
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
    description:
      'Add a todo item to the General task list. Project tasks belong to their managers — delegate instead.',
    parameters: Type.Object({
      title: Type.String(),
      due: Type.Optional(Type.String({ description: 'ISO date or datetime.' })),
    }),
    execute: async (args, api) => {
      const id = data.addTask(
        GLOBAL_SCOPE,
        args.title,
        args.due ?? null,
        `task:${api.taskId}:${api.callId}`,
      );
      return text(`task #${id} added in [global].`);
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
    description:
      'Mark a General task completed by id. Project tasks belong to their managers.',
    parameters: Type.Object({ id: Type.Number() }),
    execute: async (args, api) => {
      const task = db.getTask(args.id);
      if (task && task.scopeId !== GLOBAL_SCOPE)
        return err(
          `task #${args.id} belongs to the ${db.getProject(task.scopeId)?.name ?? task.scopeId} manager — steer it with send_manager_msg.`,
        );
      data.doneTask(args.id, true, `done-task:${api.taskId}:${api.callId}`);
      return text(`task #${args.id} done.`);
    },
  });

  const checkInbox = defineTool({
    name: 'check_inbox',
    description:
      "Read unread inbox messages of General and mark them read. A project's inbox is its manager's.",
    parameters: Type.Object({}),
    execute: async () => {
      const unread = data.checkInbox(GLOBAL_SCOPE);
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
              `${r.id} [${r.status}] ${r.runtime} in ${r.projectId}${r.finishedAt ? ` finished:${r.finishedAt}` : ''}\n  ${r.prompt.split('\n')[0].slice(0, 100)}`,
          )
          .join('\n'),
      );
    },
  });

  const listRunMsgs = defineTool({
    name: 'list_run_msgs',
    description:
      "Read the durable message thread between a run's worker and its manager.",
    parameters: Type.Object({ run: Type.String() }),
    execute: async (args) => {
      try {
        const messages = deps.runMessages(args.run);
        if (messages.length === 0) return text('(no messages)');
        return text(
          messages
            .map(
              (m) =>
                `[${m.createdAt}] ${m.sender === 'manager' ? 'manager' : 'worker'}:\n${m.body}`,
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
      "Hand a management task to a project's manager — a persistent agent that owns that project's tasks, memory, notes and coding runs, and dispatches its own workers. Creates a task assigned to the manager; you are woken when it closes with the outcome. This is how all project work — questions, code changes, multi-step jobs — gets done.",
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
            'Goal id this task advances; a project goal must match this project, a General goal may delegate anywhere.',
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
      if (goal && goal.scopeId !== scope && goal.scopeId !== GLOBAL_SCOPE)
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
      relevantMemorySection(deps, 'chief'),
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
      listRuns,
      readRunReport,
      readRunDiff,
      runProgress,
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
