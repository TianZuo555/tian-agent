import { renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Publish a complete file; watchers never observe a partial write. */
export function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}
