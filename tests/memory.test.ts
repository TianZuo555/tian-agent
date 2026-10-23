import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../src/worker/db';
import { DataService } from '../src/worker/data';
import { CORE_BUDGET, MAX_MEMORY_CHARS } from '../src/worker/memory';
import { Scopes } from '../src/worker/scopes';
import type { MemoryDump } from '../src/shared/types';
import { DATABASE_VERSION } from '../src/shared/version';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-memory-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** A project scope rooted inside `dir`, plus the global scope. */
function fixture(t: TestContext) {
  const dir = temporary(t);
  const db = new Db(join(dir, 'data'));
  t.after(() => {
    try {
      db.close();
    } catch {
      // already closed by a restart test
    }
  });
  const projectPath = join(dir, 'project');
  mkdirSync(projectPath, { recursive: true });
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: 'Manager',
  });
  const scopes = new Scopes(join(dir, 'data', 'global'), db);
  return { dir, db, scopes, projectPath };
}

function dump(scopes: Scopes, scopeId: string): MemoryDump {
  return scopes.memory(scopeId).dump();
}

const versions = (db: Db, id: string) =>
  db.sqlite
    .prepare(
      'SELECT action, actor, reason FROM memory_versions WHERE memory_id = ? ORDER BY rowid',
    )
    .all(id) as { action: string; actor: string; reason: string | null }[];

test('new memories are searchable but not Core until explicitly selected', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const { memory: fact, created } = memory.remember({
    text: 'Deploys run from the release branch',
    actor: 'chief',
  });
  assert.equal(created, true);
  assert.equal(fact.core, false);
  assert.match(memory.wake(), /0 selected/);
  assert.match(memory.wake(), /searchable with recall/);
  assert.match(memory.recall('release branch'), /Deploys run/);

  const selected = memory.select(fact.seq, 'chief', 'needed every turn');
  assert.equal(selected.memory.core, true);
  const wake = memory.wake();
  assert.match(
    wake,
    /#0 \[fact\] agent_inferred \d{4}-\d{2}-\d{2} — Deploys run/,
  );
  assert.match(wake, /core: 1 selected · \d+\/1500 tokens/);
  // Metadata is part of the budget: the reported total is a safe upper bound
  // on the rendered text (per-line token ceilings, including the footer).
  const measured = Math.ceil(Buffer.byteLength(wake, 'utf8') / 3);
  const reported = Number(/· (\d+)\/1500 tokens/.exec(wake)![1]);
  assert.ok(
    reported >= measured,
    `reported ${reported} < measured ${measured}`,
  );

  // Deselect is not forget: still active and searchable, just not resident.
  const dropped = memory.deselect(fact.seq, 'chief', 'not needed daily');
  assert.equal(dropped.memory.core, false);
  assert.equal(dropped.memory.status, 'active');
  assert.doesNotMatch(memory.wake(), /#0 \[fact\]/);
  assert.match(memory.recall('release branch'), /Deploys run/);
  // Both operations are idempotent no-ops the second time.
  assert.equal(memory.deselect(fact.seq).changed, false);
  assert.equal(memory.deselect(fact.seq).changed, false);
  assert.deepEqual(
    versions(f.db, fact.id).map((row) => [row.action, row.actor]),
    [
      ['create', 'chief'],
      ['select', 'chief'],
      ['deselect', 'chief'],
    ],
  );
});

test('an over-budget selection is rejected atomically with usage', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  // 900 CJK characters are ~900 tokens each: two of them cannot fit 1500.
  const big = '中'.repeat(900);
  const first = memory.remember({ text: `first ${big}`, core: true });
  assert.equal(first.memory.core, true);
  assert.throws(
    () => memory.remember({ text: `second ${big}`, core: true }),
    /Core Memory is full: 1 selected, \d+\/1500 tokens/,
  );
  // The rejected write left nothing behind, not even an unselected row.
  assert.deepEqual(
    dump(f.scopes, 'p1').items.map((item) => item.content.slice(0, 5)),
    ['first'],
  );
  const second = memory.remember({ text: `second ${big}` });
  assert.equal(second.memory.core, false);
  assert.throws(() => memory.select(second.memory.seq), /Core Memory is full/);
  assert.equal(dump(f.scopes, 'p1').core.selected, 1);
  assert.equal(dump(f.scopes, 'p1').core.active, 2);
});

