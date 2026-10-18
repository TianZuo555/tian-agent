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
import { Db } from '../src/worker/db';
import { EMPTY_NODE } from '../src/worker/memory';
import { Scopes } from '../src/worker/scopes';
import type { MemoryDump } from '../src/shared/types';

function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-memory-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('candidates stay out of wake/recall/export until promoted; dismiss removes them', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: 'An active memory', actor: 'chief' });

  const candidate = memory.candidate({
    text: 'Tian prefers pnpm over npm',
    kind: 'preference',
    confidence: 0.7,
    sourceRef: 'conv:1#2',
  });
  assert.equal(candidate.seq, 1);
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.trustLevel, 'agent_inferred');
  assert.equal(candidate.sourceType, 'agent');
  assert.throws(
    () =>
      memory.candidate({
        text: 'x'.repeat(281),
        kind: 'fact',
        confidence: 0.7,
        sourceRef: null,
      }),
    /280/,
  );

  // wake() output is byte-identical with and without candidates: only active
  // memory renders, and candidate-only ranges auto-mark as empty nodes.
  const second = memory.candidate({
    text: 'Second candidate fact',
    kind: 'fact',
    confidence: 0.7,
    sourceRef: 'conv:1#3',
  });
  assert.equal(memory.wake(), '#0 An active memory');
  // A pending merge may exist next to a candidate, but its source text only
  // ever contains active lines — candidates never leak into summaries.
  const merge = memory.nextMerge();
  assert.deepEqual(merge && [merge.lo, merge.hi], [0, 1]);
  assert.doesNotMatch(merge!.source, /pnpm|Second candidate/);
  assert.equal(memory.recall('pnpm'), '(no matches)');
  assert.match(
    memory.recall('pnpm', { includeHistory: true }),
    /#1 \[candidate\] Tian prefers pnpm/,
  );
  const exported = readFileSync(
    join(f.projectPath, 'memory', 'MEMORY.md'),
    'utf8',
  );
  assert.match(exported, /An active memory/);
  assert.doesNotMatch(exported, /pnpm|Second candidate/);

  // Promote keeps agent_inferred trust and puts the line into Core Memory.
  assert.throws(() => memory.promote(0), /only candidates can be promoted/);
  const { memory: promoted } = memory.promote(candidate.seq, 'user');
  assert.equal(promoted.status, 'active');
  assert.equal(promoted.trustLevel, 'agent_inferred');
  assert.match(memory.wake(), /Tian prefers pnpm over npm/);
  assert.match(memory.recall('pnpm'), /Tian prefers pnpm/);
  const fresh = readFileSync(
    join(f.projectPath, 'memory', 'MEMORY.md'),
    'utf8',
  );
  assert.match(fresh, /Tian prefers pnpm over npm/);
  assert.deepEqual(
    (
      f.db.sqlite
        .prepare(
          'SELECT action, actor FROM memory_versions WHERE memory_id = ? ORDER BY rowid',
        )
        .all(candidate.id) as { action: string; actor: string }[]
    ).map((row) => [row.action, row.actor]),
    [
      ['create', 'worker'],
      ['promote', 'user'],
    ],
  );

  // Dismiss (forget) drops the candidate for good; history keeps the row.
  memory.forget(second.seq, 'not useful', 'user');
  assert.equal(dump(f.scopes, 'p1').items[2].status, 'deleted');
  assert.doesNotMatch(memory.wake(), /Second candidate/);
  assert.throws(() => memory.forget(second.seq, 'again', 'user'), /deleted/);
});

