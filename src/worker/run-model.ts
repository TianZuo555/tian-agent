import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { ModelInfo } from '../shared/types.js';
import { THINKING_LEVELS, supportedThinkingLevels } from './magpie.js';
import { parseModelRef } from './providers.js';

/**
 * Per-run worker spec (D13): a manager may pin a run's model and thinking
 * level at dispatch. Pins resolve against the enabled providers' catalogs —
 * 'provider:model' selects a provider, a bare id the default provider. The run
 * row stores the pin (qualified only when it names a non-default provider);
 * model NULL follows the app default, thinking level NULL the model's own.
 */

export interface WorkerModelChoice {
  /** The token a dispatcher passes back: 'model' or 'provider:model'. */
  id: string;
  provider: string;
  /** pi thinking levels this model accepts; empty = not a reasoning model. */
  levels: ModelThinkingLevel[];
  isDefault: boolean;
}

/** Catalogs → the choice list tools show in <state>. */
export function workerModelChoices(
  catalogs: ReadonlyMap<string, ModelInfo[]>,
  defaults: { provider: string; modelId: string },
): WorkerModelChoice[] {
  const choices: WorkerModelChoice[] = [];
  for (const [provider, models] of catalogs) {
    for (const info of models) {
      choices.push({
        id: provider === defaults.provider ? info.id : `${provider}:${info.id}`,
        provider,
        levels: supportedThinkingLevels(info),
        isDefault:
          provider === defaults.provider && info.id === defaults.modelId,
      });
    }
  }
  return choices;
}

/** One state-block line, or null when every catalog is empty. */
export function workerModelLine(choices: WorkerModelChoice[]): string | null {
  if (choices.length === 0) return null;
  return `worker models: ${choices
    .slice(0, 12)
    .map(
      (choice) =>
        `${choice.id}${choice.isDefault ? ' (default)' : ''}${
          choice.levels.length > 0
            ? ` [think: ${choice.levels.join('/')}]`
            : ' [no thinking]'
        }`,
    )
    .join(', ')}`;
}

const isThinkingLevel = (value: string): value is ModelThinkingLevel =>
  (THINKING_LEVELS as string[]).includes(value);

/**
 * Validate a dispatch's model / thinking level against the catalogs and
 * return what the run row stores. `model` accepts 'provider:model' or a bare
 * id (default provider); a `thinkingLevel` without a model is checked against
 * the default model. Throws with an agent-readable message on anything
 * unsupported.
 */
export function resolveWorkerSpec(
  catalogs: ReadonlyMap<string, ModelInfo[]>,
  defaults: { provider: string; modelId: string },
  model?: string | null,
  thinkingLevel?: string | null,
): { model: string | null; thinkingLevel: string | null } {
  const wanted = model?.trim() || null;
  const normalized = thinkingLevel?.trim().toLowerCase() || null;
  let raw: ModelThinkingLevel | null = null;
  if (normalized) {
    if (!isThinkingLevel(normalized))
      throw new Error(
        `unknown thinking level '${thinkingLevel}' — use one of: ${THINKING_LEVELS.join(', ')}`,
      );
    raw = normalized;
  }
  if (!wanted && !raw) return { model: null, thinkingLevel: null };
  const target = wanted
    ? parseModelRef(wanted, new Set(catalogs.keys()), defaults.provider)
    : { provider: defaults.provider, modelId: defaults.modelId };
  const models = catalogs.get(target.provider) ?? [];
  const info = models.find((entry) => entry.id === target.modelId);
  if (!info) {
    if (wanted)
      throw new Error(
        `unknown model '${wanted}' — available: ${
          [...catalogs]
            .flatMap(([provider, entries]) =>
              entries.map(
                (entry) =>
                  `${provider === defaults.provider ? '' : `${provider}:`}${entry.id}`,
              ),
            )
            .slice(0, 20)
            .join(', ') || '(model catalog is empty)'
        }`,
      );
    throw new Error(
      `cannot check thinking level '${raw}' — model '${target.modelId}' is not in the current catalog`,
    );
  }
  if (raw) {
    const levels = supportedThinkingLevels(info);
    if (!levels.includes(raw))
      throw new Error(
        levels.length > 0
          ? `model '${wanted ?? target.modelId}' does not support thinking level '${raw}' — it takes: ${levels.join(', ')}`
          : `model '${wanted ?? target.modelId}' takes no thinking level (reasoning off)`,
      );
  }
  return {
    model:
      wanted === null
        ? null
        : target.provider === defaults.provider
          ? target.modelId
          : `${target.provider}:${target.modelId}`,
    thinkingLevel: raw,
  };
}