test('eight short facts all render when selected; no recursive summary replaces them', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const facts = [
    '用户偏好中文回复',
    'Deploys run from the release branch',
    'The database is SQLite',
    'Tests run through mise',
    'Workers never write memory',
    'The service owns the socket',
    'Notes live in notes/',
    'Runs use isolated worktrees',
  ];
  for (const text of facts)
    memory.remember({ text, core: true, actor: 'user', sourceType: 'user' });
  const wake = memory.wake();
  for (const fact of facts) assert.match(wake, new RegExp(fact));
  assert.equal(
    wake.split('\n').filter((line) => line.startsWith('#')).length,
    8,
  );
  assert.equal(dump(f.scopes, 'p1').core.selected, 8);
  assert.ok(dump(f.scopes, 'p1').core.tokens < CORE_BUDGET);
  // No summary rows exist at all: the tree is gone, and the export has no
  // overlapping summary section.
  const exported = readFileSync(
    join(f.projectPath, 'memory', 'MEMORY.md'),
    'utf8',
  );
  assert.doesNotMatch(exported, /## 摘要/);
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'memory_nodes%'",
      )
      .get()?.n,
    0,
  );
});

test('revise keeps the correction even when Core cannot fit it, and never revives the old fact', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const old = memory.remember({
    text: 'Tian drinks coffee every morning',
    core: true,
    actor: 'user',
    sourceType: 'user',
    trustLevel: 'user_confirmed',
  });
  // Fill the remaining budget with another selected memory.
  memory.remember({
    text: `filler ${'中'.repeat(900)}`,
    core: true,
  });
  const revised = memory.revise(
    old.memory.seq,
    `Tian drinks tea now ${'z'.repeat(900)}`,
    'Tian corrected the preference',
    'user',
    { sourceRef: 'conv:1#42' },
  );
  assert.equal(revised.changed, true);
  // The replacement frees the old line's budget first, so this one still fits.
  assert.equal(revised.coreDropped, false);
  assert.equal(revised.memory.core, true);
  assert.equal(revised.memory.status, 'active');
  assert.equal(revised.memory.sourceRef, 'conv:1#42');
  assert.equal(revised.memory.trustLevel, 'user_confirmed');
  assert.equal(revised.superseded.status, 'superseded');
  assert.equal(revised.superseded.core, false);
  assert.doesNotMatch(memory.wake(), /coffee/);
  assert.match(memory.wake(), /drinks tea now/);
  assert.doesNotMatch(memory.recall('coffee'), /coffee/);
  assert.match(
    memory.recall('coffee', { includeHistory: true }),
    /coffee every morning \(superseded\)/,
  );
  assert.match(memory.recall('tea'), /drinks tea now/);
  assert.equal(dump(f.scopes, 'p1').core.active, 2);

  // A replacement that genuinely cannot fit leaves Core and says so, while the
  // old fact still leaves Core and the new fact stays active and searchable.
  const huge = memory.revise(
    revised.memory.seq,
    `Tian drinks oolong now ${'中'.repeat(950)}`,
    'another correction',
    'user',
  );
  assert.equal(huge.changed, true);
  assert.equal(huge.coreDropped, true);
  assert.equal(huge.memory.core, false);
  assert.doesNotMatch(memory.wake(), /drinks tea now/);
  assert.match(memory.wake(), /1 selected/);
  assert.match(memory.recall('oolong'), /drinks oolong now/);
  // The old revision can never be selected again.
  assert.throws(() => memory.select(revised.memory.seq), /superseded/);
  // Freeing budget lets the user select the current fact explicitly.
  memory.deselect(
    dump(f.scopes, 'p1').items.find((item) =>
      item.content.startsWith('filler'),
    )!.seq,
  );
  assert.equal(memory.select(huge.memory.seq).memory.core, true);
  assert.match(memory.wake(), /drinks oolong now/);
});

