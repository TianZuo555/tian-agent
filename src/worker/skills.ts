import { randomUUID } from 'node:crypto';
import type { Db, RunRow } from './db.js';
import type { EventLog } from './events.js';
import type {
  RunInjection,
  SkillItem,
  SkillStatus,
  SkillVerification,
} from '../shared/types.js';

export type SkillRow = SkillItem;
export type RunAttemptSummary = {
  attempt: number;
  status: string;
  error: string | null;
};

/** Everything a reviewer may inspect from one finished run (PRD §6.1). */
export interface ExperienceInput {
  run: RunRow;
  report: string;
  attempts: RunAttemptSummary[];
  messages: { sender: string; body: string }[];
}

/** One proposed reusable procedure; never persisted before human approval. */
export interface SkillCandidate {
  name: string;
  description: string;
  body: string;
}

/**
 * Pluggable experience extractor. The default implementation is deterministic
 * and offline-testable; a model-backed one can be added later behind the same
 * interface without touching the run pipeline.
 */
export interface ExperienceExtractor {
  extract(input: ExperienceInput): SkillCandidate[];
}

const MAX_BODY = 20_000;

const slug = (value: string, fallback: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 8)
    .join('-')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return cleaned || fallback;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasCJK = (value: string) =>
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(
    value,
  );

/**
 * Skill ↔ task matching: the normalized name as a whole, or every name token
 * (a "keyword" view of the name) appearing in the task description. Short
 * ASCII tokens need word boundaries so "ci" does not match "special".
 */
export function skillMatches(name: string, taskText: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const haystack = normalize(taskText);
  const needle = normalize(name);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(' ').filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((token) =>
    hasCJK(token)
      ? haystack.includes(token)
      : new RegExp(
          `(^|[^\\p{L}\\p{N}])${escapeRegex(token)}([^\\p{L}\\p{N}]|$)`,
          'u',
        ).test(haystack),
  );
}

interface StepSection {
  title: string;
  markdown: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const STEP_WORD = /\b(steps?|procedure|workflow)\b/i;

/**
 * Deterministic offline extractor: a candidate exists only when the run
 * succeeded AND the report contains an explicit, delimited procedure — either
 * a steps/procedure/workflow heading section or a run of at least three list
 * items. Failed or vague runs yield nothing; failure lessons stay in History.
 */
export class RuleBasedExtractor implements ExperienceExtractor {
  extract(input: ExperienceInput): SkillCandidate[] {
    const { run, report } = input;
    if (run.status !== 'done' || report.trim().length < 40) return [];
    const section = findStepSection(report);
    if (!section) return [];
    const firstLine = run.prompt.split('\n')[0].trim().slice(0, 120);
    return [
      {
        name: slug(firstLine, `procedure-${run.id.slice(2, 10)}`),
        description: `Successful procedure from run ${run.id} attempt ${run.attempt}: ${firstLine}`,
        body: `# ${firstLine}\n\n${section.markdown}`.slice(0, MAX_BODY),
      },
    ];
  }
}

function findStepSection(report: string): StepSection | null {
  const lines = report.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const heading = HEADING.exec(lines[index]);
    if (!heading || !STEP_WORD.test(heading[2])) continue;
    const level = heading[1].length;
    const body: string[] = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = HEADING.exec(lines[cursor]);
      if (next && next[1].length <= level) break;
      body.push(lines[cursor]);
    }
    return { title: heading[2], markdown: body.join('\n').trim() };
  }
  // No dedicated heading: a run of >= 3 consecutive list items is a procedure.
  for (let index = 0; index < lines.length; index += 1) {
    if (!LIST_ITEM.test(lines[index])) continue;
    let end = index;
    while (end + 1 < lines.length && LIST_ITEM.test(lines[end + 1])) end += 1;
    if (end - index + 1 >= 3)
      return {
        title: lines[index].replace(LIST_ITEM, '').trim().slice(0, 60),
        markdown: lines.slice(index, end + 1).join('\n'),
      };
    index = end;
  }
  return null;
}

const mapSkill = (value: Record<string, unknown>): SkillRow => ({
  id: value.id as string,
  scopeId: value.scope_id as string,
  name: value.name as string,
  description: value.description as string,
  body: value.body as string,
  version: value.version as number,
  status: value.status as SkillStatus,
  verification: value.verification as SkillVerification,
  sourceRefs: JSON.parse((value.source_refs as string) ?? '[]') as string[],
  createdAt: value.created_at as string,
  updatedAt: value.updated_at as string,
});

/**
 * Skill Registry (PRD §6.2, M5): versioned reusable procedures with human
 * approval. The registry owns the `skills` table and is the only writer of
 * skill rows. Hard rule: unapproved candidates never reach a worker prompt —
 * `promptBlock` re-checks status at render time, defense in depth.
 */
