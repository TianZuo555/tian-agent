// Magpie provider: a local OpenAI-compatible gateway that fronts every model
// the app can talk to. Models are discovered from GET /v1/models at startup and
// mapped into pi-ai model descriptors; anything the gateway does not expose
// stays out of the picker.
import { createProvider, type Provider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type {
  Model,
  ModelThinkingLevel,
  OpenAICompletionsCompat,
  ThinkingLevelMap,
} from '@earendil-works/pi-ai';

export const MAGPIE_PROVIDER = 'magpie';
export const MAGPIE_DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1';
export const MAGPIE_DEFAULT_MODEL = 'workbuddy-ai/deepseek-v4.1-flash';

export interface MagpieModelInfo {
  id: string;
  name: string;
  reasoning: boolean;
  /** Raw effort names the gateway accepts, e.g. ['low', 'high', 'max']. */
  levels: string[];
  input: ('text' | 'image')[];
  contextWindow: number;
  maxTokens: number;
}

interface MagpieModelPayload {
  id?: unknown;
  display_name?: unknown;
  magpie_label?: unknown;
  reasoning?: unknown;
  reasoning_levels?: unknown;
  context_window?: unknown;
  context_length?: unknown;
  max_output_tokens?: unknown;
  max_input_tokens?: unknown;
  modalities?: { input?: unknown };
  native_endpoints?: unknown;
}

export function magpieBaseUrl(): string {
  return (
    process.env.MAGPIE_BASE_URL?.trim() || MAGPIE_DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
}

export function magpieApiKey(): string {
  return process.env.MAGPIE_API_KEY?.trim() || 'magpie';
}

const THINKING_LEVELS: ModelThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Map the gateway's effort names onto pi's thinking levels. */
function thinkingLevelMap(levels: string[]): ThinkingLevelMap {
  const map: ThinkingLevelMap = {};
  for (const level of THINKING_LEVELS) map[level] = null;
  for (const raw of levels) {
    const level = raw === 'none' ? 'off' : raw;
    if ((THINKING_LEVELS as string[]).includes(level)) {
      map[level as ModelThinkingLevel] = raw;
    }
  }
  return map;
}

function supportsCompletions(model: MagpieModelPayload): boolean {
  const endpoints = model.native_endpoints;
  if (!Array.isArray(endpoints) || endpoints.length === 0) return true;
  return endpoints.includes('/v1/chat/completions');
}

function toModelInfo(model: MagpieModelPayload): MagpieModelInfo | null {
  if (typeof model.id !== 'string' || !model.id) return null;
  if (!supportsCompletions(model)) return null;
  const modalities = model.modalities?.input;
  const input = Array.isArray(modalities)
    ? modalities.filter(
        (m): m is 'text' | 'image' => m === 'text' || m === 'image',
      )
    : (['text'] as const);
  const contextWindow =
    typeof model.context_window === 'number'
      ? model.context_window
      : typeof model.context_length === 'number'
        ? model.context_length
        : 128_000;
  const maxTokens =
    typeof model.max_output_tokens === 'number'
      ? model.max_output_tokens
      : Math.min(contextWindow, 32_000);
  const levels = Array.isArray(model.reasoning_levels)
    ? model.reasoning_levels.filter((l): l is string => typeof l === 'string')
    : [];
  return {
    id: model.id,
    name:
      (typeof model.display_name === 'string' && model.display_name) ||
      (typeof model.magpie_label === 'string' && model.magpie_label) ||
      model.id,
    reasoning: model.reasoning === true,
    levels,
    input: input.length > 0 ? [...input] : ['text'],
    contextWindow,
    maxTokens,
  };
}

/** Fetch the gateway catalog. Throws when Magpie is not reachable. */
export async function fetchMagpieCatalog(
  signal?: AbortSignal,
): Promise<MagpieModelInfo[]> {
  const response = await fetch(`${magpieBaseUrl()}/models`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${magpieApiKey()}`,
    },
    signal: signal ?? AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Magpie /models returned ${response.status}`);
  }
  const body = (await response.json()) as { data?: MagpieModelPayload[] };
  const seen = new Set<string>();
  const models: MagpieModelInfo[] = [];
  for (const entry of body.data ?? []) {
    const info = toModelInfo(entry);
    if (!info || seen.has(info.id)) continue;
    seen.add(info.id);
    models.push(info);
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

function toPiModel(info: MagpieModelInfo): Model<'openai-completions'> {
  const baseUrl = magpieBaseUrl();
  return {
    id: info.id,
    name: info.name,
    api: 'openai-completions',
    provider: MAGPIE_PROVIDER,
    baseUrl,
    reasoning: info.reasoning,
    thinkingLevelMap: thinkingLevelMap(info.levels),
    input: info.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      sendSessionAffinityHeaders: true,
    } satisfies OpenAICompletionsCompat,
  };
}

/** Build a pi provider that talks to the local Magpie gateway. */
export function magpieProvider(
  catalog: MagpieModelInfo[],
): Provider<'openai-completions'> {
  return createProvider<'openai-completions'>({
    id: MAGPIE_PROVIDER,
    name: 'Magpie',
    baseUrl: magpieBaseUrl(),
    auth: {
      apiKey: {
        name: 'Magpie gateway',
        resolve: async () => ({ auth: { apiKey: magpieApiKey() } }),
      },
    },
    models: catalog.map(toPiModel),
    api: openAICompletionsApi(),
  });
}
