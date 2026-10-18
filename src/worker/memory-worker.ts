import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import type { EventLog } from './events.js';
import type { MemoryKind } from './memory.js';
import { GLOBAL_SCOPE, type Scopes } from './scopes.js';

/**
 * Memory Worker (PRD §4.4 F03): background candidate extraction inside the
 * resident service, without spending a Chief conversation turn.
 *
 *   Collect   → new history rows per scope, from the worker's own cursor
 *   Extract   → injectable `MemoryExtractor` (deterministic heuristics default)
 *   Classify  → kind + confidence on every line
 *   Deduplicate → skip lines memory_fts already knows
 *   Resolve   → a candidate contradicting an active memory records `supersedes`
 *   Persist   → status `candidate`; wake() only renders active memory, so
 *               Core Memory is unchanged until the user promotes a candidate
 *
 * All persistence happens in one transaction: if the extractor throws, the
 * cursor stays put and existing memory is untouched. Candidates are written
 * with actor `worker` and trust `agent_inferred` (F05); promotion, dismissal
 * and revision stay a user decision in the Memory panel.
 *
 * The extractor is the seam for a Magpie-backed model. PRD §13 question 6
 * (whether the worker should use a cheap model) is deliberately undecided, so
 * nothing here calls a model and the default stays offline-testable.
 */

export type MemoryTrigger =
  | 'task-completed'
  | 'conversation-idle'
  | 'user-correction'
  | 'manual';

/** One indexed history line the extractor may draw from. */
export interface MemorySource {
  /** `conv:<id>#<entry>` or `event:<id>`, matching search_history refs. */
  ref: string;
  kind: 'message' | 'tool_call' | 'tool_result' | 'event';
  role: string | null;
  at: string;
  text: string;
}

export interface ExtractInput {
  scopeId: string;
  /** Rows collected since the last pass, oldest first. */
  sources: MemorySource[];
  /** The scope's active memories, for contradiction detection. */
  active: { seq: number; content: string; kind: MemoryKind }[];
}

export interface ExtractedMemory {
  text: string;
  kind: MemoryKind;
  confidence: number;
  /** History ref the line came from (F05 provenance). */
  sourceRef: string;
}

/** The injectable extraction step. */
export interface MemoryExtractor {
  extract(input: ExtractInput): Promise<ExtractedMemory[]>;
}

/** The slice of HistoryIndex the worker needs; fakeable in tests. */
export interface MemoryHistorySource {
  syncAll(scopeIds?: readonly string[]): Promise<void>;
}

export interface MemoryWorkerDeps {
  db: Db;
  scopes: Scopes;
  history: MemoryHistorySource;
  events: EventLog;
  /** Defaults to the deterministic heuristic extractor. */
  extractor?: MemoryExtractor;
  /** Injectable clock (throttling, timestamps). */
  now?: () => Date;
  /** While true (closing/maintenance) triggers are refused. */
  isPaused?: () => boolean;
  /** Minimum spacing between automatic runs per scope. */
  minIntervalMs?: number;
  /** Push the Memory panel update for a scope that gained candidates. */
  emitMemory?: (scopeId: string) => void;
}

export interface RunResult {
  scopeId: string;
  /** False when paused, throttled, or already running for the scope. */
  ran: boolean;
  sources: number;
  candidates: number;
  duplicates: number;
}

const DEFAULT_MIN_INTERVAL_MS = 30_000;
const MAX_SOURCES = 200;
const MAX_BYTES = 280;
const CURSOR_PREFIX = 'memory-worker:';
/** Similarity at or above this means "same memory", not a new one. */
const DUPLICATE_SIMILARITY = 0.8;
/** Similarity at or above this (but below duplicate) reads as a contradiction. */
const CONFLICT_SIMILARITY = 0.45;

