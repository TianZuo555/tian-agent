import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import type { AgentMessageRow, Db, RunRow } from './db.js';
import type { DataService } from './data.js';
import {
  ScopeParam,
  memoryTools,
  mergeNotice,
  resolveScope,
  toolErr as err,
  toolText as text,
} from './tools-memory.js';
import { historyTools, type HistoryDeps } from './tools-history.js';

export interface ChiefDeps {
  scopes: Scopes;
  db: Db;
  data: DataService;
  runReport: (id: string) => string;
  runDiff: (id: string) => Promise<string>;
  /** Dispatch a headless worker run; resolves once the run is queued. */
  dispatch: (input: {
    projectRef: string;
    prompt: string;
    chiefConversationId: string | null;
    operationId: string;
  }) => Promise<RunRow>;
  /** Post a message into a run's mailbox — a reply or mid-run guidance. */
  sendRunMessage: (
    runId: string,
    body: string,
    operationId: string,
  ) => AgentMessageRow;
  /** Read the durable message thread between the chief and a run's worker. */
  runMessages: (runId: string) => AgentMessageRow[];
  /** Newest user entry in a conversation, to detect a new user turn. */
  latestUserEntry: (conversationId: string) => Promise<string | null>;
  /** Derived history backing search_history/read_history (event log + transcript index). */
  history: HistoryDeps;
}

/**
 * The chief's extension: sections inject memory wake + live world state into
 * every request; tools are the narrow envelope — no shell, no coding tools.
 */
