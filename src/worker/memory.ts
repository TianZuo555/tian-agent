import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Db } from './db.js';
import { atomicWrite } from './files.js';
import { escapeLike, planSearch, tokenCost } from './search.js';
import type { MemoryDump, MemoryItem } from '../shared/types.js';

/**
 * SQLite-backed memory with provenance, versions, and an explicitly selected
 * Core Memory (D4). The database is the only source of truth; files in the
 * scope's memory directory are a one-way read-only export for workers and
 * humans, plus the legacy LOG.txt import source.
 *
 * Rules:
 * - Every active memory is searchable; only memories selected into Core are
 *   rendered by wake(). Selection is explicit (remember core=true, select), and
 *   moving a memory out of Core (deselect) is not forget.
 * - Core is a small, ordered set bounded by a token budget that counts the
 *   rendered metadata (seq, kind, trust) and the usage footer. A selection that
 *   would exceed the budget is rejected atomically; runtime never silently
 *   truncates or evicts.
 * - Candidates (auto-extracted by the memory worker, PRD §4.4 F03) occupy seq
 *   slots but never render in wake(), never enter the export, and are promoted
 *   only by an explicit user action.
 * - Superseding or deleting a memory keeps the row as history; it never stays
 *   in Core.
 * - An old database gets one deterministic Core selection during migration:
 *   user-confirmed and preference/decision memories first, within budget; all
 *   other active memories stay active and searchable.
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
  | 'import'
  | 'select'
  | 'deselect'
  | 'evidence';

export interface MemoryRow {
  id: string;
  scopeId: string;
  /** Per-scope, immutable, 0-based insertion order. */
  seq: number;
  goalId: string | null;
  kind: MemoryKind;
  content: string;
  sourceType: MemorySourceType;
  sourceRef: string | null;
  trustLevel: MemoryTrustLevel;
  confidence: number | null;
  status: MemoryStatus;
  /** Explicitly selected into the Core Memory view. */
  core: boolean;
  supersededBy: string | null;
  /** For a candidate: the active seq it will replace when promoted. */
  supersedes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoreUsage {
  budget: number;
  tokens: number;
  selected: number;
  active: number;
}

export interface RememberInput {
  text: string;
  kind?: MemoryKind;
  sourceType?: MemorySourceType;
  sourceRef?: string | null;
  trustLevel?: MemoryTrustLevel;
  confidence?: number | null;
  goalId?: string | null;
  /** Select into Core in the same transaction; over budget rejects the write. */
  core?: boolean;
  actor?: MemoryActor;
  reason?: string | null;
}

export interface RememberResult {
  memory: MemoryRow;
  /** False when normalized content already existed in this scope. */
  created: boolean;
  /** True when the duplicate added trust or a source reference. */
  evidenceAdded: boolean;
  /** True when added evidence pushed a selected memory out of Core. */
  coreDropped: boolean;
}

export interface ReviseResult {
  memory: MemoryRow;
  superseded: MemoryRow;
  /** False when the replacement text equals the old text. */
  changed: boolean;
  /** True when trust or the source reference was added without a new row. */
  evidenceAdded: boolean;
  /** True when the old memory was in Core but the replacement could not fit. */
  coreDropped: boolean;
}

/** The default per-scope Core Memory budget, in estimated tokens. */
export const CORE_BUDGET = 1500;
/** One memory line, measured in Unicode code points. */
export const MAX_MEMORY_CHARS = 1000;

/** Explicit no-match result; also the smallest possible recall output. */
const NO_MATCHES = '(no matches)';

/** Row format for recall results, with stable provenance and status. */
const recallLine = (memory: MemoryRow): string =>
  `#${memory.seq} [${memory.kind}] ${memory.trustLevel}${
    memory.core ? ' core' : ''
  } ${memory.updatedAt.slice(0, 10)}${
    memory.sourceRef ? ` ${memory.sourceRef}` : ''
  } — ${memory.content}${memory.status === 'active' ? '' : ` (${memory.status})`}`;

const newId = () => `mem-${randomUUID()}`;

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
  core: Number(value.core ?? 0) === 1,
  supersededBy: (value.superseded_by as string | null) ?? null,
  supersedes:
    value.supersedes === null || value.supersedes === undefined
      ? null
      : Number(value.supersedes),
  createdAt: value.created_at as string,
  updatedAt: value.updated_at as string,
});

/** One line: whitespace collapsed, at most 1000 Unicode code points. */
function normalizeLine(text: string, what: string): string {
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) throw new Error(`${what} must contain at least 1 character`);
  const length = [...body].length;
  if (length > MAX_MEMORY_CHARS)
    throw new Error(
      `${what} must be at most ${MAX_MEMORY_CHARS} Unicode code points`,
    );
  return body;
}

/**
 * Comparison key for exact duplicates: whitespace is normalized, case and
 * identifiers are preserved (`Foo` and `foo` may be different paths or names).
 */
