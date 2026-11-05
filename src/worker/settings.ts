import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai/models';
import type { CredentialStore } from '@earendil-works/pi-ai';
import type {
  ModelCatalog,
  ModelInfo,
  ProviderConfig,
  SettingsInfo,
  WorkerIntent,
  WorkerRuntimeInfo,
  WorkerSettingsInfo,
} from '../shared/types.js';
import { atomicWrite } from './files.js';
import {
  MAGPIE_DEFAULT_MODEL,
  MAGPIE_PROVIDER,
  fetchGatewayCatalog,
  magpieApiKey,
  magpieBaseUrl,
} from './magpie.js';
import {
  catalogForConfig,
  magpieConfig,
  providerForConfig,
} from './providers.js';
import {
  getBuiltinProviders,
  type BuiltinProvider,
} from '@earendil-works/pi-ai/providers/all';
import { resolveWorkerSpec } from './run-model.js';
import type { WorkerLimits } from './runs.js';

/** Non-secret settings without the worker block, which Settings normalizes. */
type CoreSettings = Omit<SettingsInfo, 'workers'>;

/** settings.json 'workers' section, as written on disk. */
interface StoredWorkers {
  /** Global cap on concurrent worker attempts; absent = 3. */
  maxConcurrent?: number;
  /** Per-runtime caps and external-runtime enable flags ('pi' needs none). */
  runtimes?: Record<string, { enabled?: boolean; maxConcurrent?: number }>;
  intents?: WorkerIntent[];
}

const RUNTIME_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const INTENT_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const DEFAULT_MAX_ATTEMPTS = 3;
/** External runtimes the service can dispatch; each needs an explicit opt-in. */
const KNOWN_EXTERNAL_RUNTIMES = ['codex'];

/**
 * Settings own the model choices, the configured providers, and the cached
 * gateway catalogs (D21). Catalogs are cached per provider so the app still
 * opens (and pickers still list something) when a gateway is not running.
 * Secrets never live here — they belong to the CredentialStore.
 */
export class Settings {
  private path: string;
  private value: CoreSettings;
  private workersValue: StoredWorkers = {};
  private providerConfigs: ProviderConfig[] = [];
  private catalogs: Record<string, ModelInfo[]> = {};
  private status: Record<string, Omit<ModelCatalog, 'models'>> = {};

  constructor(
    userDataDir: string,
    private credentials?: CredentialStore,
  ) {
    this.path = join(userDataDir, 'settings.json');
    this.value = {
      model: { provider: MAGPIE_PROVIDER, modelId: MAGPIE_DEFAULT_MODEL },
    };
    try {
      if (existsSync(this.path)) {
        const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<
          CoreSettings & {
            providers?: ProviderConfig[];
            catalogs?: Record<string, ModelInfo[]>;
            /** Pre-registry single Magpie cache, migrated into catalogs. */
            catalog?: ModelInfo[];
            workers?: StoredWorkers;
          }
        >;
        if (
          typeof saved.model?.modelId === 'string' &&
          saved.model.modelId.trim()
        )
          this.value = {
            model: {
              provider:
                typeof saved.model.provider === 'string' &&
                saved.model.provider.trim()
                  ? saved.model.provider
                  : MAGPIE_PROVIDER,
              modelId: saved.model.modelId,
            },
          };
        if (Array.isArray(saved.providers))
          this.providerConfigs = saved.providers.filter(
            (entry) =>
              entry &&
              typeof entry.id === 'string' &&
              (entry.kind === 'gateway' || entry.kind === 'builtin'),
          );
        if (saved.catalogs && typeof saved.catalogs === 'object')
          this.catalogs = saved.catalogs;
        else if (Array.isArray(saved.catalog))
          this.catalogs = { [MAGPIE_PROVIDER]: saved.catalog };
        if (saved.workers && typeof saved.workers === 'object') {
          const workers = saved.workers;
          this.workersValue = {
            maxConcurrent: workers.maxConcurrent,
            runtimes: workers.runtimes,
            intents: Array.isArray(workers.intents)
              ? workers.intents.filter(
                  (intent) =>
                    intent &&
                    typeof intent.name === 'string' &&
                    typeof intent.runtime === 'string',
                )
              : [],
          };
        }
      }
    } catch {
      /* A missing or malformed settings file uses defaults. */
    }
  }

  get(): SettingsInfo {
    return structuredClone({
      ...this.value,
      workers: this.workerSettings(),
    });
  }

