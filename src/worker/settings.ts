import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai/models';
import type { SettingsInfo } from '../shared/types.js';
import { atomicWrite } from './files.js';
import {
  MAGPIE_DEFAULT_MODEL,
  MAGPIE_PROVIDER,
  fetchMagpieCatalog,
  magpieBaseUrl,
  magpieProvider,
  type MagpieModelInfo,
} from './magpie.js';

export interface ModelCatalog {
  models: MagpieModelInfo[];
  ok: boolean;
  baseUrl: string;
  message?: string;
}

/**
 * Settings own the model choice and the last known Magpie catalog. The catalog
 * is cached so the app still opens (and the picker still lists something) when
 * the gateway is not running.
 */
export class Settings {
  private path: string;
  private value: SettingsInfo;
  private catalog: MagpieModelInfo[] = [];
  private status: Omit<ModelCatalog, 'models'> = {
    ok: false,
    baseUrl: magpieBaseUrl(),
  };

  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'settings.json');
    this.value = {
      model: { provider: MAGPIE_PROVIDER, modelId: MAGPIE_DEFAULT_MODEL },
    };
    try {
      if (existsSync(this.path)) {
        const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<
          SettingsInfo & { catalog?: MagpieModelInfo[] }
        >;
        if (
          typeof saved.model?.modelId === 'string' &&
          saved.model.modelId.trim()
        )
          this.value = {
            model: {
              provider: MAGPIE_PROVIDER,
              modelId: saved.model.modelId,
            },
          };
        if (Array.isArray(saved.catalog)) this.catalog = saved.catalog;
      }
    } catch {
      /* A missing or malformed settings file uses defaults. */
    }
  }

  get(): SettingsInfo {
    return structuredClone(this.value);
  }

  catalogState(): ModelCatalog {
    return { ...this.status, models: structuredClone(this.catalog) };
  }

  setModel(model: SettingsInfo['model']): void {
    if (!model.modelId.trim()) throw new Error('Invalid model');
    this.value = {
      model: { provider: MAGPIE_PROVIDER, modelId: model.modelId },
    };
    this.persist();
  }

  /** Pull the gateway catalog. A failure keeps the previous catalog intact. */
  async refreshCatalog(): Promise<ModelCatalog> {
    try {
      const models = await fetchMagpieCatalog();
      if (models.length === 0)
        throw new Error('gateway returned no chat models');
      this.catalog = models;
      if (!models.some((model) => model.id === this.value.model.modelId))
        this.value.model.modelId = models[0].id;
      this.status = { ok: true, baseUrl: magpieBaseUrl() };
      this.persist();
    } catch (error) {
      this.status = {
        ok: false,
        baseUrl: magpieBaseUrl(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return this.catalogState();
  }

  models() {
    const models = createModels();
    models.setProvider(magpieProvider(this.catalog));
    return models;
  }

  private persist(): void {
    atomicWrite(
      this.path,
      JSON.stringify({ ...this.value, catalog: this.catalog }, null, 2),
    );
  }
}
