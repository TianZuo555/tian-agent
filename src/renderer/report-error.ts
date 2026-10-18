const recent = new Map<string, number>();
const WINDOW_MS = 30_000;

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/**
 * Best-effort renderer issue capture. The service dedupes by fingerprint, but
 * a broken render loop can fire the same error hundreds of times per second,
 * so throttle locally before crossing the IPC boundary.
 */
export function reportClientError(
  area: string,
  error: unknown,
  extra = '',
): void {
  const message = messageOf(error).trim() || area;
  const key = `${area}:${message}`;
  const now = Date.now();
  const seen = recent.get(key);
  if (seen !== undefined && seen > now - WINDOW_MS) return;
  recent.set(key, now);
  if (recent.size > 100) {
    for (const [entry, at] of recent)
      if (at <= now - WINDOW_MS) recent.delete(entry);
  }
  const detail = [error instanceof Error ? error.stack : '', extra.trim()]
    .filter(Boolean)
    .join('\n');
  try {
    void window.tian
      ?.reportClientIssue(message.slice(0, 300), detail.slice(0, 20_000))
      .catch(() => {});
  } catch {
    // The service may not be available while the window is booting.
  }
}
