import type { Notification } from './db.js';

/** The durable queue behind notification delivery. */
export interface NotificationStore {
  queueNotification(value: Notification): boolean;
  pendingNotifications(): Notification[];
  targetNotification(id: string, conversationId: string): void;
  deliveredNotification(id: string): void;
}

export interface NotificationOutboxDeps {
  store: NotificationStore;
  /** Pick the conversation for a notification that has no explicit target. */
  resolveConversation(notification: Notification): Promise<string>;
  /** Deliver one notification to its conversation. */
  deliver(notification: Notification, conversationId: string): Promise<void>;
  /** Record the delivery after the notification leaves the pending set. */
  delivered(notification: Notification, conversationId: string): void;
  reportIssue(
    area: string,
    error: unknown,
    context?: { scopeId?: string; conversationId?: string },
  ): void;
}

/**
 * Notification delivery for the resident service. The outbox drains its
 * durable queue one pass at a time and coalesces requests that arrive during a
 * pass, so a wake queued mid-delivery never waits for the next interval.
 */
export class NotificationOutbox {
  private running: Promise<void> | null = null;
  private requested = false;
  private paused = false;

  constructor(private readonly deps: NotificationOutboxDeps) {}

  /** Persist a notification; repeated ids are ignored by the store. */
  queue(notification: Notification): boolean {
    return this.deps.store.queueNotification(notification);
  }

  /** Run (or join) the delivery pass. Returns after pending work settles. */
  request(): Promise<void> {
    if (this.paused) return Promise.resolve();
    this.requested = true;
    if (this.running) return this.running;
    this.running = this.flush().finally(() => {
      this.running = null;
      // A request that arrived as the pass ended must not wait for the timer.
      if (this.requested && !this.paused) void this.request();
    });
    return this.running;
  }

  /** Stop starting deliveries; queued notifications stay durable. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Wait for the pass in flight, if any. */
  async idle(): Promise<void> {
    await this.running;
  }

  private async flush(): Promise<void> {
    while (this.requested && !this.paused) {
      this.requested = false;
      for (const notification of this.deps.store.pendingNotifications()) {
        if (this.paused) break;
        // Serial by design: one wake at a time keeps model load and event order
        // predictable; the queue, not parallelism, absorbs bursts.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await this.deliver(notification);
      }
    }
  }

  private async deliver(notification: Notification): Promise<void> {
    let conversationId = notification.conversationId;
    try {
      if (!conversationId) {
        conversationId = await this.deps.resolveConversation(notification);
        this.deps.store.targetNotification(notification.id, conversationId);
      }
      await this.deps.deliver(notification, conversationId);
      this.deps.store.deliveredNotification(notification.id);
      this.deps.delivered(notification, conversationId);
    } catch (error) {
      this.deps.reportIssue('notification.deliver', error, {
        scopeId: notification.scopeId,
        conversationId: conversationId ?? undefined,
      });
    }
  }
}
