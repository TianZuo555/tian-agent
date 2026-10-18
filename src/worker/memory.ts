import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Db } from './db.js';
import { atomicWrite } from './files.js';
import type {
  MemoryDump,
  MemoryItem,
  MemoryNodeInfo,
} from '../shared/types.js';

/**
 * SQLite-backed memory with provenance, versions, and the aligned dyadic
 * summary tree (D4). The database is the only source of truth; files in
 * the scope's memory directory are a one-way read-only export for workers and
 * humans, plus the legacy LOG.txt/TREE import source.
 *
 * Tree rules carried over from the OptMem file implementation:
 * - Nodes cover aligned dyadic intervals of immutable per-scope `seq` values;
 *   node lo-hi (size 2^k) covers children lo-mid and mid+1-hi, leaves two seqs.
 * - A merge becomes due when a node is missing (or stale) and both halves
 *   exist; merges are offered one at a time, smallest intervals first.
 * - Superseding or deleting a memory marks every covering node stale; stale
 *   nodes count as missing (they get re-summarized) and are skipped by wake.
 * - A concurrent nap never overwrites an existing non-stale node.
 * - A due range with zero active memories is summarized automatically as an
 *   empty marker, without a model call, and wake omits it.
 * - Candidate memories (auto-extracted by the memory worker, PRD §4.4 F03)
 *   occupy seq slots but never render in wake, never feed merge sources, and
 *   stay out of the export; ranges holding only candidates are auto-marked
 *   as empty nodes, and promoting one re-stales the covering nodes.
 */

export type MemoryKind =
  | 'preference'
  | 'fact'
  | 'decision'
  | 'outcome'
  | 'environment';
export type MemoryStatus = 'active' | 'candidate' | 'superseded' | 'deleted';
export type MemorySourceType =
  | 'user'
  | 'agent'
  | 'tool'
  | 'external'
  | 'legacy';
export type MemoryTrustLevel =
  | 'user_confirmed'
  | 'agent_inferred'
  | 'third_party';
export type MemoryActor = 'chief' | 'user' | 'worker' | 'migration';
export type MemoryAction =
  | 'create'
  | 'promote'
  | 'supersede'
  | 'delete'
  | 'restore'
  | 'import';