test('revision into an existing active memory is rejected with its target', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: 'Deploy on Fridays' });
  memory.remember({ text: 'Deploy on Mondays' });
  assert.throws(
    () => memory.revise(0, 'Deploy  on   Mondays', 'duplicate', 'chief'),
    /#1 already says that/,
  );
  // Case and identifiers are significant: `Deploy`/`deploy` may differ.
  const caseOnly = memory.revise(
    0,
    'deploy on fridays',
    'case change',
    'chief',
  );
  assert.equal(caseOnly.changed, true);
  // Revising to the same normalized text is an idempotent no-op that still
  // records new evidence.
  const same = memory.revise(
    caseOnly.memory.seq,
    'deploy   on  fridays',
    'noop',
    'user',
    {
      sourceRef: 'conv:9#1',
      trustLevel: 'user_confirmed',
    },
  );
  assert.equal(same.changed, false);
  assert.equal(same.memory.seq, caseOnly.memory.seq);
  assert.equal(same.memory.sourceRef, 'conv:9#1');
  assert.equal(same.memory.trustLevel, 'user_confirmed');
});

test('exact duplicates reuse the row and append evidence without reviving history', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const first = memory.remember({
    text: 'Project uses pnpm',
    sourceRef: 'conv:1#10',
    actor: 'chief',
  });
  const repeated = memory.remember({
    text: 'Project   uses  pnpm',
    sourceRef: 'conv:1#10',
    actor: 'chief',
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.memory.id, first.memory.id);
  assert.equal(repeated.evidenceAdded, false);
  assert.equal(dump(f.scopes, 'p1').items.length, 1);

  // A user confirmation upgrades trust and keeps the new evidence.
  const confirmed = memory.remember({
    text: 'Project uses pnpm',
    sourceType: 'user',
    trustLevel: 'user_confirmed',
    sourceRef: 'conv:1#12',
    actor: 'chief',
  });
  assert.equal(confirmed.created, false);
  assert.equal(confirmed.evidenceAdded, true);
  assert.equal(confirmed.memory.trustLevel, 'user_confirmed');
  assert.equal(confirmed.memory.sourceType, 'user');
  assert.equal(confirmed.memory.sourceRef, 'conv:1#12');
  assert.equal(confirmed.memory.evidence?.at(-1)?.sourceRef, 'conv:1#12');
  assert.deepEqual(
    versions(f.db, first.memory.id).map((row) => [row.action, row.actor]),
    [
      ['create', 'chief'],
      ['evidence', 'chief'],
    ],
  );
  assert.match(versions(f.db, first.memory.id)[1].reason!, /conv:1#12/);
  const repeatedAgain = memory.remember({
    text: 'Project uses pnpm',
    sourceType: 'user',
    trustLevel: 'user_confirmed',
    sourceRef: 'conv:1#12',
    actor: 'chief',
  });
  assert.equal(repeatedAgain.evidenceAdded, false);
  assert.equal(versions(f.db, first.memory.id).length, 2);
  // A later duplicate from a new source is evidence; the first source stays
  // stable and no second audit row appears for the same review.
  const third = memory.remember({
    text: 'Project uses pnpm',
    sourceRef: 'conv:1#13',
    actor: 'chief',
  });
  assert.equal(third.evidenceAdded, true);
  // The most recent confirmed source identifies the row; every citation stays
  // in evidence.
  assert.equal(third.memory.sourceRef, 'conv:1#12');
  assert.equal(third.memory.evidence?.length, 3);

  // Same content after a supersede is a new fact, not a resurrection.
  memory.revise(0, 'Project uses pnpm workspaces', 'refined', 'chief');
  const fresh = memory.remember({ text: 'Project uses pnpm', actor: 'chief' });
  assert.equal(fresh.created, true);
  assert.equal(fresh.memory.seq, 2);
  assert.equal(dump(f.scopes, 'p1').items[0].status, 'superseded');

  // Forget twice is a no-op; a deleted line is not revived either.
  const forgotten = memory.forget(2, 'cleanup', 'user');
  assert.equal(forgotten.changed, true);
  assert.equal(memory.forget(2, 'again', 'user').changed, false);
  const reAdded = memory.remember({
    text: 'Project uses pnpm',
    actor: 'chief',
  });
  assert.equal(reAdded.created, true);
  assert.equal(reAdded.memory.seq, 3);
});

test('candidates stay out of Core, are never auto-promoted by repeats, and activation never replaces', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const old = memory.remember({
    text: 'We decided to deploy on Fridays',
    kind: 'decision',
    core: true,
  });
  const candidate = memory.candidate({
    text: 'We decided to deploy on Mondays instead of Fridays',
    kind: 'decision',
    confidence: 0.7,
    sourceRef: 'conv:1#10',
    supersedes: old.memory.seq,
  });
  assert.ok(candidate);
  assert.equal(candidate.core, false);
  assert.doesNotMatch(memory.wake(), /Mondays/);
  assert.equal(memory.recall('Mondays'), '(no matches)');

  // Repeating the same fact never promotes the candidate.
  const repeat = memory.remember({
    text: 'We decided to deploy on Mondays instead of Fridays',
    actor: 'chief',
    sourceRef: 'conv:2#1',
  });
  assert.equal(repeat.created, false);
  assert.equal(repeat.memory.status, 'candidate');
  assert.equal(
    dump(f.scopes, 'p1').items.find((item) => item.seq === candidate.seq)
      ?.status,
    'candidate',
  );

  // The user revises the target while the candidate is pending.
  memory.revise(
    old.memory.seq,
    'We decided to deploy on Sundays',
    'user corrected the day',
    'user',
  );

  // Ordinary activation ignores the supersede hint: both facts coexist and the
  // current one keeps Core. Only the explicit replacement action supersedes.
  const activated = memory.promote(candidate.seq);
  assert.equal(activated.memory.status, 'active');
  assert.equal(activated.superseded, null);
  assert.equal(
    dump(f.scopes, 'p1').items.find((item) => item.seq === candidate.seq)
      ?.status,
    'active',
  );
  assert.match(memory.wake(), /Sundays/);
  assert.match(memory.recall('Mondays'), /Mondays/);

  // Promoting a candidate with a live target keeps it out of Core, and the
  // explicit replacement is the only path that supersedes.
  const other = memory.candidate({
    text: 'We decided to deploy on Tuesdays',
    kind: 'decision',
    confidence: 0.6,
    sourceRef: 'conv:1#20',
    supersedes: dump(f.scopes, 'p1').items.find((item) =>
      item.content.includes('Sundays'),
    )!.seq,
  })!;
  const promoted = memory.promote(other.seq, 'user');
  assert.equal(promoted.memory.status, 'active');
  assert.equal(promoted.memory.core, false);
  assert.equal(promoted.superseded, null);
  assert.doesNotMatch(memory.wake(), /Tuesdays/);
  assert.match(memory.recall('Tuesdays'), /Tuesdays/);
});

