import { GLOBAL_SCOPE } from './scopes.js';
import type { Db, ManagerMessageRow, Notification, TaskRow } from './db.js';
import type { ConversationInfo, SessionBinding } from '../shared/types.js';

export interface ManagerLinkDeps {
  db: Db;
  /** Create or reuse the reserved `manager` channel binding. */
  openManagerSession(binding: SessionBinding): Promise<ConversationInfo>;
  queueNotification(notification: Notification): boolean;
  requestDelivery(): Promise<void>;
  emitUpdates(): void;
}

/**
 * Chief ↔ Manager handoffs. Owns the one persistent manager conversation per
 * project, delegation tasks, and the messages that wake a manager.
 */
export class ManagerLink {
  constructor(private readonly deps: ManagerLinkDeps) {}

  /**
   * The project's persistent manager conversation, created with the project
   * (or on service start for older projects) and reused afterwards.
   */
  async open(projectId: string): Promise<ConversationInfo> {
    if (projectId === GLOBAL_SCOPE)
      throw new Error('the global scope has no project manager');
    const project = this.deps.db.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const conversation = await this.deps.openManagerSession({
      channel: 'manager',
      externalId: projectId,
      scopeId: projectId,
    });
    const title = `Manager · ${project.name}`;
    this.deps.db.setConversationTitle(conversation.conversationId, title);
    // setConversationTitle only fills a NULL title — mirror that here so a
    // renamed conversation keeps its own title in the returned row.
    return conversation.title == null
      ? { ...conversation, title }
      : conversation;
  }

  /**
   * D18: every project has its manager. Projects added before that rule get
   * theirs on service start; for the rest this is a no-op.
   */
  async ensureAll(): Promise<void> {
    await Promise.all(
      this.deps.db.listProjects().map((project) => this.open(project.id)),
    );
  }

  /** Wake the manager conversation through the notification pipeline. */
  async wake(
    projectId: string,
    content: string,
    notificationId: string,
  ): Promise<void> {
    const conversation = await this.open(projectId);
    this.deps.queueNotification({
      id: notificationId,
      scopeId: projectId,
      conversationId: conversation.conversationId,
      content,
    });
    await this.deps.requestDelivery();
  }

  /**
   * Chief → manager delegation: one transaction creates the delegated task
   * (assignee='manager', reportTo=this chief) and the delegation thread row,
   * then the manager is woken with the task id. Idempotent via operationId.
   */
  async delegate(input: {
    projectId: string;
    chiefConversationId: string;
    title: string;
    briefing: string;
    goalId?: string | null;
    operationId: string;
  }): Promise<{ task: TaskRow; message: ManagerMessageRow }> {
    const project = this.deps.db.getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    const conversation = await this.open(input.projectId);
    const { task, message } = this.deps.db.once(input.operationId, () => {
      const task = this.deps.db.insertTask({
        scopeId: input.projectId,
        title: input.title,
        owner: 'agent',
        assignee: 'manager',
        reportTo: input.chiefConversationId,
        goalId: input.goalId ?? null,
        dedupeKey: `delegate:${input.operationId}`,
      });
      const message = this.deps.db.addManagerMessage({
        id: `mm:${input.projectId}:${input.operationId}`,
        projectId: input.projectId,
        sender: 'chief',
        kind: 'delegation',
        taskId: task.id,
        body: input.briefing,
      });
      return { task, message };
    });
    this.deps.queueNotification({
      id: `mm-notify:${message.id}`,
      scopeId: input.projectId,
      conversationId: conversation.conversationId,
      content: `[delegated task #${task.id} from chief] ${task.title}\n${input.briefing}\n\nstart_task #${task.id}, dispatch runs with task: ${task.id}, then complete_task / fail_task #${task.id} — closing it reports back to the chief automatically. ask_chief(question, task: ${task.id}) only if genuinely blocked; report_chief(text, task: ${task.id}) for interim status.`,
    });
    await this.deps.requestDelivery();
    this.deps.emitUpdates();
    return { task, message };
  }

  /**
   * Chief → manager message. An answer to an open question is picked up by
   * the waiting ask_chief — no wake; anything else (and a late answer)
   * wakes the manager once. Idempotent via operationId.
   */
  async send(input: {
    projectId: string;
    body: string;
    replyTo?: number;
    taskId?: number;
    operationId: string;
  }): Promise<{
    message: ManagerMessageRow;
    delivered: 'waiting' | 'woken';
  }> {
    const project = this.deps.db.getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    if (input.taskId != null) {
      const task = this.deps.db.getTask(input.taskId);
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      if (task.scopeId !== input.projectId)
        throw new Error(
          `task #${task.id} belongs to ${task.scopeId}, not ${project.name}`,
        );
    }
    if (input.replyTo != null) {
      const question = this.deps.db.managerMessageBySeq(
        input.projectId,
        input.replyTo,
      );
      if (!question || question.kind !== 'question')
        throw new Error(
          `reply_to ${input.replyTo} is not a manager question in ${project.name} (seq from list_manager_msgs)`,
        );
      const { message, open } = this.deps.db.once(input.operationId, () => {
        const message = this.deps.db.addManagerMessage({
          id: `mm:${input.projectId}:${input.operationId}`,
          projectId: input.projectId,
          sender: 'chief',
          kind: 'answer',
          taskId: question.taskId,
          replyTo: question.id,
          body: input.body,
        });
        return {
          message,
          open: this.deps.db.managerMessage(question.id)?.closedAt == null,
        };
      });
      if (open) return { message, delivered: 'waiting' };
      await this.wake(
        input.projectId,
        `[chief answers your earlier question #${question.seq}]\n${question.body}\n---\n${input.body}`,
        `mm-notify:${message.id}`,
      );
      return { message, delivered: 'woken' };
    }
    const { message } = this.deps.db.once(input.operationId, () => ({
      message: this.deps.db.addManagerMessage({
        id: `mm:${input.projectId}:${input.operationId}`,
        projectId: input.projectId,
        sender: 'chief',
        kind: 'message',
        taskId: input.taskId ?? null,
        body: input.body,
      }),
    }));
    await this.wake(
      input.projectId,
      `[chief → ${project.name} manager]\n${input.body}`,
      `mm-notify:${message.id}`,
    );
    return { message, delivered: 'woken' };
  }
}