export interface MemoryRow {
  id: string;
  scopeId: string;
  /** Per-scope, immutable, 0-based; also the summary-tree leaf index. */
  seq: number;
  goalId: string | null;
  kind: MemoryKind;
  content: string;
  sourceType: MemorySourceType;
  sourceRef: string | null;
  trustLevel: MemoryTrustLevel;
  confidence: number | null;
  status: MemoryStatus;
  supersededBy: string | null;
  /** For a candidate: the active seq it will replace when promoted. */
  supersedes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MergeDue {
  lo: number;
  hi: number;
  /** The text the model should compress: child summaries, or active raw lines. */
  source: string;
}

export interface RememberInput {
  text: string;
  kind?: MemoryKind;
  sourceType?: MemorySourceType;
  sourceRef?: string | null;
  trustLevel?: MemoryTrustLevel;
  confidence?: number | null;
  goalId?: string | null;
  actor?: MemoryActor;
  reason?: string | null;
}

/** Summary written for a due range with zero active memories; wake omits it. */
export const EMPTY_NODE = '(empty)';
const MAX_BYTES = 280;

const toMemory = (value: Record<string, unknown>): MemoryRow => ({
  id: value.id as string,
  scopeId: value.scope_id as string,
  seq: Number(value.seq),
  goalId: (value.goal_id as string | null) ?? null,
  kind: value.kind as MemoryKind,
  content: value.content as string,
  sourceType: value.source_type as MemorySourceType,
  sourceRef: (value.source_ref as string | null) ?? null,
  trustLevel: value.trust_level as MemoryTrustLevel,
  confidence: (value.confidence as number | null) ?? null,
  status: value.status as MemoryStatus,
  supersededBy: (value.superseded_by as string | null) ?? null,
  supersedes:
    value.supersedes === null || value.supersedes === undefined
      ? null
      : Number(value.supersedes),
  createdAt: value.created_at as string,
  updatedAt: value.updated_at as string,
});

const schemaReady = new WeakSet<object>();
function ensureSchema(db: Db): void {
  if (schemaReady.has(db.sqlite)) return;
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, seq INTEGER NOT NULL, goal_id TEXT,
      kind TEXT NOT NULL, content TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT,
      trust_level TEXT NOT NULL, confidence REAL, status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT, supersedes INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(scope_id, seq)
    );
    CREATE INDEX IF NOT EXISTS memories_scope_status ON memories(scope_id, status);
    CREATE TABLE IF NOT EXISTS memory_versions (
      memory_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT,
      before TEXT, after TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_nodes (
      scope_id TEXT NOT NULL, lo INTEGER NOT NULL, hi INTEGER NOT NULL,
      summary TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, lo, hi)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content, mem_id UNINDEXED, tokenize='trigram'
    );
  `);
  // Databases created before candidates existed gain the supersedes column.
  const columns = db.sqlite.prepare('PRAGMA table_info(memories)').all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === 'supersedes'))
    db.sqlite.exec('ALTER TABLE memories ADD COLUMN supersedes INTEGER');
  schemaReady.add(db.sqlite);
}

/** One memory line: single-line, non-empty, at most 280 UTF-8 bytes. */
function normalizeLine(text: string, what: string): string {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) throw new Error(`${what} must contain at least 1 UTF-8 byte`);
  if (Buffer.byteLength(body, 'utf8') > MAX_BYTES)
    throw new Error(`${what} must be at most ${MAX_BYTES} UTF-8 bytes`);
  return body;
}

function highestPow2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

const tokenCost = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, 'utf8') / 3);

const newId = () => `mem-${randomUUID()}`;

interface NodeRow {
  lo: number;
  hi: number;
  summary: string;
  stale: number;
}

export class MemoryStore {
  private versionCounter = 0;

  constructor(
    private db: Db,
    readonly scopeId: string,
    readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
    ensureSchema(db);
    this.migrateLegacy();
    this.versionCounter = this.loadVersion();
  }

  // ---- schema helpers

  private all<T = Record<string, unknown>>(
    sql: string,
    ...args: (string | number | null)[]
  ): T[] {
    return this.db.sqlite.prepare(sql).all(...args) as T[];
  }
  private get<T = Record<string, unknown>>(
    sql: string,
    ...args: (string | number | null)[]
  ): T | undefined {
    return this.db.sqlite.prepare(sql).get(...args) as T | undefined;
  }
  private run(sql: string, ...args: (string | number | null)[]): void {
    this.db.sqlite.prepare(sql).run(...args);
  }

  private seqCountTx(): number {
    const value = this.get<{ n: number }>(
      'SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM memories WHERE scope_id = ?',
      this.scopeId,
    );
    return Number(value?.n ?? 0);
  }
  private bySeqTx(seq: number): MemoryRow | undefined {
    const value = this.get(
      'SELECT * FROM memories WHERE scope_id = ? AND seq = ?',
      this.scopeId,
      seq,
    );
    return value ? toMemory(value) : undefined;
  }
  private activeBetweenTx(lo: number, hi: number): MemoryRow[] {
    return this.all(
      `SELECT * FROM memories WHERE scope_id = ? AND seq BETWEEN ? AND ? AND status = 'active' ORDER BY seq`,
      this.scopeId,
      lo,
      hi,
    ).map(toMemory);
  }
  private nodeTx(lo: number, hi: number): NodeRow | undefined {
    return this.get<{ lo: number; hi: number; summary: string; stale: number }>(
      'SELECT lo, hi, summary, stale FROM memory_nodes WHERE scope_id = ? AND lo = ? AND hi = ?',
      this.scopeId,
      lo,
      hi,
    );
  }
  /** A node that counts for the tree: present and not stale. */
  private hasNodeTx(lo: number, hi: number): boolean {
    const node = this.nodeTx(lo, hi);
    return node !== undefined && node.stale === 0;
  }
  private nodeTextTx(lo: number, hi: number): string | undefined {
    const node = this.nodeTx(lo, hi);
    return node && node.stale === 0 ? node.summary : undefined;
  }
  private writeNodeTx(lo: number, hi: number, summary: string): void {
    this.run(
      `INSERT INTO memory_nodes (scope_id, lo, hi, summary, stale, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(scope_id, lo, hi) DO UPDATE SET summary = excluded.summary, stale = 0`,
      this.scopeId,
      lo,
      hi,
      summary,
      new Date().toISOString(),
    );
  }
  private insertMemoryTx(memory: MemoryRow): void {
    this.run(
      `INSERT INTO memories (id, scope_id, seq, goal_id, kind, content, source_type, source_ref,
        trust_level, confidence, status, superseded_by, supersedes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memory.id,
      memory.scopeId,
      memory.seq,
      memory.goalId,
      memory.kind,
      memory.content,
      memory.sourceType,
      memory.sourceRef,
      memory.trustLevel,
      memory.confidence,
      memory.status,
      memory.supersededBy,
      memory.supersedes,
      memory.createdAt,
      memory.updatedAt,
    );
    this.run(
      'INSERT INTO memory_fts (content, mem_id) VALUES (?, ?)',
      memory.content,
      memory.id,
    );
  }
  private recordVersionTx(
    memoryId: string,
    action: MemoryAction,
    actor: MemoryActor,
    reason: string | null,
    before: MemoryRow | null,
    after: MemoryRow | null,
  ): void {
    this.run(
      'INSERT INTO memory_versions (memory_id, action, actor, reason, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      memoryId,
      action,
      actor,
      reason,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      new Date().toISOString(),
    );
  }
  private markCoveringNodesStaleTx(seq: number): void {
    this.run(
      'UPDATE memory_nodes SET stale = 1 WHERE scope_id = ? AND lo <= ? AND ? <= hi AND stale = 0',
      this.scopeId,
      seq,
      seq,
    );
  }
  private nextSeqTx(): number {
    return this.seqCountTx();
  }

