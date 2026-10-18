import {
  Harness,
  createRegistry,
  type Conversation,
  type ConversationId,
  type Extension,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { join } from 'node:path';
import type { Db, RunRow } from './db.js';
import type { Settings } from './settings.js';
import type { WorkerConversation, WorkerRuntime } from './runs.js';

/** The only adapter that knows Pi's conversation and submission APIs. */
export class AgentRuntime implements WorkerRuntime {
  harness!: Harness;
  private models: ReturnType<Settings['models']> | undefined;
  private chief!: Extension;
  private worker!: Extension;
  constructor(
    private userDataDir: string,
    private globalDir: string,
    private settings: Settings,
    private db: Db,
  ) {}

  /**
   * Swap in a fresh provider after the model catalog was refreshed. The Models
   * instance is shared with the open Harness, so replacing the provider is
   * enough — no need to reopen storage.
   */
  refreshModels(): void {
    if (!this.models) return;
    for (const provider of this.settings.models().getProviders())
      this.models.setProvider(provider);
  }

  async open(chief: Extension, worker: Extension): Promise<void> {
    this.chief = chief;
    this.worker = worker;
    const registry = createRegistry();
    registry.install(chief);
    registry.install(worker);
    registry.install(CodingTools);
    this.models = this.settings.models();
    this.harness = await Harness.open(
      await openNodeSqliteStorage(join(this.userDataDir, 'pi-session.sqlite')),
      {
        models: this.models,
        registry,
        settings: { extensions: [chief], toolExecution: 'sequential' },
        env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? this.globalDir }),
      },
      BACKGROUND_CONTEXT,
    );
    // Existing chief conversations must also lose implicitly inherited coding tools.
    await Promise.all(
      this.db.listConversations().map(async (row) => {
        const conversation = await this.harness.conversation(
          Number(row.conversationId) as ConversationId,
          BACKGROUND_CONTEXT,
        );
        await conversation?.configure(
          { extensions: [chief] },
          BACKGROUND_CONTEXT,
        );
      }),
    );
    // Existing worker conversations gain the messaging tools after an upgrade.
    await Promise.all(
      this.db.listRuns(null).map(async (run) => {
        if (!run.conversationId || run.reviewStatus === 'discarded') return;
        const conversation = await this.harness.conversation(
          Number(run.conversationId) as ConversationId,
          BACKGROUND_CONTEXT,
        );
        await conversation?.configure(
          { extensions: [CodingTools, worker] },
          BACKGROUND_CONTEXT,
        );
      }),
    );
  }

  async conversation(id: string): Promise<Conversation> {
    const conversation = await this.harness.conversation(
      Number(id) as ConversationId,
      BACKGROUND_CONTEXT,
    );
    if (!conversation) throw new Error(`Unknown conversation: ${id}`);
    return conversation;
  }
  async createChief(cwd: string): Promise<Conversation> {
    return this.harness.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: {
          model: this.settings.get().model,
          cwd,
          extensions: [this.chief],
        },
      },
      BACKGROUND_CONTEXT,
    );
  }
  async create(run: RunRow): Promise<WorkerConversation> {
    const project = this.db.getProject(run.projectId);
    const conversation = await this.harness.createConversation(
      {
        ownership: { kind: 'ownerless' },
        agent: {
          model: this.settings.get().model,
          cwd: run.worktreePath ?? run.rootPath,
          extensions: [CodingTools, this.worker],
          instructions: [
            'You are a worker coding agent. Complete the task unattended and make reasonable decisions yourself. Only when a decision genuinely needs the chief (destructive or irreversible action, missing credentials, fundamental ambiguity) ask once with ask_chief and wait for its reply; use tell_chief for short progress notes, never for chatter.',
            'Edit only files inside the current working directory. Do not run git commit, merge, push, or change branches; the application manages Git.',
            `Shared memory is exported read-only to ${join(run.rootPath, 'memory', 'MEMORY.md')}; longer notes in ${join(run.rootPath, 'notes')}. Never modify the memory export, notes, or the project main checkout.`,
            'Write a report of at most one page to TIAN_REPORT.md in the working directory: changes, validation, key decisions, and limitations.',
            project?.promptPreamble ?? '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      },
      BACKGROUND_CONTEXT,
    );
    return this.wrap(conversation);
  }
  async get(id: string): Promise<WorkerConversation> {
    return this.wrap(await this.conversation(id));
  }
  private wrap(conversation: Conversation): WorkerConversation {
    return {
      id: String(conversation.id),
      submit: async (content, requestId) => {
        const submission = await conversation.submit(
          { type: 'input', content, requestId },
          BACKGROUND_CONTEXT,
        );
        return {
          wait: async () => {
            const result = await submission.wait(BACKGROUND_CONTEXT);
            return {
              status: result.status,
              reason:
                result.status === 'unanswered' ? result.reason : undefined,
            };
          },
        };
      },
      abort: () => conversation.abort(BACKGROUND_CONTEXT, { background: true }),
      lastText: async () => {
        const page = await conversation.entries(
          { order: 'descending' },
          20,
          undefined,
          BACKGROUND_CONTEXT,
        );
        for (const entry of page.items) {
          if (entry.kind !== 'pi.assistant') continue;
          const text = (entry.model ?? [])
            .map((message) =>
              typeof message.content === 'string'
                ? message.content
                : message.content
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join(''),
            )
            .join('')
            .trim();
          if (text) return text;
        }
        return '';
      },
    };
  }
  async close(): Promise<void> {
    await this.harness?.close(BACKGROUND_CONTEXT);
  }
}