  /** The default Manager model (D21); falls back to the Chief model. */
  managerModel(): SettingsInfo['model'] {
    return structuredClone(this.value.managerModel ?? this.value.model);
  }

  /** null clears the override — managers fall back to the chief model. */
  setManagerModel(model: SettingsInfo['model'] | null): void {
    if (model) this.assertModel(model);
    this.value = {
      ...this.value,
      managerModel: model ? structuredClone(model) : undefined,
    };
    this.persist();
  }

  /** Configured providers; the magpie preset always exists. */
  providers(): ProviderConfig[] {
    const configured = new Map(
      this.providerConfigs.map((entry) => [entry.id, entry]),
    );
    const list = [...this.providerConfigs];
    if (!configured.has(MAGPIE_PROVIDER)) list.unshift(magpieConfig());
    else {
      const index = list.findIndex((entry) => entry.id === MAGPIE_PROVIDER);
      list[index] = magpieConfig(list[index]);
    }
    return list;
  }

  providerIds(): Set<string> {
    return new Set(this.providers().map((entry) => entry.id));
  }

  /** ModelInfo list for one provider; empty when it is not configured. */
  catalogFor(providerId: string): ModelInfo[] {
    const config = this.providers().find((entry) => entry.id === providerId);
    if (!config || !config.enabled) return [];
    return catalogForConfig(config, this.catalogs);
  }

  /** provider id → ModelInfo list for every enabled provider. */
  workerCatalogs(): Map<string, ModelInfo[]> {
    const catalogs = new Map<string, ModelInfo[]>();
    for (const config of this.providers())
      if (config.enabled)
        catalogs.set(config.id, catalogForConfig(config, this.catalogs));
    return catalogs;
  }

  /** Catalog + reachability status for the default model's provider. */
  catalogState(providerId = this.value.model.provider): ModelCatalog {
    const config = this.providers().find((entry) => entry.id === providerId);
    const status = this.status[providerId];
    if (config?.kind === 'builtin')
      return {
        ok: true,
        baseUrl: '',
        models: this.catalogFor(providerId),
      };
    return {
      ok: status?.ok ?? (this.catalogs[providerId]?.length ?? 0) > 0,
      baseUrl:
        config?.baseUrl ??
        (config?.id === MAGPIE_PROVIDER ? magpieBaseUrl() : ''),
      message: status?.message,
      models: this.catalogFor(providerId),
    };
  }

  setModel(model: SettingsInfo['model']): void {
    this.assertModel(model);
    this.value = {
      ...this.value,
      model: { provider: model.provider, modelId: model.modelId },
    };
    this.persist();
  }

  private assertModel(model: SettingsInfo['model']): void {
    if (!model.modelId.trim()) throw new Error('Invalid model');
    const provider = this.providers().find(
      (entry) => entry.id === model.provider,
    );
    if (!provider || !provider.enabled)
      throw new Error(`Unknown provider '${model.provider}'`);
  }

