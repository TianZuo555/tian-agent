import { randomUUID } from 'node:crypto';
import type { AgentMessageRow, Db } from './db.js';
import type { MemoryActor, MemoryKind, MemoryRow, MergeDue } from './memory.js';
import type { Scopes } from './scopes.js';
import type { Emit } from '../shared/types.js';

/** Application operations shared by IPC and the chief's tools. */
export class DataService {
  constructor(
    private db: Db,
    private scopes: Scopes,
    private emit: Emit,
  ) {}

  addTask(
    scopeId: string,
    title: string,
    due: string | null,
    operationId?: string,
  ): number {
    this.scopes.root(scopeId);
    if (!title.trim()) throw new Error('Task title cannot be empty');
    const id = this.db.once(operationId, () =>
      this.db.addTask(scopeId, title.trim(), due),
    );
    this.emit('tasks', this.db.listTasks(null));
    return id;
  }

  doneTask(id: number, done: boolean, operationId?: string): void {
    this.db.once(operationId, () => {
      if (done) this.db.doneTask(id);
      else this.db.reopenTask(id);
      return null;
    });
    this.emit('tasks', this.db.listTasks(null));
  }

  /** Record a memory; `source: 'user'` means Tian stated it explicitly. */
  remember(
    scopeId: string,
    text: string,
    options?: {
      kind?: MemoryKind;
      source?: 'user' | 'agent';
      goalId?: string | null;
      sourceRef?: string | null;
    },
  ): { memory: MemoryRow; merge: MergeDue | null } {
    const source = options?.source ?? 'agent';
    const result = this.scopes.memory(scopeId).remember({
      text,
      kind: options?.kind,
      sourceType: source,
      sourceRef: options?.sourceRef ?? null,
      trustLevel: source === 'user' ? 'user_confirmed' : 'agent_inferred',
      goalId: options?.goalId ?? null,
    });
    this.emit('memory', scopeId);
    return result;
  }

  revise(
    scopeId: string,
    seq: number,
    text: string,
    reason: string,
    actor: MemoryActor,
  ) {
    const result = this.scopes.memory(scopeId).revise(seq, text, reason, actor);
    this.emit('memory', scopeId);
    return result;
  }

  forget(
    scopeId: string,
    seq: number,
    reason: string,
    actor: MemoryActor,
  ): MemoryRow {
    const memory = this.scopes.memory(scopeId).forget(seq, reason, actor);
    this.emit('memory', scopeId);
    return memory;
  }

  nap(scopeId: string, lo: number, hi: number, summary: string) {
    const merge = this.scopes.memory(scopeId).nap(lo, hi, summary);
    this.emit('memory', scopeId);
    return merge;
  }

  checkInbox(scopeId: string) {
    const messages = this.scopes.unreadMessages(scopeId);
    this.scopes.markInboxRead(
      scopeId,
      messages.map((message) => message.id),
    );
    this.emit('inbox', scopeId);
    return messages;
  }

  sendMessage(
    scopeId: string,
    body: string,
    to?: string,
    thread?: string,
  ): string {
    const id = this.scopes.sendMessage(scopeId, 'chief', body, to, thread);
    this.emit('inbox', scopeId);
    return id;
  }

  sendRunMessage(
    runId: string,
    body: string,
    operationId?: string,
  ): AgentMessageRow {
    if (!this.db.getRun(runId)) throw new Error(`Unknown run: ${runId}`);
    if (!body.trim()) throw new Error('Message body cannot be empty');
    return this.db.once(operationId, () =>
      this.db.addAgentMessage({
        id: `msg:${runId}:${operationId ?? randomUUID()}`,
        runId,
        sender: 'chief',
        body: body.trim(),
      }),
    );
  }

  runMessages(runId: string): AgentMessageRow[] {
    if (!this.db.getRun(runId)) throw new Error(`Unknown run: ${runId}`);
    return this.db.listAgentMessages(runId);
  }
}