const dedupeKey = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * How a selected memory renders in Core. Provenance stays compact but
 * locatable — kind, trust, date and the source ref — and every character of it
 * is part of the measured budget.
 */
const renderLine = (memory: MemoryRow): string =>
  `#${memory.seq} [${memory.kind}] ${memory.trustLevel} ${memory.updatedAt.slice(0, 10)}${memory.sourceRef ? ` ${memory.sourceRef}` : ''} — ${memory.content}`;

interface CoreRender {
  /** Exactly what wake() emits. */
  text: string;
  /** Estimated tokens of `text`, including metadata, newlines, and footer. */
  tokens: number;
  /** Tokens the full selection would need, even when `text` is an overflow notice. */
  needed: number;
  overflow: boolean;
}

/**
 * Render the selected memories with a usage footer. Everything is measured on
 * the final output string — metadata, newlines, the empty-selection hint, and
 * the footer itself — and the footer's own token count is resolved to a fixed
 * point. `tokens` therefore equals the estimate of exactly what wake emits.
 */
function renderCore(
  memories: MemoryRow[],
  budget: number,
  activeCount: number,
): CoreRender {
  const body =
    memories.length > 0
      ? memories.map(renderLine).join('\n')
      : `(no core memories selected; ${activeCount} active memories are searchable with recall)`;
  // Resolve the footer's own token count to a fixed point, then render once
  // more with that exact number so the displayed usage equals `tokens`.
  let used = tokenCost(
    `${body}\ncore: ${memories.length} selected · 0/${budget} tokens`,
  );
  for (let i = 0; i < 5; i++) {
    const footer = `core: ${memories.length} selected · ${used}/${budget} tokens`;
    const next = tokenCost(`${body}\n${footer}`);
    if (next === used) break;
    used = next;
  }
  const footer = `core: ${memories.length} selected · ${used}/${budget} tokens`;
  const full = `${body}\n${footer}`;
  const needed = tokenCost(full);
  if (needed > budget) {
    const text = `core: ${memories.length} selected need ${needed} tokens, budget ${budget}. Deselect memories or shorten them; nothing is truncated.`;
    return { text, tokens: tokenCost(text), needed, overflow: true };
  }
  return { text: full, tokens: needed, needed, overflow: false };
}

export class MemoryStore {
  private versionCounter = 0;

