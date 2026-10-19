import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from './memory.js';
import { planSearch, tokenCost } from './search.js';
import type { Db, ProjectRow } from './db.js';
import type { InboxItem } from '../shared/types.js';
import { atomicWrite } from './files.js';

export const GLOBAL_SCOPE = 'global';

/**
 * Scope directory layout (global scope root = <userData>/scopes/global,
 * project scope root = the project's rootPath):
 *   memory/        SQLite-backed memory (tian.db) + read-only MEMORY.md export + legacy/
 *   notes/         user-facing markdown
 *   .tian/inbox/   one .md file per message
 *   .tian/runs/    dispatch reports
 * Inbox read state and delivery records live in SQLite, keyed by message ID.
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

  forget(scopeId: string): void {
    this.memories.delete(scopeId);
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
      m = new MemoryStore(
        this.db,
        scopeId,
        join(this.ensureDirs(scopeId), 'memory'),
      );
      // Never cache a store whose initialization (legacy import, initial Core
      // selection, export) ran inside a transaction that may still roll back:
      // a cached object would outlive the rolled-back marker and later be
      // treated as pre-existing data. Callers that need a write inside
      // `Db.once` resolve the store first, so this path only serves defensive
      // use and the next call re-initializes from committed state.
      if (!this.db.inTransaction) this.memories.set(scopeId, m);
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

  /**
   * Keyword search over notes, with the same AND semantics as memory and
   * history: every whitespace-separated term must appear on the line
   * (case-insensitive substring). Results are bounded and addressable as
   * `file.md:<line>`, which read_note can open directly.
   */
  searchNotes(scopeId: string, query: string, limit = 40): string {
    // Same query planning as memory and history: whitespace terms, all of them
    // required (AND), matched case-insensitively per line.
    const plan = planSearch(query);
    if (plan.terms.length === 0)
      throw new Error('search query cannot be empty');
    const terms = plan.terms.map((term) => term.toLowerCase());
    const bounded = Math.min(Math.max(limit, 1), 100);
    const SNIPPET_BUDGET = 160;
    const hits: string[] = [];
    let more = 0;
    for (const file of this.listNotes(scopeId)) {
      if (more > 0) break;
      const lines = readFileSync(
        join(this.notesDir(scopeId), file),
        'utf8',
      ).split('\n');
      lines.forEach((line, index) => {
        const lower = line.toLowerCase();
        if (!terms.every((term) => lower.includes(term))) return;
        if (hits.length >= bounded) {
          more++;
          return;
        }
        const text = line.trim();
        let snippet = [...text].slice(0, 400).join('');
        if (tokenCost(snippet) > SNIPPET_BUDGET) {
          const chars = [...snippet];
          let end = chars.length;
          while (
            end > 1 &&
            tokenCost(chars.slice(0, end).join('')) > SNIPPET_BUDGET
          )
            end--;
          snippet = `${chars.slice(0, end).join('')}…`;
        }
        hits.push(`${file}:${index + 1}: ${snippet}`);
      });
    }
    if (hits.length === 0) return '(no matches)';
    return more > 0
      ? `${hits.join('\n')}\n… more matches; narrow the query`
      : hits.join('\n');
  }

  /** Read one note, or a bounded window around a `file.md:<line>` hit. */
  readNoteWindow(scopeId: string, ref: string): string {
    const match = /^(.*?):(\d+)$/.exec(ref.trim());
    if (!match) return this.readNote(scopeId, ref);
    const [, name, rawLine] = match;
    const line = Number.parseInt(rawLine, 10);
    const lines = this.readNote(scopeId, name).split('\n');
    const at = Math.min(Math.max(line - 1, 0), lines.length - 1);
    const from = Math.max(0, at - 20);
    const to = Math.min(lines.length, at + 21);
    return [
      `${name}:${from + 1}-${to}`,
      ...lines
        .slice(from, to)
        .map((text, index) => `${from + index + 1}: ${text}`),
    ].join('\n');
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
    messageId?: string,
  ): string {
    const dir = this.inboxDir(scopeId);
    const ts = new Date().toISOString();
    const id =
      messageId ??
      `${ts.replace(/[:.]/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
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
    atomicWrite(join(dir, `${id}.md`), front + body);
    return id;
  }

  listMessages(scopeId: string): InboxItem[] {
    const dir = this.inboxDir(scopeId);
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()) {
      let raw: string;
      try {
        raw = readFileSync(join(dir, file), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
      const meta: Record<string, string> = {};
      if (match)
        for (const line of match[1].split(/\r?\n/)) {
          const index = line.indexOf(':');
          if (index > 0)
            meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
        }
      this.db.importMessage(scopeId, {
        id: meta.id || file.replace(/\.md$/, ''),
        from: meta.from || '?',
        to: meta.to || '',
        ts: meta.ts || file.slice(0, 20),
        thread: meta.thread || '',
        body: match ? match[2] : raw,
        read: false,
      });
    }
    return this.db.listMessages(scopeId);
  }

  unreadMessages(scopeId: string): InboxItem[] {
    return this.listMessages(scopeId).filter((message) => !message.read);
  }

  markInboxRead(scopeId: string, ids: string[]): void {
    this.db.markMessagesRead(scopeId, ids);
  }

  runsDir(scopeId: string): string {
    return join(this.ensureDirs(scopeId), '.tian', 'runs');
  }
}
