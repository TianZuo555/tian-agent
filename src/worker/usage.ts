import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { Conversation, Cursor } from '@earendil-works/pi-durable';
import type { UsageDay, UsageStats } from '../shared/types.js';
import type { Db } from './db.js';

const PAGE_SIZE = 500;

const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/** Conversations that spend under a scope: chief conversations bound to it plus its worker runs. */
export function usageConversationIds(db: Db, scopeId: string | null): string[] {
  const ids = new Set<string>();
  for (const row of db.listConversations())
    if (scopeId === null || row.scopeId === scopeId)
      ids.add(row.conversationId);
  if (scopeId !== 'global')
    for (const id of db.runConversationIds(scopeId)) ids.add(id);
  return [...ids];
}

interface UsageSource {
  conversation(id: string): Promise<Conversation>;
}

/** Bucket every recorded assistant response by local day across the given conversations. */
export async function collectUsage(
  source: UsageSource,
  conversationIds: string[],
): Promise<UsageStats> {
  const days = new Map<string, UsageDay>();
  for (const id of conversationIds) {
    let conversation: Conversation;
    try {
      conversation = await source.conversation(id);
    } catch {
      continue;
    }
    let cursor: Cursor | undefined;
    for (;;) {
      const page = await conversation.entries(
        {},
        PAGE_SIZE,
        cursor,
        BACKGROUND_CONTEXT,
      );
      for (const entry of page.items) {
        if (entry.kind !== 'pi.assistant') continue;
        const message = entry.model?.[0] as AssistantMessage | undefined;
        if (typeof message?.timestamp === 'number' && message.usage)
          recordUsageDay(days, message);
      }
      if (!page.next) break;
      cursor = page.next;
    }
  }
  return {
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function recordUsageDay(
  days: Map<string, UsageDay>,
  message: AssistantMessage,
): void {
  const usage = message.usage;
  const key = dayKey(message.timestamp);
  const day = days.get(key) ?? {
    date: key,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: 0,
    messages: 0,
  };
  day.input += usage.input;
  day.output += usage.output;
  day.cacheRead += usage.cacheRead;
  day.cacheWrite += usage.cacheWrite;
  day.totalTokens += usage.totalTokens;
  day.cost += usage.cost?.total ?? 0;
  day.messages += 1;
  days.set(day.date, day);
}
