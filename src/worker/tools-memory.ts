import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { GLOBAL_SCOPE } from './scopes.js';
import type { ChiefDeps } from './tools.js';
import type { MergeDue } from './memory.js';

export const toolText = (t: string) => ({
  output: [{ type: 'text' as const, text: t }],
});
export const toolErr = (t: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: t }],
});

export const ScopeParam = Type.Optional(
  Type.String({
    description:
      'Target scope: "global", a project name or id. Default: this conversation\'s scope.',
  }),
);

export function resolveScope(
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

/** Follow-up hint appended to memory write results when a merge became due. */
export function mergeNotice(scope: string, merge: MergeDue | null): string {
  if (!merge) return '';
  return `\n\nCOMPRESSION DUE — before your next action, call nap with scope="${scope}" lo=${merge.lo} hi=${merge.hi} and a one-line summary of:\n${merge.source}`;
}

const scopeLabel = (scope: string) =>
  scope === GLOBAL_SCOPE ? 'global' : scope;

/**
 * The chief's memory-writing tools. Reading tools (recall, nap, zoom) stay in
 * tools.ts; these three own every mutation of memory.
 */
export function memoryTools(deps: ChiefDeps) {
  const { data } = deps;

  const remember = defineTool({
    name: 'remember',
    description:
      "Record one memory: a single line (<=280 UTF-8 bytes) of a lasting fact, decision, preference or outcome. You are the only writer; choose target 'global' for facts about Tian, 'project' for facts about the current or a named project.",
    parameters: Type.Object({
      text: Type.String({ description: 'One line, <=280 bytes.' }),
      kind: Type.Optional(
        Type.Union(
          [
            Type.Literal('preference'),
            Type.Literal('fact'),
            Type.Literal('decision'),
            Type.Literal('outcome'),
            Type.Literal('environment'),
          ],
          { description: 'Default: fact.' },
        ),
      ),
      source: Type.Optional(
        Type.Union([Type.Literal('user'), Type.Literal('agent')], {
          description:
            '"user" when Tian stated it explicitly (stored as user-confirmed), "agent" when you inferred it. Default: agent.',
        }),
      ),
      target: Type.Optional(
        Type.Union([Type.Literal('global'), Type.Literal('project')], {
          description:
            'Default: this conversation\'s scope; "global" for the General memory.',
        }),
      ),
      goal: Type.Optional(
        Type.String({
          description: 'Related goal id, if the memory belongs to one.',
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
        const { memory, merge } = data.remember(scope, args.text, {
          kind: args.kind,
          source: args.source,
          goalId: args.goal ?? null,
          sourceRef: `conv:${api.conversationId}`,
        });
        return toolText(
          `remembered as #${memory.seq} in [${scopeLabel(scope)}].${mergeNotice(scope, merge)}`,
        );
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const revise = defineTool({
    name: 'revise',
    description:
      'Replace memory #seq with a corrected line (never append a contradicting line). Use this whenever Tian corrects something; the old memory stays as history but leaves Core Memory.',
    parameters: Type.Object({
      seq: Type.Integer({
        minimum: 0,
        description: 'Memory number, as shown by #seq.',
      }),
      text: Type.String({
        description: 'The corrected one line, <=280 bytes.',
      }),
      reason: Type.String({ description: 'Why the memory is being replaced.' }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const { memory, superseded, merge } = data.revise(
          scope,
          args.seq,
          args.text,
          args.reason,
          'chief',
        );
        return toolText(
          `superseded #${superseded.seq} with #${memory.seq} in [${scopeLabel(scope)}].${mergeNotice(scope, merge)}`,
        );
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const forget = defineTool({
    name: 'forget',
    description:
      'Mark memory #seq deleted (kept as history, removed from Core Memory). For memories that should never have existed; to correct a memory use revise instead.',
    parameters: Type.Object({
      seq: Type.Integer({
        minimum: 0,
        description: 'Memory number, as shown by #seq.',
      }),
      reason: Type.String({ description: 'Why the memory is being removed.' }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        await data.forget(scope, args.seq, args.reason, 'chief');
        return toolText(`forgot #${args.seq} in [${scopeLabel(scope)}].`);
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  return [remember, revise, forget];
}
