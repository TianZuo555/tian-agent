// Map a pi-durable ConversationView to renderable message rows.

export interface ToolCallRow {
  callId: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error' | 'pending';
  output?: string;
  entry?: number;
}

export interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  toolCalls?: ToolCallRow[];
  streaming?: boolean;
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  callId?: string;
  name?: string;
  arguments?: unknown;
  content?: ContentBlock[] | string;
  isError?: boolean;
  toolCallId?: string;
  toolName?: string;
  [key: string]: unknown;
}

interface ModelMessage {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

interface EntryRecord {
  id: number;
  kind: string;
  model?: ModelMessage[];
  data?: unknown;
}

interface ToolSlot {
  callId: string;
  name: string;
  status: 'pending' | 'running' | 'done';
  output?: string;
  entry?: number;
}

interface LiveState {
  run?: { taskId: number; inputs: unknown[] };
  generation?: { message?: ModelMessage };
  tools?: ToolSlot[];
  nestedTools?: ToolSlot[];
  compactions?: unknown[];
}

export interface ConversationView {
  entries: EntryRecord[];
  docs: Record<string, unknown>;
}

const textOf = (content: string | ContentBlock[] | undefined): string => {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
};

const toolCallsOf = (
  content: string | ContentBlock[] | undefined,
): ToolCallRow[] => {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === 'toolCall' || b.type === 'tool_call')
    .map((b) => ({
      callId: String(b.callId ?? b.id ?? ''),
      name: String(b.name ?? 'tool'),
      args:
        typeof b.arguments === 'string'
          ? b.arguments
          : JSON.stringify(b.arguments ?? {}),
      status: 'pending' as const,
    }));
};

export function toRows(view: ConversationView | undefined): {
  rows: MessageRow[];
  busy: boolean;
} {
  if (!view) return { rows: [], busy: false };
  const rows: MessageRow[] = [];
  const resultByCallId = new Map<string, { text: string; isError: boolean }>();

  // First pass: collect tool results by call id.
  for (const e of view.entries) {
    if (e.kind !== 'pi.tool-result') continue;
    const msg = e.model?.[0];
    const callId = String((msg as { toolCallId?: string })?.toolCallId ?? '');
    if (callId) {
      resultByCallId.set(callId, {
        text: textOf(msg?.content),
        isError: Boolean((msg as { isError?: boolean })?.isError),
      });
    }
  }

  for (const e of view.entries) {
    const msg = e.model?.[0];
    switch (e.kind) {
      case 'pi.user': {
        rows.push({ id: `e${e.id}`, role: 'user', text: textOf(msg?.content) });
        break;
      }
      case 'pi.assistant': {
        const calls = toolCallsOf(msg?.content).map((c) => {
          const r = resultByCallId.get(c.callId);
          return {
            ...c,
            status: r ? (r.isError ? 'error' : 'done') : c.status,
            output: r?.text,
          } as ToolCallRow;
        });
        const text = textOf(msg?.content);
        const error = (msg as { errorMessage?: string } | undefined)
          ?.errorMessage;
        if (text || calls.length > 0) {
          rows.push({
            id: `e${e.id}`,
            role: 'assistant',
            text,
            toolCalls: calls,
          });
        }
        if (error) {
          rows.push({
            id: `e${e.id}-err`,
            role: 'system',
            text: `Model error: ${error}`,
          });
        }
        break;
      }
      case 'pi.reset':
        rows.push({
          id: `e${e.id}`,
          role: 'system',
          text: '— context reset —',
        });
        break;
      case 'pi.compaction':
        rows.push({
          id: `e${e.id}`,
          role: 'system',
          text: '— context compacted —',
        });
        break;
      default: {
        if (e.kind.startsWith('pi.')) break;
        // System wakes (goal, run, inbox notifications) and worker input keep
        // their own entry kinds; show their text as a system row. Display-only
        // entries carry their text in `data` instead of a model message.
        const text =
          textOf(msg?.content) || (typeof e.data === 'string' ? e.data : '');
        rows.push({
          id: `e${e.id}`,
          role: 'system',
          text: text || `[${e.kind}]`,
        });
      }
    }
  }

  const live = view.docs['pi.live'] as LiveState | undefined;
  const busy = Boolean(live?.run);

  // Running tool round as its own rows.
  for (const slot of live?.tools ?? []) {
    rows.push({
      id: `slot-${slot.callId}`,
      role: 'tool',
      text: '',
      toolCalls: [
        {
          callId: slot.callId,
          name: slot.name,
          args: '',
          status: slot.status === 'done' ? 'done' : 'running',
          output: slot.output,
        },
      ],
    });
  }

  // Streaming partial generation.
  if (live?.generation?.message) {
    rows.push({
      id: 'streaming',
      role: 'assistant',
      text: textOf(live.generation.message.content),
      toolCalls: toolCallsOf(live.generation.message.content),
      streaming: true,
    });
  }

  return { rows, busy };
}
