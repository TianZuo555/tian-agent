import { createConnection, type Socket } from 'node:net';
import type { Args, CommandName, Result } from '../shared/contracts.js';
import type { AppEvents, Emit, ServiceInfo } from '../shared/types.js';
import { SERVICE_PROTOCOL } from '../shared/service-paths.js';
import { isId, isRecord, jsonPeer } from './protocol.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const channels = new Set<keyof AppEvents>([
  'view',
  'conversations',
  'tasks',
  'runs',
  'inbox',
  'memory',
  'scopes',
  'settings',
  'runtime',
]);

/** Connects to a resident service; closing this client never stops the service. */
export class ServiceClient {
  private socket: Socket | null = null;
  private peer: ReturnType<typeof jsonPeer> | null = null;
  private pending = new Map<number, Pending>();
  private waiting = new Set<{
    resolve: (info: ServiceInfo) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private sequence = 0;
  private active = false;
  private disposed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private currentInfo: ServiceInfo | null = null;
  private reconnectAttempt = 0;

  constructor(
    readonly socketPath: string,
    private emit: Emit = () => {},
    private options: {
      readyTimeoutMs?: number;
      reconnectDelayMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ) {}
  get info(): ServiceInfo | null {
    return this.currentInfo;
  }

  start(): Promise<ServiceInfo> {
    if (this.disposed)
      return Promise.reject(new Error('Service client closed'));
    if (this.currentInfo) return Promise.resolve(this.currentInfo);
    if (!this.active) {
      this.active = true;
      this.connect();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiting.delete(waiter);
          reject(
            new Error(
              'The resident service is unavailable. Start it with pnpm service:start, or install it with pnpm service:install.',
            ),
          );
        }, this.options.readyTimeoutMs ?? 10_000),
      };
      this.waiting.add(waiter);
    });
  }

  private connect(): void {
    if (!this.active) return;
    this.emit('runtime', { status: 'starting' });
    const socket = createConnection(this.socketPath);
    this.socket = socket;
    this.peer = jsonPeer(socket, (message) => this.receive(socket, message));
    let lastError = 'Resident service disconnected';
    socket.on('error', (error) => {
      lastError = error.message;
    });
    socket.once('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.peer = null;
      this.currentInfo = null;
      const error = new Error(lastError);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      if (this.active) {
        this.emit('runtime', { status: 'failed', error: lastError });
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          Math.min(
            30_000,
            (this.options.reconnectDelayMs ?? 500) *
              2 ** Math.min(this.reconnectAttempt++, 6),
          ),
        );
        this.reconnectTimer.unref();
      }
    });
  }

  private receive(socket: Socket, message: unknown): void {
    if (this.socket !== socket || !isRecord(message)) {
      socket.destroy();
      return;
    }
    if (message.type === 'ready') {
      const info = message.info;
      if (
        !isRecord(info) ||
        info.protocolVersion !== SERVICE_PROTOCOL ||
        typeof info.serviceVersion !== 'string' ||
        typeof info.releaseId !== 'string' ||
        !Number.isSafeInteger(info.databaseVersion) ||
        !isId(info.pid) ||
        typeof info.startedAt !== 'string'
      ) {
        socket.destroy(
          new Error(
            'Incompatible resident service; reinstall the service after updating the app',
          ),
        );
        return;
      }
      this.currentInfo = info as unknown as ServiceInfo;
      this.reconnectAttempt = 0;
      for (const waiter of this.waiting) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.currentInfo);
      }
      this.waiting.clear();
      this.emit('runtime', { status: 'ready' });
    } else if (message.type === 'result' && isId(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (typeof message.error === 'string')
        pending.reject(new Error(message.error));
      else pending.resolve(message.value);
    } else if (
      message.type === 'event' &&
      channels.has(message.channel as keyof AppEvents) &&
      (message.clientId === undefined || isId(message.clientId))
    ) {
      this.emit(
        message.channel as keyof AppEvents,
        message.payload as never,
        message.clientId as number | undefined,
      );
    } else socket.destroy(new Error('Invalid service response'));
  }

  async invoke<K extends CommandName>(
    command: K,
    args: Args<K>,
    clientId = 0,
  ): Promise<Result<K>> {
    await this.start();
    if (!this.active || !this.peer || !this.currentInfo)
      throw new Error('Resident service is disconnected');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Service command timed out: ${command}`));
      }, this.options.requestTimeoutMs ?? 300_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result<K>),
        reject,
        timer,
      });
      this.peer!.send({ type: 'request', id, command, args, clientId });
    });
  }
  releaseClient(clientId: number): void {
    this.peer?.send({ type: 'release-client', clientId });
  }
  close(): void {
    this.disposed = true;
    this.active = false;
    clearTimeout(this.reconnectTimer);
    const error = new Error('Service client closed');
    for (const waiter of this.waiting) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiting.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.socket?.destroy();
    this.currentInfo = null;
  }
}