  constructor(
    private db: Db,
    readonly scopeId: string,
    readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
    // Schema (tables, columns, indexes, tree retirement, FTS rebuild) is part
    // of Db's version migration; by the time a store exists it is in place.
    this.migrateLegacy();
    this.migrateCoreSelection();
    this.versionCounter = this.loadVersion();
    // Always regenerate the read-only export: this repairs a stale file left by
    // a failed write or an interrupted upgrade, not just after a migration.
    this.db.afterCommit(() => this.exportFile());
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
  private activeTx(): MemoryRow[] {
    return this.all(
      "SELECT * FROM memories WHERE scope_id = ? AND status = 'active' ORDER BY seq",
      this.scopeId,
    ).map(toMemory);
  }
  private selectedTx(): MemoryRow[] {
    return this.all(
      "SELECT * FROM memories WHERE scope_id = ? AND status = 'active' AND core = 1 ORDER BY seq",
      this.scopeId,
    ).map(toMemory);
  }
  private activeByTextTx(key: string): MemoryRow | undefined {
    return this.all(
      "SELECT * FROM memories WHERE scope_id = ? AND status = 'active' ORDER BY seq",
      this.scopeId,
    )
      .map(toMemory)
      .find((memory) => dedupeKey(memory.content) === key);
  }
  private candidateByTextTx(key: string): MemoryRow | undefined {
    return this.all(
      "SELECT * FROM memories WHERE scope_id = ? AND status = 'candidate' ORDER BY seq",
      this.scopeId,
    )
      .map(toMemory)
      .find((memory) => dedupeKey(memory.content) === key);
  }
  private insertMemoryTx(memory: MemoryRow): void {
    this.run(
      `INSERT INTO memories (id, scope_id, seq, goal_id, kind, content, source_type, source_ref,
        trust_level, confidence, status, core, superseded_by, supersedes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      memory.core ? 1 : 0,
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
  private setCoreTx(seq: number, core: boolean): void {
    this.run(
      'UPDATE memories SET core = ?, updated_at = ? WHERE scope_id = ? AND seq = ?',
      core ? 1 : 0,
      new Date().toISOString(),
      this.scopeId,
      seq,
    );
  }

  /** Current Core usage; `tokens` includes the rendered metadata and footer. */
  coreUsage(budget = CORE_BUDGET): CoreUsage {
    return this.db.transaction(() => this.coreUsageTx(budget));
  }
  private coreUsageTx(budget: number): CoreUsage {
    const selected = this.selectedTx();
    const active = this.activeTx();
    return {
      budget,
      tokens: renderCore(selected, budget, active.length).tokens,
      selected: selected.length,
      active: active.length,
    };
  }

  /**
   * Reject a projected Core selection that would exceed the budget. The error
   * carries current usage so the agent can deselect or shorten something.
   */
  private assertCoreFitsTx(
    projected: MemoryRow[],
    budget: number,
    activeCount = this.activeTx().length,
  ): void {
    const render = renderCore(projected, budget, activeCount);
    if (!render.overflow) return;
    const usage = this.coreUsageTx(budget);
    const overflow = render.needed - budget;
    throw new Error(
      `Core Memory is full: ${usage.selected} selected, ${usage.tokens}/${budget} tokens. This selection needs ${render.needed} tokens (${overflow} over). Deselect a memory or shorten it; active memories stay searchable outside Core.`,
    );
  }

  // ---- writes

  /**
   * Record a new memory. Normalized exact duplicates in the same scope return
   * the existing row; new user confirmation or a new source reference is
   * appended as evidence (trust upgrade + version row), never silently dropped.
   * A duplicate of an inactive historical row is not revived: a new active row
   * is written instead.
   */
  remember(input: RememberInput): RememberResult {
    const content = normalizeLine(input.text, 'memory');
    const key = dedupeKey(content);
    const actor = input.actor ?? 'chief';
    const sourceType = input.sourceType ?? 'agent';
    const trustLevel = input.trustLevel ?? 'agent_inferred';
    const result = this.db.transaction((): RememberResult => {
      const active = this.activeByTextTx(key);
      const candidate = active ? undefined : this.candidateByTextTx(key);
      const existing = active ?? candidate;
      if (existing) {
        // A candidate is never promoted implicitly by a repeat: only the user
        // approval path moves it to active. New evidence is still recorded.
        const pending = existing.status === 'candidate';
        const upgraded =
          !pending &&
          trustLevel === 'user_confirmed' &&
          existing.trustLevel !== 'user_confirmed';
        // An unconfirmed write never overwrites the evidence of an already
        // confirmed row: a passing mention is not a new confirmation.
        const mayAddEvidence =
          trustLevel === 'user_confirmed' ||
          existing.trustLevel !== 'user_confirmed';
        const newEvidence =
          mayAddEvidence &&
          input.sourceRef !== null &&
          input.sourceRef !== undefined &&
          input.sourceRef !== existing.sourceRef;
        let updated = existing;
        let coreDropped = false;
        if (pending) {
          // The candidate keeps its status and trust. New evidence is recorded
          // for the user's later decision, never applied to the row.
          if (newEvidence)
            this.recordVersionTx(
              existing.id,
              'evidence',
              actor,
              [
                input.reason ?? 'duplicate remember',
                `source ${input.sourceRef}`,
                'candidate kept pending for user approval',
              ].join('; '),
              existing,
              existing,
            );
          if (input.core)
            throw new Error(
              `memory #${existing.seq} is a candidate; promote it before selecting it into Core`,
            );
          return {
            memory: existing,
            created: false,
            evidenceAdded: newEvidence,
            coreDropped: false,
          };
        }
        if (upgraded || newEvidence) {
          updated = {
            ...existing,
            trustLevel: upgraded ? 'user_confirmed' : existing.trustLevel,
            sourceType:
              upgraded && sourceType === 'user' ? 'user' : existing.sourceType,
            sourceRef: newEvidence ? input.sourceRef! : existing.sourceRef,
            updatedAt: new Date().toISOString(),
          };
          this.run(
            'UPDATE memories SET trust_level = ?, source_type = ?, source_ref = ?, updated_at = ? WHERE id = ?',
            updated.trustLevel,
            updated.sourceType,
            updated.sourceRef,
            updated.updatedAt,
            existing.id,
          );
          this.recordVersionTx(
            existing.id,
            'evidence',
            actor,
            [
              input.reason ?? 'duplicate remember',
              newEvidence ? `source ${input.sourceRef}` : null,
              upgraded ? 'trust upgraded to user_confirmed' : null,
            ]
              .filter(Boolean)
              .join('; '),
            existing,
            updated,
          );
          // Metadata can grow (e.g. a longer trust label), so re-check the
          // rendered selection; never leave Core in an overflowing state.
          if (updated.core) {
            const projected = this.selectedTx().map((item) =>
              item.seq === updated.seq ? updated : item,
            );
            if (
              renderCore(projected, CORE_BUDGET, this.activeTx().length)
                .overflow
            ) {
              this.setCoreTx(updated.seq, false);
              updated = { ...updated, core: false };
              coreDropped = true;
              this.recordVersionTx(
                updated.id,
                'deselect',
                actor,
                'evidence made the rendered Core exceed its budget',
                existing,
                updated,
              );
            }
          }
        }
        if (input.core && !updated.core) {
          // The projected set is the current selection minus this row, plus
          // this row selected. Over budget rejects the whole write — evidence
          // updates included — inside the same transaction.
          this.assertCoreFitsTx(
            [
              ...this.selectedTx().filter((item) => item.seq !== updated.seq),
              { ...updated, core: true },
            ],
            CORE_BUDGET,
          );
          this.setCoreTx(updated.seq, true);
          updated = { ...updated, core: true };
          this.recordVersionTx(
            updated.id,
            'select',
            actor,
            input.reason ?? 'selected on remember',
            existing,
            updated,
          );
        }
        return {
          memory: updated,
          created: false,
          evidenceAdded: Boolean(
            upgraded || newEvidence || (input.core && !existing.core),
          ),
          coreDropped,
        };
      }

