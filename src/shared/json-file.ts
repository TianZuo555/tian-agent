import { readFileSync } from 'node:fs';

/**
 * Read a JSON file whose shape this process wrote itself. A missing file,
 * invalid JSON, or a wrong top-level type is a corrupt installation rather
 * than a programming error, so it returns `null` and lets the caller fall
 * back to a safe default.
 */
export function readJsonFile<T>(
  path: string,
  isShape: (value: unknown) => value is T,
): T | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isShape(value) ? value : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow to a record whose listed keys have the given runtime type. */
export function hasKeys<K extends string>(
  value: unknown,
  keys: Record<K, 'string' | 'number' | 'boolean'>,
): value is Record<K, string | number | boolean> {
  if (!isRecord(value)) return false;
  return (Object.keys(keys) as K[]).every(
    (key) => typeof value[key] === keys[key],
  );
}
