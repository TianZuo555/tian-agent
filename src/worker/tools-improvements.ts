import { createHash } from 'node:crypto';
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Db } from './db.js';
import { improvementRef, type ImprovementStore } from './improvements.js';
import { GLOBAL_SCOPE, type Scopes } from './scopes.js';

export interface ImprovementToolDeps {
  db: Db;
  scopes: Scopes;
  improvements: ImprovementStore;
  emitImprovements: () => void;
}

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
});
const err = (value: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: value }],
});

const ScopeParam = Type.Optional(
  Type.String({
    description:
      'Target scope: "global", a project name or id. Default: this conversation\'s scope.',
  }),
);

const kind = Type.Union(
  [
    Type.Literal('issue'),
    Type.Literal('friction'),
    Type.Literal('idea'),
    Type.Literal('win'),
  ],
  {
    description:
      'issue = broken behavior; friction = a workflow pain point; idea = a concrete proposal; win = something that worked notably well.',
  },
);

const severity = Type.Union(
  [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')],
  { description: 'Default: medium.' },
);

/**
 * Chief tools for the Improvement Log. Entries are durable observations about
 * the product, not task notes: Tian triages them in the Log view and can
 * promote one into a task.
 */
export function improvementTools(deps: ImprovementToolDeps) {
  const resolve = (conversationId: string, param?: string): string => {
    const own = deps.db.conversationScope(conversationId);
    if (!param) return own;
    const project = deps.db.getProject(param) ?? deps.db.projectByName(param);
    if (project) return project.id;
    if (param === GLOBAL_SCOPE) return GLOBAL_SCOPE;
    return param; // scopes.root validates unknown scopes and gives the error
  };

  const logImprovement = defineTool({
    name: 'log_improvement',
    replay: 'safe',
    description:
      'Record one durable improvement observation: a real bug, recurring friction, a concrete idea, or a win worth repeating. Log when Tian gives feedback or when you notice a pattern while working. Do not log routine task noise, one-off model hiccups, or guesses. Tian triages entries in the Log view, so keep each entry to one actionable observation.',
    parameters: Type.Object({
      kind,
      summary: Type.String({
        description: 'One actionable line, at most 300 characters.',
      }),
      detail: Type.Optional(
        Type.String({
          description:
            'Reproduction, evidence, affected screen/command, or the concrete proposal. At most 20k characters.',
        }),
      ),
      severity: Type.Optional(severity),
      source: Type.Optional(
        Type.Union([Type.Literal('user'), Type.Literal('chief')], {
          description:
            '"user" when Tian explicitly reported it; "chief" when you noticed it yourself. Default: chief.',
        }),
      ),
      scope: ScopeParam,
      run: Type.Optional(
        Type.String({ description: 'Related run id, if any.' }),
      ),
      conversation: Type.Optional(
        Type.String({
          description:
            'Related conversation id or conv: ref. Default: this conversation.',
        }),
      ),
    }),
    execute: async (args, api) => {
      const scope = resolve(String(api.conversationId), args.scope);
      try {
        deps.scopes.root(scope);
        const id = `imp-${createHash('sha256')
          .update(
            `tool:${String(api.conversationId)}:${String(api.taskId)}:${String(api.callId)}`,
          )
          .digest('hex')
          .slice(0, 24)}`;
        const conversation = args.conversation
          ? args.conversation.startsWith('conv:')
            ? args.conversation
            : `conv:${args.conversation}`
          : `conv:${String(api.conversationId)}`;
        const entry = deps.improvements.record({
          id,
          scopeId: scope,
          kind: args.kind,
          summary: args.summary,
          detail: args.detail,
          severity: args.severity,
          source: args.source ?? 'chief',
          conversationId: conversation,
          runId: args.run ?? null,
        });
        deps.emitImprovements();
        return text(
          `logged ${improvementRef(entry.id)} in ${scope === GLOBAL_SCOPE ? 'global' : scope} (${entry.kind}, ${entry.severity}). Tian triages it in the Log view.`,
        );
      } catch (error) {
        return err(String(error));
      }
    },
  });

  const listImprovements = defineTool({
    name: 'list_improvements',
    description:
      "List logged improvement entries to avoid duplicates or answer what is already known. Defaults to open entries in this conversation's scope.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union(
          [
            Type.Literal('open'),
            Type.Literal('promoted'),
            Type.Literal('resolved'),
            Type.Literal('dismissed'),
            Type.Literal('all'),
          ],
          { description: 'Default: open.' },
        ),
      ),
      kind: Type.Optional(kind),
      scope: ScopeParam,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    execute: async (args, api) => {
      const scope = resolve(String(api.conversationId), args.scope);
      try {
        deps.scopes.root(scope);
        const entries = deps.improvements.list({
          scopeId: scope,
          status: args.status && args.status !== 'all' ? args.status : null,
          kind: args.kind ?? null,
          limit: args.limit ?? 20,
        });
        if (entries.length === 0)
          return text('No matching improvement entries.');
        return text(
          entries
            .map(
              (entry) =>
                `${improvementRef(entry.id)} [${entry.status}/${entry.kind}/${entry.severity}] ${entry.summary}${entry.occurrences > 1 ? ` (${entry.occurrences}x)` : ''}${entry.taskId != null ? ` task#${entry.taskId}` : ''}`,
            )
            .join('\n'),
        );
      } catch (error) {
        return err(String(error));
      }
    },
  });

  return [logImprovement, listImprovements];
}