      const now = new Date().toISOString();
      const memory: MemoryRow = {
        id: newId(),
        scopeId: this.scopeId,
        seq: this.seqCountTx(),
        goalId: input.goalId ?? null,
        kind: input.kind ?? 'fact',
        content,
        sourceType,
        sourceRef: input.sourceRef ?? null,
        trustLevel,
        confidence: input.confidence ?? null,
        status: 'active',
        core: false,
        supersededBy: null,
        supersedes: null,
        createdAt: now,
        updatedAt: now,
      };
      if (input.core)
        this.assertCoreFitsTx([...this.selectedTx(), memory], CORE_BUDGET);
      memory.core = input.core === true;
      this.insertMemoryTx(memory);
      this.recordVersionTx(
        memory.id,
        'create',
        actor,
        input.reason ?? null,
        null,
        memory,
      );
      if (memory.core)
        this.recordVersionTx(
          memory.id,
          'select',
          actor,
          input.reason ?? 'selected on remember',
          null,
          memory,
        );
      return {
        memory,
        created: true,
        evidenceAdded: false,
        coreDropped: false,
      };
    });
    if (result.created || result.evidenceAdded) this.publish();
    return result;
  }

  /**
   * Store one auto-extracted candidate (PRD §4.4 F03): status `candidate`,
   * trust `agent_inferred`, operator `worker`. Candidates never render in
   * wake(), default recall(), or the MEMORY.md export until a user promotes
   * them. A candidate that repeats an existing row is not written twice.
   */
  candidate(input: {
    text: string;
    kind: MemoryKind;
    confidence: number | null;
    sourceRef: string | null;
    /** Active memory this candidate contradicts; applied on promote. */
    supersedes?: number | null;
    reason?: string;
  }): MemoryRow | null {
    const content = normalizeLine(input.text, 'memory');
    const key = dedupeKey(content);
    const result = this.db.transaction((): MemoryRow | null => {
      if (this.activeByTextTx(key) || this.candidateByTextTx(key)) return null;
      const memory: MemoryRow = {
        id: newId(),
        scopeId: this.scopeId,
        seq: this.seqCountTx(),
        goalId: null,
        kind: input.kind,
        content,
        sourceType: 'agent',
        sourceRef: input.sourceRef,
        trustLevel: 'agent_inferred',
        confidence: input.confidence,
        status: 'candidate',
        core: false,
        supersededBy: null,
        supersedes: input.supersedes ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (memory.supersedes !== null) {
        const target = this.bySeqTx(memory.supersedes);
        if (!target || target.status !== 'active')
          throw new Error(
            `supersede target #${memory.supersedes} is not an active memory`,
          );
      }
      this.insertMemoryTx(memory);
      this.recordVersionTx(
        memory.id,
        'create',
        'worker',
        input.reason ?? 'auto-extracted from history',
        null,
        memory,
      );
      return memory;
    });
    if (result) this.publish();
    return result;
  }

  /**
   * Supersede memory #seq with a revised line. The old memory leaves Core and
   * stays as history. If it was selected and the replacement cannot fit, the
   * new fact is still saved but starts outside Core and `coreDropped` is true:
   * the correction always takes effect, and the caller must re-select or free
   * budget explicitly.
   */
  revise(
    seq: number,
    text: string,
    reason: string,
    actor: MemoryActor = 'chief',
    options: {
      sourceRef?: string | null;
      trustLevel?: MemoryTrustLevel;
      sourceType?: MemorySourceType;
    } = {},
  ): ReviseResult {
    const content = normalizeLine(text, 'memory');
    const result = this.db.transaction((): ReviseResult => {
      const superseded = this.bySeqTx(seq);
      if (!superseded)
        throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
      if (superseded.status !== 'active')
        throw new Error(
          `memory #${seq} is ${superseded.status}; only active memories can be revised`,
        );
      if (dedupeKey(content) === dedupeKey(superseded.content)) {
        // Same fact: "content unchanged" is not "nothing changed". New user
        // confirmation or a new source ref is recorded, published, and
        // re-checked against the rendered Core budget like any evidence update.
        const upgraded =
          (options.trustLevel === 'user_confirmed' || actor === 'user') &&
          superseded.trustLevel !== 'user_confirmed';
        const mayAddEvidence =
          options.trustLevel === 'user_confirmed' ||
          actor === 'user' ||
          superseded.trustLevel !== 'user_confirmed';
        const newEvidence =
          mayAddEvidence &&
          options.sourceRef !== null &&
          options.sourceRef !== undefined &&
          options.sourceRef !== superseded.sourceRef;
        let updated = superseded;
        let evidenceAdded = false;
        let coreDropped = false;
        if (upgraded || newEvidence) {
          evidenceAdded = true;
          updated = {
            ...superseded,
            trustLevel: upgraded ? 'user_confirmed' : superseded.trustLevel,
            sourceType: upgraded ? 'user' : superseded.sourceType,
            sourceRef: newEvidence ? options.sourceRef! : superseded.sourceRef,
            updatedAt: new Date().toISOString(),
          };
          this.run(
            'UPDATE memories SET trust_level = ?, source_type = ?, source_ref = ?, updated_at = ? WHERE id = ?',
            updated.trustLevel,
            updated.sourceType,
            updated.sourceRef,
            updated.updatedAt,
            superseded.id,
          );
          this.recordVersionTx(
            superseded.id,
            'evidence',
            actor,
            [
              reason,
              newEvidence ? `source ${options.sourceRef}` : null,
              upgraded ? 'trust upgraded to user_confirmed' : null,
            ]
              .filter(Boolean)
              .join('; '),
            superseded,
            updated,
          );
          // New metadata renders wider: keep Core inside its budget.
          if (updated.core) {
            const projected = this.selectedTx().map((item) =>
              item.seq === updated.seq ? updated : item,
            );
            if (
              renderCore(projected, CORE_BUDGET, this.activeTx().length)
                .overflow
            ) {
              this.setCoreTx(updated.seq, false);
              updated = { ...updated, core: false };
              coreDropped = true;
              this.recordVersionTx(
                updated.id,
                'deselect',
                actor,
                'evidence made the rendered Core exceed its budget',
                superseded,
                updated,
              );
            }
          }
        }
        return {
          memory: updated,
          superseded: updated,
          changed: false,
          evidenceAdded,
          coreDropped,
        };
      }
      const duplicate = this.activeByTextTx(dedupeKey(content));
      if (duplicate && duplicate.seq !== seq)
        throw new Error(
          `memory #${duplicate.seq} already says that; revise #${duplicate.seq} instead of duplicating it`,
        );
      const now = new Date().toISOString();
      const trustLevel =
        options.trustLevel ??
        (actor === 'user' ? 'user_confirmed' : 'agent_inferred');
      const memory: MemoryRow = {
        ...superseded,
        id: newId(),
        seq: this.seqCountTx(),
        content,
        sourceType: options.sourceType ?? (actor === 'user' ? 'user' : 'agent'),
        // Never inherit the old source: a correction points at its own evidence.
        sourceRef: options.sourceRef ?? null,
        trustLevel,
        confidence: superseded.confidence,
        status: 'active',
        core: false,
        supersededBy: null,
        // The revision itself is the supersede; the target pointer is spent.
        supersedes: null,
        createdAt: now,
        updatedAt: now,
      };
      let coreDropped = false;
      if (superseded.core) {
        const projected = [...this.selectedTx(), memory].filter(
          (item) => item.seq !== superseded.seq,
        );
        if (renderCore(projected, CORE_BUDGET, this.activeTx().length).overflow)
          coreDropped = true;
        else memory.core = true;
      }
      const revisedOld: MemoryRow = {
        ...superseded,
        status: 'superseded',
        core: false,
        supersededBy: memory.id,
        updatedAt: now,
      };
      this.insertMemoryTx(memory);
      this.run(
        'UPDATE memories SET status = ?, core = 0, superseded_by = ?, updated_at = ? WHERE id = ?',
        'superseded',
        memory.id,
        now,
        superseded.id,
      );
      this.recordVersionTx(memory.id, 'create', actor, reason, null, memory);
      if (memory.core)
        this.recordVersionTx(
          memory.id,
          'select',
          actor,
          `${reason} (replacement for #${seq})`,
          null,
          memory,
        );
      this.recordVersionTx(
        superseded.id,
        'supersede',
        actor,
        reason,
        superseded,
        revisedOld,
      );
      return {
        memory,
        superseded: revisedOld,
        changed: true,
        evidenceAdded: false,
        coreDropped,
      };
    });
    if (result.changed || result.evidenceAdded || result.coreDropped)
      this.publish();
    return result;
  }

  /** Mark memory #seq deleted and out of Core; rows are never physically removed. */
  forget(
    seq: number,
    reason: string,
    actor: MemoryActor = 'chief',
  ): { memory: MemoryRow; changed: boolean } {
    const result = this.db.transaction(
      (): { memory: MemoryRow; changed: boolean } => {
        const memory = this.bySeqTx(seq);
        if (!memory)
          throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
        if (memory.status === 'deleted') return { memory, changed: false };
        if (memory.status !== 'active' && memory.status !== 'candidate')
          throw new Error(
            `memory #${seq} is ${memory.status}; only active or candidate memories can be forgotten`,
          );
        const updated: MemoryRow = {
          ...memory,
          status: 'deleted',
          core: false,
          updatedAt: new Date().toISOString(),
        };
        this.run(
          'UPDATE memories SET status = ?, core = 0, updated_at = ? WHERE id = ?',
          'deleted',
          updated.updatedAt,
          memory.id,
        );
        this.recordVersionTx(
          memory.id,
          'delete',
          actor,
          reason,
          memory,
          updated,
        );
        return { memory: updated, changed: true };
      },
    );
    if (result.changed) this.publish();
    return result;
  }

  /** Select an active memory into Core; over budget rejects atomically. */
  select(
    seq: number,
    actor: MemoryActor = 'user',
    reason = 'selected into core',
  ): { memory: MemoryRow; changed: boolean } {
    const result = this.db.transaction(
      (): { memory: MemoryRow; changed: boolean } => {
        const memory = this.bySeqTx(seq);
        if (!memory)
          throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
        if (memory.status !== 'active')
          throw new Error(
            `memory #${seq} is ${memory.status}; only active memories can enter Core`,
          );
        if (memory.core) return { memory, changed: false };
        this.assertCoreFitsTx(
          [...this.selectedTx(), memory],
          CORE_BUDGET,
          this.activeTx().length,
        );
        const updated: MemoryRow = {
          ...memory,
          core: true,
          updatedAt: new Date().toISOString(),
        };
        this.setCoreTx(seq, true);
        this.recordVersionTx(
          memory.id,
          'select',
          actor,
          reason,
          memory,
          updated,
        );
        return { memory: updated, changed: true };
      },
    );
    if (result.changed) this.publish();
    return result;
  }

  /** Remove a memory from Core without forgetting it; still active and searchable. */
  deselect(
    seq: number,
    actor: MemoryActor = 'user',
    reason = 'removed from core',
  ): { memory: MemoryRow; changed: boolean } {
    const result = this.db.transaction(
      (): { memory: MemoryRow; changed: boolean } => {
        const memory = this.bySeqTx(seq);
        if (!memory)
          throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
        if (!memory.core) return { memory, changed: false };
        const updated: MemoryRow = {
          ...memory,
          core: false,
          updatedAt: new Date().toISOString(),
        };
        this.setCoreTx(seq, false);
        this.recordVersionTx(
          memory.id,
          'deselect',
          actor,
          reason,
          memory,
          updated,
        );
        return { memory: updated, changed: true };
      },
    );
    if (result.changed) this.publish();
    return result;
  }

  /**
   * Promote a candidate: status becomes active, trust stays agent_inferred,
   * and it does not enter Core automatically. If the candidate contradicts an
   * active memory (`supersedes`), that memory is superseded in the same
   * transaction. A target the user changed while the candidate was pending is
   * not silently overwritten: promotion fails and the user must re-evaluate.
   */
  promote(
    seq: number,
    actor: MemoryActor = 'user',
    reason = 'promoted from candidates',
  ): { memory: MemoryRow; superseded: MemoryRow | null } {
    const result = this.db.transaction(
      (): {
        memory: MemoryRow;
        superseded: MemoryRow | null;
      } => {
        const memory = this.bySeqTx(seq);
        if (!memory)
          throw new Error(`no memory #${seq} in scope ${this.scopeId}`);
        if (memory.status !== 'candidate')
          throw new Error(
            `memory #${seq} is ${memory.status}; only candidates can be promoted`,
          );
        const duplicate = this.activeByTextTx(dedupeKey(memory.content));
        if (duplicate)
          throw new Error(
            `active memory #${duplicate.seq} already says that; dismiss this candidate instead`,
          );
        const now = new Date().toISOString();
        let superseded: MemoryRow | null = null;
        if (memory.supersedes !== null) {
          const target = this.bySeqTx(memory.supersedes);
          if (!target || target.status !== 'active')
            throw new Error(
              `memory #${memory.supersedes} is ${target?.status ?? 'missing'} since this candidate was extracted; dismiss it and revise the current memory instead`,
            );
          superseded = {
            ...target,
            status: 'superseded',
            core: false,
            supersededBy: memory.id,
            updatedAt: now,
          };
          this.run(
            'UPDATE memories SET status = ?, core = 0, superseded_by = ?, updated_at = ? WHERE id = ?',
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
        }
        const updated: MemoryRow = {
          ...memory,
          status: 'active',
          core: false,
          updatedAt: now,
        };
        this.run(
          'UPDATE memories SET status = ?, core = 0, updated_at = ? WHERE id = ?',
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
        return { memory: updated, superseded };
      },
    );
    this.publish();
    return result;
  }

  // ---- reads

  /**
   * What wake prints: the explicitly selected Core memories, ordered by seq,
   * with a usage footer. Selection is validated on write, so this never drops
   * an entry silently; if a smaller budget is requested than the selection
   * needs, the footer says so instead of truncating.
   */
  wake(budget = CORE_BUDGET): string {
    return this.db.transaction(() => {
      const selected = this.selectedTx();
      return renderCore(selected, budget, this.activeTx().length).text;
    });
  }

  /**
   * Keyword search shared with History: every whitespace-separated term must
   * appear (AND), terms of three or more code points use the trigram FTS index,
   * shorter terms fall back to LIKE (so Chinese words of two characters work).
   * Results are ordered by relevance — FTS rank when the index is used, then
   * exact-phrase hits, then newer memories — and bounded by `limit` and a
   * token budget. Each line carries #seq, kind, trust, date and source ref.
   */
  recall(
    query: string,
    options?: {
      includeHistory?: boolean;
      limit?: number;
      budget?: number;
    },
  ): string {
    // The budget is validated before any early return: the contract covers the
    // COMPLETE returned string, including `(no matches)`.
    const budget = options?.budget ?? 1200;
    const checkBudget = (minimum: number): void => {
      if (!Number.isInteger(budget) || budget < minimum)
        throw new Error(
          `recall budget ${budget} is too small for this result; use at least ${minimum} tokens`,
        );
    };
    const plan = planSearch(query);
    if (plan.terms.length === 0) {
      checkBudget(tokenCost(NO_MATCHES));
      return NO_MATCHES;
    }
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const statusFilter = options?.includeHistory
      ? ''
      : ` AND status = 'active'`;
    const rows = this.db.transaction(() => {
      const clauses = [`m.scope_id = ?${statusFilter}`];
      const args: (string | number)[] = [this.scopeId];
      if (plan.match) clauses.push('memory_fts MATCH ?');
      for (let index = 0; index < plan.short.length; index++) {
        clauses.push("m.content LIKE ? ESCAPE '\\'");
      }
      const selectRank = plan.match ? ', bm25(memory_fts) AS rank' : '';
      const join = plan.match
        ? 'JOIN memory_fts ON memory_fts.mem_id = m.id'
        : '';
      const order = plan.match
        ? 'rank, m.seq DESC'
        : `CASE WHEN m.content LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, m.seq DESC`;
      const sql = `SELECT m.*${selectRank} FROM memories m ${join}
        WHERE ${clauses.join(' AND ')}
        ORDER BY ${order}
        LIMIT ?`;
      // Placeholder order follows the SQL text: WHERE (scope, match, LIKE...),
      // then ORDER BY for the non-FTS fallback, then LIMIT.
      if (plan.match) args.push(plan.match);
      for (const term of plan.short) args.push(`%${escapeLike(term)}%`);
      if (!plan.match) args.push(`%${escapeLike(plan.terms[0])}%`);
      args.push(limit);
      return this.all<Record<string, unknown>>(sql, ...args).map(toMemory);
    });
    if (rows.length === 0) {
      checkBudget(tokenCost(NO_MATCHES));
      return NO_MATCHES;
    }
    // The budget covers the ENTIRE returned string: hit lines, their newlines,
    // the truncation marker and the omission footer. Assemble candidates and
    // measure the final rendering rather than summing line estimates. A budget
    // that cannot even hold the omission footer is an argument error: the
    // contract is never "claim a budget the output exceeds".
    const footer = (omitted: number) =>
      `… ${omitted} more match(es) within this scope; refine the query or raise the budget`;
    const assemble = (hits: string[], omitted: number) =>
      omitted > 0 ? [...hits, footer(omitted)].join('\n') : hits.join('\n');
    const minimum = tokenCost(footer(rows.length));
    checkBudget(minimum);
    const hits: string[] = [];
    for (let index = 0; index < rows.length; index++) {
      const line = recallLine(rows[index]);
      const remaining = rows.length - index;
      const candidate =
        remaining > 1
          ? assemble([...hits, line], remaining - 1)
          : assemble([...hits, line], 0);
      if (tokenCost(candidate) <= budget) {
        hits.push(line);
        continue;
      }
      // It does not fit whole. If nothing was emitted yet, try a truncated
      // line that still leaves room for the footer; otherwise stop here.
      if (hits.length === 0) {
        const chars = [...line];
        for (let end = chars.length; end > 0; end--) {
          // One row is shown (truncated); the rest are the omitted count.
          const shortened = assemble(
            [`${chars.slice(0, end).join('')}…`],
            remaining - 1,
          );
          if (tokenCost(shortened) <= budget) return shortened;
        }
      }
      // Nothing fits: neither a full line nor a truncated one, with the
      // omission footer. Report the budget instead of returning more than it.
      const rendered = assemble(hits, rows.length - hits.length);
      if (tokenCost(rendered) <= budget) return rendered;
      throw new Error(
        `recall budget ${budget} is too small for this result; use at least ${minimum} tokens`,
      );
    }
    return assemble(hits, 0);
  }

  /** Dump for the UI: every memory with provenance plus Core usage. */
  dump(budget = CORE_BUDGET): MemoryDump {
    return this.db.transaction(() => {
      const items: MemoryItem[] = this.all(
        'SELECT * FROM memories WHERE scope_id = ? ORDER BY seq',
        this.scopeId,
      ).map(toMemory);
      return {
        scopeId: this.scopeId,
        items,
        core: this.coreUsageTx(budget),
      };
    });
  }

  /** Monotonic change counter for a scope, for per-conversation Core snapshots. */
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
  /**
   * Publish a write: the version bump and the file export run only once the
   * outermost transaction commits, so a rolled-back operation (operation-id
   * replay, schedule fire, batch) never leaves a stale export or version.
   */
  private publish(): void {
    this.db.afterCommit(() => {
      this.versionCounter += 1;
      this.exportFile();
    });
  }

  // ---- legacy import, core migration, and one-way export

  /**
   * One-time import of the pre-SQLite files: every LOG.txt line (seq = line
   * index, provenance legacy/agent_inferred). The old summary tree is derived
   * data and is retired unread into memory/legacy/TREE. Idempotent and
   * transactional; afterwards the files move into memory/legacy/.
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
          core: false,
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
    });
    // Archive only once the import is committed. If an enclosing transaction
    // rolls back, the source files must still be there for the next attempt;
    // moving them eagerly would consume the only copy of the data.
    this.db.afterCommit(() => {
      const legacyDir = join(this.dir, 'legacy');
      mkdirSync(legacyDir, { recursive: true });
      if (existsSync(logPath)) renameSync(logPath, join(legacyDir, 'LOG.txt'));
      if (existsSync(treeDir)) renameSync(treeDir, join(legacyDir, 'TREE'));
    });
    this.publish();
  }

  /**
   * One-time deterministic Core selection for data that predates explicit
   * selection (or a legacy LOG.txt import): user-confirmed first, then
   * preference/decision, then the rest, oldest first, while the rendered
   * selection fits the budget. Everything else stays active and searchable.
   */
  private migrateCoreSelection(): void {
    const marker = `core-migrated:${this.scopeId}`;
    if (this.get('SELECT 1 FROM memory_meta WHERE key = ?', marker)) return;
    this.db.transaction(() => {
      if (this.get('SELECT 1 FROM memory_meta WHERE key = ?', marker)) return;
      const active = this.all(
        `SELECT * FROM memories WHERE scope_id = ? AND status = 'active' ORDER BY seq`,
        this.scopeId,
      ).map(toMemory);
      const priority = (memory: MemoryRow): number =>
        memory.trustLevel === 'user_confirmed'
          ? 0
          : memory.kind === 'preference' || memory.kind === 'decision'
            ? 1
            : 2;
      const ordered = [...active].sort(
        (a, b) => priority(a) - priority(b) || a.seq - b.seq,
      );
      const selected: MemoryRow[] = [];
      for (const memory of ordered) {
        const projected = [...selected, memory];
        if (renderCore(projected, CORE_BUDGET, active.length).overflow)
          continue;
        selected.push(memory);
        this.setCoreTx(memory.seq, true);
        const after = { ...memory, core: true };
        this.recordVersionTx(
          memory.id,
          'select',
          'migration',
          'initial core selection during upgrade',
          memory,
          after,
        );
      }
      this.run(
        'INSERT INTO memory_meta (key, value) VALUES (?, ?)',
        marker,
        JSON.stringify({
          selected: selected.map((memory) => memory.seq),
          active: active.length,
          budget: CORE_BUDGET,
        }),
      );
    });
    this.publish();
  }

  /** Regenerate the read-only MEMORY.md export; the DB is never read back from it. */
  exportFile(): void {
    const { items, core } = this.dump();
    const active = items.filter((item) => item.status === 'active');
    const lines = [
      `# Memory（${this.scopeId}）`,
      '',
      '> 只读导出：由 Tian Agent 服务在每次写入后生成。数据库是唯一写入来源，请勿手改本文件。',
      `> Core Memory：${core.selected} 条已选入，约 ${core.tokens}/${core.budget} tokens；其余有效记忆可检索。`,
      '',
      '## 有效记忆',
      '',
      ...(active.length === 0
        ? ['（暂无有效记忆）']
        : active.map(
            (item) =>
              `- ${item.core ? '[core] ' : ''}#${item.seq} [${item.kind}] ${item.trustLevel}${item.sourceRef ? ` ${item.sourceRef}` : ''} ${item.createdAt.slice(0, 10)} — ${item.content}`,
          )),
      '',
    ];
    atomicWrite(join(this.dir, 'MEMORY.md'), lines.join('\n'));
  }
}
