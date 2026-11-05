import type { Args, CommandName, Result } from '../../src/shared/contracts';
import type { AppEvents } from '../../src/shared/types';

export interface Connection {
  next(): Promise<unknown>;
  send(message: unknown): Promise<void>;
  close(): void;
}

type Emit = <K extends keyof AppEvents>(
  channel: K,
  payload: AppEvents[K],
) => void;
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const channels = new Set<keyof AppEvents>([
  'view',
  'conversations',
  'tasks',
  'goals',
  'notices',
  'improvements',
  'runs',
  'inbox',
  'memory',
  'skills',
  'scopes',
  'settings',
  'runtime',
]);

/** RPC correlation and reconnect; Rust owns IO, framing and the ready handshake. */
export function createServiceClient(
  connect: () => Promise<Connection>,
  emit: Emit,
  options: { retryMs?: number; requestMs?: number } = {},
) {
  let connection: Connection | null = null;
  let active = false;
  let sequence = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeRetry: (() => void) | undefined;
  const pending = new Map<number, Pending>();
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  async function run() {
    let attempt = 0;
    while (active) {
      emit('runtime', { status: 'starting' });
      let current: Connection | null = null;
      try {
        current = await connect();
        if (!active) {
          current.close();
          break;
        }
        connection = current;
        attempt = 0;
        emit('runtime', { status: 'ready' });
        while (active && connection === current) {
          const message = await current.next();
          if (!active || connection !== current) break;
          if (!record(message)) throw new Error('Invalid service message');
          if (message.type === 'result' && Number.isSafeInteger(message.id)) {
            const request = pending.get(message.id as number);
            if (!request) continue;
            pending.delete(message.id as number);
            clearTimeout(request.timer);
            if (typeof message.error === 'string')
              request.reject(new Error(message.error));
            else request.resolve(message.value);
          } else if (
            message.type === 'event' &&
            channels.has(message.channel as keyof AppEvents) &&
            (message.clientId === undefined || message.clientId === 1)
          ) {
            emit(message.channel as keyof AppEvents, message.payload as never);
          } else if (message.type !== 'event')
            throw new Error('Invalid service response');
        }
      } catch (reason) {
        const error =
          reason instanceof Error ? reason : new Error(String(reason));
        rejectPending(error);
        if (active) emit('runtime', { status: 'failed', error: error.message });
      } finally {
        current?.close();
        connection = null;
      }
      if (active)
        await new Promise<void>((resolve) => {
          wakeRetry = resolve;
          retryTimer = setTimeout(
            resolve,
            Math.min(
              30_000,
              (options.retryMs ?? 500) * 2 ** Math.min(attempt++, 6),
            ),
          );
        });
    }
  }
  return {
    start() {
      if (active) return;
      active = true;
      void run();
    },
    invoke<K extends CommandName>(
      command: K,
      args: Args<K>,
    ): Promise<Result<K>> {
      const current = connection;
      if (!active || !current)
        return Promise.reject(new Error('Resident service is disconnected'));
      if (pending.size >= 128)
        return Promise.reject(new Error('Too many service requests'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Service command timed out: ${command}`));
        }, options.requestMs ?? 300_000);
        pending.set(id, {
          resolve: (value) => resolve(value as Result<K>),
          reject,
          timer,
        });
        void current
          .send({ type: 'request', id, command, args, clientId: 1 })
          .catch((error: unknown) => {
            const request = pending.get(id);
            if (!request) return;
            clearTimeout(request.timer);
            pending.delete(id);
            request.reject(
              error instanceof Error ? error : new Error(String(error)),
            );
            current.close();
          });
      });
    },
    close() {
      active = false;
      clearTimeout(retryTimer);
      wakeRetry?.();
      rejectPending(new Error('Service client closed'));
      const current = connection;
      connection = null;
      // The server releases this connection's client IDs and watches on EOF.
      current?.close();
    },
  };
}