test('content length is 1000 Unicode code points, not 280 UTF-8 bytes', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const chinese = '中'.repeat(MAX_MEMORY_CHARS);
  assert.equal([...chinese].length, 1000);
  assert.ok(Buffer.byteLength(chinese, 'utf8') > 280);
  const { memory: stored } = memory.remember({ text: chinese });
  assert.equal(stored.content, chinese);
  assert.throws(() => memory.remember({ text: '中'.repeat(1001) }), /1000/);
  // Astral characters count once, not per UTF-16 unit.
  assert.doesNotThrow(() => memory.remember({ text: '😀'.repeat(1000) }));
});

test('a failing first write cannot consume legacy import or cache an uncommitted store', (t) => {
  const dir = temporary(t);
  const dataDir = join(dir, 'data');
  const projectPath = join(dir, 'project');
  mkdirSync(join(projectPath, 'memory', 'TREE'), { recursive: true });
  writeFileSync(
    join(projectPath, 'memory', 'LOG.txt'),
    '2025-01-01 10:00 Original legacy preference\n',
    'utf8',
  );
  writeFileSync(join(projectPath, 'memory', 'TREE', '0-1.txt'), 'old tree\n');

  const db = new Db(dataDir);
  const scopes = new Scopes(join(dataDir, 'global'), db);
  db.addProject({
    id: 'p1',
    name: 'project',
    rootPath: projectPath,
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: 'Manager',
  });
  const data = new DataService(db, scopes, () => {});
  // First business write is invalid and must roll back cleanly.
  assert.throws(() => data.remember('p1', '', { operationId: 'bad-first' }));
  // The legacy import survives: the source file is not consumed by the
  // rolled-back attempt, and the store is not cached from inside it.
  scopes.forget('p1');
  const reloaded = scopes.memory('p1');
  assert.deepEqual(
    reloaded.dump().items.map((item) => item.content),
    ['Original legacy preference'],
  );
  // The import committed on its own before the failing write, so it is
  // archived exactly once — and the data is present, not lost.
  assert.ok(!existsSync(join(projectPath, 'memory', 'LOG.txt')));
  assert.ok(existsSync(join(projectPath, 'memory', 'legacy', 'LOG.txt')));
  // A valid write afterwards is searchable but not silently selected into Core.
  const written = data.remember('p1', 'Only searchable please', {
    operationId: 'good-next',
  });
  assert.equal(written.memory.core, false);
  scopes.forget('p1');
  const again = scopes.memory('p1');
  assert.equal(
    again.dump().items.find((item) => item.seq === written.memory.seq)?.core,
    false,
  );
  assert.equal(again.recall('Only searchable please').includes('Only'), true);
  db.close();
  // A fresh open sees the same committed data and still has the archive.
  const reopened = new Db(dataDir);
  const reopenedScopes = new Scopes(join(dataDir, 'global'), reopened);
  assert.equal(reopenedScopes.memory('p1').dump().items.length, 2);
  reopened.close();
});