  // ---- summary tree

  /** Whether node lo-hi is due to be merged (missing/stale and both halves present). */
  private mergeDueTx(lo: number, hi: number): boolean {
    if (this.hasNodeTx(lo, hi)) return false;
    const size = hi - lo + 1;
    if (size === 2) return true;
    const mid = lo + size / 2 - 1;
    return this.hasNodeTx(lo, mid) && this.hasNodeTx(mid + 1, hi);
  }

  /**
   * Write empty-marker nodes for every due range whose memories are all
   * inactive, cascading upwards; no model call is needed for those.
   */
  private autoMergeEmptyTx(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const n = this.seqCountTx();
      for (let size = 2; size <= n; size *= 2) {
        for (let lo = 0; lo + size <= n; lo += size) {
          const hi = lo + size - 1;
          if (!this.mergeDueTx(lo, hi)) continue;
          if (this.activeBetweenTx(lo, hi).length > 0) continue;
          this.writeNodeTx(lo, hi, EMPTY_NODE);
          changed = true;
        }
      }
    }
  }

  /** The text a merge would compress: the halves' summaries, or active raw lines. */
  private mergeSourceTx(lo: number, hi: number): string {
    const half = (a: number, b: number): string => {
      const text = this.nodeTextTx(a, b);
      if (text !== undefined && text !== EMPTY_NODE)
        return `#${a}-${b} ${text}`;
      return this.activeBetweenTx(a, b)
        .map((m) => `#${m.seq} ${m.content}`)
        .join('\n');
    };
    const mid = lo + (hi - lo + 1) / 2 - 1;
    return [half(lo, mid), half(mid + 1, hi)]
      .filter((part) => part !== '')
      .join('\n');
  }

  /** The earliest pending merge, or null. Smallest intervals first, left to right. */
  nextMerge(): MergeDue | null {
    return this.db.transaction(() => this.nextMergeTx());
  }

  private nextMergeTx(): MergeDue | null {
    const n = this.seqCountTx();
    for (let size = 2; size <= Math.max(n, 2); size *= 2) {
      for (let lo = 0; lo + size <= n; lo += size) {
        const hi = lo + size - 1;
        if (!this.mergeDueTx(lo, hi)) continue;
        if (this.activeBetweenTx(lo, hi).length === 0) continue; // auto-marked instead
        return { lo, hi, source: this.mergeSourceTx(lo, hi) };
      }
    }
    return null;
  }

  pendingMergeCount(): number {
    return this.db.transaction(() => this.pendingMergeCountTx());
  }

  private pendingMergeCountTx(): number {
    let count = 0;
    const n = this.seqCountTx();
    for (let size = 2; size <= Math.max(n, 2); size *= 2) {
      for (let lo = 0; lo + size <= n; lo += size) {
        const hi = lo + size - 1;
        if (!this.mergeDueTx(lo, hi)) continue;
        if (this.activeBetweenTx(lo, hi).length === 0) continue;
        count++;
      }
    }
    return count;
  }

  // ---- writes

  /** Record a new memory; returns the merge now due, if any. */
  remember(input: RememberInput): {
    memory: MemoryRow;
    merge: MergeDue | null;
  } {
    const content = normalizeLine(input.text, 'memory');
    const now = new Date().toISOString();
    const memory: MemoryRow = {
      id: newId(),
      scopeId: this.scopeId,
      seq: 0,
      goalId: input.goalId ?? null,
      kind: input.kind ?? 'fact',
      content,
      sourceType: input.sourceType ?? 'agent',
      sourceRef: input.sourceRef ?? null,
      trustLevel: input.trustLevel ?? 'agent_inferred',
      confidence: input.confidence ?? null,
      status: 'active',
      supersededBy: null,
      supersedes: null,
      createdAt: now,
      updatedAt: now,
    };
    const merge = this.db.transaction(() => {
      memory.seq = this.nextSeqTx();
      this.insertMemoryTx(memory);
      this.recordVersionTx(
        memory.id,
        'create',
        input.actor ?? 'chief',
        input.reason ?? null,
        null,
        memory,
      );
      this.autoMergeEmptyTx();
      return this.nextMergeTx();
    });
    this.bump();
    this.exportFile();
    return { memory, merge };
  }

  /**
   * Store one auto-extracted candidate (PRD §4.4 F03): status `candidate`,
   * trust `agent_inferred`, operator `worker`. Candidates never render in
   * wake() or default recall(); the MEMORY.md export ignores them until a
   * user promotes them, so workers only ever read confirmed memory.
   */
  candidate(input: {
    text: string;
    kind: MemoryKind;
    confidence: number | null;
    sourceRef: string | null;
    /** Active memory this candidate contradicts; applied on promote. */
    supersedes?: number | null;
    reason?: string;
  }): MemoryRow {
    const content = normalizeLine(input.text, 'memory');
    const now = new Date().toISOString();
    const memory: MemoryRow = {
      id: newId(),
      scopeId: this.scopeId,
      seq: 0,
      goalId: null,
      kind: input.kind,
      content,
      sourceType: 'agent',
      sourceRef: input.sourceRef,
      trustLevel: 'agent_inferred',
      confidence: input.confidence,
      status: 'candidate',
      supersededBy: null,
      supersedes: input.supersedes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.transaction(() => {
      if (memory.supersedes !== null) {
        const target = this.bySeqTx(memory.supersedes);
        if (!target || target.status !== 'active')
          throw new Error(
            `supersede target #${memory.supersedes} is not an active memory`,
          );
      }
      memory.seq = this.nextSeqTx();
      this.insertMemoryTx(memory);
      this.recordVersionTx(
        memory.id,
        'create',
        'worker',
        input.reason ?? 'auto-extracted from history',
        null,
        memory,
      );
      this.autoMergeEmptyTx();
    });
    this.bump();
    return memory;
  }

  /**
   * Supersede memory #seq with a revised line: the new memory takes the next
   * seq, the old one stays as history and no longer enters Core Memory.
   */
  revise(
    seq: number,
    text: string,
    reason: string,
    actor: MemoryActor = 'chief',
  ): { memory: MemoryRow; superseded: MemoryRow; merge: MergeDue | null } {
    const content = normalizeLine(text, 'memory');
    const result = this.db.transaction(() => {
      const superseded = this.bySeqTx(seq);
      if (!superseded)
        throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
      if (superseded.status !== 'active')
        throw new Error(
          `memory #${seq} is ${superseded.status}; only active memories can be revised`,
        );
      const now = new Date().toISOString();
      const memory: MemoryRow = {
        ...superseded,
        id: newId(),
        seq: this.nextSeqTx(),
        content,
        sourceType: actor === 'user' ? 'user' : 'agent',
        sourceRef: superseded.sourceRef,
        trustLevel: actor === 'user' ? 'user_confirmed' : 'agent_inferred',
        confidence: superseded.confidence,
        status: 'active',
        supersededBy: null,
        // The revision itself is the supersede; the target pointer is spent.
        supersedes: null,
        createdAt: now,
        updatedAt: now,
      };
      const revisedOld: MemoryRow = {
        ...superseded,
        status: 'superseded',
        supersededBy: memory.id,
        updatedAt: now,
      };
      this.insertMemoryTx(memory);
      this.run(
        'UPDATE memories SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?',
        'superseded',
        memory.id,
        now,
        superseded.id,
      );
      this.recordVersionTx(memory.id, 'create', actor, reason, null, memory);
      this.recordVersionTx(
        superseded.id,
        'supersede',
        actor,
        reason,
        superseded,
        revisedOld,
      );
      this.markCoveringNodesStaleTx(seq);
      this.autoMergeEmptyTx();
      return { memory, superseded: revisedOld, merge: this.nextMergeTx() };
    });
    this.bump();
    this.exportFile();
    return result;
  }

  /** Mark memory #seq deleted; rows are never physically removed. */
  forget(seq: number, reason: string, actor: MemoryActor = 'chief'): MemoryRow {
    const result = this.db.transaction(() => {
      const memory = this.bySeqTx(seq);
      if (!memory)
        throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
      if (memory.status !== 'active' && memory.status !== 'candidate')
        throw new Error(
          `memory #${seq} is ${memory.status}; only active or candidate memories can be forgotten`,
        );
      const updated: MemoryRow = {
        ...memory,
        status: 'deleted',
        updatedAt: new Date().toISOString(),
      };
      this.run(
        'UPDATE memories SET status = ?, updated_at = ? WHERE id = ?',
        'deleted',
        updated.updatedAt,
        memory.id,
      );
      this.recordVersionTx(memory.id, 'delete', actor, reason, memory, updated);
      this.markCoveringNodesStaleTx(seq);
      this.autoMergeEmptyTx();
      return updated;
    });
    this.bump();
    this.exportFile();
    return result;
  }

  /**
   * Promote a candidate into Core Memory: status becomes active, trust stays
   * at agent_inferred. If the candidate contradicts an active memory
   * (`supersedes`), that memory is superseded in the same transaction, so the
   * contradiction never coexists in Core Memory. Covering summary nodes go
   * stale so the promoted line renders immediately.
   */
  promote(
    seq: number,
    actor: MemoryActor = 'user',
    reason = 'promoted from candidates',
  ): { memory: MemoryRow; superseded: MemoryRow | null } {
    const result = this.db.transaction(() => {
      const memory = this.bySeqTx(seq);
      if (!memory)
        throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
      if (memory.status !== 'candidate')
        throw new Error(
          `memory #${seq} is ${memory.status}; only candidates can be promoted`,
        );
      const now = new Date().toISOString();
      let superseded: MemoryRow | null = null;
      if (memory.supersedes !== null) {
        const target = this.bySeqTx(memory.supersedes);
        if (target && target.status === 'active') {
          superseded = {
            ...target,
            status: 'superseded',
            supersededBy: memory.id,
            updatedAt: now,
          };
          this.run(
            'UPDATE memories SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?',
            'superseded',
            memory.id,
            now,
            target.id,
          );
          this.recordVersionTx(
            target.id,
            'supersede',
            actor,
            `${reason} (candidate #${seq})`,
            target,
            superseded,
          );
          this.markCoveringNodesStaleTx(target.seq);
        }
      }
      const updated: MemoryRow = {
        ...memory,
        status: 'active',
        updatedAt: now,
      };
      this.run(
        'UPDATE memories SET status = ?, updated_at = ? WHERE id = ?',
        'active',
        now,
        memory.id,
      );
      this.recordVersionTx(
        memory.id,
        'promote',
        actor,
        reason,
        memory,
        updated,
      );
      this.markCoveringNodesStaleTx(seq);
      this.autoMergeEmptyTx();
      return { memory: updated, superseded };
    });
    this.bump();
    this.exportFile();
    return result;
  }

  /** Store a summary for node lo-hi; the agent writes `summary`, we own storage. */
  nap(lo: number, hi: number, summary: string): MergeDue | null {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo < 1 || lo < 0)
      throw new Error(`bad node ${lo}-${hi}`);
    const size = hi - lo + 1;
    if ((size & (size - 1)) !== 0 || lo % size !== 0)
      throw new Error(`unaligned node ${lo}-${hi}`);
    const body = normalizeLine(summary, 'summary');
    const merge = this.db.transaction(() => {
      if (hi >= this.seqCountTx())
        throw new Error(`node ${lo}-${hi} covers missing memories`);
      if (
        size > 2 &&
        (!this.hasNodeTx(lo, lo + size / 2 - 1) ||
          !this.hasNodeTx(lo + size / 2, hi))
      ) {
        throw new Error(`node ${lo}-${hi} needs both child summaries`);
      }
      // Another chief conversation may already have compressed this immutable range.
      if (!this.hasNodeTx(lo, hi)) this.writeNodeTx(lo, hi, body);
      this.autoMergeEmptyTx();
      return this.nextMergeTx();
    });
    this.bump();
    this.exportFile();
    return merge;
  }

  // ---- reads

  /**
   * What wake prints: coarse summary nodes covering old history, then active
   * raw lines, oldest to newest, capped at `budget` tokens
   * (estimated as ceil(UTF-8 bytes / 3)).
   */
  wake(budget = 1500): string {
    const items = this.db.transaction(() => {
      const n = this.seqCountTx();
      const lines: string[] = [];
      let pos = 0;
      while (pos < n) {
        const node = this.largestNodeAtTx(pos, n);
        if (node) {
          if (node.summary !== EMPTY_NODE)
            lines.push(`#${node.lo}-${node.hi} ${node.summary}`);
          pos = node.hi + 1;
        } else {
          const memory = this.bySeqTx(pos);
          if (memory && memory.status === 'active')
            lines.push(`#${pos} ${memory.content}`);
          pos += 1;
        }
      }
      return lines;
    });
    if (items.length === 0) return '(no memories yet)';
    const costs = items.map(tokenCost);
    const total = costs.reduce((sum, cost) => sum + cost, 0);
    if (total <= budget) return items.join('\n');
    const headBudget = Math.ceil(budget / 4);
    let headCost = 0;
    let head = 0;
    while (head < items.length && headCost + costs[head] <= headBudget) {
      headCost += costs[head];
      head++;
    }
    const omission = `… (older memories omitted; use recall/zoom)`;
    let tailCost = tokenCost(omission);
    let tailStart = items.length;
    while (
      tailStart > head &&
      tailCost + costs[tailStart - 1] <= budget - headCost
    ) {
      tailStart--;
      tailCost += costs[tailStart];
    }
    return [...items.slice(0, head), omission, ...items.slice(tailStart)].join(
      '\n',
    );
  }

  /** Largest existing non-stale summary node starting exactly at `pos`, or null. */
  private largestNodeAtTx(pos: number, n: number): NodeRow | undefined {
    const maxByAlign = pos === 0 ? 1 << 30 : pos & -pos; // largest pow2 dividing pos
    for (
      let size = Math.min(maxByAlign, highestPow2(n - pos));
      size >= 2;
      size /= 2
    ) {
      if (pos % size !== 0) continue;
      if (pos + size > n) continue;
      if (this.hasNodeTx(pos, pos + size - 1))
        return this.nodeTx(pos, pos + size - 1);
    }
    return undefined;
  }

  /**
   * Full-text search (FTS5 trigram, works for Chinese); queries shorter than
   * three characters fall back to substring LIKE. Active memories by default;
   * `includeHistory` adds superseded and deleted ones, marked with [status].
   */
  recall(
    query: string,
    options?: { includeHistory?: boolean; limit?: number },
  ): string {
    const q = query.trim();
    if (!q) return '(no matches)';
    const limit = options?.limit ?? 100;
    const statusFilter = options?.includeHistory
      ? ''
      : ` AND status = 'active'`;
    const rows = this.db.transaction(() => {
      const where = `WHERE scope_id = ?${statusFilter}`;
      if ([...q].length < 3) {
        const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
        return this.all<Record<string, unknown>>(
          `SELECT * FROM memories ${where} AND content LIKE ? ESCAPE '\\' ORDER BY seq LIMIT ?`,
          this.scopeId,
          `%${escaped}%`,
          limit,
        ).map(toMemory);
      }
      const match = `"${q.replace(/"/g, '""')}"`;
      return this.all<Record<string, unknown>>(
        `SELECT * FROM memories ${where} AND id IN (SELECT mem_id FROM memory_fts WHERE memory_fts MATCH ?) ORDER BY seq LIMIT ?`,
        this.scopeId,
        match,
        limit,
      ).map(toMemory);
    });
    if (rows.length === 0) return '(no matches)';
    return rows
      .map((m) =>
        m.status === 'active' || !options?.includeHistory
          ? `#${m.seq} ${m.content}`
          : `#${m.seq} [${m.status}] ${m.content}`,
      )
      .join('\n');
  }

  /** Open node lo-hi into its two halves: summaries where built, active raw lines otherwise. */
  zoom(lo: number, hi: number): string {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi - lo < 1)
      throw new Error(`bad range ${lo}-${hi}`);
    return this.db.transaction(() => {
      if (hi >= this.seqCountTx())
        throw new Error(`range ${lo}-${hi} covers missing memories`);
      const mid = lo + (hi - lo + 1) / 2 - 1;
      const half = (a: number, b: number): string => {
        const text = this.nodeTextTx(a, b);
        if (text !== undefined && text !== EMPTY_NODE)
          return `#${a}-${b} ${text}`;
        return this.activeBetweenTx(a, b)
          .map((m) => `#${m.seq} ${m.content}`)
          .join('\n');
      };
      const rendered = [half(lo, mid), half(mid + 1, hi)]
        .filter((part) => part !== '')
        .join('\n');
      return rendered === '' ? '(no active memories in range)' : rendered;
    });
  }

  /** Dump for the UI: every memory with provenance, every node, pending merges. */
  dump(): MemoryDump {
    return this.db.transaction(() => {
      const items: MemoryItem[] = this.all(
        'SELECT * FROM memories WHERE scope_id = ? ORDER BY seq',
        this.scopeId,
      ).map(toMemory);
      const nodes: MemoryNodeInfo[] = this.all<{
        lo: number;
        hi: number;
        summary: string;
        stale: number;
      }>(
        'SELECT lo, hi, summary, stale FROM memory_nodes WHERE scope_id = ? ORDER BY lo, hi',
        this.scopeId,
      ).map((node) => ({
        lo: Number(node.lo),
        hi: Number(node.hi),
        summary: node.summary,
        stale: node.stale === 1,
      }));
      return {
        scopeId: this.scopeId,
        items,
        nodes,
        pendingMerges: this.pendingMergeCountTx(),
      };
    });
  }

  /** Monotonic change counter for a scope, for per-conversation Core Memory snapshots. */
  version(): number {
    return this.versionCounter;
  }
  private loadVersion(): number {
    const value = this.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM memory_versions v JOIN memories m ON m.id = v.memory_id WHERE m.scope_id = ?',
      this.scopeId,
    );
    return Number(value?.n ?? 0);
  }
  private bump(): void {
    this.versionCounter += 1;
  }

  // ---- legacy import and one-way export

  /**
   * One-time import of the pre-SQLite files: every LOG.txt line (seq = line
   * index, provenance legacy/agent_inferred) and every TREE node. Idempotent
   * and transactional; afterwards the files move into memory/legacy/.
   */
  private migrateLegacy(): void {
    const logPath = join(this.dir, 'LOG.txt');
    const treeDir = join(this.dir, 'TREE');
    if (!existsSync(logPath)) return;
    const hasRows = this.get(
      'SELECT 1 FROM memories WHERE scope_id = ? LIMIT 1',
      this.scopeId,
    );
    if (hasRows) return;
    const lines = readFileSync(logPath, 'utf8').split('\n');
    const now = new Date().toISOString();
    this.db.transaction(() => {
      lines.forEach((line, index) => {
        const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+(.*)$/.exec(line);
        const content = (match ? match[2] : line).trim();
        if (!content) return; // keep seq = line index even with gaps
        const createdAt = match
          ? new Date(`${match[1]}:00`).toISOString()
          : now;
        const memory: MemoryRow = {
          id: newId(),
          scopeId: this.scopeId,
          seq: index,
          goalId: null,
          kind: 'fact',
          content,
          sourceType: 'legacy',
          sourceRef: 'legacy:LOG.txt',
          trustLevel: 'agent_inferred',
          confidence: null,
          status: 'active',
          supersededBy: null,
          supersedes: null,
          createdAt,
          updatedAt: createdAt,
        };
        this.insertMemoryTx(memory);
        this.recordVersionTx(
          memory.id,
          'import',
          'migration',
          'imported from LOG.txt',
          null,
          memory,
        );
      });
      if (existsSync(treeDir)) {
        for (const file of readdirSync(treeDir)) {
          const match = /^(\d+)-(\d+)\.txt$/.exec(file);
          if (!match) continue;
          const summary = readFileSync(join(treeDir, file), 'utf8').trim();
          if (!summary) continue;
          this.writeNodeTx(Number(match[1]), Number(match[2]), summary);
        }
      }
    });
    const legacyDir = join(this.dir, 'legacy');
    mkdirSync(legacyDir, { recursive: true });
    renameSync(logPath, join(legacyDir, 'LOG.txt'));
    if (existsSync(treeDir)) renameSync(treeDir, join(legacyDir, 'TREE'));
    this.bump();
    this.exportFile();
  }

  /** Regenerate the read-only MEMORY.md export; the DB is never read back from it. */
  exportFile(): void {
    const { items, nodes } = this.dump();
    const active = items.filter((item) => item.status === 'active');
    const summaries = nodes.filter(
      (node) => !node.stale && node.summary !== EMPTY_NODE,
    );
    const lines = [
      `# Memory（${this.scopeId}）`,
      '',
      '> 只读导出：由 Tian Agent 服务在每次写入后生成。数据库是唯一写入来源，请勿手改本文件。',
      '',
      '## 记忆',
      '',
      ...(active.length === 0
        ? ['（暂无有效记忆）']
        : active.map(
            (item) =>
              `- #${item.seq} [${item.kind}] ${item.trustLevel} ${item.createdAt.slice(0, 10)} — ${item.content}`,
          )),
      '',
      '## 摘要',
      '',
      ...(summaries.length === 0
        ? ['（暂无摘要）']
        : summaries.map((node) => `- #${node.lo}-${node.hi} ${node.summary}`)),
      '',
    ];
    atomicWrite(join(this.dir, 'MEMORY.md'), lines.join('\n'));
  }
}