/** A project scope rooted inside `dir`, plus the global scope. */
function fixture(t: TestContext) {
  const dir = temporary(t);
  const db = new Db(join(dir, 'data'));
  t.after(() => {
    try {
      db.close();
    } catch {
      // already closed by the restart test
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
  });
  const scopes = new Scopes(join(dir, 'data', 'global'), db);
  return { dir, db, scopes, projectPath };
}

function dump(scopes: Scopes, scopeId: string): MemoryDump {
  return scopes.memory(scopeId).dump();
}

test('legacy LOG.txt and TREE import once, transactionally, and move into legacy/', (t) => {
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

  f.scopes.memory('p1');
  const d = dump(f.scopes, 'p1');
  assert.deepEqual(
    d.items.map((item) => [item.seq, item.content]),
    [
      [0, 'Tian prefers Chinese replies'],
      [1, '项目使用 Electron'],
      [3, 'no stamp line'], // blank line skipped, seq = line index
    ],
  );
  assert.equal(d.items[0].sourceType, 'legacy');
  assert.equal(d.items[0].trustLevel, 'agent_inferred');
  assert.equal(d.items[0].kind, 'fact');
  assert.equal(
    d.items[0].createdAt,
    new Date('2025-10-01 09:30:00').toISOString(),
  );
  assert.deepEqual(
    d.nodes.map((node) => [node.lo, node.hi, node.summary, node.stale]),
    [[0, 1, 'Preferences and stack', false]],
  );
  // One import version per imported memory, actor migration.
  assert.equal(
    f.db.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM memory_versions WHERE action = 'import' AND actor = 'migration'`,
      )
      .get()?.n,
    3,
  );
  assert.ok(!existsSync(join(memoryDir, 'LOG.txt')));
  assert.ok(!existsSync(join(memoryDir, 'TREE')));
  assert.ok(existsSync(join(memoryDir, 'legacy', 'LOG.txt')));
  assert.ok(existsSync(join(memoryDir, 'legacy', 'TREE', '0-1.txt')));

  // Reopening imports nothing new, even if a stray LOG.txt reappears.
  writeFileSync(
    join(memoryDir, 'LOG.txt'),
    '2025-10-03 00:00 sneaky\n',
    'utf8',
  );
  const reopened = f.scopes.memory('p1');
  assert.equal(dump(f.scopes, 'p1').items.length, 3);
  assert.match(reopened.wake(), /Preferences and stack/);
});

test('supersede hides the old line from wake, stales covering nodes, and re-queues the merge', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: 'Tian likes coffee', actor: 'chief' });
  memory.remember({ text: 'Project uses Electron', actor: 'chief' });
  memory.nap(0, 1, 'Coffee and Electron');
  assert.match(memory.wake(), /Coffee and Electron/);
  assert.equal(memory.nextMerge(), null);

  const {
    memory: revised,
    superseded,
    merge,
  } = memory.revise(
    0,
    'Tian switched to tea',
    'Tian corrected the preference',
    'chief',
  );
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.supersededBy, revised.id);
  assert.equal(revised.seq, 2);
  assert.equal(superseded.seq, 0);

  // The stale summary node no longer feeds wake; the raw active lines do.
  const d = dump(f.scopes, 'p1');
  assert.deepEqual(
    d.nodes.map((node) => [node.lo, node.hi, node.stale]),
    [[0, 1, true]],
  );
  const wake = memory.wake();
  assert.match(wake, /Tian switched to tea/);
  assert.match(wake, /Project uses Electron/);
  assert.doesNotMatch(wake, /Coffee and Electron/);
  assert.doesNotMatch(wake, /Tian likes coffee/);

  // The merge for the invalidated range is due again, sourcing only the
  // active lines inside it; the revised line lives at its own seq.
  assert.deepEqual(merge && [merge.lo, merge.hi], [0, 1]);
  assert.equal(merge!.source, '#1 Project uses Electron');
  assert.doesNotMatch(merge!.source, /Coffee and Electron/);
  assert.equal(memory.nextMerge()!.hi, 1);
});

test('forget marks deleted, keeps history searchable, and records a version', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: 'Deploy happens on Fridays', actor: 'chief' });
  const forgotten = memory.forget(0, 'no longer true', 'user');
  assert.equal(forgotten.status, 'deleted');
  assert.doesNotMatch(memory.wake(), /Fridays/);
  assert.equal(memory.recall('Fridays'), '(no matches)');
  assert.match(
    memory.recall('Fridays', { includeHistory: true }),
    /\[deleted\] Deploy happens on Fridays/,
  );

  const version = f.db.sqlite
    .prepare(
      `SELECT * FROM memory_versions WHERE memory_id = ? AND action = 'delete' AND actor = 'user'`,
    )
    .get(forgotten.id) as {
    reason: string;
    before: string;
    after: string;
  };
  assert.equal(version.reason, 'no longer true');
  assert.match(version.before, /active/);
  assert.match(version.after, /deleted/);

  assert.throws(() => memory.forget(0, 'again', 'user'), /deleted/);
  assert.throws(() => memory.forget(99, 'again', 'user'), /no memory #99/);

  // Forgetting every memory of a due range writes an empty marker node
  // automatically (no model call), and wake omits it.
  const pair = f.scopes.memory('global');
  pair.remember({ text: 'One', actor: 'chief' });
  pair.remember({ text: 'Two', actor: 'chief' });
  pair.nap(0, 1, 'A pair');
  pair.forget(0, 'cleanup', 'chief');
  pair.forget(1, 'cleanup', 'chief');
  const marker = dump(f.scopes, 'global').nodes.find((node) => node.hi === 1);
  assert.equal(marker?.stale, false);
  assert.equal(marker?.summary, EMPTY_NODE);
  assert.equal(pair.nextMerge(), null);
  assert.equal(pair.wake(), '(no memories yet)');
  assert.equal(dump(f.scopes, 'global').pendingMerges, 0);
});

test('every write appends version rows with before/after snapshots', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const { memory: created } = memory.remember({
    text: 'Uses pnpm',
    kind: 'decision',
    actor: 'chief',
  });
  const count = (action: string) =>
    Number(
      f.db.sqlite
        .prepare('SELECT COUNT(*) AS n FROM memory_versions WHERE action = ?')
        .get(action)?.n,
    );
  assert.equal(count('create'), 1);
  memory.revise(0, 'Uses pnpm workspaces', 'refined', 'chief');
  assert.equal(count('create'), 2);
  assert.equal(count('supersede'), 1);
  const supersede = f.db.sqlite
    .prepare(`SELECT * FROM memory_versions WHERE action = 'supersede'`)
    .get() as { reason: string; before: string; after: string; actor: string };
  assert.equal(supersede.reason, 'refined');
  assert.equal(supersede.actor, 'chief');
  assert.match(supersede.before, /Uses pnpm/);
  assert.match(supersede.after, /superseded/);
  void created;
});

test('recall uses FTS for Chinese and long queries, LIKE for short ones', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  memory.remember({ text: '用户偏好中文对话', actor: 'user' });
  memory.remember({ text: 'Tian prefers Chinese tea', actor: 'chief' });
  memory.remember({ text: 'Unrelated deployment detail', actor: 'chief' });
  // Trigram FTS matches substrings of any language.
  assert.match(memory.recall('中文对话'), /用户偏好中文对话/);
  assert.match(memory.recall('chinese tea'), /Chinese tea/);
  assert.match(memory.recall('Chinese'), /Chinese tea/);
  // Shorter than 3 characters falls back to LIKE substring matching.
  assert.match(memory.recall('中文'), /用户偏好中文对话/);
  assert.match(memory.recall('ea'), /Chinese tea/);
  assert.equal(memory.recall('不存在的词汇'), '(no matches)');
  assert.equal(memory.recall('zzzz'), '(no matches)');
  // Search is scoped: the memory is invisible from the global scope.
  const global = f.scopes.memory('global');
  assert.equal(global.recall('中文对话'), '(no matches)');
  assert.doesNotMatch(global.wake(), /中文/);
  assert.doesNotMatch(
    dump(f.scopes, 'global')
      .items.map((item) => item.content)
      .join(),
    /中文/,
  );
});

test('memory is isolated per scope and persists across a service restart', (t) => {
  const f = fixture(t);
  f.scopes.memory('p1').remember({ text: 'Project secret', actor: 'chief' });
  f.scopes.memory('global').remember({ text: 'Global fact', actor: 'chief' });

  const dir = f.dir;
  f.db.close();

  // A restarted service reopens the same database and scope directories.
  const db2 = new Db(join(dir, 'data'));
  const scopes2 = new Scopes(join(dir, 'data', 'global'), db2);
  try {
    const d = dump(scopes2, 'p1');
    assert.deepEqual(
      d.items.map((item) => item.content),
      ['Project secret'],
    );
    assert.deepEqual(
      dump(scopes2, 'global').items.map((item) => item.content),
      ['Global fact'],
    );
    assert.match(scopes2.memory('p1').wake(), /Project secret/);
    assert.match(scopes2.memory('global').wake(), /Global fact/);
  } finally {
    db2.close();
  }
});

test('wake truncates to the token budget with a head/tail split', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  // 20 lines of ~90 UTF-8 bytes ≈ 30 tokens each; well over a 100-token budget.
  for (let i = 0; i < 20; i++)
    memory.remember({
      text: `fact number ${i} ${'detail '.repeat(10)}`,
      actor: 'chief',
    });

  const small = memory.wake(100);
  assert.match(small, /older memories omitted; use recall\/zoom/);
  const smallLines = small.split('\n');
  const kept = smallLines.filter((line) => !line.startsWith('…'));
  assert.ok(kept.length < 20);
  assert.match(smallLines.at(-1)!, /#19 fact number 19/);
  const tokens = Math.ceil(Buffer.byteLength(small, 'utf8') / 3);
  assert.ok(tokens <= 130, `wake(100) produced ~${tokens} tokens`);

  const medium = memory.wake(300);
  const mediumLines = medium.split('\n');
  assert.equal(
    mediumLines[0],
    `#0 fact number 0 ${'detail '.repeat(10)}`.trimEnd(),
  );
  assert.match(mediumLines.at(-1)!, /#19 fact number 19/);
  assert.match(medium, /older memories omitted/);

  const large = memory.wake(100_000);
  assert.doesNotMatch(large, /omitted/);
  assert.equal(large.split('\n').length, 20);
});

test('MEMORY.md export follows every write and never feeds back', (t) => {
  const f = fixture(t);
  const memory = f.scopes.memory('p1');
  const exportPath = join(f.projectPath, 'memory', 'MEMORY.md');
  assert.ok(!existsSync(exportPath));

  memory.remember({ text: 'First fact', actor: 'chief' });
  memory.remember({ text: 'Second fact', actor: 'chief' });
  memory.nap(0, 1, 'Both facts');
  let exported = readFileSync(exportPath, 'utf8');
  assert.match(exported, /#0 \[fact\] agent_inferred .* — First fact/);
  assert.match(exported, /#1 \[fact\] agent_inferred .* — Second fact/);
  assert.match(exported, /#0-1 Both facts/);

  memory.revise(0, 'First fact revised', 'correction', 'user');
  exported = readFileSync(exportPath, 'utf8');
  assert.match(exported, /First fact revised/);
  assert.doesNotMatch(exported, /— First fact\n/);
  assert.match(exported, /user_confirmed/);
  // Superseded memories leave both the raw list and their stale node.
  assert.doesNotMatch(exported, /#0-1 Both facts/);

  memory.forget(1, 'cleanup', 'chief');
  exported = readFileSync(exportPath, 'utf8');
  assert.doesNotMatch(exported, /Second fact/);

  // The export is write-only: editing it never changes the database.
  writeFileSync(exportPath, 'tampered', 'utf8');
  assert.equal(memory.recall('tampered'), '(no matches)');
  assert.match(memory.wake(), /First fact revised/);
});