export function chiefExtension(deps: ChiefDeps) {
  const { scopes, db, data } = deps;

  const preamble = section(
    'preamble',
    () => `You are Tian's chief of staff (大内总管) — a personal chief-of-staff agent, not a coding agent.

The user is Tian. Answer in the language they use (Chinese by default). Be direct, brief, and concrete.

MEMORY. Your memory outlives every session — without it you do not know who Tian is or what was decided. It is already loaded into context (see <memory>), do not re-read it.
- remember "<one line>" whenever you learn something lasting: a fact about Tian, a project decision, an outcome, a preference. Judge what is worth keeping; never record trivia. Set source "user" when Tian states it explicitly, target "global" for facts about Tian, "project" for facts about the project.
- When Tian corrects something, call revise on that memory's #seq — never append a contradicting line. forget #seq removes a memory that should not exist at all.
- recall "<query>" full-text search over memory (Chinese included; queries under 3 characters use substring matching); pass include_history to see superseded or deleted memories. zoom <lo>-<hi> drills a summary node down to raw lines.
- If a compression is due, do it immediately: call nap with the range and a one-line summary before anything else.
- You are the only writer of memory. Dispatched workers read only the exported memory/MEMORY.md and never write memory.

WORLD. <state> shows unread inbox, open tasks and active runs — re-check it each turn rather than asking. check_inbox reads messages; send_msg posts to any scope's inbox.

DISPATCH. You command, others execute. You have no shell and cannot edit code — real work is dispatched to coding agents via dispatch(project, prompt): they work in an isolated git worktree, unattended. dispatch returns at once with a run id; when the run finishes you are woken with its report and diffstat — collect it, note what matters, and report back to Tian. IMPORTANT: worker changes live on the run's branch inside the worktree — the project's main checkout stays untouched until Tian lands the run from the Runs panel, so never expect them in the project directory itself. Use list_runs to check progress; Tian can also follow up, land, ship or discard a run from the UI.

WORKER QUESTIONS. Workers can ask you questions mid-run with ask_chief — you are woken with the question and the run id while the worker waits. Answer at once with send_run_msg(run, body): short, concrete, self-contained. If only Tian can decide, say so, give your best interim guidance, and tell Tian afterwards. send_run_msg also steers a run proactively; list_run_msgs reviews a thread.

SCOPES. This conversation is bound to one scope. Tools take an optional scope parameter to read or write across scopes — to answer "how are my projects" from General, query them. To write memory about another scope, pass its scope to remember.

HISTORY. Everything said or done stays searchable across sessions. When Tian asks about a past discussion, decision, or what happened before, run search_history(query) instead of guessing: it returns dated lines with refs like conv:12#345 or event:<id> — cite the ref in your answer and use read_history(ref) to expand the surrounding context. The scope defaults to this conversation's scope; pass scope "all" to search everything. If nothing matches, say plainly that no record was found — never invent history.`,
    { tag: false },
  );

  //
  // Core Memory snapshot: the rendered text lands in the cacheable system-prompt
  // prefix, so it is computed once per conversation and refreshed only when a
  // new user turn starts AND the scope's memory version changed since. Writes
  // within a turn reach the model through the tool results instead.
  const snapshots = new Map<
    string,
    { text: string; version: string; turn: string | null }
  >();
  const renderMemory = (scope: string): string => {
    const parts: string[] = [];
    const pending = (scopeId: string) => {
      const merge = scopes.memory(scopeId).nextMerge();
      return merge
        ? `\nCOMPRESSION DUE: call nap with scope="${scopeId}", lo=${merge.lo}, hi=${merge.hi}. Summarize:\n${merge.source}`
        : '';
    };
    const globalWake = scopes.memory(GLOBAL_SCOPE).wake();
    parts.push(`[global]\n${globalWake}${pending(GLOBAL_SCOPE)}`);
    if (scope !== GLOBAL_SCOPE) {
      const project = db.getProject(scope);
      parts.push(
        `[project: ${project?.name ?? scope}]\n${scopes.memory(scope).wake()}${pending(scope)}`,
      );
    }
    return parts.join('\n\n');
  };

  const memorySection = section('memory', async (input) => {
    const conversationId = String(input.conversationId);
    const scope = db.conversationScope(conversationId);
    const version = `${scopes.memory(GLOBAL_SCOPE).version()}/${scope === GLOBAL_SCOPE ? '' : scopes.memory(scope).version()}`;
    let turn: string | null;
    try {
      turn = await deps.latestUserEntry(conversationId);
    } catch {
      turn = `unavailable-${Date.now()}`; // degradation: recompute every request
    }
    const cached = snapshots.get(conversationId);
    if (cached && cached.turn === turn) return cached.text;
    if (cached && cached.version === version) {
      cached.turn = turn; // new turn but unchanged memory: keep the snapshot
      return cached.text;
    }
    const rendered = renderMemory(scope);
    if (snapshots.size > 200) snapshots.clear();
    snapshots.set(conversationId, { text: rendered, version, turn });
    return rendered;
  });

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
      const tasks = db.listTasks(scope, 'open');
      if (tasks.length > 0) {
        lines.push(`open tasks (${tasks.length}):`);
        for (const t of tasks.slice(0, 10))
          lines.push(`  #${t.id} ${t.title}${t.due ? ` (due ${t.due})` : ''}`);
      }
      const running = db
        .listRuns(scope)
        .filter((r) => ['running', 'queued', 'collecting'].includes(r.status));
      if (running.length > 0)
        lines.push(`active runs: ${running.map((r) => r.id).join(', ')}`);
    } catch {
      // scope dirs not created yet — nothing to report
    }
    const project = scope === GLOBAL_SCOPE ? null : db.getProject(scope);
    const header = [
      `scope: ${project ? `${project.name} (${project.rootPath})` : 'General'}`,
      `now: ${new Date().toISOString().slice(0, 16)}`,
    ];
    return lines.length > 0
      ? [...header, '', ...lines].join('\n')
      : header.join('\n');
  });

  const nap = defineTool({
    name: 'nap',
    description:
      'Answer a pending memory compression: write a one-line summary covering the given range of memory #seq values. Call this when remember/revise reports a compression due.',
    parameters: Type.Object({
      lo: Type.Integer({ minimum: 0 }),
      hi: Type.Integer({ minimum: 1 }),
      summary: Type.String({
        description: 'One line summarizing memories #lo..#hi.',
      }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const next = data.nap(scope, args.lo, args.hi, args.summary);
        return text(`merged ${args.lo}-${args.hi}.${mergeNotice(scope, next)}`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const recall = defineTool({
    name: 'recall',
    description:
      "Full-text search over a scope's memories (FTS, Chinese included; queries under 3 characters fall back to substring matching). Active memories by default.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Search text; at least 3 characters for full-text matching.',
      }),
      include_history: Type.Optional(
        Type.Boolean({
          description:
            'Include superseded and deleted memories (marked with their status). Default: false.',
        }),
      ),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        return text(
          scopes.memory(scope).recall(args.query, {
            includeHistory: args.include_history ?? false,
          }),
        );
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const zoom = defineTool({
    name: 'zoom',
    description:
      'Open a memory summary node into its two halves, down to raw #seq lines.',
    parameters: Type.Object({
      lo: Type.Integer({ minimum: 0 }),
      hi: Type.Integer({ minimum: 1 }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        return text(scopes.memory(scope).zoom(args.lo, args.hi));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const listScopes = defineTool({
    name: 'list_scopes',
    description:
      'List all scopes: General plus every registered project (name, id, path).',
    parameters: Type.Object({}),
    execute: async () => {
      const projects = db.listProjects();
      const lines = [
        `global — General`,
        ...projects.map((p) => `${p.id} — ${p.name} (${p.rootPath})`),
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
    description: 'List tasks of a scope (open first).',
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union([Type.Literal('open'), Type.Literal('done')]),
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
              `#${t.id} [${t.status}] ${t.title}${t.due ? ` due:${t.due}` : ''}`,
          )
          .join('\n'),
      );
    },
  });

  const doneTask = defineTool({
    name: 'done_task',
    replay: 'safe',
    description: 'Mark a task done by id.',
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
    description: 'List markdown notes of a scope.',
    parameters: Type.Object({ scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const names = scopes.listNotes(scope);
      return text(names.length === 0 ? '(no notes)' : names.join('\n'));
    },
  });

  const readNote = defineTool({
    name: 'read_note',
    description: 'Read a markdown note of a scope.',
    parameters: Type.Object({ name: Type.String(), scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        return text(scopes.readNote(scope, args.name));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const writeNote = defineTool({
    name: 'write_note',
    description: 'Create or overwrite a markdown note of a scope.',
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      scopes.writeNote(scope, args.name, args.content);
      return text(
        `note "${args.name}" written in [${scope === GLOBAL_SCOPE ? 'global' : scope}].`,
      );
    },
  });

  const appendNote = defineTool({
    name: 'append_note',
    description: 'Append text to a markdown note of a scope.',
    parameters: Type.Object({
      name: Type.String(),
      content: Type.String(),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      scopes.appendNote(scope, args.name, args.content);
      return text(
        `appended to "${args.name}" in [${scope === GLOBAL_SCOPE ? 'global' : scope}].`,
      );
    },
  });

  const searchNotes = defineTool({
    name: 'search_notes',
    description: 'Regex-search the notes of a scope, returning file:line hits.',
    parameters: Type.Object({ pattern: Type.String(), scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        return text(scopes.searchNotes(scope, args.pattern));
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
          operationId: `dispatch:${api.taskId}:${api.callId}`,
        });
        return text(
          `dispatched run ${run.id} on ${run.agentKind} — worktree ${run.worktreePath ?? '(in place, not a git repo)'}. I'll report when it finishes.`,
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

  const listRuns = defineTool({
    name: 'list_runs',
    description: 'List dispatched runs of a scope (or all scopes) with status.',
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

  return defineExtension({
    name: 'chief',
    sections: [preamble, memorySection, stateSection],
    tools: [
      ...memoryTools(deps),
      nap,
      recall,
      zoom,
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
      sendRunMsg,
      listRunMsgs,
      ...historyTools(deps.history),
    ],
  });
}
