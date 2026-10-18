import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { GLOBAL_SCOPE, Scopes } from './scopes.js';
import type { Db, RunRow } from './db.js';

export interface ChiefDeps {
  scopes: Scopes;
  db: Db;
  /** Dispatch a headless worker run; resolves once the run is queued. */
  dispatch: (input: {
    projectRef: string;
    prompt: string;
    chiefConversationId: string | null;
  }) => Promise<RunRow>;
}

const text = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });
const err = (t: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: t }],
});

const ScopeParam = Type.Optional(
  Type.String({
    description:
      'Target scope: "global", a project name or id. Default: this conversation\'s scope.',
  }),
);

function resolveScope(
  deps: ChiefDeps,
  conversationId: string,
  param?: string,
): string {
  const own = deps.db.conversationScope(conversationId);
  if (!param) return own;
  const p = deps.db.getProject(param) ?? deps.db.projectByName(param);
  if (p) return p.id;
  if (param === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  return param; // let scopes.root throw if truly unknown
}

/**
 * The chief's extension: sections inject memory wake + live world state into
 * every request; tools are the narrow envelope — no shell, no coding tools.
 */
export function chiefExtension(deps: ChiefDeps) {
  const { scopes, db } = deps;

  const preamble = section(
    'preamble',
    (
      input,
    ) => `You are Tian's chief of staff (大内总管) — a personal chief-of-staff agent, not a coding agent.

The user is Tian. Answer in the language they use (Chinese by default). Be direct, brief, and concrete.

MEMORY. Your memory outlives every session — without it you do not know who Tian is or what was decided. It is already loaded into context (see <memory>), do not re-read it.
- note "<one line>" whenever you learn something lasting: a fact about Tian, a project decision, an outcome, a preference. Judge what is worth keeping; never record trivia. Set target "global" for facts about Tian, "project" for facts about the project.
- If note asks for a compression, do it immediately: call nap with the range and a one-line summary before anything else.
- recall <regex> searches every memory verbatim; zoom <lo>-<hi> drills a summary node down to raw lines.
- You are the only writer of memory. Dispatched sub-agents never touch it.

WORLD. <state> shows unread inbox, open tasks and active runs — re-check it each turn rather than asking. check_inbox reads messages; send_msg posts to any scope's inbox.

DISPATCH. You command, others execute. You have no shell and cannot edit code — real work is dispatched to coding agents via dispatch(project, prompt): they work in an isolated git worktree, unattended. dispatch returns at once with a run id; when the run finishes you are woken with its report and diffstat — collect it, note what matters, and report back to Tian. IMPORTANT: worker changes live on the run's branch inside the worktree — the project's main checkout stays untouched until Tian lands the run from the Runs panel, so never expect them in the project directory itself. Use list_runs to check progress; Tian can also follow up, land, ship or discard a run from the UI.

SCOPES. This conversation is bound to one scope. Tools take an optional scope parameter to read or write across scopes — to answer "how are my projects" from General, query them. To write memory about another scope, pass its scope to note.`,
    { tag: false },
  );

  const memorySection = section('memory', (input) => {
    const scope = db.conversationScope(String(input.conversationId));
    const parts: string[] = [];
    const globalWake = scopes.memory(GLOBAL_SCOPE).wake();
    parts.push(`[global]\n${globalWake}`);
    if (scope !== GLOBAL_SCOPE) {
      const project = db.getProject(scope);
      parts.push(
        `[project: ${project?.name ?? scope}]\n${scopes.memory(scope).wake()}`,
      );
    }
    return parts.join('\n\n');
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
        .filter((r) => r.status === 'running' || r.status === 'queued');
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

  const note = defineTool({
    name: 'note',
    description:
      "Record one memory: a single line (<=280 chars) of a lasting fact, decision, preference or outcome. You are the only writer; choose target 'global' for facts about Tian, 'project' for facts about the current or a named project.",
    parameters: Type.Object({
      text: Type.String({ description: 'One line, <=280 bytes.' }),
      target: Type.Optional(
        Type.Union([Type.Literal('global'), Type.Literal('project')], {
          description:
            'Default: this conversation\'s scope; "global" for the General memory.',
        }),
      ),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope =
        args.target === 'global'
          ? GLOBAL_SCOPE
          : resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const merge = scopes.memory(scope).note(args.text);
        if (merge) {
          return text(
            `noted in [${scope === GLOBAL_SCOPE ? 'global' : scope}].\n\nCOMPRESSION DUE — before your next action, call nap with lo=${merge.lo} hi=${merge.hi} and a one-line summary of:\n${merge.source}`,
          );
        }
        return text(`noted in [${scope === GLOBAL_SCOPE ? 'global' : scope}].`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const nap = defineTool({
    name: 'nap',
    description:
      'Answer a pending memory compression: write a one-line summary covering the given range. Call this when note reports a compression due.',
    parameters: Type.Object({
      lo: Type.Number(),
      hi: Type.Number(),
      summary: Type.String({
        description: 'One line summarizing lines lo..hi.',
      }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const next = scopes.memory(scope).nap(args.lo, args.hi, args.summary);
        if (next) {
          return text(
            `merged ${args.lo}-${args.hi}.\n\nCOMPRESSION DUE — call nap with lo=${next.lo} hi=${next.hi} and a one-line summary of:\n${next.source}`,
          );
        }
        return text(`merged ${args.lo}-${args.hi}.`);
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const recall = defineTool({
    name: 'recall',
    description:
      'Search every memory verbatim with a regex (case-insensitive).',
    parameters: Type.Object({ pattern: Type.String(), scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        return text(scopes.memory(scope).recall(args.pattern));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  const zoom = defineTool({
    name: 'zoom',
    description:
      'Open a memory summary node into its two halves, down to raw lines.',
    parameters: Type.Object({
      lo: Type.Number(),
      hi: Type.Number(),
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
    description: "Add a todo item to a scope's task list.",
    parameters: Type.Object({
      title: Type.String(),
      due: Type.Optional(Type.String({ description: 'ISO date or datetime.' })),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const id = db.addTask(scope, args.title, args.due ?? null);
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
    description: 'Mark a task done by id.',
    parameters: Type.Object({ id: Type.Number() }),
    execute: async (args) => {
      db.doneTask(args.id);
      return text(`task #${args.id} done.`);
    },
  });

  const checkInbox = defineTool({
    name: 'check_inbox',
    description: 'Read unread inbox messages of a scope and mark them read.',
    parameters: Type.Object({ scope: ScopeParam }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      const unread = scopes.unreadMessages(scope);
      scopes.markInboxRead(scope);
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
      const id = scopes.sendMessage(
        scope,
        'chief',
        args.body,
        args.to,
        args.thread,
      );
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
        });
        return text(
          `dispatched run ${run.id} on ${run.agentKind} — worktree ${run.worktreePath ?? '(in place, not a git repo)'}. I'll report when it finishes.`,
        );
      } catch (e) {
        return err(`dispatch failed: ${e instanceof Error ? e.message : e}`);
      }
    },
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

  return defineExtension({
    name: 'chief',
    sections: [preamble, memorySection, stateSection],
    tools: [
      note,
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
    ],
  });
}
