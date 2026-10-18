import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createModels,
  type createProvider,
} from '@earendil-works/pi-ai/models';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { SettingsInfo } from '../shared/types.js';
import { atomicWrite } from './files.js';

const providers: Record<string, () => ReturnType<typeof createProvider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
};
const envNames: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
};
const defaults: Record<string, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  deepseek: 'deepseek-v4-pro',
};

export class Settings {
  private path: string;
  private value: SettingsInfo;
  constructor(userDataDir: string) {
    this.path = join(userDataDir, 'settings.json');
    const preferred: string[] = [];
    try {
      const authPath =
        process.env.HOME && join(process.env.HOME, '.pi/agent/auth.json');
      if (authPath && existsSync(authPath)) {
        const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
          string,
          { type?: string; key?: string }
        >;
        for (const [provider, names] of Object.entries(envNames)) {
          const entry = auth[provider];
          if (
            (entry?.type === 'api_key' || entry?.type === 'api-key') &&
            entry.key
          ) {
            for (const name of names) process.env[name] = entry.key;
            preferred.push(provider);
          }
        }
      }
    } catch {
      /* Credentials may also be supplied by the environment. */
    }
    const provider =
      [...preferred, ...Object.keys(providers)].find((name) =>
        envNames[name].some((env) => !!process.env[env]),
      ) ?? 'anthropic';
    this.value = { model: { provider, modelId: defaults[provider] } };
    try {
      if (existsSync(this.path)) {
        const saved = JSON.parse(
          readFileSync(this.path, 'utf8'),
        ) as SettingsInfo;
        if (
          Object.hasOwn(providers, saved.model?.provider) &&
          typeof saved.model.modelId === 'string' &&
          saved.model.modelId.trim()
        )
          this.value = saved;
      }
    } catch {
      /* A missing or malformed settings file uses defaults. */
    }
  }
  get(): SettingsInfo {
    return structuredClone(this.value);
  }
  setModel(model: SettingsInfo['model']): void {
    if (!Object.hasOwn(providers, model.provider) || !model.modelId.trim())
      throw new Error('Invalid provider or model');
    this.value = { model: { ...model } };
    atomicWrite(this.path, JSON.stringify(this.value, null, 2));
  }
  models() {
    const models = createModels();
    for (const make of Object.values(providers)) models.setProvider(make());
    return models;
  }
}
