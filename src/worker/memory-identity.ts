export interface MemoryIdentity {
  content: string;
  conditions?: string;
  validUntil?: string | null;
}

export interface MemoryReplacement extends MemoryIdentity {
  seq: number;
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

export function normalizeConditions(
  conditions: string | null | undefined = '',
): string {
  const value = normalizeWhitespace(conditions ?? '');
  if ([...value].length > 300)
    throw new Error('Conditions must be at most 300 characters');
  return value;
}

/** Dates use UTC midnight; timestamps require an explicit UTC offset. */
export function normalizeValidUntil(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (
    !dateOnly &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      text,
    )
  )
    throw new Error(
      'validUntil must be an ISO date or a timestamp with a UTC offset',
    );
  const timestamp = Date.parse(dateOnly ? `${text}T00:00:00.000Z` : text);
  const [year, month, day] = text.slice(0, 10).split('-').map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(timestamp) ||
    calendarDay.getUTCFullYear() !== year ||
    calendarDay.getUTCMonth() !== month - 1 ||
    calendarDay.getUTCDate() !== day
  )
    throw new Error('validUntil must be a valid ISO date');
  return new Date(timestamp).toISOString();
}

/** Classification is metadata; wording, conditions, and validity identify a fact. */
export function memoryIdentityKey(memory: MemoryIdentity): string {
  return JSON.stringify([
    normalizeWhitespace(memory.content),
    normalizeConditions(memory.conditions),
    normalizeValidUntil(memory.validUntil),
  ]);
}

/** Scope and case are significant; JSON avoids ambiguous separator joins. */
export function memoryDismissalKey(
  scopeId: string,
  memory: MemoryIdentity,
): string {
  return `dismissed:v2:${JSON.stringify([scopeId, memoryIdentityKey(memory)])}`;
}
