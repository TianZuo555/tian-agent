// Provider registry (D21): every configured provider becomes a pi Provider at
// startup. Gateway providers are OpenAI-compatible endpoints whose catalog is
// discovered and cached; built-in providers come from the pi-ai catalog. The
// Magpie gateway is a preset entry — its MAGPIE_* environment variables stay a
// compatibility input for one release; every other provider resolves auth only
// from the credential store (the 0600 file), so no secret ever travels through
// the process environment.
import type { Provider } from '@earendil-works/pi-ai';
import {
  builtinProviders,
  getBuiltinModels,
  getBuiltinProviders,
  type BuiltinProvider,
} from '@earendil-works/pi-ai/providers/all';
import type { ModelInfo, ProviderConfig } from '../shared/types.js';
import {
  MAGPIE_PROVIDER,
  THINKING_LEVELS,
  gatewayProvider,
  magpieApiKey,
  magpieBaseUrl,
} from './magpie.js';

/** The magpie preset, resolved from settings + MAGPIE_* environment. */
export function magpieConfig(config?: ProviderConfig): ProviderConfig {
  return {
    id: MAGPIE_PROVIDER,
    kind: 'gateway',
    name: config?.name ?? 'Magpie',
    baseUrl: config?.baseUrl ?? magpieBaseUrl(),
    enabled: config?.enabled ?? true,
  };
}

/**
 * Build the pi Provider for one config. `catalog` is the provider's cached or
 * generated ModelInfo list. The api-key resolver prefers the credential store
 * (pi-ai passes the stored credential into resolve); the magpie environment
 * default stays as the compatibility fallback for the preset only.
 */
export function providerForConfig(
  config: ProviderConfig,
  catalog: ModelInfo[],
): Provider {
  if (config.kind === 'builtin') {
    const provider = builtinProviders().find(
      (entry) => entry.id === (config.builtinId ?? config.id),
    );
    if (!provider) throw new Error(`unknown built-in provider '${config.id}'`);
    if (provider.id === config.id) return provider;
    // Auth resolves against this id; catalog models must use the same id.
    return {
      ...provider,
      id: config.id,
      name: config.name ?? provider.name,
      getModels: () =>
        provider
          .getModels()
          .map((model) => ({ ...model, provider: config.id })),
      getAllModels: () =>
        (provider.getAllModels?.() ?? provider.getModels()).map((model) => ({
          ...model,
          provider: config.id,
        })),
    };
  }
  return gatewayProvider(
    {
      id: config.id,
      name: config.name ?? config.id,
      baseUrl: config.baseUrl,
      resolveKey: (credential) =>
        credential?.type === 'api_key'
          ? credential.key
          : config.id === MAGPIE_PROVIDER
            ? magpieApiKey()
            : undefined,
    },
    catalog,
  );
}

/** The pi-ai catalog of chat models for a built-in provider, as ModelInfo. */
export function builtinCatalog(builtinId: string): ModelInfo[] {
  return getBuiltinModels(builtinId as BuiltinProvider).map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    levels: model.thinkingLevelMap
      ? THINKING_LEVELS.filter(
          (level) => model.thinkingLevelMap![level] !== null,
        )
      : model.reasoning
        ? [...THINKING_LEVELS]
        : [],
    input: model.input.map((entry) =>
      entry === 'image' ? 'image' : 'text',
    ) as ('text' | 'image')[],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));
}

/** ModelInfo list for a config: built-ins generate it, gateways read cache. */
export function catalogForConfig(
  config: ProviderConfig,
  catalogs: Record<string, ModelInfo[]>,
): ModelInfo[] {
  if (config.kind === 'builtin')
    return builtinCatalog(config.builtinId ?? config.id);
  return catalogs[config.id] ?? [];
}

/** Every provider id pi-ai ships a built-in catalog for. */
export function builtinProviderIds(): string[] {
  return getBuiltinProviders();
}

/**
 * Split 'provider:model' into its parts. A bare model id resolves against the
 * default provider. A prefix that is not a configured provider id is part of
 * the model id itself (fine-tuned ids contain ':').
 */
export function parseModelRef(
  ref: string,
  providerIds: ReadonlySet<string>,
  defaultProvider: string,
): { provider: string; modelId: string } {
  const index = ref.indexOf(':');
  if (index > 0) {
    const prefix = ref.slice(0, index);
    if (providerIds.has(prefix))
      return { provider: prefix, modelId: ref.slice(index + 1) };
  }
  return { provider: defaultProvider, modelId: ref };
}
