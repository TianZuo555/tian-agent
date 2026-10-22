import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import type { MemoryConfirmation, MemoryEvidence } from '../shared/types.js';
import type { InputEvidence } from './provenance.js';

export interface EvidenceInput {
  sourceRef: string;
  excerpt: string;
  actor: string;
  relation: 'direct' | 'paraphrase' | 'inference';
  observedAt: string;
}

export interface ConfirmationInput {
  sourceRef: string;
  method: 'explicit-save' | 'review' | 'legacy';
}

const key = (...parts: string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Validate model-supplied references against service-owned source records. */
export function resolveMemoryEvidence(
  db: Db,
  scopeId: string,
  claim: string,
  ref: string,
  excerpt: string | undefined,
  current?: { conversationId: string; input: InputEvidence | null },
): EvidenceInput {
  const input = current?.input;
  let source: { text: string; role: string; at: string } | undefined;
  if (input && ref === `conv:${current!.conversationId}#${input.entryId}`) {
    source = {
      text: input.text,
      role: input.kind,
      at: new Date().toISOString(),
    };
  } else if (ref === `conv:${current?.conversationId}`) {
    // A conversation without an entry cannot cite a statement.
    throw new Error('Evidence reference must identify a source entry');
  } else {
    const match = /^conv:([^#]+)#(.+)$/.exec(ref);
    const event = /^event:(.+)$/.exec(ref);
    if (!match && !event)
      throw new Error('Evidence reference must identify a source entry');
    source = db.sqlite
      .prepare(`SELECT text, role, at FROM history_entries
      WHERE scope_id = ? AND conversation_id = ? AND entry_id = ?`)
      .get(scopeId, match?.[1] ?? '', match?.[2] ?? event![1]) as typeof source;
  }
  if (!source)
    throw new Error('Evidence reference does not exist in this scope');
  const fragment = excerpt ?? source.text;
  if (!source.text.trim())
    return {
      sourceRef: ref,
      excerpt: '',
      actor: source.role,
      relation: 'inference',
      observedAt: source.at,
    };
  if (!fragment.trim() || !source.text.includes(fragment))
    throw new Error('Evidence excerpt is not present in the source');
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  return {
    sourceRef: ref,
    excerpt: fragment,
    actor: source.role ?? 'external',
    relation: normalize(claim) === normalize(fragment) ? 'direct' : 'inference',
    observedAt: source.at,
  };
}

export function addMemoryEvidence(
  db: Db,
  memoryId: string,
  evidence: EvidenceInput,
): boolean {
  // One source excerpt is one piece of evidence; relation/actor refinements
  // must not create duplicate evidence rows for the same citation.
  const id = key(memoryId, evidence.sourceRef, evidence.excerpt);
  return (
    db.sqlite
      .prepare(`INSERT OR IGNORE INTO memory_evidence
    (id, memory_id, source_ref, excerpt, source_actor, relation, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        memoryId,
        evidence.sourceRef,
        evidence.excerpt,
        evidence.actor,
        evidence.relation,
        evidence.observedAt,
      ).changes > 0
  );
}

export function confirmMemory(
  db: Db,
  memoryId: string,
  content: string,
  confirmation: ConfirmationInput,
): boolean {
  return (
    db.sqlite
      .prepare(`INSERT OR IGNORE INTO memory_confirmations
    (id, memory_id, source_ref, content, method, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        key(memoryId, confirmation.sourceRef, content, confirmation.method),
        memoryId,
        confirmation.sourceRef,
        content,
        confirmation.method,
        new Date().toISOString(),
      ).changes > 0
  );
}

export function memoryEvidence(db: Db, memoryId: string): MemoryEvidence[] {
  return db.sqlite
    .prepare(`SELECT source_ref AS sourceRef, excerpt, source_actor AS actor,
    relation, observed_at AS observedAt FROM memory_evidence WHERE memory_id = ? ORDER BY rowid`)
    .all(memoryId) as unknown as MemoryEvidence[];
}

export function memoryConfirmations(
  db: Db,
  memoryId: string,
): MemoryConfirmation[] {
  return db.sqlite
    .prepare(`SELECT source_ref AS sourceRef, content, method, confirmed_at AS confirmedAt
    FROM memory_confirmations WHERE memory_id = ? ORDER BY rowid`)
    .all(memoryId) as unknown as MemoryConfirmation[];
}
