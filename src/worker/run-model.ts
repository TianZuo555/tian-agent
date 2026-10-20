import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  THINKING_LEVELS,
  supportedThinkingLevels,
  type MagpieModelInfo,
} from './magpie.js';

/**
 * Per-run worker spec (D13): chief and manager may pin a run's model and
 * thinking level at dispatch. What they pass is validated against the Magpie
 * catalog here; the run row stores the request — model NULL follows the app
 * default, thinking level NULL the model's own default.
 */

export interface WorkerModelChoice {
  id: string;
  /** pi thinking levels this model accepts; empty = not a reasoning model. */
  levels: ModelThinkingLevel[];
  isDefault: boolean;
}

/** Catalog → the choice list tools show in <state>. */
export function workerModelChoices(
  models: MagpieModelInfo[],
  defaultId: string,
): WorkerModelChoice[] {
  return models.map((info) => ({
    id: info.id,
    levels: supportedThinkingLevels(info),
    isDefault: info.id === defaultId,
  }));
}

/** One state-block line, or null when the catalog is empty. */
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
 * Validate a dispatch's model / thinking_level against the catalog and return
 * what the run row stores. `model` is normalized (trimmed; '' = unset); a
 * `thinkingLevel` without a model is checked against the default model.
 * Throws with an agent-readable message on anything unsupported.
 */
export function resolveWorkerSpec(
  models: MagpieModelInfo[],
  defaultId: string,
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
  const targetId = wanted ?? defaultId;
  const info = models.find((entry) => entry.id === targetId);
  if (!info) {
    if (wanted)
      throw new Error(
        `unknown model '${wanted}' — available: ${
          models
            .map((entry) => entry.id)
            .slice(0, 20)
            .join(', ') || '(model catalog is empty)'
        }`,
      );
    throw new Error(
      `cannot check thinking level '${raw}' — model '${targetId}' is not in the current catalog`,
    );
  }
  if (raw) {
    const levels = supportedThinkingLevels(info);
    if (!levels.includes(raw))
      throw new Error(
        levels.length > 0
          ? `model '${targetId}' does not support thinking level '${raw}' — it takes: ${levels.join(', ')}`
          : `model '${targetId}' takes no thinking level (reasoning off)`,
      );
  }
  return { model: wanted, thinkingLevel: raw };
}
