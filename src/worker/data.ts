import { randomUUID } from 'node:crypto';
import type {
  AgentMessageRow,
  Db,
  ManagerMessageKind,
  ManagerMessageRow,
} from './db.js';
import type {
  MemoryActor,
  MemoryKind,
  MemoryRow,
  RememberResult,
  ReviseResult,
} from './memory.js';
import type { Scopes } from './scopes.js';
import type { EvidenceInput, ConfirmationInput } from './memory-evidence.js';
import type { Emit } from '../shared/types.js';

/** Application operations shared by IPC and the chief's tools. */
export class DataService {
  constructor(
    private db: Db,
    private scopes: Scopes,
    private emit: Emit,
    /** Background hooks fired after memory corrections and task completions. */
    private hooks: {
      onTaskCompleted?: (scopeId: string) => void;
      onCorrection?: (scopeId: string) => void;
    } = {},
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
    const scopeId = this.db.getTask(id)?.scopeId;
    this.db.once(operationId, () => {
      if (done) this.db.doneTask(id);
      else this.db.reopenTask(id);
      return null;
    });
    this.emit('tasks', this.db.listTasks(null));
    // A finished task is an extraction trigger (PRD §4.4 F03).
    if (done && scopeId) this.hooks.onTaskCompleted?.(scopeId);
  }

  /**
   * Record a memory. Provenance is decided by the caller (the tool layer
   * verifies the user turn); `sourceType`/`trustLevel` are stored as given.
   * `operationId` makes a durable replay a no-op instead of a second write.
   */
  remember(
    scopeId: string,
    text: string,
    options?: {
      kind?: MemoryKind;
      sourceType?: 'user' | 'agent' | 'tool' | 'external';
      trustLevel?: 'user_confirmed' | 'agent_inferred' | 'third_party';
      goalId?: string | null;
      sourceRef?: string | null;
      core?: boolean;
      actor?: MemoryActor;
      operationId?: string;
      evidence?: EvidenceInput;
      confirmation?: ConfirmationInput;
      conditions?: string;
      validUntil?: string | null;
      status?: 'active' | 'candidate';
      supersedes?: number | null;
    },
  ): RememberResult {
    // Resolve (and fully initialize) the store before the replayable write
    // transaction: legacy import and the initial Core selection must commit on
    // their own, so a failing write cannot roll them back.
    const memory = this.scopes.memory(scopeId);
    const result = this.db.once(options?.operationId, () =>
      memory.remember({
        text,
        kind: options?.kind,
        sourceType: options?.sourceType,
        sourceRef: options?.sourceRef ?? null,
        trustLevel: options?.trustLevel,
        goalId: options?.goalId ?? null,
        core: options?.core,
        actor: options?.actor,
        evidence: options?.evidence,
        confirmation: options?.confirmation,
        conditions: options?.conditions,
        validUntil: options?.validUntil,
        status: options?.status,
        supersedes: options?.supersedes ?? null,
      }),
    );
    this.emit('memory', scopeId);
    return result;
  }

  revise(
    scopeId: string,
    seq: number,
    text: string,
    reason: string,
    actor: MemoryActor,
    options?: {
      sourceRef?: string | null;
      trustLevel?: 'user_confirmed' | 'agent_inferred' | 'third_party';
      sourceType?: 'user' | 'agent' | 'tool' | 'external';
      operationId?: string;
      evidence?: EvidenceInput;
      confirmation?: ConfirmationInput;
      conditions?: string;
      validUntil?: string | null;
      replacement?: {
        seq: number;
        content: string;
        conditions?: string;
        validUntil?: string | null;
      };
    },
  ): ReviseResult {
    const memory = this.scopes.memory(scopeId);
    const result = this.db.once(options?.operationId, () =>
      memory.revise(seq, text, reason, actor, options),
    );
    this.emit('memory', scopeId);
    // A correction is an extraction trigger (PRD §4.4 F03).
    this.hooks.onCorrection?.(scopeId);
    return result;
  }

