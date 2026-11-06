import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Db } from './db.js';
import type { EventLog } from './events.js';
import type { HistoryIndex } from './history.js';
import { GLOBAL_SCOPE } from './scopes.js';

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
 * The chief's history tools: search every past Global turn, tool call and
 * event (optionally filtered by time), and expand a ref into context.
 * Project transcripts belong to their managers (M6) — the chief reads only
 * Global history; project detail comes from the project memory and notes or
 * the manager itself.
 */
export function historyTools(deps: HistoryDeps) {
  /** Scope a history ref points to, or null when it cannot be determined. */
  const refScope = (ref: string): string | null => {
    const trimmed = ref.trim();
    if (trimmed.startsWith('event:'))
      return deps.events.get(trimmed.slice('event:'.length))?.scopeId ?? null;
    const match = /^conv:([^#\s]+)#/.exec(trimmed);
    if (!match) return null;
    try {
      return deps.db.conversationScope(match[1]);
    } catch {
      return deps.db.runByConversation(match[1])?.projectId ?? null;
    }
  };

  const searchHistory = defineTool({
    name: 'search_history',
    description:
      'Search the recorded General history — past conversations, tool calls and events — with keyword or phrase matching (Chinese works; several words must all appear). Returns dated lines like "[2026-10-11 14:02] conv:12#345 user: …snippet…" with «» around matched text and a ref for read_history. Project transcripts are not included — ask the project manager. An empty result means nothing was recorded; never invent history.',
    parameters: Type.Object({
      query: Type.String({
        description:
          'Keywords or a phrase that appears in the history. A single word or phrase matches verbatim; several words must all appear. Words shorter than 3 characters fall back to substring matching.',
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
    execute: async (args) => {
      try {
        const lines = await deps.history.search(args.query, {
          scopeId: GLOBAL_SCOPE,
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
      'Read the full content behind a search_history ref, from the original transcript. "conv:<id>#<entry>" returns a page of that entry (long tool results and arguments included) with a continuation ref when more remains; "event:<id>" shows the recorded event. Only General refs are readable — project transcripts belong to their managers. Pass offset from a previous continuation to keep reading.',
    parameters: Type.Object({
      ref: Type.String({
        description: 'A ref returned by search_history.',
      }),
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          description:
            'Code-point offset to continue from (see the continuation line). Default 0.',
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
          description:
            'Neighbouring entries on each side when a ref has no content. Default 2.',
        }),
      ),
    }),
    execute: async (args) => {
      try {
        const target = refScope(args.ref);
        if (target && target !== GLOBAL_SCOPE)
          return err('that ref belongs to a project — ask its manager');
        return text(
          await deps.history.read(args.ref, {
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

  return [searchHistory, readHistory];
}