test('a failing outer transaction does not archive legacy sources or publish Core selection', (t) => {
  const f = fixture(t);
  const memoryDir = join(f.projectPath, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    join(memoryDir, 'LOG.txt'),
    '2025-02-02 08:00 Legacy line one\n2025-02-03 09:00 Legacy line two\n',
    'utf8',
  );
  // Simulate an outer transaction that initializes the store and then fails.
  assert.throws(() =>
    f.db.transaction(() => {
      f.scopes.memory('p1');
      throw new Error('outer failure');
    }),
  );
  // The import rolled back with the transaction: the source is still in place
  // and nothing was published or cached from the aborted attempt.
  assert.ok(existsSync(join(memoryDir, 'LOG.txt')));
  assert.ok(!existsSync(join(memoryDir, 'legacy', 'LOG.txt')));
  f.scopes.forget('p1');
  const memory = f.scopes.memory('p1');
  assert.deepEqual(
    memory.dump().items.map((item) => item.content),
    ['Legacy line one', 'Legacy line two'],
  );
  assert.match(memory.wake(), /Legacy line one/);
  assert.ok(existsSync(join(memoryDir, 'legacy', 'LOG.txt')));
});

test('memory is isolated per scope and persists across a restart', (t) => {
  const f = fixture(t);
  f.scopes.memory('p1').remember({
    text: 'Project secret',
    core: true,
  });
  f.scopes.memory('global').remember({ text: 'Global fact', core: true });

  const dir = f.dir;
  f.db.close();

  const db2 = new Db(join(dir, 'data'));
  const scopes2 = new Scopes(join(dir, 'data', 'global'), db2);
  try {
    assert.deepEqual(
      dump(scopes2, 'p1').items.map((item) => [item.content, item.core]),
      [['Project secret', true]],
    );
    assert.deepEqual(
      dump(scopes2, 'global').items.map((item) => [item.content, item.core]),
      [['Global fact', true]],
    );
    assert.match(scopes2.memory('p1').wake(), /Project secret/);
    assert.doesNotMatch(scopes2.memory('p1').wake(), /Global fact/);
    assert.match(scopes2.memory('global').wake(), /Global fact/);
    assert.equal(scopes2.memory('p1').recall('Global fact'), '(no matches)');
  } finally {
    db2.close();
  }
});