const emptyResult = (scopeId: string): RunResult => ({
  scopeId,
  ran: true,
  sources: 0,
  candidates: 0,
  duplicates: 0,
});

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const sha = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'we',
  'they',
  'he',
  'she',
  'my',
  'your',
  'our',
  'their',
  'me',
  'us',
  'them',
  'at',
  'by',
  'from',
  'as',
  'so',
  'if',
  'then',
  'than',
  'do',
  'does',
  'did',
  'not',
  'no',
  'yes',
  'ok',
  'okay',
  'just',
  'really',
  'please',
  'thanks',
  'thank',
  'can',
  'could',
  'would',
  'should',
  'will',
  'have',
  'has',
  'had',
  'there',
  'here',
  'what',
  'which',
  'who',
  'how',
  'when',
  'where',
  'why',
  'also',
  'very',
  'too',
  'about',
  'into',
  'over',
  'after',
  'before',
  'now',
  'today',
  'tomorrow',
  'yesterday',
  'still',
  'again',
  'some',
  'any',
  'all',
  'more',
  'most',
  'other',
  'one',
  'two',
  'new',
  'get',
  'got',
  'make',
  'made',
  'let',
  'lets',
  'like',
  'want',
  'need',
  'use',
  'using',
  'used',
  'see',
  'look',
  'looks',
  'think',
  'know',
  'go',
  'going',
  'come',
  'well',
  'good',
  'bad',
  'sure',
  'maybe',
  'probably',
  'actually',
  'basically',
  'thing',
  'things',
  'stuff',
  'bit',
  'lot',
  'etc',
  '的',
  '了',
  '是',
  '我',
  '你',
  '他',
  '她',
  '它',
  '们',
  '在',
  '有',
  '和',
  '就',
  '都',
  '也',
  '很',
  '吧',
  '吗',
  '呢',
  '啊',
  '哦',
  '嗯',
  '这',
  '那',
  '个',
  '把',
  '被',
  '给',
  '让',
  '对',
  '从',
  '到',
  '会',
  '能',
  '要',
  '可以',
  '什么',
  '怎么',
  '现在',
  '今天',
  '然后',
  '所以',
  '但是',
  '因为',
  '如果',
  '还是',
  '一下',
  '这样',
  '那样',
  '这个',
  '那个',
]);

/** First-person statements of a durable preference. */
const PREFERENCE_PATTERNS = [
  /\bI (?:always|usually|generally|never) (?:prefer|use|want|like|avoid)\b/i,
  /\bI(?:'d| would)? (?:prefer|rather)\b/i,
  /\bmy preference is\b/i,
  /\bI don't (?:like|want|use)\b/i,
  /\bplease (?:always|never)\b/i,
  /我(?:更|比较)?(?:喜欢|偏好|习惯|不喜欢|讨厌)/,
  /以后(?:都|请|一律)/,
  /请(?:始终|一律|不要)/,
  /默认(?:用|使用|走)/,
];

/** A decision that outlives the conversation. */
const DECISION_PATTERNS = [
  /\b(?:we|I) (?:decided|agreed|chose|settled on|will use|will go with)\b/i,
  /\bdecision:\b|\bconvention:\b|\bpolicy:\b/i,
  /\bfrom now on\b/i,
  /\b(?:we're|we are|I'm|I am) (?:using|going with|sticking with|switching to)\b/i,
  /(?:决定|约定|定下来|敲定|统一)(?:使用|用|走|采用|为)/,
  /以后(?:统一|都)?(?:用|使用|走|采用)/,
  /(?:规范|约定|政策)[:：]/,
];

/** Environment and setup facts. */
const ENVIRONMENT_PATTERNS = [
  /\b(?:runs?|works?|built|deployed|installed|hosted) (?:on|at|in)\b/i,
  /\bnode(?:\.js)? \d+/i,
  /\bpnpm\b|\bnpm\b|\byarn\b|\bbun\b/i,
  /\b(?:macos|linux|windows|ubuntu|debian|arch)\b/i,
  /\b(?:python|rust|go|java|typescript|electron) \d+(?:\.\d+)*/i,
  /\b(?:database|db|server|service) (?:is|runs|listens)\b/i,
  /\bport \d{2,5}\b/i,
  /(?:环境|配置|版本|路径|端口|目录|依赖|部署)(?:是|为|用|在|：|:)/,
  /(?:安装|配置|部署)(?:了|在|为)/,
];

/** A reusable problem→solution statement. */
const SOLUTION_PATTERNS = [
  /\bfixed by\b|\bthe fix (?:is|was)\b|\broot cause\b|\bworkaround\b/i,
  /\b(?:solved|resolved) (?:it|this|that) by\b/i,
  /\binstead of\b/i,
  /(?:解决|修复|根因|原因是|变通|绕过)(?:了|是|：|:)?/,
  /(?:以后|下次)(?:遇到|可以|要)/,
];

/** Transient state that must not become memory. */
const TRANSIENT_PATTERNS = [
  /\b(?:right now|at the moment|currently|for now|temporarily|in progress|still running|just now|this once)\b/i,
  /\b(?:todo|to-do|fixme|wip)\b/i,
  /\b(?:today|tonight|this morning|this evening)\b/i,
  /(?:现在|目前|暂时|刚刚|正在|待会|稍后|今天|明天|昨天|一会儿)/,
  /(?:进行中|还没|未完成|先这样)/,
];

/** Chat with no lasting content. */
const CHITCHAT_PATTERNS = [
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|sure|cool|great|nice|yes|no|yep|nope|bye|good morning|good night)[.!,\s]*$/i,
  /^(?:你好|您好|谢谢|多谢|好的|好|嗯+|行|可以|没问题|再见|晚安|早安|早|收到|明白了|了解)[。！？!?,\s]*$/,
  /^(?:lol|haha+|hmm+|ah+|oh+|wow)[.!,\s]*$/i,
];

