import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { GLOBAL_SCOPE } from './scopes.js';
import type { ChiefDeps } from './tools.js';
import { verifyUserEvidence, type InputEvidence } from './provenance.js';

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

const scopeLabel = (scope: string) =>
  scope === GLOBAL_SCOPE ? 'global' : scope;

/** `conv:<id>#<entry>` when the current turn has a user entry, else the conversation. */
const evidenceRef = (
  conversationId: string,
  turn: InputEvidence | null,
): string =>
  turn ? `conv:${conversationId}#${turn.entryId}` : `conv:${conversationId}`;

const usageText = (usage: {
  selected: number;
  tokens: number;
  budget: number;
}) => `core ${usage.selected} selected, ${usage.tokens}/${usage.budget} tokens`;

/** Append a Core-state note to a write result so the model knows the budget. */
function coreNote(deps: ChiefDeps, scope: string): string {
  const usage = deps.scopes.memory(scope).coreUsage();
  return ` (${usageText(usage)})`;
}

function droppedNote(coreDropped: boolean): string {
  return coreDropped
    ? '\nThis correction no longer fits Core Memory, so it is saved outside Core. Deselect something or shorten a selected memory, then select it again; the old fact is not kept.'
    : '';
}

/**
 * The chief's memory-writing tools. Reading tools (recall, select, deselect)
 * stay in tools.ts; these own every mutation of memory content.
 */
