import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Db } from './db.js';
import type { EventLog } from './events.js';
import type { HistoryIndex } from './history.js';

export interface HistoryDeps {
  db: Db;
  events: EventLog;
  history: HistoryIndex;
}

const text = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });
const err = (t: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: t }],
});

/**
 * The chief's history tools: search every past turn, tool call and event
 * (optionally filtered by scope and time), and expand a ref into context.
 */
export function historyTools(deps: HistoryDeps) {
  const resolveScope = (param: string): string => {
    const project = deps.db.getProject(param) ?? deps.db.projectByName(param);
    if (project) return project.id;
    return param; // unknown scopes simply yield no matches
  };

  const searchHistory = defineTool({
    name: 'search_history',
    description:
      'Search the full history of past conversations — user and assistant messages, tool calls and results, and recorded events — with keyword or phrase matching (Chinese works; several words must all appear). Returns dated lines like "[2026-10-11 14:02] conv:12#345 user: …snippet…" with «» around matched text and a ref for read_history. An empty result means nothing was recorded; never invent history.',
    parameters: Type.Object({
      query: Type.String({
        description:
          'Keywords or a phrase that appears in the history. A single word or phrase matches verbatim; several words must all appear. Words shorter than 3 characters fall back to substring matching.',
      }),
      scope: Type.Optional(
        Type.String({
          description:
            'A scope (project name or id, "global"), or "all" to search everything. Default: this conversation\'s scope.',
        }),
      ),
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
        const own = deps.db.conversationScope(String(api.conversationId));
        const scopeId = !args.scope
          ? own
          : args.scope === 'all'
            ? null
            : resolveScope(args.scope);
        const lines = await deps.history.search(args.query, {
          scopeId,
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

  const readHistory = defineTool({
    name: 'read_history',
    description:
      'Expand a search_history ref: "conv:<id>#<entry>" shows that entry with its neighbouring turns for context; "event:<id>" shows the recorded event (actor, summary, payload).',
    parameters: Type.Object({
      ref: Type.String({
        description: 'A ref returned by search_history.',
      }),
      around: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 20,
          description: 'Neighbouring entries on each side. Default 2.',
        }),
      ),
    }),
    execute: async (args) => {
      try {
        return text(await deps.history.read(args.ref, args.around ?? 2));
      } catch (e) {
        return err(String(e));
      }
    },
  });

  return [searchHistory, readHistory];
}