test('MEMORY.md export lists Core and searchable memory without summaries and never feeds back', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const exportPath = join(f.projectPath, 'memory', 'MEMORY.md');
  // Construction regenerates the export even before the first write.
  assert.match(readFileSync(exportPath, 'utf8'), /暂无有效记忆/);

  memory.remember({
    text: 'First fact',
    core: true,
    actor: 'user',
    sourceType: 'user',
    trustLevel: 'user_confirmed',
  });
  memory.remember({ text: 'Second fact', actor: 'chief' });
  memory.candidate({
    text: 'Pending candidate',
    kind: 'fact',
    confidence: 0.5,
    sourceRef: 'conv:1#2',
  });
  const exported = readFileSync(exportPath, 'utf8');
  assert.match(exported, /Core Memory：1 条已选入/);
  assert.match(exported, /\[core\] #0 \[fact\] user_confirmed/);
  assert.match(exported, /#1 \[fact\] agent_inferred .* — Second fact/);
  assert.doesNotMatch(exported, /Pending candidate/);

  memory.forget(1, 'cleanup', 'chief');
  assert.doesNotMatch(readFileSync(exportPath, 'utf8'), /Second fact/);

  // The export is write-only: editing it never changes the database.
  writeFileSync(exportPath, 'tampered', 'utf8');
  assert.equal(memory.recall('tampered'), '(no matches)');
  assert.match(memory.wake(), /First fact/);
});

test('a v4 database migrates without losing memory, versions, provenance, or candidate state', (t) => {
  const dir = temporary(t);
  const dataDir = join(dir, 'data');
  const projectPath = join(dir, 'project');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(projectPath, 'memory'), { recursive: true });
  // Build the previous schema by hand: no core column, tree nodes present.
  const legacy = new DatabaseSync(join(dataDir, 'tian.db'));
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
      auto_land INTEGER NOT NULL DEFAULT 0, allow_in_place INTEGER NOT NULL DEFAULT 0,
      agent_kind TEXT NOT NULL DEFAULT 'durable-worker', run_timeout_min INTEGER NOT NULL DEFAULT 30,
      base_branch TEXT NOT NULL DEFAULT 'main', prompt_preamble TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, seq INTEGER NOT NULL, goal_id TEXT,
      kind TEXT NOT NULL, content TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT,
      trust_level TEXT NOT NULL, confidence REAL, status TEXT NOT NULL DEFAULT 'active',
      superseded_by TEXT, supersedes INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(scope_id, seq)
    );
    CREATE TABLE memory_versions (
      memory_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT,
      before TEXT, after TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_nodes (
      scope_id TEXT NOT NULL, lo INTEGER NOT NULL, hi INTEGER NOT NULL,
      summary TEXT NOT NULL, stale INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, lo, hi)
    );
    CREATE VIRTUAL TABLE memory_fts USING fts5(content, mem_id UNINDEXED, tokenize='trigram');
    PRAGMA user_version = 4;
  `);
  legacy
    .prepare(
      'INSERT INTO projects (id,name,root_path,created_at) VALUES (?,?,?,?)',
    )
    .run('p1', 'project', projectPath, '2026-01-01T00:00:00.000Z');
  const insert = legacy.prepare(
    `INSERT INTO memories (id,scope_id,seq,kind,content,source_type,source_ref,trust_level,confidence,status,superseded_by,supersedes,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  insert.run(
    'mem-a',
    'p1',
    0,
    'preference',
    '用户偏好中文回复',
    'user',
    'conv:1#2',
    'user_confirmed',
    null,
    'active',
    null,
    null,
    '2026-01-02T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
  );
  insert.run(
    'mem-b',
    'p1',
    1,
    'fact',
    'The importer runs nightly',
    'agent',
    'conv:1#5',
    'agent_inferred',
    null,
    'superseded',
    'mem-c',
    null,
    '2026-01-03T00:00:00.000Z',
    '2026-01-04T00:00:00.000Z',
  );
  insert.run(
    'mem-c',
    'p1',
    2,
    'fact',
    'The importer runs hourly',
    'agent',
    'conv:1#6',
    'agent_inferred',
    null,
    'active',
    null,
    null,
    '2026-01-04T00:00:00.000Z',
    '2026-01-04T00:00:00.000Z',
  );
  insert.run(
    'mem-d',
    'p1',
    3,
    'decision',
    'Pending candidate about deploys',
    'agent',
    'conv:1#7',
    'agent_inferred',
    0.7,
    'candidate',
    null,
    2,
    '2026-01-05T00:00:00.000Z',
    '2026-01-05T00:00:00.000Z',
  );
  legacy
    .prepare(
      'INSERT INTO memory_versions (memory_id,action,actor,reason,before,after,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      'mem-b',
      'supersede',
      'user',
      'corrected the cadence',
      JSON.stringify({ content: 'The importer runs nightly' }),
      JSON.stringify({
        content: 'The importer runs nightly',
        status: 'superseded',
      }),
      '2026-01-04T00:00:00.000Z',
    );
  legacy
    .prepare(
      'INSERT INTO memory_nodes (scope_id,lo,hi,summary,stale,created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(
      'p1',
      0,
      1,
      'Chinese replies and nightly importer',
      0,
      '2026-01-04T00:00:00.000Z',
    );
  legacy
    .prepare('INSERT INTO memory_fts (content, mem_id) VALUES (?,?)')
    .run('用户偏好中文回复', 'mem-a');
  legacy.close();

  const db = new Db(dataDir);
  const scopes = new Scopes(join(dataDir, 'global'), db);
  try {
    assert.equal(
      db.sqlite.prepare('PRAGMA user_version').get()?.user_version,
      DATABASE_VERSION,
    );
    const d = dump(scopes, 'p1');
    assert.deepEqual(
      d.items.map((item) => [
        item.seq,
        item.content,
        item.status,
        item.sourceRef,
        item.trustLevel,
      ]),
      [
        [0, '用户偏好中文回复', 'active', 'conv:1#2', 'user_confirmed'],
        [
          1,
          'The importer runs nightly',
          'superseded',
          'conv:1#5',
          'agent_inferred',
        ],
        [2, 'The importer runs hourly', 'active', 'conv:1#6', 'agent_inferred'],
        [
          3,
          'Pending candidate about deploys',
          'candidate',
          'conv:1#7',
          'agent_inferred',
        ],
      ],
    );
    assert.equal(d.items[3].supersedes, 2);
    // Uncalibrated confidence is removed; evidence and review carry provenance.
    assert.equal(d.items[3].confidence, null);
    assert.equal(d.items[0].confirmations?.[0].method, 'legacy');
    assert.equal(d.items[3].evidence?.[0].sourceRef, 'conv:1#7');
    // Version history survived the upgrade.
    assert.equal(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM memory_versions WHERE memory_id = 'mem-b' AND reason = 'corrected the cadence'",
        )
        .get()?.n,
      1,
    );
    // The tree is retired, never read again, and no summary leaks into Core.
    assert.equal(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM memory_nodes_retired WHERE scope_id = 'p1'",
        )
        .get()?.n,
      1,
    );
    assert.doesNotMatch(scopes.memory('p1').wake(), /nightly importer/);
    // A deterministic selection keeps the user-confirmed preference in Core
    // within budget; the other active facts stay searchable.
    const selected = d.items
      .filter((item) => item.core)
      .map((item) => item.seq);
    assert.deepEqual(selected, [0, 2]);
    assert.match(scopes.memory('p1').wake(), /用户偏好中文回复/);
    // FTS rows are rebuilt from memory content during migration.
    assert.match(scopes.memory('p1').recall('importer runs'), /runs hourly/);
    assert.match(scopes.memory('p1').wake(), /runs hourly/);
    // Candidates still do not enter Core after migration.
    assert.equal(scopes.memory('p1').recall('deploys'), '(no matches)');
  } finally {
    db.close();
  }
});

