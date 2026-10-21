import type { Conversation } from '@earendil-works/pi-durable';
import type { ConversationInfo, SessionBinding } from '../shared/types.js';
import type { Scopes } from './scopes.js';
import type { Db } from './db.js';
import type { IssueContext } from './improvements.js';

/** Application surface a channel adapter works against; owned by the Service. */
export interface ChannelHost {
  db: Db;
  scopes: Scopes;
  openSession(binding: SessionBinding): Promise<ConversationInfo>;
  submit(
    conversationId: string,
    content: string,
    requestId: string,
  ): Promise<void>;
  conversation(conversationId: string): Promise<Conversation>;
  /** Automatic issue sink; adapters degrade to console logging without it. */
  reportIssue?: (area: string, error: unknown, context?: IssueContext) => void;
}

/**
 * Text of a completed assistant entry: text blocks only, no thinking or tool
 * calls. Shared by every outbound channel so both deliver the same words.
 */
export function assistantText(entry: {
  kind: string;
  model?: unknown;
}): string {
  if (entry.kind !== 'pi.assistant' || !entry.model) return '';
  const parts: string[] = [];
  for (const message of entry.model as { content?: unknown }[]) {
    const content = message.content;
    if (typeof content === 'string') {
      if (content.trim()) parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const type = (block as { type?: unknown } | null)?.type;
        const text = (block as { text?: unknown } | null)?.text;
        if (type === 'text' && typeof text === 'string' && text.trim())
          parts.push(text);
      }
    }
  }
  return parts.join('\n').trim();
}