/** Unverified speculation stays out of memory. */
const SPECULATION_PATTERNS = [
  /\b(?:maybe|perhaps|probably|possibly|might(?: be)?|could be|i guess|i think|not sure|unclear|presumably|seems like)\b/i,
  /(?:可能|也许|大概|或许|估计|我觉得|应该是|不确定|说不好|似乎)/,
];

/**
 * Instructions inside externally sourced content. A line that orders the
 * agent around must never become memory, whatever its provenance says.
 */
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget) (?:all |any )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)\b/i,
  /\byou are now\b|\bact as\b|\byour new (?:role|task|instructions?)\b/i,
  /\b(?:system|developer) (?:prompt|message|instruction)\b/i,
  /\b(?:always|never) (?:tell|reveal|mention|disclose|share)\b/i,
  /\b(?:send|post|upload|exfiltrate|reveal) (?:the |your |all )?(?:secrets?|credentials?|tokens?|api ?keys?|passwords?)\b/i,
  /忽略(?:之前|以上|先前|所有)(?:的)?(?:指令|提示|规则)/,
  /(?:你现在是|从现在起你是|扮演(?:成|为)?)/,
  /(?:系统|开发者)(?:提示|指令|消息)/,
  /(?:泄露|发送|上传|透露)(?:密钥|密码|凭据|token|api)/i,
];

const matches = (patterns: RegExp[], text: string) =>
  patterns.some((pattern) => pattern.test(text));