  forget(
    scopeId: string,
    seq: number,
    reason: string,
    actor: MemoryActor,
    operationId?: string,
  ): MemoryRow {
    const store = this.scopes.memory(scopeId);
    const { memory } = this.db.once(operationId, () =>
      store.forget(seq, reason, actor),
    );
    this.emit('memory', scopeId);
    this.hooks.onCorrection?.(scopeId);
    return memory;
  }

  /** Explicit Core selection; over budget rejects with current usage. */
  select(
    scopeId: string,
    seq: number,
    actor: MemoryActor = 'user',
    operationId?: string,
  ) {
    const memory = this.scopes.memory(scopeId);
    const result = this.db.once(operationId, () => memory.select(seq, actor));
    this.emit('memory', scopeId);
    return result;
  }

  /** Remove from Core only; the memory stays active and searchable. */
  deselect(
    scopeId: string,
    seq: number,
    actor: MemoryActor = 'user',
    operationId?: string,
  ) {
    const memory = this.scopes.memory(scopeId);
    const result = this.db.once(operationId, () => memory.deselect(seq, actor));
    this.emit('memory', scopeId);
    return result;
  }

  /** User promotion of a candidate; trust stays agent_inferred. */
  promote(
    scopeId: string,
    seq: number,
    operationId?: string,
    confirmation: ConfirmationInput = {
      sourceRef: 'ui:memory-panel',
      method: 'review',
    },
    replacement?: {
      seq: number;
      content: string;
      conditions?: string;
      validUntil?: string | null;
    },
  ): {
    memory: MemoryRow;
    superseded: MemoryRow | null;
  } {
    const store = this.scopes.memory(scopeId);
    const result = this.db.once(operationId, () =>
      store.promote(
        seq,
        'user',
        'user reviewed stored statement',
        confirmation,
        replacement,
      ),
    );
    this.emit('memory', scopeId);
    return result;
  }

  /** User dismissal of a candidate; the extraction remembers the rejection. */
  dismiss(scopeId: string, seq: number): void {
    this.forget(scopeId, seq, 'candidate dismissed', 'user');
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

  /**
   * Append to a project's chief↔manager thread (durable record). `sender` is
   * 'chief' for delegations/guidance/answers, 'manager' for reports and
   * questions; delivery to the other side is the caller's job (notifications).
   */
  postManagerMessage(input: {
    projectId: string;
    sender: 'chief' | 'manager';
    body: string;
    kind?: ManagerMessageKind;
    taskId?: number | null;
    replyTo?: string | null;
    operationId?: string;
  }): ManagerMessageRow {
    if (!this.db.getProject(input.projectId))
      throw new Error(`Unknown project: ${input.projectId}`);
    if (!input.body.trim()) throw new Error('Message body cannot be empty');
    return this.db.once(input.operationId, () =>
      this.db.addManagerMessage({
        id: `mm:${input.projectId}:${input.operationId ?? randomUUID()}`,
        projectId: input.projectId,
        sender: input.sender,
        kind: input.kind,
        taskId: input.taskId,
        replyTo: input.replyTo,
        body: input.body.trim(),
      }),
    );
  }

  managerMessages(projectId: string): ManagerMessageRow[] {
    if (!this.db.getProject(projectId))
      throw new Error(`Unknown project: ${projectId}`);
    return this.db.listManagerMessages(projectId);
  }

  /**
   * The chief conversation a manager's report/question should reach: the
   * given task's reportTo first (only when that task lives in this
   * project — a foreign task must not leak the report into another
   * project's chief), then the latest delegated task's reportTo, else
   * null (scope-level notification fallback).
   */
  managerReportTarget(
    projectId: string,
    taskId?: number | null,
  ): string | null {
    if (taskId != null) {
      const task = this.db.getTask(taskId);
      if (task?.scopeId === projectId && task.reportTo) return task.reportTo;
    }
    return this.db.latestDelegatedTask(projectId)?.reportTo ?? null;
  }
}
