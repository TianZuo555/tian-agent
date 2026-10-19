/**
 * Shared query planning for the derived search indexes (Memory, History,
 * Notes). One implementation keeps trigram FTS, short-term LIKE fallbacks and
 * multi-word AND semantics identical everywhere instead of three variants.
 */

export interface SearchPlan {
  /** Every whitespace-separated term, in query order. */
  terms: string[];
  /** Terms of at least 3 code points: trigram FTS can match these. */
  long: string[];
  /** Terms shorter than 3 code points: LIKE substring matching only. */
  short: string[];
  /** FTS5 MATCH expression for the long terms, or null when none qualify. */
  match: string | null;
}

export const codePointLength = (value: string): number => [...value].length;

export const escapeLike = (value: string): string =>
  value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);

/** Split a user query into terms and decide how each can be matched. */
export function planSearch(query: string): SearchPlan {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const long = terms.filter((term) => codePointLength(term) >= 3);
  const short = terms.filter((term) => codePointLength(term) < 3);
  return {
    terms,
    long,
    short,
    match:
      long.length > 0
        ? long.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ')
        : null,
  };
}

/** Estimated tokens for budgeted output: ceil(UTF-8 bytes / 3). */
export const tokenCost = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 3);

/** A code-point page, so astral characters never split across pages. */
export function pageText(
  text: string,
  offset: number,
  limit: number,
): { page: string; offset: number; next: number | null; total: number } {
  const chars = [...text];
  const start = Math.min(Math.max(offset, 0), chars.length);
  const end = Math.min(start + Math.max(limit, 1), chars.length);
  return {
    page: chars.slice(start, end).join(''),
    offset: start,
    next: end < chars.length ? end : null,
    total: chars.length,
  };
}