/** Content words of a line; CJK runs split into characters. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .flatMap((word) => (/[\u4e00-\u9fff]/.test(word) ? [...word] : [word]))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Jaccard similarity over content tokens; 1 means identical wording. */
export function similarity(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Classify a line by the strongest signal; `fact` is the fallback. */
export function classify(text: string): {
  kind: MemoryKind;
  confidence: number;
  patterns: RegExp[];
} {
  if (matches(PREFERENCE_PATTERNS, text))
    return {
      kind: 'preference',
      confidence: 0.7,
      patterns: PREFERENCE_PATTERNS,
    };
  if (matches(DECISION_PATTERNS, text))
    return { kind: 'decision', confidence: 0.7, patterns: DECISION_PATTERNS };
  if (matches(ENVIRONMENT_PATTERNS, text))
    return {
      kind: 'environment',
      confidence: 0.6,
      patterns: ENVIRONMENT_PATTERNS,
    };
  if (matches(SOLUTION_PATTERNS, text))
    return { kind: 'outcome', confidence: 0.6, patterns: SOLUTION_PATTERNS };
  return { kind: 'fact', confidence: 0.5, patterns: [] };
}

/** True for lines that must never become memory. */
export function isNoise(source: MemorySource): boolean {
  const text = normalize(source.text);
  if (!text) return true;
  // Tool output repeats across runs; only prose and business events count.
  if (source.kind === 'tool_call' || source.kind === 'tool_result') return true;
  if (source.kind === 'event') return true; // handled by the goal engine's own stores
  if (matches(CHITCHAT_PATTERNS, text)) return true;
  if (matches(INSTRUCTION_PATTERNS, text)) return true;
  if (matches(TRANSIENT_PATTERNS, text)) return true;
  if (matches(SPECULATION_PATTERNS, text)) return true;
  // A line needs a few content words to say anything durable.
  return tokens(text).length < 3;
}

/** Keep the clause that carries the signal so a candidate stays one line. */
function focusSentence(text: string, patterns: RegExp[]): string {
  const sentences = normalize(text)
    .split(/(?<=[.!?。！？])\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return normalize(text);
  return (
    sentences.find((sentence) => matches(patterns, sentence)) ?? normalize(text)
  );
}

/**
 * The deterministic default extractor: offline, explainable, no model call.
 * Extract and Classify in one pass; Deduplicate/Resolve stay in the worker.
 */
export class HeuristicExtractor implements MemoryExtractor {
  async extract(input: ExtractInput): Promise<ExtractedMemory[]> {
    const results: ExtractedMemory[] = [];
    for (const source of input.sources) {
      if (isNoise(source)) continue;
      const { kind, confidence, patterns } = classify(source.text);
      if (kind === 'fact' && tokens(source.text).length < 6) continue;
      const text = focusSentence(source.text, patterns)
        .replace(/^[-*•]\s*/, '')
        .trim();
      if (!text || bytes(text) > MAX_BYTES) continue;
      results.push({ text, kind, confidence, sourceRef: source.ref });
    }
    return results;
  }
}

/**
 * Resolve Conflicts: the newest active memory of the same kind this line
 * contradicts — overlapping topic, different facts. The result is a
 * supersede *candidate*: the contradiction applies only when the user
 * promotes it (MemoryStore.promote applies `supersedes`).
 */
export function resolveConflict(
  text: string,
  kind: MemoryKind,
  active: { seq: number; content: string; kind: MemoryKind }[],
): number | null {
  let best: { seq: number; score: number } | null = null;
  for (const memory of active) {
    if (memory.kind !== kind) continue;
    const score = similarity(text, memory.content);
    if (
      score >= CONFLICT_SIMILARITY &&
      score < DUPLICATE_SIMILARITY &&
      (!best || score > best.score)
    )
      best = { seq: memory.seq, score };
  }
  return best?.seq ?? null;
}

/**
 * Runs extraction over the history index. One worker serves every scope; each
 * keeps its own cursor, so a slow scope never blocks another.
 */
export class MemoryWorker {
  private extractor: MemoryExtractor;
  private inflight = new Map<string, Promise<RunResult>>();
  private lastRun = new Map<string, number>();
  private stopped = false;

  constructor(private deps: MemoryWorkerDeps) {
    this.extractor = deps.extractor ?? new HeuristicExtractor();
    this.ensureSchema();
  }

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** The worker's own audit table; feature stores may own tables (AGENTS.md). */
  private ensureSchema(): void {
    this.deps.db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memory_worker_runs (
        id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, trigger TEXT NOT NULL,
        at TEXT NOT NULL, sources INTEGER NOT NULL, candidates INTEGER NOT NULL,
        duplicates INTEGER NOT NULL, error TEXT
      );
      CREATE INDEX IF NOT EXISTS memory_worker_runs_scope ON memory_worker_runs(scope_id, at);
    `);
  }

  // ---- cursors ------------------------------------------------------------

  /** Per-scope cursor over `history_entries.rowid`, kept in history_cursors. */
  private cursor(scopeId: string): number {
    const value = this.deps.db.sqlite
      .prepare(
        'SELECT last_entry FROM history_cursors WHERE conversation_id = ?',
      )
      .get(`${CURSOR_PREFIX}${scopeId}`) as { last_entry: string } | undefined;
    return Number(value?.last_entry ?? 0);
  }

  private setCursor(scopeId: string, rowId: number): void {
    this.deps.db.sqlite
      .prepare(
        `INSERT INTO history_cursors (conversation_id,last_entry,updated_at) VALUES (?,?,?)
        ON CONFLICT(conversation_id) DO UPDATE SET last_entry=excluded.last_entry, updated_at=excluded.updated_at`,
      )
      .run(`${CURSOR_PREFIX}${scopeId}`, String(rowId), this.now.toISOString());
  }

  /** New rows for a scope, oldest first, plus the rowid to commit after. */
  private collect(scopeId: string): {
    sources: MemorySource[];
    cursor: number;
  } {
    const db = this.deps.db.sqlite;
    // A full index resync resets rowids; a cursor beyond MAX(rowid) restarts.
    const tip = db
      .prepare(
        'SELECT COALESCE(MAX(rowid), 0) AS n FROM history_entries WHERE scope_id = ?',
      )
      .get(scopeId) as { n: number };
    const cursor = Math.min(this.cursor(scopeId), Number(tip.n));
    const rows = db
      .prepare(
        `SELECT rowid AS rid, conversation_id, entry_id, kind, role, at, text
        FROM history_entries WHERE scope_id = ? AND rowid > ?
        ORDER BY rowid LIMIT ?`,
      )
      .all(scopeId, cursor, MAX_SOURCES) as unknown as ({
      rid: number;
      conversation_id: string;
      entry_id: string;
      kind: MemorySource['kind'];
      role: string | null;
      at: string;
      text: string;
    } | null)[];
    // The worker's own audit events would only re-trigger themselves.
    const sources = rows
      .filter(
        (row): row is NonNullable<typeof row> =>
          row !== null &&
          !(row.kind === 'event' && row.entry_id.startsWith('memory.worker:')),
      )
      .map((row) => ({
        ref:
          row.kind === 'event'
            ? `event:${row.entry_id}`
            : `conv:${row.conversation_id}#${row.entry_id}`,
        kind: row.kind,
        role: row.role,
        at: row.at,
        text: row.text,
      }));
    return { sources, cursor: rows.at(-1)?.rid ?? cursor };
  }

  // ---- triggers -----------------------------------------------------------

  /**
   * Fire one extraction pass. Concurrent triggers share the in-flight run;
   * automatic triggers inside the minimum interval are skipped, while user
   * corrections always run (`force`).
   */
  async trigger(
    scopeId: string,
    trigger: MemoryTrigger,
    options: { force?: boolean } = {},
  ): Promise<RunResult> {
    if (this.stopped || (this.deps.isPaused?.() ?? false))
      return { ...emptyResult(scopeId), ran: false };
    const pending = this.inflight.get(scopeId);
    if (pending) return pending;
    const minInterval = this.deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const last = this.lastRun.get(scopeId) ?? 0;
    if (!options.force && this.now.getTime() - last < minInterval)
      return { ...emptyResult(scopeId), ran: false };
    this.lastRun.set(scopeId, this.now.getTime());
    const run = this.runScope(scopeId, trigger).finally(() =>
      this.inflight.delete(scopeId),
    );
    this.inflight.set(scopeId, run);
    return run;
  }

  /** Idle sweep over every known scope; each scope is still throttled. */
  async sweep(
    trigger: MemoryTrigger = 'conversation-idle',
  ): Promise<RunResult[]> {
    if (this.stopped || (this.deps.isPaused?.() ?? false)) return [];
    const scopes = [
      GLOBAL_SCOPE,
      ...this.deps.db.listProjects().map((project) => project.id),
    ];
    // Scopes are independent: each has its own inflight entry, throttle
    // window, and rows, so a slow extraction in one must not delay the rest.
    return Promise.all(scopes.map((scopeId) => this.trigger(scopeId, trigger)));
  }

  /** Wait for in-flight work (used on service close). */
  async idle(): Promise<void> {
    await Promise.allSettled(this.inflight.values());
  }

  stop(): void {
    this.stopped = true;
  }

  /** Recent runs, newest first; diagnostics for the UI. */
  recent(scopeId: string, limit = 20) {
    return this.deps.db.sqlite
      .prepare(
        `SELECT trigger, at, sources, candidates, duplicates FROM memory_worker_runs
        WHERE scope_id = ? ORDER BY rowid DESC LIMIT ?`,
      )
      .all(scopeId, limit) as unknown as {
      trigger: MemoryTrigger;
      at: string;
      sources: number;
      candidates: number;
      duplicates: number;
    }[];
  }

  // ---- pipeline -----------------------------------------------------------

  /** Collect → Extract → Classify → Deduplicate → Resolve → Persist. */
  private async runScope(
    scopeId: string,
    trigger: MemoryTrigger,
  ): Promise<RunResult> {
    // Catch the index up first so a trigger right after a turn sees it all.
    await this.deps.history.syncAll([scopeId]);
    const { sources, cursor } = this.collect(scopeId);
    if (sources.length === 0) return emptyResult(scopeId);

    const items = this.deps.scopes.memory(scopeId).dump().items;
    const active = items
      .filter((item) => item.status === 'active')
      .map((item) => ({
        seq: item.seq,
        content: item.content,
        kind: item.kind as MemoryKind,
      }));

    // Extraction runs outside the write transaction: it may later become a
    // model call, and must never hold the database while thinking.
    let extracted: ExtractedMemory[];
    try {
      extracted = await this.extractor.extract({ scopeId, sources, active });
    } catch (error) {
      console.error(`Memory extract ${scopeId}:`, error);
      return { ...emptyResult(scopeId), sources: sources.length, ran: false };
    }

    const result = this.deps.db.transaction(() => {
      const memory = this.deps.scopes.memory(scopeId);
      const known = this.knownTexts(scopeId);
      let candidates = 0;
      let duplicates = 0;
      for (const item of extracted) {
        const text = normalize(item.text);
        if (!text || bytes(text) > MAX_BYTES) continue;
        if (this.isDuplicate(scopeId, text, known)) {
          duplicates++;
          continue;
        }
        memory.candidate({
          text,
          kind: item.kind,
          confidence: item.confidence,
          sourceRef: item.sourceRef,
          supersedes: resolveConflict(text, item.kind, active),
          reason: `memory worker: ${trigger}`,
        });
        known.push(text);
        candidates++;
      }
      this.setCursor(scopeId, cursor);
      this.recordRun(scopeId, trigger, {
        sources: sources.length,
        candidates,
        duplicates,
      });
      return {
        scopeId,
        ran: true,
        sources: sources.length,
        candidates,
        duplicates,
      };
    });
    if (result.candidates > 0) this.deps.emitMemory?.(scopeId);
    return result;
  }

  /**
   * Existing memory text for dedupe: every row the scope has ever stored.
   * A line the user dismissed or a memory they revised must not come back
   * as a new candidate just because its wording changed slightly.
   */
  private knownTexts(scopeId: string): string[] {
    return (
      this.deps.db.sqlite
        .prepare('SELECT content FROM memories WHERE scope_id = ?')
        .all(scopeId) as { content: string }[]
    ).map((row) => row.content);
  }

  /**
   * Deduplicate: exact text first, then a memory_fts (trigram) lookup of the
   * longest term to find near-identical rows, then a token similarity scan
   * for CJK-only lines the trigram index cannot serve.
   */
  private isDuplicate(scopeId: string, text: string, known: string[]): boolean {
    const normalized = normalize(text);
    if (known.some((existing) => normalize(existing) === normalized))
      return true;
    const terms = [...new Set(tokens(normalized))]
      .filter((term) => [...term].length >= 3)
      .sort((a, b) => [...b].length - [...a].length)
      .slice(0, 3);
    if (terms.length > 0) {
      const match = terms
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(' OR ');
      const ids = this.deps.db.sqlite
        .prepare('SELECT mem_id FROM memory_fts WHERE memory_fts MATCH ?')
        .all(match) as unknown as { mem_id: string }[];
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const near = this.deps.db.sqlite
          .prepare(
            `SELECT content FROM memories
            WHERE scope_id = ? AND id IN (${placeholders})`,
          )
          .all(scopeId, ...ids.map((row) => row.mem_id)) as {
          content: string;
        }[];
        if (
          near.some(
            (row) =>
              similarity(row.content, normalized) >= DUPLICATE_SIMILARITY,
          )
        )
          return true;
      }
    }
    return known.some(
      (existing) => similarity(existing, normalized) >= DUPLICATE_SIMILARITY,
    );
  }

  private recordRun(
    scopeId: string,
    trigger: MemoryTrigger,
    counts: { sources: number; candidates: number; duplicates: number },
  ): void {
    const at = this.now.toISOString();
    this.deps.db.sqlite
      .prepare(
        `INSERT INTO memory_worker_runs
        (id, scope_id, trigger, at, sources, candidates, duplicates, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        `mwr-${sha(`${scopeId}:${trigger}:${at}`)}`,
        scopeId,
        trigger,
        at,
        counts.sources,
        counts.candidates,
        counts.duplicates,
      );
    this.deps.events.record({
      id: `memory.worker:${scopeId}:${trigger}:${at}`,
      type: 'memory.extracted',
      actor: 'system',
      scopeId,
      summary: `Memory worker (${trigger}): ${counts.sources} source(s) → ${counts.candidates} candidate(s), ${counts.duplicates} duplicate(s)`,
      payload: counts,
    });
  }
}
