import {
  defineExtension,
  defineTool,
  section,
} from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import type { Db, Notification } from './db.js';
import type { Scopes } from './scopes.js';
import { relevantContext } from './relevant-context.js';

export interface WorkerDeps {
  db: Db;
  scopes?: Scopes;
  /**
   * Queue a notification that wakes the chief conversation, then trigger
   * delivery. Reuses the same pipeline that reports finished runs.
   */
  wake: (notification: Notification) => Promise<void>;
}

const text = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });
const err = (t: string) => ({
  isError: true as const,
  output: [{ type: 'text' as const, text: t }],
});

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_SECONDS = 300;

/**
 * The worker's messaging extension: a direct line to the chief while the run
 * is in flight. Questions wake the chief through the notification pipeline;
 * replies and guidance land in the run's durable message thread.
 */
export function workerExtension(deps: WorkerDeps) {
  const { db } = deps;

  const runOf = (conversationId: string) =>
    db.runByConversation(conversationId) ?? null;

  const askChief = defineTool({
    name: 'ask_chief',
    replay: 'safe',
    description:
      "Ask the chief one question and wait for its reply. The chief is woken immediately; use this only when a decision genuinely blocks the task (destructive or irreversible action, missing credentials, fundamental ambiguity) — never for anything you can decide yourself. The reply is returned as this tool's output.",
    parameters: Type.Object({
      question: Type.String({
        description:
          'One crisp, self-contained question with the context needed to answer it.',
      }),
      wait_seconds: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 3600,
          description: `How long to wait for the reply. Default ${DEFAULT_WAIT_SECONDS}.`,
        }),
      ),
    }),
    execute: async (args, api) => {
      const run = runOf(String(api.conversationId));
      if (!run) return err('No run is bound to this conversation.');
      // Deterministic id: a durable replay must not re-ask the same question.
      const message = db.addAgentMessage({
        id: `ask:${run.id}:${api.taskId}:${api.callId}`,
        runId: run.id,
        sender: 'worker',
        body: args.question,
      });
      await deps.wake({
        id: `ask:${message.id}`,
        scopeId: run.projectId,
        conversationId: run.chiefConversationId,
        content: `[run ${run.id} worker asks]\n${args.question}\n\nThe worker is blocked waiting. Reply now with send_run_msg(run: "${run.id}", body: "<answer>"). If only Tian can decide, say so and give interim guidance.`,
      });
      const deadline =
        Date.now() + (args.wait_seconds ?? DEFAULT_WAIT_SECONDS) * 1000;
      for (;;) {
        const reply = db.chiefReplyAfter(run.id, message.seq);
        if (reply) {
          db.markAgentMessagesDelivered([reply.id]);
          return text(`chief replied:\n${reply.body}`);
        }
        const current = db.getRun(run.id);
        if (
          !current ||
          current.reviewStatus === 'discarding' ||
          current.reviewStatus === 'discarded' ||
          current.status === 'interrupted'
        )
          return text(
            'The run was cancelled while waiting — stop working and do not start anything new.',
          );
        if (Date.now() >= deadline)
          return text(
            'No reply within the wait window — proceed with your best judgment and record the open question in your report.',
          );
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  const tellChief = defineTool({
    name: 'tell_chief',
    replay: 'safe',
    description:
      'Send the chief a short progress note or FYI without waiting for a reply. For significant milestones or discovered risks; never chatter.',
    parameters: Type.Object({
      text: Type.String({
        description: 'A few lines at most; self-contained.',
      }),
    }),
    execute: async (args, api) => {
      const run = runOf(String(api.conversationId));
      if (!run) return err('No run is bound to this conversation.');
      const message = db.addAgentMessage({
        id: `tell:${run.id}:${api.taskId}:${api.callId}`,
        runId: run.id,
        sender: 'worker',
        body: args.text,
      });
      await deps.wake({
        id: `tell:${message.id}`,
        scopeId: run.projectId,
        conversationId: run.chiefConversationId,
        content: `[run ${run.id} worker note]\n${args.text}`,
      });
      return text('delivered to the chief.');
    },
  });

  const checkMsgs = defineTool({
    name: 'check_msgs',
    replay: 'safe',
    description:
      'Read new messages the chief sent to this run (guidance, answers, scope changes) and mark them read. Ask_chief replies arrive directly; check this at natural milestones if the chief said it would send more.',
    parameters: Type.Object({}),
    execute: async (_args, api) => {
      const run = runOf(String(api.conversationId));
      if (!run) return err('No run is bound to this conversation.');
      const pending = db.undeliveredAgentMessages(run.id);
      if (pending.length === 0) return text('(no new messages)');
      db.markAgentMessagesDelivered(pending.map((message) => message.id));
      return text(
        pending
          .map((message) => `[${message.createdAt}] chief:\n${message.body}`)
          .join('\n---\n'),
      );
    },
  });

  const recall = defineTool({
    name: 'recall',
    replay: 'safe',
    description:
      'Read task-related memory, notes and history from this run project only. No memory writes. Use read_history for source excerpts.',
    parameters: Type.Object({
      query: Type.String(),
      budget: Type.Optional(Type.Integer({ minimum: 50, maximum: 4000 })),
    }),
    execute: async (args, api) => {
      const run = runOf(String(api.conversationId));
      if (!run || !deps.scopes)
        return err('No project memory is bound to this run');
      return text(
        relevantContext(
          { db, scopes: deps.scopes },
          [run.projectId],
          args.query,
          args.budget,
        ),
      );
    },
  });
  const readEvidence = defineTool({
    name: 'read_history',
    replay: 'safe',
    description:
      'Read an indexed original evidence excerpt from this run project only.',
    parameters: Type.Object({
      ref: Type.String(),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    execute: async (args, api) => {
      const run = runOf(String(api.conversationId));
      const match = /^conv:([^#]+)#(.+)$/.exec(args.ref);
      if (!run || !match) return err('Unknown evidence reference');
      const row = db.sqlite
        .prepare(
          'SELECT text FROM history_entries WHERE scope_id = ? AND conversation_id = ? AND entry_id = ?',
        )
        .get(run.projectId, match[1], match[2]) as { text: string } | undefined;
      if (!row) return err('Evidence is unavailable in this project');
      return text(
        [...row.text]
          .slice(args.offset ?? 0, (args.offset ?? 0) + 1800)
          .join(''),
      );
    },
  });
  return defineExtension({
    name: 'tian-worker-msg',
    sections: [
      section('relevant_context', (input) => {
        const run = runOf(String(input.conversationId));
        return run && deps.scopes
          ? relevantContext(
              { db, scopes: deps.scopes },
              [run.projectId],
              run.prompt,
            )
          : '';
      }),
    ],
    tools: [askChief, tellChief, checkMsgs, recall, readEvidence],
  });
}
