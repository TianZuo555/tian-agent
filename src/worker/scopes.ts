import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from './memory.js';
import type { Db, ProjectRow } from './db.js';

export const GLOBAL_SCOPE = 'global';

/**
 * Scope directory layout (global scope root = <userData>/scopes/global,
 * project scope root = the project's rootPath):
 *   memory/        OptMem-format memory
 *   notes/         user-facing markdown
 *   .tian/inbox/   one .md file per message
 *   .tian/runs/    dispatch reports
 *   .tian/inbox/.read  timestamp of last read (file-based, agent-accessible)
 */
export class Scopes {
  private memories = new Map<string, MemoryStore>();

  constructor(
    private globalDir: string,
    private db: Db,
  ) {
    mkdirSync(globalDir, { recursive: true });
  }

  /** Throw if scopeId is unknown. */
  root(scopeId: string): string {
    if (scopeId === GLOBAL_SCOPE) return this.globalDir;
    const p = this.db.getProject(scopeId) ?? this.db.projectByName(scopeId);
    if (!p) throw new Error(`unknown scope: ${scopeId}`);
    return p.rootPath;
  }

  scopeIdFor(input: string | undefined, fallback: string): string {
    if (!input || input === GLOBAL_SCOPE)
      return fallback === GLOBAL_SCOPE ? GLOBAL_SCOPE : (input ?? fallback);
    const p = this.db.getProject(input) ?? this.db.projectByName(input);
    return p ? p.id : input;
  }

  project(scopeId: string): ProjectRow | undefined {
    return scopeId === GLOBAL_SCOPE ? undefined : this.db.getProject(scopeId);
  }

  ensureDirs(scopeId: string): string {
    const root = this.root(scopeId);
    for (const d of ['memory', 'notes', '.tian/inbox', '.tian/runs']) {
      mkdirSync(join(root, d), { recursive: true });
    }
    return root;
  }

  memory(scopeId: string): MemoryStore {
    let m = this.memories.get(scopeId);
    if (!m) {
      m = new MemoryStore(join(this.ensureDirs(scopeId), 'memory'));
      this.memories.set(scopeId, m);
    }
    return m;
  }

  notesDir(scopeId: string): string {
    return join(this.ensureDirs(scopeId), 'notes');
  }

  listNotes(scopeId: string): string[] {
    const dir = this.notesDir(scopeId);
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  }

  readNote(scopeId: string, name: string): string {
    const p = this.notePath(scopeId, name);
    if (!existsSync(p)) throw new Error(`no note ${name} in scope ${scopeId}`);
    return readFileSync(p, 'utf8');
  }

  writeNote(scopeId: string, name: string, content: string): void {
    writeFileSync(this.notePath(scopeId, name), content, 'utf8');
  }

  appendNote(scopeId: string, name: string, content: string): void {
    appendFileSync(
      this.notePath(scopeId, name),
      content.endsWith('\n') ? content : content + '\n',
      'utf8',
    );
  }

  private notePath(scopeId: string, name: string): string {
    const safe = name.replace(/[/\\]/g, '_');
    if (!safe.endsWith('.md'))
      return join(this.notesDir(scopeId), `${safe}.md`);
    return join(this.notesDir(scopeId), safe);
  }

  searchNotes(scopeId: string, pattern: string): string {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      throw new Error(`bad regex: ${pattern}`);
    }
    const hits: string[] = [];
    for (const f of this.listNotes(scopeId)) {
      const lines = readFileSync(join(this.notesDir(scopeId), f), 'utf8').split(
        '\n',
      );
      lines.forEach((l, i) => {
        if (re.test(l)) hits.push(`${f}:${i + 1}: ${l}`);
      });
    }
    return hits.length === 0 ? '(no matches)' : hits.slice(0, 100).join('\n');
  }

  // ---- inbox (file-based: .tian/inbox/<ts>-<rand>.md, read marker .tian/inbox/.read)

  private inboxDir(scopeId: string): string {
    return join(this.ensureDirs(scopeId), '.tian', 'inbox');
  }

  sendMessage(
    scopeId: string,
    from: string,
    body: string,
    to?: string,
    thread?: string,
  ): string {
    const dir = this.inboxDir(scopeId);
    const ts = new Date().toISOString();
    const id = `${ts.replace(/[:.]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
    const front = [
      `---`,
      `from: ${from}`,
      `to: ${to ?? ''}`,
      `ts: ${ts}`,
      `thread: ${thread ?? ''}`,
      `id: ${id}`,
      `---`,
      ``,
    ].join('\n');
    writeFileSync(join(dir, `${id}.md`), front + body, 'utf8');
    return id;
  }

  listMessages(scopeId: string): {
    id: string;
    from: string;
    to: string;
    ts: string;
    thread: string;
    body: string;
    read: boolean;
  }[] {
    const dir = this.inboxDir(scopeId);
    const readMarker = join(dir, '.read');
    const lastRead = existsSync(readMarker) ? statSync(readMarker).mtimeMs : 0;
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => {
        const raw = readFileSync(join(dir, f), 'utf8');
        const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
        const meta: Record<string, string> = {};
        if (m)
          for (const line of m[1].split('\n')) {
            const i = line.indexOf(':');
            if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
          }
        const body = m ? m[2] : raw;
        return {
          id: meta.id ?? f.replace(/\.md$/, ''),
          from: meta.from ?? '?',
          to: meta.to ?? '',
          ts: meta.ts ?? f.slice(0, 20),
          thread: meta.thread ?? '',
          body,
          read: statSync(join(dir, f)).mtimeMs <= lastRead,
        };
      });
  }

  unreadMessages(scopeId: string) {
    return this.listMessages(scopeId).filter((m) => !m.read);
  }

  markInboxRead(scopeId: string): void {
    const marker = join(this.inboxDir(scopeId), '.read');
    writeFileSync(marker, new Date().toISOString(), 'utf8');
  }

  runsDir(scopeId: string): string {
    return join(this.ensureDirs(scopeId), '.tian', 'runs');
  }
}
