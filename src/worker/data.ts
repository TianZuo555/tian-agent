import type { Db } from './db.js';
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

  note(scopeId: string, text: string) {
    const merge = this.scopes.memory(scopeId).note(text);
    this.emit('memory', scopeId);
    return merge;
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
}
