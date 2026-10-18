import { createServer, type Server, type Socket } from 'node:net';
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lock } from 'proper-lockfile';
import { Service } from '../worker/service.js';
import { commandHandlers } from '../worker/commands.js';
import { validateCommand, type RuntimeMessage } from '../shared/contracts.js';
import type { Emit, ServiceInfo } from '../shared/types.js';
import {
  SERVICE_PROTOCOL,
  type ServicePaths,
} from '../shared/service-paths.js';
import { jsonPeer, isId, isRecord } from './protocol.js';
import { checkDatabaseOwner } from './ownership.js';
import { APP_VERSION, DATABASE_VERSION } from '../shared/version.js';

interface Connection {
  socket: Socket;
  peer: ReturnType<typeof jsonPeer>;
  clients: Map<number, number>;
  requests: Set<number>;
}

/** Owns one application service, independent of every desktop/client process. */
export class ResidentServer {
  private server: Server | null = null;
  private application: Service | null = null;
  private releaseLock: (() => Promise<void>) | null = null;
  private releaseSocketLock: (() => Promise<void>) | null = null;
  private ownsSocket = false;
  private connections = new Set<Connection>();
  private targets = new Map<
    number,
    { connection: Connection; localId: number }
  >();
  private nextClient = 0;
  private inFlight = new Set<Promise<void>>();
  private closing = false;
  private maintenance = false;
  private initialization: Promise<void> = Promise.resolve();
  readonly info: ServiceInfo = {
    serviceVersion: APP_VERSION,
    databaseVersion: DATABASE_VERSION,
    releaseId: process.env.TIAN_AGENT_RELEASE_ID ?? 'development',
    protocolVersion: SERVICE_PROTOCOL,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  constructor(readonly paths: ServicePaths) {}
  get service(): Service {
    if (!this.application) throw new Error('Service has not started');
    return this.application;
  }

  private emit: Emit = (channel, payload, clientId) => {
    if (clientId !== undefined) {
      const target = this.targets.get(clientId);
      if (target)
        this.send(target.connection, {
          type: 'event',
          channel,
          payload,
          clientId: target.localId,
        });
    } else
      for (const connection of this.connections)
        this.send(connection, { type: 'event', channel, payload });
  };
  private send(connection: Connection, message: RuntimeMessage): void {
    if (!connection.socket.destroyed) connection.peer.send(message);
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('Service is already started');
    mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 });
    chmodSync(this.paths.dataDir, 0o700);
    this.releaseLock = await lock(this.paths.dataDir, {
      lockfilePath: join(this.paths.dataDir, 'service.lock'),
      stale: 10_000,
      update: 5_000,
      retries: 0,
    });
    try {
      await checkDatabaseOwner(this.paths.dataDir);
      mkdirSync(dirname(this.paths.socketPath), {
        recursive: true,
        mode: 0o700,
      });
      this.releaseSocketLock = await lock(dirname(this.paths.socketPath), {
        lockfilePath: `${this.paths.socketPath}.lock`,
        stale: 10_000,
        update: 5_000,
        retries: 0,
      });
      // Both the storage and endpoint have an exclusive owner before stale cleanup.
      if (existsSync(this.paths.socketPath)) unlinkSync(this.paths.socketPath);
      this.application = new Service(this.paths.dataDir, this.emit);
      this.maintenance = existsSync(
        join(this.paths.installationDir, 'maintenance.json'),
      );
      this.initialization = this.application.init(this.maintenance);
      await this.initialization;
      if (this.closing) throw new Error('Service is closing');
      this.server = createServer((socket) => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(this.paths.socketPath, () => {
          this.server!.off('error', reject);
          resolve();
        });
      });
      this.ownsSocket = true;
      chmodSync(this.paths.socketPath, 0o600);
      this.server.on('error', (error) => {
        console.error('Service listener failed:', error);
        void this.close();
      });
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private accept(socket: Socket): void {
    if (this.closing) {
      socket.destroy();
      return;
    }
    const connection: Connection = {
      socket,
      clients: new Map(),
      requests: new Set(),
      peer: jsonPeer(
        socket,
        (message) => this.receive(connection, message),
        1024 * 1024,
      ),
    };
    socket.on('error', () => {});
    socket.once('close', () => {
      this.connections.delete(connection);
      for (const canonical of connection.clients.values()) {
        this.targets.delete(canonical);
        void this.service.releaseClient(canonical).catch(console.error);
      }
      connection.clients.clear();
    });
    this.connections.add(connection);
    this.send(connection, { type: 'ready', info: this.info });
  }