test('a v5 archive database upgrades with a backup and retains archived conversations', (t) => {
  const dataDir = temporary(t);
  const legacy = new DatabaseSync(join(dataDir, 'tian.db'));
  legacy.exec(`
    CREATE TABLE conversations (
      conversation_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, title TEXT,
      created_at TEXT NOT NULL, archived_at TEXT
    );
    INSERT INTO conversations VALUES (
      'old-chat', 'global', 'Keep this conversation',
      '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
    );
    PRAGMA user_version = 5;
  `);
  legacy.close();

  const db = new Db(dataDir);
  t.after(() => db.close());
  assert.equal(
    db.sqlite.prepare('PRAGMA user_version').get()?.user_version,
    DATABASE_VERSION,
  );
  assert.equal(
    db.sqlite
      .prepare(
        "SELECT archived_at FROM conversations WHERE conversation_id = 'old-chat'",
      )
      .get()?.archived_at,
    '2026-02-01T00:00:00.000Z',
  );
  assert.ok(
    (
      db.sqlite.prepare('PRAGMA table_info(memories)').all() as {
        name: string;
      }[]
    ).some((column) => column.name === 'core'),
  );
  const backup = new DatabaseSync(join(dataDir, 'tian.db_v5.backup'), {
    readOnly: true,
  });
  try {
    assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version, 5);
    assert.equal(
      backup
        .prepare(
          "SELECT title FROM conversations WHERE conversation_id = 'old-chat'",
        )
        .get()?.title,
      'Keep this conversation',
    );
  } finally {
    backup.close();
  }
});

