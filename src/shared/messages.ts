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
  /**
   * System rows only: 'marker' is a transcript divider (context reset), while
   * 'notice' is prose an agent posted — a manager/worker report, a run wake, a
   * model error — and is rendered as markdown.
   */
  variant?: 'marker' | 'notice';
  toolCalls?: ToolCallRow[];
  streaming?: boolean;
}

/**
 * Split a notification's bracketed first line (`[run … finished]`,
 * `[<project> manager reports]`) from the body it labels. Notifications are
 * written by agents, so the body is markdown and the label is UI chrome.
 */
export function noticeParts(text: string): {
  label: string | null;
  body: string;
} {
  const head = /^\[([^\]\n]{1,120})\]\n?/.exec(text);
  if (!head) return { label: null, body: text };
  return { label: head[1].trim(), body: text.slice(head[0].length).trim() };
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
  const live = view.docs['pi.live'] as LiveState | undefined;
  const busy = Boolean(live?.run);
  // A running round publishes the same calls the committed tool-calling answer
  // already lists, so prefer the live status and never render a call twice.
  const liveByCallId = new Map<string, ToolSlot>();
  for (const slot of live?.tools ?? []) liveByCallId.set(slot.callId, slot);
  const committedCalls = new Set<string>();

  // Tool-only rounds are activity, not messages: every contiguous block of
  // them (a run's rounds, tool results are not rows) collapses into one row so
  // a chief or manager that never writes prose still reads as one activity log.
  const appendToolCalls = (id: string, calls: ToolCallRow[]) => {
    if (calls.length === 0) return;
    const last = rows.at(-1);
    if (last?.role === 'tool') {
      last.toolCalls = [...(last.toolCalls ?? []), ...calls];
      return;
    }
    rows.push({ id, role: 'tool', text: '', toolCalls: calls });
  };

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
          committedCalls.add(c.callId);
          const r = resultByCallId.get(c.callId);
          const slot = r ? undefined : liveByCallId.get(c.callId);
          return {
            ...c,
            status: r
              ? r.isError
                ? 'error'
                : 'done'
              : (slot?.status ?? c.status),
            output: r?.text ?? slot?.output,
          } as ToolCallRow;
        });
        const text = textOf(msg?.content);
        const error = (msg as { errorMessage?: string } | undefined)
          ?.errorMessage;
        if (text) {
          rows.push({
            id: `e${e.id}`,
            role: 'assistant',
            text,
            toolCalls: calls.length > 0 ? calls : undefined,
          });
        } else if (calls.length > 0) {
          appendToolCalls(`e${e.id}`, calls);
        }
        if (error) {
          rows.push({
            id: `e${e.id}-err`,
            role: 'system',
            variant: 'notice',
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
          variant: 'notice',
          text: text || `[${e.kind}]`,
        });
      }
    }
  }

  // Calls running before their answer is committed. Calls the transcript
  // already lists are updated in place instead of shown a second time.
  const liveOnly = (live?.tools ?? []).filter(
    (slot) => !committedCalls.has(slot.callId),
  );
  if (liveOnly.length > 0) {
    appendToolCalls(
      'live-tools',
      liveOnly.map(
        (slot): ToolCallRow => ({
          callId: slot.callId,
          name: slot.name,
          args: '',
          status: slot.status,
          output: slot.output,
        }),
      ),
    );
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