  /**
   * Provider CRUD. `providerConfigs` holds the user's configured list; the
   * magpie preset is merged in by `providers()` and survives removal only as
   * a disable.
   */
  private validateProviderConfig(
    config: ProviderConfig,
    existing: ReadonlySet<string>,
  ): void {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(config.id))
      throw new Error(
        `Invalid provider id '${config.id}' — use lowercase letters, digits, '-' or '_'`,
      );
    if (existing.has(config.id))
      throw new Error(`Provider '${config.id}' already exists`);
    if (config.id === MAGPIE_PROVIDER && config.kind !== 'gateway')
      throw new Error("The 'magpie' preset stays a gateway provider");
    if (config.kind === 'gateway') {
      const baseUrl =
        config.id === MAGPIE_PROVIDER
          ? (config.baseUrl ?? magpieBaseUrl())
          : config.baseUrl;
      try {
        const parsed = new URL(baseUrl ?? '');
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
          throw new Error();
      } catch {
        throw new Error(`Provider '${config.id}' needs an http(s) base URL`);
      }
    } else if (
      !getBuiltinProviders().includes(
        (config.builtinId ?? config.id) as BuiltinProvider,
      )
    )
      throw new Error(
        `Unknown built-in provider '${config.builtinId ?? config.id}'`,
      );
  }

  addProvider(config: ProviderConfig): void {
    this.validateProviderConfig(
      config,
      new Set(this.providerConfigs.map((entry) => entry.id)),
    );
    this.providerConfigs.push({ ...config, enabled: config.enabled ?? true });
    this.persist();
  }

  updateProvider(id: string, config: ProviderConfig): void {
    const index = this.providerConfigs.findIndex((entry) => entry.id === id);
    if (index < 0) {
      if (id !== MAGPIE_PROVIDER) throw new Error(`Unknown provider '${id}'`);
      // Updating the unset preset stores its override (e.g. enabled: false).
      this.providerConfigs.push(magpieConfig(config));
      this.persist();
      return;
    }
    const merged = { ...this.providerConfigs[index], ...config, id };
    if (id === MAGPIE_PROVIDER && merged.kind !== 'gateway')
      throw new Error("The 'magpie' preset stays a gateway provider");
    this.providerConfigs[index] = merged;
    this.persist();
  }

  /** Remove a provider's config; the magpie preset can only be disabled. */
  async removeProvider(id: string): Promise<void> {
    if (id === MAGPIE_PROVIDER)
      throw new Error("The 'magpie' preset cannot be removed — disable it");
    const index = this.providerConfigs.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error(`Unknown provider '${id}'`);
    if (
      this.value.model.provider === id ||
      this.value.managerModel?.provider === id
    )
      throw new Error(`Provider '${id}' is the selected model — switch first`);
    this.providerConfigs.splice(index, 1);
    delete this.catalogs[id];
    delete this.status[id];
    await this.credentials?.delete(id);
    this.persist();
  }

  /** Credential metadata for the providers page — never the secret itself. */
  async providerInfos(): Promise<
    Map<string, { hasKey: boolean; keyTail?: string; type: string }>
  > {
    const entries = await Promise.all(
      ((await this.credentials?.list()) ?? []).map(async (info) => {
        const credential = await this.credentials?.read(info.providerId);
        const secret =
          credential?.type === 'api_key'
            ? credential.key
            : credential?.type === 'oauth'
              ? credential.access
              : undefined;
        return [
          info.providerId,
          {
            hasKey: true,
            keyTail: secret ? `…${secret.slice(-4)}` : undefined,
            type: info.type,
          },
        ] as const;
      }),
    );
    return new Map(entries);
  }

  /**
   * Pull every enabled gateway's catalog. A failure keeps that provider's
   * previous catalog intact. Returns the default provider's catalog state —
   * the renderer-facing shape stays one catalog for now.
   */
  async refreshCatalog(): Promise<ModelCatalog> {
    await Promise.all(
      this.providers().map(async (config) => {
        if (config.kind !== 'gateway' || !config.enabled) return;
        const baseUrl =
          config.id === MAGPIE_PROVIDER
            ? (config.baseUrl ?? magpieBaseUrl())
            : config.baseUrl;
        if (!baseUrl) {
          this.status[config.id] = {
            ok: false,
            baseUrl: '',
            message: 'no base URL configured',
          };
          return;
        }
        try {
          const apiKey =
            config.id === MAGPIE_PROVIDER
              ? ((await this.credential(config.id)) ?? magpieApiKey())
              : await this.credential(config.id);
          const models = await fetchGatewayCatalog({ baseUrl, apiKey });
          if (models.length === 0)
            throw new Error('gateway returned no chat models');
          this.catalogs[config.id] = models;
          this.status[config.id] = { ok: true, baseUrl };
        } catch (error) {
          this.status[config.id] = {
            ok: false,
            baseUrl,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const current = this.catalogFor(this.value.model.provider);
    if (
      current.length > 0 &&
      !current.some((entry) => entry.id === this.value.model.modelId)
    )
      this.value.model.modelId = current[0].id;
    this.persist();
    return this.catalogState();
  }

  private async credential(providerId: string): Promise<string | undefined> {
    const credential = await this.credentials?.read(providerId);
    return credential?.type === 'api_key' ? credential.key : undefined;
  }

  /** The Models collection with every enabled provider registered. */
  models() {
    const models = createModels({ credentials: this.credentials });
    for (const config of this.providers()) {
      if (!config.enabled) continue;
      models.setProvider(
        providerForConfig(config, catalogForConfig(config, this.catalogs)),
      );
    }
    return models;
  }

  // ---- worker runtimes, concurrency, intents (M6) -------------------------

  /** The worker settings block as the Settings page shows it. */
  workerSettings(): WorkerSettingsInfo {
    const stored = this.workersValue;
    const caps = new Map(Object.entries(stored.runtimes ?? {}));
    caps.delete('pi');
    const runtimes: WorkerRuntimeInfo[] = [
      {
        id: 'pi',
        enabled: true,
        maxConcurrent: stored.runtimes?.pi?.maxConcurrent ?? null,
      },
    ];
    for (const [id, config] of caps)
      runtimes.push({
        id,
        enabled: config.enabled ?? false,
        maxConcurrent: config.maxConcurrent ?? null,
      });
    // Known external runtimes always appear in Settings, disabled until the
    // user switches them on; the service enables one only after its
    // installed-and-signed-in check passes (D21).
    for (const id of KNOWN_EXTERNAL_RUNTIMES)
      if (!runtimes.some((runtime) => runtime.id === id))
        runtimes.push({ id, enabled: false, maxConcurrent: null });
    return {
      maxConcurrent: stored.maxConcurrent ?? DEFAULT_MAX_ATTEMPTS,
      runtimes,
      intents: (stored.intents ?? []).map((intent) => ({ ...intent })),
    };
  }

  /** Live concurrency limits for the run orchestrator's gates. */
  workerLimits(): WorkerLimits {
    const workers = this.workerSettings();
    const runtimes: Record<string, number> = {};
    for (const runtime of workers.runtimes)
      if (runtime.enabled && runtime.maxConcurrent)
        runtimes[runtime.id] = runtime.maxConcurrent;
    return { global: workers.maxConcurrent, runtimes };
  }

  /** Runtimes a dispatch may name: pi plus every enabled external runtime. */
  enabledRuntimes(): Set<string> {
    return new Set(
      this.workerSettings()
        .runtimes.filter((runtime) => runtime.enabled)
        .map((runtime) => runtime.id),
    );
  }

  /** Throw unless `name` is a configured intent. */
  assertIntent(name: string): WorkerIntent {
    const intent = this.workerSettings().intents.find(
      (entry) => entry.name === name,
    );
    if (!intent) throw new Error(`Unknown intent '${name}'`);
    return intent;
  }

  /**
   * Replace the whole worker block: the global cap, per-runtime caps and
   * enable flags, and the intent list. Pi is always enabled; pi intents'
   * models validate against the provider catalogs, external models pass
   * through unvalidated (D13/D21).
   */
  setWorkers(info: WorkerSettingsInfo): void {
    if (
      !Number.isInteger(info.maxConcurrent) ||
      info.maxConcurrent < 1 ||
      info.maxConcurrent > 64
    )
      throw new Error('maxConcurrent must be an integer between 1 and 64');
    const runtimes: StoredWorkers['runtimes'] = {};
    const enabled = new Set<string>(['pi']);
    for (const runtime of info.runtimes) {
      if (!RUNTIME_ID.test(runtime.id))
        throw new Error(`invalid runtime id '${runtime.id}'`);
      if (runtime.id === 'pi' && runtime.enabled === false)
        throw new Error('runtime pi is always enabled');
      const cap = runtime.maxConcurrent ?? null;
      if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 64))
        throw new Error(
          `runtime '${runtime.id}' cap must be an integer between 1 and 64`,
        );
      runtimes[runtime.id] = {
        ...(runtime.id !== 'pi' ? { enabled: runtime.enabled } : {}),
        ...(cap !== null ? { maxConcurrent: cap } : {}),
      };
      if (runtime.id !== 'pi' && runtime.enabled) enabled.add(runtime.id);
    }
    const names = new Set<string>();
    const intents = info.intents.map((intent) => {
      const name = intent.name.trim();
      if (!INTENT_NAME.test(name))
        throw new Error(
          `invalid intent name '${intent.name}' — lowercase letters, digits, '-' and '_'`,
        );
      if (names.has(name)) throw new Error(`duplicate intent '${name}'`);
      names.add(name);
      if (!enabled.has(intent.runtime))
        throw new Error(
          `intent '${name}' uses disabled or unknown runtime '${intent.runtime}'`,
        );
      const model = intent.model?.trim() || null;
      const thinkingLevel = intent.thinkingLevel?.trim().toLowerCase() || null;
      if (intent.runtime === 'pi')
        resolveWorkerSpec(
          this.workerCatalogs(),
          this.value.model,
          model,
          thinkingLevel,
        );
      return {
        name,
        runtime: intent.runtime,
        model,
        thinkingLevel,
        ...(intent.purpose?.trim() ? { purpose: intent.purpose.trim() } : {}),
      };
    });
    this.workersValue = {
      maxConcurrent: info.maxConcurrent,
      runtimes,
      intents,
    };
    this.persist();
  }

  private persist(): void {
    atomicWrite(
      this.path,
      JSON.stringify(
        {
          ...this.value,
          providers: this.providerConfigs,
          catalogs: this.catalogs,
          workers: this.workersValue,
        },
        null,
        2,
      ),
    );
  }
}