test('legacy LOG.txt imports once, keeps line order, and never imports the tree as Core', (t) => {
  const f = fixture(t);
  const memoryDir = join(f.projectPath, 'memory');
  mkdirSync(join(memoryDir, 'TREE'), { recursive: true });
  writeFileSync(
    join(memoryDir, 'LOG.txt'),
    [
      '2025-10-01 09:30 Tian prefers Chinese replies',
      '2025-10-02 14:05 项目使用 Electron',
      '',
      'no stamp line',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(memoryDir, 'TREE', '0-1.txt'),
    'Preferences and stack\n',
    'utf8',
  );

  const memory = f.scopes.memory('p1');
  const d = dump(f.scopes, 'p1');
  assert.deepEqual(
    d.items.map((item) => [item.seq, item.content]),
    [
      [0, 'Tian prefers Chinese replies'],
      [1, '项目使用 Electron'],
      [3, 'no stamp line'],
    ],
  );
  assert.equal(d.items[0].sourceType, 'legacy');
  assert.equal(d.items[0].trustLevel, 'agent_inferred');
  assert.equal(
    d.items[0].createdAt,
    new Date('2025-10-01 09:30:00').toISOString(),
  );
  // Imported facts become an initial Core selection (within budget), not the
  // old tree summary.
  assert.equal(d.core.selected, 3);
  assert.match(memory.wake(), /Tian prefers Chinese replies/);
  assert.doesNotMatch(memory.wake(), /Preferences and stack/);
  assert.ok(!existsSync(join(memoryDir, 'LOG.txt')));
  assert.ok(existsSync(join(memoryDir, 'legacy', 'LOG.txt')));
  assert.ok(existsSync(join(memoryDir, 'legacy', 'TREE', '0-1.txt')));

  // Reopening imports nothing new, even if a stray LOG.txt reappears.
  writeFileSync(join(memoryDir, 'LOG.txt'), '2025-10-03 00:00 sneaky\n');
  const reopened = f.scopes.memory('p1');
  assert.equal(dump(f.scopes, 'p1').items.length, 3);
  assert.doesNotMatch(reopened.wake(), /sneaky/);
});

test('Core budget rejects a selection that exceeds it, and a smaller wake budget reports overflow', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: 'a '.repeat(300), core: true });
  const before = memory.wake();
  assert.match(before, /core: 1 selected/);
  // The selection fits the real budget but not an artificially small one: the
  // render is honest and never truncates lines.
  const cramped = memory.wake(10);
  assert.match(cramped, /need \d+ tokens, budget 10/);
  assert.match(cramped, /nothing is truncated/);
  assert.doesNotMatch(cramped, /#0 \[/);
  // Dump usage matches the real budget and reports active totals.
  const d = dump(f.scopes, 'p1');
  assert.equal(d.core.budget, CORE_BUDGET);
  assert.equal(d.core.selected, 1);
  assert.equal(d.core.active, 1);
  assert.ok(d.core.tokens < CORE_BUDGET);
});

test('MemoryStore rejects operations on missing or inactive rows', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  assert.throws(() => memory.select(99), /no memory #99/);
  assert.throws(() => memory.deselect(99), /no memory #99/);
  assert.throws(() => memory.forget(99, 'x'), /no memory #99/);
  assert.throws(() => memory.revise(99, 'x', 'y'), /no memory #99/);
  const created = memory.remember({ text: 'active fact' });
  memory.forget(created.memory.seq, 'gone', 'user');
  assert.throws(() => memory.select(created.memory.seq), /deleted/);
  assert.throws(
    () => memory.revise(created.memory.seq, 'new', 'nope'),
    /deleted/,
  );
  assert.throws(
    () =>
      memory.candidate({
        text: 'candidate',
        kind: 'fact',
        confidence: 0.5,
        sourceRef: null,
        supersedes: created.memory.seq,
      }),
    /not an active memory/,
  );
});