  private receive(connection: Connection, message: unknown): void {
    if (!isRecord(message) || !isId(message.clientId)) {
      connection.socket.destroy();
      return;
    }
    if (message.type === 'release-client') {
      const canonical = connection.clients.get(message.clientId);
      connection.clients.delete(message.clientId);
      if (canonical !== undefined) {
        this.targets.delete(canonical);
        void this.service.releaseClient(canonical).catch(console.error);
      }
      return;
    }
    if (
      message.type !== 'request' ||
      !isId(message.id) ||
      connection.requests.has(message.id)
    ) {
      connection.socket.destroy();
      return;
    }
    const id = message.id;
    const localId = message.clientId;
    if (connection.requests.size >= 128 || connection.clients.size >= 128) {
      this.send(connection, {
        type: 'result',
        id,
        error: 'Too many service requests',
      });
      return;
    }
    connection.requests.add(id);
    let enteredMaintenance = false;
    const operation = (async () => {
      try {
        if (this.closing) throw new Error('Service is closing');
        validateCommand(message.command, message.args);
        if (
          this.maintenance &&
          !['getActivity', 'beginMaintenance', 'finishMaintenance'].includes(
            message.command,
          )
        )
          throw new Error(
            'Service is in maintenance mode. Please wait for the update to finish.',
          );
        if (message.command === 'beginMaintenance') {
          if (this.maintenance)
            throw new Error('Service is already in maintenance mode');
          this.maintenance = true;
          enteredMaintenance = true;
          await Promise.allSettled(this.inFlight);
        }
        if (
          message.command === 'finishMaintenance' &&
          existsSync(join(this.paths.installationDir, 'maintenance.json'))
        )
          throw new Error(
            'The update has not committed; maintenance cannot be released yet',
          );
        if (message.command === 'pickDir')
          throw new Error('Native dialogs belong to the desktop client');
        let canonical = connection.clients.get(localId);
        if (canonical === undefined) {
          canonical = ++this.nextClient;
          connection.clients.set(localId, canonical);
          this.targets.set(canonical, { connection, localId });
        }
        const handler = commandHandlers(this.service, canonical)[
          message.command
        ] as (...args: unknown[]) => unknown;
        const value = await handler(...(message.args as unknown[]));
        if (message.command === 'finishMaintenance') {
          this.maintenance = false;
          this.emit('runtime', { status: 'ready' });
        }
        this.send(connection, { type: 'result', id, value });
      } catch (error) {
        if (enteredMaintenance) this.maintenance = false;
        this.send(connection, { type: 'result', id, error: String(error) });
      }
    })().finally(() => {
      connection.requests.delete(id);
      this.inFlight.delete(operation);
    });
    this.inFlight.add(operation);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const connection of this.connections) connection.socket.destroy();
    await Promise.allSettled(this.inFlight);
    await this.initialization.catch(() => {});
    await this.application?.close();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    if (this.ownsSocket && existsSync(this.paths.socketPath))
      unlinkSync(this.paths.socketPath);
    if (this.releaseSocketLock) {
      await this.releaseSocketLock();
      this.releaseSocketLock = null;
    }
    if (this.releaseLock) {
      await this.releaseLock();
      this.releaseLock = null;
    }
  }
}
