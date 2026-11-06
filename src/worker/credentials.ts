// FileCredentialStore: the pi-ai CredentialStore persisted on a single JSON
// file in the service data directory. The resident service is the only writer.
// Every write goes to a fresh temp file with mode 0600 and is renamed into
// place, so readers never observe a partial file and the file never carries
// looser permissions. A missing file reads as empty; a corrupt file is a
// storage failure and rejects.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';

export class FileCredentialStore implements CredentialStore {
  private readonly filePath: string;
  private readonly chains = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'credentials.json');
  }

  private loadAll(): Record<string, Credential> {
    if (!existsSync(this.filePath)) return {};
    const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new Error(`Credential store is corrupt: ${this.filePath}`);
    for (const [providerId, credential] of Object.entries(raw)) {
      const type = (credential as Credential | undefined)?.type;
      if (type !== 'api_key' && type !== 'oauth')
        throw new Error(
          `Credential store entry '${providerId}' has unknown type '${String(type)}'`,
        );
    }
    return raw as Record<string, Credential>;
  }

  private writeAll(credentials: Record<string, Credential>): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(credentials), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const queued = (async () => {
      await previous.catch(() => {});
      return task();
    })();
    const tail = queued.then(
      () => {},
      () => {},
    );
    this.chains.set(providerId, tail);
    void tail.then(() => {
      if (this.chains.get(providerId) === tail) this.chains.delete(providerId);
    });
    return queued;
  }

  async read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return this.loadAll()[providerId];
  }

  async list(
    options?: AuthOperationOptions,
  ): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(this.loadAll()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      options?.signal?.throwIfAborted();
      const current = this.loadAll()[providerId];
      const next = await fn(current);
      options?.signal?.throwIfAborted();
      if (next !== undefined) {
        // Other providers can commit while fn awaits an OAuth refresh.
        const credentials = this.loadAll();
        credentials[providerId] = next;
        this.writeAll(credentials);
      }
      return next ?? current;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      options?.signal?.throwIfAborted();
      if (!existsSync(this.filePath)) return;
      const credentials = this.loadAll();
      if (!(providerId in credentials)) return;
      delete credentials[providerId];
      this.writeAll(credentials);
    });
  }
}