export function memoryTools(deps: ChiefDeps) {
  const { data } = deps;

  const remember = defineTool({
    name: 'remember',
    replay: 'safe',
    description:
      "Record one memory: a single line (<=1000 characters) of a lasting fact, decision, preference or outcome. New memories are searchable but do NOT enter Core Memory unless you pass core=true; select them explicitly when they must be visible every turn. Choose target 'global' for facts about Tian, 'project' for facts about the current or a named project.",
    parameters: Type.Object({
      text: Type.String({ description: 'One line, <=1000 characters.' }),
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
            '"user" only when the statement equals Tian\'s current input (whitespace-normalized); excerpts, rewrites and translations are stored agent_inferred. Default: agent.',
        }),
      ),
      core: Type.Optional(
        Type.Boolean({
          description:
            'Also select into Core Memory. Over budget is rejected without writing anything.',
        }),
      ),
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
        const conversationId = String(api.conversationId);
        const input = await deps.currentInput(conversationId);
        const verdict =
          args.source === 'user'
            ? verifyUserEvidence(args.text, input)
            : { confirmed: false, reason: 'recorded as agent inference' };
        const result = data.remember(scope, args.text, {
          kind: args.kind,
          sourceType: verdict.confirmed ? 'user' : 'agent',
          trustLevel: verdict.confirmed ? 'user_confirmed' : 'agent_inferred',
          sourceRef: evidenceRef(conversationId, input),
          core: args.core ?? false,
          actor: 'chief',
          operationId: `remember:${api.taskId}:${api.callId}`,
        });
        const parts = [
          result.created
            ? `remembered as #${result.memory.seq} in [${scopeLabel(scope)}]`
            : `#${result.memory.seq} already says that in [${scopeLabel(scope)}]; no duplicate written`,
        ];
        if (result.evidenceAdded)
          parts.push(
            `evidence recorded: trust ${result.memory.trustLevel}, source ${result.memory.sourceRef ?? 'none'}`,
          );
        parts.push(
          `stored trust ${result.memory.trustLevel}; this write is ${verdict.confirmed ? 'user-confirmed' : 'agent-inferred'}: ${verdict.reason}`,
        );
        parts.push(
          result.memory.core
            ? `in Core${coreNote(deps, scope)}`
            : `not in Core; use select to keep it resident${coreNote(deps, scope)}`,
        );
        if (result.coreDropped)
          parts.push(
            'adding this evidence pushed it out of Core to stay within budget; select it again after freeing space',
          );
        return toolText(`${parts.join('. ')}.`);
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const revise = defineTool({
    name: 'revise',
    replay: 'safe',
    description:
      'Replace memory #seq with a corrected line (never append a contradicting line). Use this whenever Tian corrects something; the old memory stays as history but leaves Core Memory. If the correction cannot fit Core, it is still saved outside Core and the result says so.',
    parameters: Type.Object({
      seq: Type.Integer({
        minimum: 0,
        description: 'Memory number, as shown by #seq.',
      }),
      text: Type.String({
        description: 'The corrected one line, <=1000 characters.',
      }),
      reason: Type.String({ description: 'Why the memory is being replaced.' }),
      source: Type.Optional(
        Type.Union([Type.Literal('user'), Type.Literal('agent')], {
          description:
            '"user" only when the correction equals Tian\'s current input (whitespace-normalized); excerpts and rewrites are stored agent_inferred. Default: agent.',
        }),
      ),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const conversationId = String(api.conversationId);
        const input = await deps.currentInput(conversationId);
        const verdict =
          args.source === 'user'
            ? verifyUserEvidence(args.text, input)
            : { confirmed: false, reason: 'recorded as agent inference' };
        const result = data.revise(
          scope,
          args.seq,
          args.text,
          args.reason,
          'chief',
          {
            sourceRef: evidenceRef(conversationId, input),
            trustLevel: verdict.confirmed ? 'user_confirmed' : 'agent_inferred',
            sourceType: verdict.confirmed ? 'user' : 'agent',
            operationId: `revise:${api.taskId}:${api.callId}`,
          },
        );
        const head = result.changed
          ? `superseded #${args.seq} with #${result.memory.seq} in [${scopeLabel(scope)}]`
          : `#${result.memory.seq} already said that in [${scopeLabel(scope)}]; no new revision written`;
        const trust = `stored trust ${result.memory.trustLevel}; this write is ${verdict.confirmed ? 'user-confirmed' : 'agent-inferred'}: ${verdict.reason}`;
        const core = result.memory.core
          ? `in Core${coreNote(deps, scope)}`
          : `outside Core${coreNote(deps, scope)}`;
        return toolText(
          `${head}. ${trust}. ${core}.${droppedNote(result.coreDropped)}`,
        );
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const forget = defineTool({
    name: 'forget',
    replay: 'safe',
    description:
      'Mark memory #seq deleted (kept as history, removed from Core Memory). For memories that should never have existed; to correct a memory use revise instead. To merely stop showing a memory every turn, use deselect — it stays active and searchable.',
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
        data.forget(
          scope,
          args.seq,
          args.reason,
          'chief',
          `forget:${api.taskId}:${api.callId}`,
        );
        return toolText(`forgot #${args.seq} in [${scopeLabel(scope)}].`);
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const select = defineTool({
    name: 'select',
    replay: 'safe',
    description:
      'Select an active memory into Core Memory so it is injected every turn. Selection is explicit and bounded: if the rendered Core would exceed its token budget the call is rejected with current usage and nothing changes. Removing a memory from Core is deselect, not forget.',
    parameters: Type.Object({
      seq: Type.Integer({ minimum: 0 }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const { memory, changed } = data.select(
          scope,
          args.seq,
          'chief',
          `select:${api.taskId}:${api.callId}`,
        );
        return toolText(
          changed
            ? `#${memory.seq} selected into Core${coreNote(deps, scope)}.`
            : `#${memory.seq} was already in Core${coreNote(deps, scope)}.`,
        );
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  const deselect = defineTool({
    name: 'deselect',
    replay: 'safe',
    description:
      'Remove a memory from Core Memory without forgetting it: it stays active and searchable with recall, and frees budget for other selections.',
    parameters: Type.Object({
      seq: Type.Integer({ minimum: 0 }),
      scope: ScopeParam,
    }),
    execute: async (args, api) => {
      const scope = resolveScope(deps, String(api.conversationId), args.scope);
      try {
        const { memory, changed } = data.deselect(
          scope,
          args.seq,
          'chief',
          `deselect:${api.taskId}:${api.callId}`,
        );
        return toolText(
          changed
            ? `#${memory.seq} removed from Core; still active and searchable${coreNote(deps, scope)}.`
            : `#${memory.seq} was not in Core${coreNote(deps, scope)}.`,
        );
      } catch (e) {
        return toolErr(String(e));
      }
    },
  });

  return [remember, revise, forget, select, deselect];
}