export class SkillRegistry {
  constructor(
    private db: Db,
    private events?: EventLog,
    private extractor: ExperienceExtractor = new RuleBasedExtractor(),
    /** Notifies the service that the skill list changed (UI refresh). */
    private onChanged?: () => void,
  ) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'candidate',
        verification TEXT NOT NULL DEFAULT 'unverified',
        source_refs TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS skills_scope_name_version
        ON skills(scope_id, name, version);
      CREATE INDEX IF NOT EXISTS skills_scope_status ON skills(scope_id, status);
    `);
  }

  private touch(): void {
    this.onChanged?.();
  }

  private record(
    skillId: string,
    action: string,
    scopeId: string,
    payload: Record<string, unknown>,
  ): void {
    this.events?.record({
      id: `skill:${skillId}:${action}:${Date.now()}`,
      type: `skill.${action}`,
      actor: action === 'candidate' ? 'system' : 'user',
      scopeId,
      summary: `Skill ${action}: ${skillId}`,
      payload,
    });
  }

  get(id: string): SkillRow | undefined {
    const value = this.db.sqlite
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return value ? mapSkill(value) : undefined;
  }

  list(scopeId: string | null): SkillRow[] {
    return (
      this.db.sqlite
        .prepare(
          'SELECT * FROM skills WHERE (? IS NULL OR scope_id = ?) ORDER BY name, version',
        )
        .all(scopeId, scopeId) as Record<string, unknown>[]
    ).map(mapSkill);
  }

  /** All versions of one skill name, oldest first — the version history. */
  history(scopeId: string, name: string): SkillRow[] {
    return (
      this.db.sqlite
        .prepare(
          'SELECT * FROM skills WHERE scope_id = ? AND name = ? ORDER BY version',
        )
        .all(scopeId, name) as Record<string, unknown>[]
    ).map(mapSkill);
  }

  latest(scopeId: string, name: string): SkillRow | undefined {
    const value = this.db.sqlite
      .prepare(
        'SELECT * FROM skills WHERE scope_id = ? AND name = ? ORDER BY version DESC LIMIT 1',
      )
      .get(scopeId, name) as Record<string, unknown> | undefined;
    return value ? mapSkill(value) : undefined;
  }

  /**
   * Persist an extracted candidate. A still-open candidate with identical
   * body absorbs the new source refs instead of spawning another version.
   */
  recordExtraction(
    input: {
      scopeId: string;
      name: string;
      description: string;
      body: string;
      sourceRefs: string[];
    },
    now = new Date(),
  ): SkillRow {
    return this.db.transaction(() => {
      const latest = this.latest(input.scopeId, input.name);
      if (
        latest &&
        latest.status === 'candidate' &&
        latest.body === input.body
      ) {
        const merged = [
          ...new Set([...latest.sourceRefs, ...input.sourceRefs]),
        ];
        this.db.sqlite
          .prepare(
            'UPDATE skills SET source_refs = ?, updated_at = ? WHERE id = ?',
          )
          .run(JSON.stringify(merged), now.toISOString(), latest.id);
        this.touch();
        return this.get(latest.id)!;
      }
      const skill: SkillRow = {
        id: `s-${randomUUID()}`,
        scopeId: input.scopeId,
        name: input.name,
        description: input.description.slice(0, 500),
        body: input.body.slice(0, MAX_BODY),
        version: (latest?.version ?? 0) + 1,
        status: 'candidate',
        verification: 'unverified',
        sourceRefs: input.sourceRefs,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.db.sqlite
        .prepare(
          'INSERT INTO skills (id,scope_id,name,description,body,version,status,verification,source_refs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          skill.id,
          skill.scopeId,
          skill.name,
          skill.description,
          skill.body,
          skill.version,
          skill.status,
          skill.verification,
          JSON.stringify(skill.sourceRefs),
          skill.createdAt,
          skill.updatedAt,
        );
      this.record(skill.id, 'candidate', skill.scopeId, {
        name: skill.name,
        version: skill.version,
        sourceRefs: skill.sourceRefs,
      });
      this.touch();
      return skill;
    });
  }

  /** candidate → approved; only the user may take this step. */
  approve(id: string, now = new Date()): SkillRow {
    return this.db.transaction(() => {
      const skill = this.get(id);
      if (!skill) throw new Error(`Unknown skill: ${id}`);
      if (skill.status !== 'candidate')
        throw new Error(
          `Only candidate skills can be approved (${skill.name} v${skill.version} is ${skill.status})`,
        );
      const superseded = (
        this.db.sqlite
          .prepare(
            "SELECT id FROM skills WHERE scope_id = ? AND name = ? AND version < ? AND status = 'approved'",
          )
          .all(skill.scopeId, skill.name, skill.version) as { id: string }[]
      ).map((value) => value.id);
      this.db.sqlite
        .prepare(
          "UPDATE skills SET status = 'superseded', updated_at = ? WHERE scope_id = ? AND name = ? AND version < ? AND status = 'approved'",
        )
        .run(now.toISOString(), skill.scopeId, skill.name, skill.version);
      this.db.sqlite
        .prepare(
          "UPDATE skills SET status = 'approved', updated_at = ? WHERE id = ?",
        )
        .run(now.toISOString(), id);
      this.record(id, 'approved', skill.scopeId, {
        name: skill.name,
        version: skill.version,
        superseded,
      });
      this.touch();
      return this.get(id)!;
    });
  }

  /** User withdraws a candidate or withdraws approval; the row is kept. */
  retire(id: string, reason: string | null = null, now = new Date()): SkillRow {
    return this.db.transaction(() => {
      const skill = this.get(id);
      if (!skill) throw new Error(`Unknown skill: ${id}`);
      if (!['candidate', 'approved'].includes(skill.status))
        throw new Error(
          `Only candidate or approved skills can be retired (${skill.name} v${skill.version} is ${skill.status})`,
        );
      this.db.sqlite
        .prepare(
          "UPDATE skills SET status = 'retired', updated_at = ? WHERE id = ?",
        )
        .run(now.toISOString(), id);
      this.record(id, 'retired', skill.scopeId, {
        name: skill.name,
        version: skill.version,
        reason,
      });
      this.touch();
      return this.get(id)!;
    });
  }

  /**
   * A run loaded this version and failed: retire it, mark it failed, and
   * restore the newest earlier superseded version as approved. Every version
   * row is kept, so the full history stays auditable.
   */
  rollback(
    id: string,
    reason: string | null = null,
    now = new Date(),
  ): SkillRow {
    return this.db.transaction(() => {
      const skill = this.get(id);
      if (!skill) throw new Error(`Unknown skill: ${id}`);
      if (skill.status !== 'approved')
        throw new Error(
          `Only the currently approved version can be rolled back (${skill.name} v${skill.version} is ${skill.status})`,
        );
      const previous = this.db.sqlite
        .prepare(
          "SELECT * FROM skills WHERE scope_id = ? AND name = ? AND version < ? AND status = 'superseded' ORDER BY version DESC LIMIT 1",
        )
        .get(skill.scopeId, skill.name, skill.version) as
        | Record<string, unknown>
        | undefined;
      this.db.sqlite
        .prepare(
          "UPDATE skills SET status = 'retired', verification = 'failed', updated_at = ? WHERE id = ?",
        )
        .run(now.toISOString(), id);
      const restored = previous ? mapSkill(previous) : null;
      if (restored)
        this.db.sqlite
          .prepare(
            "UPDATE skills SET status = 'approved', updated_at = ? WHERE id = ?",
          )
          .run(now.toISOString(), restored.id);
      this.record(id, 'rollback', skill.scopeId, {
        name: skill.name,
        version: skill.version,
        restored: restored?.id ?? null,
        reason,
      });
      this.touch();
      return this.get(id)!;
    });
  }

  /** Approved versions of a scope whose name matches the task description. */
  matchApproved(scopeId: string, taskText: string, limit = 3): SkillRow[] {
    const latest = new Map<string, SkillRow>();
    for (const skill of this.list(scopeId)) {
      if (skill.status !== 'approved') continue;
      const current = latest.get(skill.name);
      if (!current || skill.version > current.version)
        latest.set(skill.name, skill);
    }
    return [...latest.values()]
      .filter((skill) => skillMatches(skill.name, taskText))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * The prompt block for a worker: only currently approved versions are
   * rendered, re-checked at render time so a candidate can never leak into a
   * prompt, even if it was recorded on the run row.
   */
  promptBlock(run: Pick<RunRow, 'injectedSkills'>): string {
    const parts: string[] = [];
    for (const ref of (run.injectedSkills ?? []) as RunInjection[]) {
      const skill = this.get(ref.id);
      if (!skill || skill.status !== 'approved') continue;
      parts.push(`## ${skill.name} (v${skill.version})\n\n${skill.body}`);
    }
    if (parts.length === 0) return '';
    return [
      'SKILLS. The project owner approved these procedures for tasks like this one. Apply them where they fit; if a step fails or no longer applies, say so in your report instead of silently skipping it.',
      '',
      ...parts,
    ].join('\n');
  }

  /**
   * Experience review of one finished run (PRD §6.1): failures mark injected
   * versions failed; evidence-rich successes produce candidates with source
   * refs. Every write is transactional, so an extractor crash damages nothing.
   */
  review(run: RunRow, report: string): void {
    if (run.status === 'failed' && run.injectedSkills?.length) {
      for (const ref of run.injectedSkills) {
        this.db.sqlite
          .prepare(
            "UPDATE skills SET verification = 'failed', updated_at = ? WHERE id = ? AND status = 'approved'",
          )
          .run(new Date().toISOString(), ref.id);
      }
      this.touch();
    }
    const attempts = this.db.sqlite
      .prepare(
        'SELECT attempt, status, error FROM run_attempts WHERE run_id = ? ORDER BY attempt',
      )
      .all(run.id) as RunAttemptSummary[];
    const candidates = this.extractor.extract({
      run,
      report,
      attempts,
      messages: this.db.listAgentMessages(run.id),
    });
    const ref = `run:${run.id}:attempt:${run.attempt}`;
    for (const candidate of candidates)
      this.recordExtraction({
        scopeId: run.projectId,
        name: candidate.name,
        description: candidate.description,
        body: candidate.body,
        sourceRefs: [ref],
      });
  }
}
