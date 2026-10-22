import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Conversation, EntryRecord } from '@earendil-works/pi-durable';
import type { UserMessage } from '@earendil-works/pi-ai';
import { readFileSync } from 'node:fs';
import { Db } from '../src/worker/db';
import { Scopes } from '../src/worker/scopes';
import { DataService } from '../src/worker/data';
import { Settings } from '../src/worker/settings';
import { AgentRuntime } from '../src/worker/agents';
import { EventLog } from '../src/worker/events';
import { HistoryIndex } from '../src/worker/history';
import { chiefExtension } from '../src/worker/tools';
import { GoalStore } from '../src/worker/goals';
import { ImprovementStore } from '../src/worker/improvements';
import { workerExtension } from '../src/worker/worker-tools';
import { verifyUserEvidence } from '../src/worker/provenance';
import { pageText, planSearch } from '../src/worker/search';
import { MemoryStore } from '../src/worker/memory';

const T0 = Date.parse('2026-10-18T08:00:00Z');
function temporary(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'tian-regress-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

type ToolResult = { isError?: boolean; output: { text: string }[] };
type ExecutableTool = {
  execute: (
    args: unknown,
    api: unknown,
    context?: unknown,
  ) => Promise<ToolResult>;
};
const toolText = (result: ToolResult) => result.output[0].text;
const plain = (value: string) => value.replaceAll('«', '').replaceAll('»', '');

interface Harness {
  root: string;
  userData: string;
  db: Db;
  scopes: Scopes;
  data: DataService;
  events: EventLog;
  history: HistoryIndex;
  agents: AgentRuntime;
  chief: ReturnType<typeof chiefExtension>;
  /** The current input entry the chief tools verify provenance against. */
  turn: {
    entryId: string;
    kind: 'user' | 'system.notification' | 'worker.input';
    text: string;
  } | null;
  openConversation(scopeId: string): Promise<Conversation>;
  append(
    conversation: Conversation,
    entry: Omit<EntryRecord, 'id' | 'conversationId'>,
  ): Promise<EntryRecord>;
  tool(name: string): ExecutableTool;
}

async function harness(t: TestContext): Promise<Harness> {
  const root = temporary(t);
  const userData = join(root, 'data');
  mkdirSync(join(root, 'project'));
  const db = new Db(userData);
  const scopes = new Scopes(join(userData, 'scopes', 'global'), db);
  db.addProject({
    id: 'p1',
    name: 'proj',
    rootPath: join(root, 'project'),
    autoLand: 0,
    allowInPlace: 0,
    agentKind: 'durable-worker',
    runTimeoutMin: 30,
    baseBranch: 'main',
    promptPreamble: '',
    managerName: 'Manager',
  });
  scopes.ensureDirs('p1');
  const events = new EventLog(db);
  const agents = new AgentRuntime(
    userData,
    scopes.root('global'),
    new Settings(userData),
    db,
  );
  const history = new HistoryIndex(db, agents, events);
  const data = new DataService(db, scopes, () => {});
  const state: { turn: Harness['turn'] } = { turn: null };
  const chief = chiefExtension({
    scopes,
    db,
    data,
    latestInputEntry: async () => state.turn?.entryId ?? null,
    currentInput: async () => state.turn,
    history: { db, events, history },
    goals: new GoalStore(db),
    improvements: new ImprovementStore(db),
    openGoalConversation: (goalId) => Promise.resolve(`goal-conv-${goalId}`),
    emitUpdates: () => {},
    emitImprovements: () => {},
    emitNotices: () => {},
    dispatch: () => Promise.reject(new Error('not used here')),
    workerModels: () => [],
    runReport: () => '',
    runDiff: () => Promise.resolve(''),
    runProgress: () => Promise.reject(new Error('unused')),
    stopRun: () => Promise.reject(new Error('unused')),
    sendRunMessage: () => {
      throw new Error('not used here');
    },
    runMessages: () => [],
    delegateToManager: () => Promise.reject(new Error('not used here')),
    sendManagerMessage: () => Promise.reject(new Error('not used here')),
    managerMessages: () => [],
  });
  await agents.open(chief, workerExtension({ db, wake: async () => {} }));
  t.after(async () => {
    history.stop();
    await agents.close();
    db.close();
  });
  const openConversation = async (scopeId: string) => {
    const conversation = await agents.createChief(scopes.ensureDirs(scopeId));
    db.mapConversation(String(conversation.id), scopeId);
    return conversation;
  };
  const append = (
    conversation: Conversation,
    entry: Omit<EntryRecord, 'id' | 'conversationId'>,
  ) =>
    conversation.commit(
      (tx) => tx.appendEntry(conversation.id, entry),
      BACKGROUND_CONTEXT,
    );
  const tool = (name: string) => {
    const found = chief.tools?.find((entry) => entry.name === name);
    if (!found) throw new Error(`Missing tool: ${name}`);
    return found as unknown as ExecutableTool;
  };
  return {
    root,
    userData,
    db,
    scopes,
    data,
    events,
    history,
    agents,
    chief,
    get turn() {
      return state.turn;
    },
    set turn(value) {
      state.turn = value;
    },
    openConversation,
    append,
    tool,
  };
}

const userTurn = (text: string, minutes = 0) => ({
  kind: 'pi.user',
  model: [
    {
      role: 'user',
      content: text,
      timestamp: T0 + minutes * 60_000,
    } satisfies UserMessage,
  ],
});

let callCounter = 0;
const call = (
  tool: ExecutableTool,
  conversationId: string,
  args: Record<string, unknown>,
  callId = `c${++callCounter}`,
) => tool.execute(args, { conversationId, taskId: 'task-1', callId });

test('remember binds the exact current input and confirms only verbatim user wording', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);

  // A real user turn that IS the statement confirms the source only: the row
  // stays a candidate, and Core waits for review.
  f.turn = {
    entryId: '42',
    kind: 'user',
    text: '项目部署走 release 分支',
  };
  const written = await call(f.tool('remember'), id, {
    text: '项目部署走 release 分支',
    source: 'user',
    core: true,
  });
  assert.doesNotMatch(toolText(written), /isError/);
  assert.match(toolText(written), /remembered as #0/);
  assert.match(toolText(written), /agent-inferred/);
  assert.match(toolText(written), /stays a candidate/);
  assert.match(toolText(written), /not in Core/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref, status FROM memories WHERE seq = 0')
        .get() as { source_ref: string; status: string }
    ).source_ref,
    `conv:${id}#42`,
  );
  assert.equal(f.scopes.memory('global').dump().items[0].status, 'candidate');
  assert.doesNotMatch(f.scopes.memory('global').wake(), /release 分支/);

  // An excerpt of a longer turn is not proof (no substring matching): the
  // stored row keeps its first source and stays a candidate.
  f.turn = {
    entryId: '43',
    kind: 'user',
    text: '记一下：项目部署走 release 分支，另外周五前完成',
  };
  const excerpt = await call(f.tool('remember'), id, {
    text: '项目部署走 release 分支',
    source: 'user',
  });
  assert.match(toolText(excerpt), /not this exact statement/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref FROM memories WHERE seq = 0')
        .get() as { source_ref: string }
    ).source_ref,
    `conv:${id}#42`,
  );

  // An anchored save request is the tool-side confirmation; only then does the
  // row become active, verified and selected.
  f.turn = {
    entryId: '44',
    kind: 'user',
    text: '记住：项目部署走 release 分支',
  };
  const saved = await call(f.tool('remember'), id, {
    text: '项目部署走 release 分支',
    source: 'user',
    core: true,
  });
  assert.match(toolText(saved), /user-confirmed/);
  assert.match(toolText(saved), /in Core/);
  const stored = f.scopes.memory('global').dump().items[0];
  assert.equal(stored.status, 'active');
  assert.equal(stored.trustLevel, 'user_confirmed');
  assert.equal(stored.core, true);
  // Core renders provenance (kind, trust, date, source) inside the budget.
  assert.match(
    f.scopes.memory('global').wake(),
    /#0 \[fact\] user_confirmed \d{4}-\d{2}-\d{2} conv:/,
  );

  const recall = f.tool('recall');
  assert.match(
    toolText(await call(recall, id, { query: '部署 release' })),
    /#0 \[fact\] user_confirmed core .*release 分支/,
  );

  const deselect = f.tool('deselect');
  assert.match(
    toolText(await call(deselect, id, { seq: 0 })),
    /removed from Core; still active and searchable/,
  );
  assert.doesNotMatch(f.scopes.memory('global').wake(), /release 分支/);
  assert.match(f.scopes.memory('global').recall('release'), /release 分支/);

  const select = f.tool('select');
  assert.match(
    toolText(await call(select, id, { seq: 0 })),
    /selected into Core/,
  );
  assert.match(f.scopes.memory('global').wake(), /release 分支/);
});

test('provenance stays conservative: wakes and paraphrases never confirm', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);

  // A system wake (goal/schedule/run/inbox): traceable, never user-confirmed.
  f.turn = {
    entryId: '50',
    kind: 'system.notification',
    text: '[run finished] deploy report is ready',
  };
  const wakeWrite = await call(f.tool('remember'), id, {
    text: 'Deploy windows are Fridays',
    source: 'user',
  });
  assert.match(toolText(wakeWrite), /agent-inferred/);
  assert.match(toolText(wakeWrite), /not started by Tian/);
  const wake = f.db.sqlite
    .prepare('SELECT source_ref, trust_level FROM memories WHERE seq = 0')
    .get() as { source_ref: string; trust_level: string };
  assert.equal(wake.trust_level, 'agent_inferred');
  // The source is still bound to the exact wake entry for later inspection.
  assert.equal(wake.source_ref, `conv:${id}#50`);

  // A worker prompt is likewise not Tian speaking.
  f.turn = {
    entryId: '55',
    kind: 'worker.input',
    text: 'Fix the flaky migration test',
  };
  await call(f.tool('remember'), id, {
    text: 'The migration test is flaky',
    source: 'user',
  });
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT trust_level FROM memories WHERE seq = 1')
        .get() as { trust_level: string }
    ).trust_level,
    'agent_inferred',
  );

  // An unrelated user turn does not confirm an unrelated claim.
  f.turn = { entryId: '60', kind: 'user', text: '帮我看一下 CI' };
  const unrelated = await call(f.tool('remember'), id, {
    text: 'Production runs PostgreSQL 17',
    source: 'user',
  });
  assert.match(toolText(unrelated), /agent-inferred/);
  assert.match(toolText(unrelated), /not this exact statement/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT trust_level FROM memories WHERE seq = 2')
        .get() as { trust_level: string }
    ).trust_level,
    'agent_inferred',
  );

  // The verifier itself: only an exact statement (whitespace-normalized)
  // confirms; excerpts, case changes, kinds and absences do not.
  assert.equal(
    verifyUserEvidence('以后都用   pnpm', {
      entryId: '1',
      kind: 'user',
      text: '以后都用 pnpm',
    }).confirmed,
    true,
  );
  assert.equal(
    verifyUserEvidence('用 pnpm', {
      entryId: '1',
      kind: 'user',
      text: '以后都用 pnpm',
    }).confirmed,
    false,
  );
  assert.equal(
    verifyUserEvidence('Use npm', {
      entryId: '1',
      kind: 'user',
      text: 'Do not use npm',
    }).confirmed,
    false,
  );
  assert.equal(
    verifyUserEvidence('Production path is /srv/foo', {
      entryId: '1',
      kind: 'user',
      text: 'Production path is /srv/Foo',
    }).confirmed,
    false,
  );
  assert.equal(
    verifyUserEvidence('deploy Fridays', {
      entryId: '1',
      kind: 'system.notification',
      text: 'deploy Fridays',
    }).confirmed,
    false,
  );
  assert.equal(verifyUserEvidence('deploy Fridays', null).confirmed, false);
  assert.equal(
    verifyUserEvidence('unrelated claim about rust', {
      entryId: '1',
      kind: 'user',
      text: 'pnpm only',
    }).confirmed,
    false,
  );
});

test('a correction quoting the user stays confirmed; a rewrite is agent_inferred', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  f.turn = {
    entryId: '10',
    kind: 'user',
    text: '记住：我喝咖啡',
  };
  await call(f.tool('remember'), id, {
    text: '我喝咖啡',
    source: 'user',
    core: true,
  });

  // Rewriting the correction into English cannot be authenticated.
  f.turn = {
    entryId: '20',
    kind: 'user',
    text: '不是咖啡，我改喝茶了',
  };
  const rewritten = await call(f.tool('revise'), id, {
    seq: 0,
    text: 'Tian drinks tea instead of coffee',
    reason: 'user corrected the preference',
    source: 'user',
  });
  assert.match(toolText(rewritten), /agent-inferred/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT trust_level FROM memories WHERE seq = 1')
        .get() as { trust_level: string }
    ).trust_level,
    'agent_inferred',
  );

  // An anchored save request for the correction is the confirmation path. The
  // confirmed correction supersedes the active fact it was written against.
  f.turn = { entryId: '21', kind: 'user', text: '记住：其实我喝茶' };
  const verbatim = await call(f.tool('revise'), id, {
    seq: 0,
    text: '其实我喝茶',
    reason: 'user corrected the preference',
    source: 'user',
  });
  assert.match(toolText(verbatim), /user-confirmed/);
  const row = f.db.sqlite
    .prepare('SELECT source_ref, trust_level, core FROM memories WHERE seq = 2')
    .get() as { source_ref: string; trust_level: string; core: number };
  assert.equal(row.trust_level, 'user_confirmed');
  assert.equal(row.source_ref, `conv:${id}#21`);
  // The original fact was in Core; the correction does not inherit Core.
  assert.equal(f.scopes.memory('global').dump().items[1].core, false);
  // The verified correction supersedes the original fact in the same
  // transaction; the old fact leaves Core but remains as history.
  assert.equal(f.scopes.memory('global').dump().items[0].status, 'superseded');
  assert.doesNotMatch(f.scopes.memory('global').wake(), /我喝咖啡/);
  assert.match(
    f.scopes.memory('global').recall('我喝咖啡', { includeHistory: true }),
    /\(superseded\)/,
  );
});

test('remember source:user keeps a candidate until an explicit save or review', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  // An ordinary user statement equal to the stored claim confirms the source
  // only: no confirmation record, no activation, no Core.
  f.turn = { entryId: '30', kind: 'user', text: 'I prefer tea in the morning' };
  const inferred = await call(f.tool('remember'), id, {
    text: 'I prefer tea in the morning',
    source: 'user',
    core: true,
  });
  assert.match(toolText(inferred), /agent-inferred/);
  const pending = f.scopes.memory('global').dump().items[0];
  assert.equal(pending.status, 'candidate');
  assert.equal(pending.trustLevel, 'agent_inferred');
  assert.equal(pending.core, false);
  assert.equal(pending.verifiedAt, null);
  assert.equal(pending.confirmations?.length ?? 0, 0);
  assert.doesNotMatch(f.scopes.memory('global').wake(), /tea in the morning/);
  // The anchored save request activates it with a real confirmation record.
  f.turn = {
    entryId: '31',
    kind: 'user',
    text: 'remember: I prefer tea in the morning',
  };
  const saved = await call(f.tool('remember'), id, {
    text: 'I prefer tea in the morning',
    source: 'user',
  });
  assert.match(toolText(saved), /user-confirmed/);
  const active = f.scopes.memory('global').dump().items[0];
  assert.equal(active.status, 'active');
  assert.equal(active.trustLevel, 'user_confirmed');
  assert.equal(active.confirmations?.length, 1);
  assert.ok(active.verifiedAt);
  // Selection stayed a separate decision: saving did not select into Core.
  assert.equal(active.core, false);
});

test('an unconfirmed revise validates its target instead of inventing a fact', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  const memory = f.scopes.memory('global');
  memory.remember({ text: 'Deploys run on Fridays', kind: 'decision' });
  f.turn = { entryId: '40', kind: 'user', text: 'deploy day changed' };
  // A missing number fails; it never becomes a standalone candidate.
  const missing = await call(f.tool('revise'), id, {
    seq: 99,
    text: 'Deploys run on Thursdays',
    reason: 'user corrected the day',
  });
  assert.equal(missing.isError, true);
  assert.match(toolText(missing), /no memory #99/);
  // A historical target fails the same way.
  memory.revise(0, 'Deploys run on Sundays', 'corrected', 'user');
  const historical = await call(f.tool('revise'), id, {
    seq: 0,
    text: 'Deploys run on Saturdays',
    reason: 'user corrected the day again',
  });
  assert.equal(historical.isError, true);
  assert.match(toolText(historical), /superseded/);
  assert.equal(memory.dump().items.length, 2);
  assert.equal(
    memory.dump().items.filter((item) => item.status === 'candidate').length,
    0,
  );
  // A live target stores the correction as a candidate that leaves the target
  // active until Tian chooses the replacement.
  const pending = await call(f.tool('revise'), id, {
    seq: 1,
    text: 'Deploys run on Thursdays',
    reason: 'user corrected the day',
  });
  assert.match(toolText(pending), /candidate/);
  const review = memory
    .dump()
    .items.find((item) => item.status === 'candidate')!;
  assert.equal(review.supersedes, 1);

  // Verbatim user wording confirms the source only: an ordinary correction
  // sentence must not replace the fact without an explicit save request.
  f.turn = { entryId: '41', kind: 'user', text: 'Deploys run on Wednesdays' };
  const verbatim = await call(f.tool('revise'), id, {
    seq: 1,
    text: 'Deploys run on Wednesdays',
    reason: 'user corrected the day',
    source: 'user',
  });
  assert.match(toolText(verbatim), /candidate/);
  assert.equal(memory.dump().items[1].status, 'active');
  assert.equal(
    memory.dump().items.filter((item) => item.status === 'candidate').length,
    2,
  );
  assert.equal(memory.dump().items[1].status, 'active');
});

test('ordinary activation never replaces a fact; only an explicit replacement does', async (t) => {
  const f = await harness(t);
  const memory = f.scopes.memory('p1');
  const old = memory.remember({
    text: 'Deploys run on Fridays',
    kind: 'decision',
    core: true,
  });
  const pending = memory.candidate({
    text: 'Deploys run on Mondays',
    kind: 'decision',
    sourceRef: 'conv:1#2',
    supersedes: old.memory.seq,
  })!;
  // The supersede hint is a review prompt, not an instruction.
  const activated = memory.promote(pending.seq, 'user', 'reviewed');
  assert.equal(activated.memory.status, 'active');
  assert.equal(activated.superseded, null);
  assert.equal(
    memory.dump().items.find((item) => item.seq === old.memory.seq)?.status,
    'active',
  );
  assert.match(memory.wake(), /Fridays/);
  assert.doesNotMatch(memory.wake(), /Mondays/);
  // The dedicated replacement action is the only path that supersedes; it
  // needs a candidate, so the replacement is staged through revise.
  const staged = memory.candidate({
    text: 'Deploys run on Saturdays',
    kind: 'decision',
    sourceRef: 'conv:1#3',
    supersedes: old.memory.seq,
  })!;
  const replaced = memory.promote(staged.seq, 'user', 'reviewed', undefined, {
    seq: old.memory.seq,
    content: old.memory.content,
    conditions: old.memory.conditions,
    validUntil: old.memory.validUntil,
  });
  assert.equal(replaced.superseded?.status, 'superseded');
  assert.equal(
    memory.dump().items.find((item) => item.seq === old.memory.seq)?.status,
    'superseded',
  );
  assert.doesNotMatch(memory.wake(), /Fridays/);
});

test('an expired memory cannot be selected into Core', async (t) => {
  const f = await harness(t);
  const memory = f.scopes.memory('p1');
  const expired = memory.remember({
    text: 'Deploy freeze ended',
    validUntil: '2020-01-01T00:00:00.000Z',
  });
  assert.throws(
    () => memory.select(expired.memory.seq),
    /expired .*cannot enter Core/,
  );
  assert.equal(
    memory.dump().items.find((item) => item.seq === expired.memory.seq)?.core,
    false,
  );
  assert.throws(
    () =>
      memory.remember({
        text: 'Another expired fact',
        validUntil: '2020-01-01',
        core: true,
      }),
    /expired .*cannot enter Core/,
  );
});

test('duplicate remember with core stays inside the rendered budget or writes nothing', async (t) => {
  const f = await harness(t);
  await f.openConversation('p1');
  const memory = f.scopes.memory('p1');
  // Keep selecting large facts until the next one cannot fit; the exact count
  // depends on the rendered metadata, so derive it instead of hard-coding.
  let overflow = '';
  for (let i = 0; i < 50; i++) {
    const candidate = `fact ${i} ${'中'.repeat(400)}`;
    try {
      memory.remember({ text: candidate, core: true });
    } catch {
      overflow = candidate;
      break;
    }
  }
  assert.ok(overflow, 'the fixture never filled Core');
  // The oversized fact is rejected through the normal path…
  assert.throws(
    () => memory.remember({ text: overflow, core: true }),
    /Core Memory is full/,
  );
  // …a fact larger than the remaining budget lands unselected.
  const remaining = 1500 - memory.coreUsage().tokens;
  const plainText = '中'.repeat(Math.min(999, remaining + 100));
  const plain = memory.remember({ text: plainText });
  assert.equal(plain.created, true);
  assert.equal(plain.memory.core, false);
  const before = memory.wake();

  // A duplicate remember that ALSO asks for Core must not bypass the budget.
  assert.throws(
    () => memory.remember({ text: plainText, core: true }),
    /Core Memory is full/,
  );
  assert.equal(memory.wake(), before);

  // Rejected atomically: no evidence write, no partial state.
  assert.equal(
    (
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM memory_versions WHERE action = 'evidence'",
        )
        .get() as { n: number }
    ).n,
    0,
  );
  // Freeing enough budget lets the same duplicate select successfully.
  const plainCost = Math.ceil(Buffer.byteLength(plainText, 'utf8') / 3) + 40;
  while (memory.coreUsage().tokens + plainCost > 1500) {
    const selected = memory.dump().items.find((item) => item.core);
    if (!selected) break;
    memory.deselect(selected.seq);
  }
  const retried = memory.remember({ text: plainText, core: true });
  assert.equal(retried.created, false);
  assert.equal(retried.memory.core, true);
  assert.match(memory.wake(), /中中/);
});

test('same-text revision records confirmation, publishes version and export, and re-checks Core', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-sametext-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(join(dir, 'data'));
  const memory = new MemoryStore(db, 'p1', join(dir, 'mem'));
  memory.remember({
    text: '项目用 pnpm',
    actor: 'chief',
    sourceRef: 'conv:1#2',
  });
  const readExport = () => readFileSync(join(dir, 'mem', 'MEMORY.md'), 'utf8');
  const exportedBefore = readExport();
  const versionsBefore = (
    db.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_versions').get() as {
      n: number;
    }
  ).n;

  // Same content, but now confirmed from a later entry: trust, source, version,
  // export and the next-turn snapshot all move.
  const same = memory.revise(0, '项目用 pnpm', 'Tian confirmed it', 'user', {
    sourceRef: 'conv:1#9',
    confirmation: { sourceRef: 'conv:1#9', method: 'review' },
  });
  assert.equal(same.changed, false);
  assert.equal(same.evidenceAdded, true);
  assert.equal(same.memory.trustLevel, 'user_confirmed');
  assert.equal(same.memory.sourceRef, 'conv:1#9');
  assert.equal(same.memory.verifiedAt !== null, true);
  assert.equal(
    (
      db.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_versions').get() as {
        n: number;
      }
    ).n,
    versionsBefore + 1,
  );
  assert.notEqual(readExport(), exportedBefore);
  assert.match(readExport(), /user_confirmed/);
  assert.ok(memory.version() > 0);

  // Repeating adds nothing: no duplicate evidence rows.
  const repeat = memory.revise(0, '项目用 pnpm', 'again', 'user', {
    sourceRef: 'conv:1#9',
    confirmation: { sourceRef: 'conv:1#9', method: 'review' },
  });
  assert.equal(repeat.evidenceAdded, false);
  assert.equal(
    (
      db.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM memory_versions WHERE action = 'evidence'",
        )
        .get() as { n: number }
    ).n,
    1,
  );
});

test('metadata growth can push a selected memory out of Core, reported not overflowing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-metaoverflow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(join(dir, 'data'));
  const memory = new MemoryStore(db, 'p1', join(dir, 'mem'));
  // ~410 + ~1015 tokens selected; fits with the footer, adding a 400-char
  // source ref does not.
  memory.remember({ text: 'main'.padEnd(0) + '中'.repeat(400), core: true });
  memory.remember({ text: '中'.repeat(1000), core: true });
  assert.doesNotMatch(memory.wake(), /need \d+ tokens/);

  const dropped = memory.revise(
    0,
    memory.dump().items[0].content,
    'attach evidence',
    'chief',
    {
      sourceRef: `conv:${'9'.repeat(400)}#${'8'.repeat(400)}`,
      trustLevel: 'user_confirmed',
    },
  );
  assert.equal(dropped.changed, false);
  assert.equal(dropped.evidenceAdded, true);
  assert.equal(dropped.coreDropped, true);
  assert.equal(dropped.memory.core, false);
  // The replacement is saved and searchable; Core stays valid.
  assert.doesNotMatch(memory.wake(), /need \d+ tokens/);
  assert.equal(memory.dump().core.selected, 1);
});

test('select replays are deduplicated: a replayed agent select cannot undo a user deselect', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const memory = f.scopes.memory('global');
  memory.remember({ text: 'Resident fact' });
  // Agent selects (its durable call id), the user then deselects via IPC.
  await call(
    f.tool('select'),
    String(conversation.id),
    { seq: 0 },
    'agent-call',
  );
  f.data.deselect('global', 0, 'user');
  assert.equal(memory.dump().items[0].core, false);
  // The agent call replays (durable retry): the user's result stands.
  await call(
    f.tool('select'),
    String(conversation.id),
    { seq: 0 },
    'agent-call',
  );
  assert.equal(memory.dump().items[0].core, false);
  // A fresh select call works normally again.
  await call(
    f.tool('select'),
    String(conversation.id),
    { seq: 0 },
    'agent-call-2',
  );
  assert.equal(memory.dump().items[0].core, true);
});

test('a rolled-back savepoint discards its after-commit callbacks', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-savepoint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(join(dir, 'data'));
  const ran: string[] = [];
  db.transaction(() => {
    db.afterCommit(() => ran.push('outer'));
    assert.throws(() =>
      db.transaction(() => {
        db.afterCommit(() => ran.push('inner'));
        throw new Error('inner failure');
      }),
    );
    // Outer work continues after the inner rollback.
    db.afterCommit(() => ran.push('outer-2'));
  });
  assert.deepEqual(ran, ['outer', 'outer-2']);
});

test('memory search: non-contiguous multi-word AND, short Chinese terms, relevance, limit and budget', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  f.turn = null;
  const facts = [
    'Project uses SQLite for durable memory storage',
    'The memory store keeps versions and sources',
    '用户偏好中文对话',
    '部署使用 release 分支',
    'Unrelated deployment detail about caches',
  ];
  // Seed active rows directly: tool writes without a verified user turn are
  // candidates by design and are covered by the review tests.
  for (const text of facts)
    f.scopes.memory('global').remember({ text, actor: 'chief' });

  const recall = f.tool('recall');
  // Non-contiguous words both match (AND), unlike the old phrase query.
  const multi = toolText(await call(recall, id, { query: 'SQLite memory' }));
  assert.match(multi, /SQLite for durable memory/);
  assert.doesNotMatch(multi, /keeps versions/);
  // Two-character Chinese words work through the LIKE fallback.
  assert.match(toolText(await call(recall, id, { query: '中文' })), /中文对话/);
  // Mixed long + short terms.
  assert.match(
    toolText(await call(recall, id, { query: '部署 分支' })),
    /部署使用 release 分支/,
  );
  // Every hit carries seq, kind, trust, date and source.
  assert.match(multi, /#0 \[fact\] agent_inferred \d{4}-\d{2}-\d{2}/);
  // Limit is honored: exactly one hit line (a truncation footer may follow).
  const limited = toolText(
    await call(recall, id, { query: 'memory', limit: 1 }),
  );
  const limitedLines = limited.split('\n');
  assert.match(limitedLines[0], /^#\d+ \[/);
  assert.ok(
    limitedLines.length === 1 || limitedLines[1].startsWith('…'),
    `limit 1 returned more than one hit: ${limited}`,
  );
  // The budget covers the WHOLE returned string. Too small for even the
  // omission footer is an explicit argument error, never an over-budget body.
  assert.throws(
    () => f.scopes.memory('global').recall('memory', { budget: 1 }),
    /too small for this result/,
  );
  const tight = f.scopes.memory('global').recall('memory', { budget: 40 });
  assert.ok(
    Math.ceil(Buffer.byteLength(tight, 'utf8') / 3) <= 40,
    `recall exceeded its budget: ${tight}`,
  );
  assert.doesNotMatch(tight, /durable memory storage/);
  assert.match(tight, /more match\(es\)/);
  // No matches is explicit, not invented.
  assert.equal(
    toolText(await call(recall, id, { query: '不存在的词汇' })),
    '(no matches)',
  );
  // Ownership: the chief wrote General, so the project's memory has none of
  // it, and a project recall is marked read-only.
  const projectRecall = toolText(
    await call(recall, id, { query: 'SQLite', scope: 'p1' }),
  );
  assert.match(projectRecall, /read-only/);
  assert.match(projectRecall, /\(no matches\)$/);
});

test('long history: middle and tail of a tool result are searchable and pageable', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  const head = 'build log start';
  const middle = 'MIDDLE_MARKER: the migration timed out at step 42';
  const tail = 'TAIL_MARKER: rollback completed cleanly';
  const long = `${head}\n${'filler line for the build output\n'.repeat(400)}${middle}\n${'more filler\n'.repeat(200)}${tail}`;
  await f.append(conversation, userTurn('run the migration', 0));
  await f.append(conversation, {
    kind: 'pi.tool-result',
    model: [
      {
        role: 'toolResult',
        toolCallId: 'call-migrate',
        toolName: 'bash',
        content: [{ type: 'text', text: long }],
        isError: false,
        timestamp: T0 + 60_000,
      },
    ],
  });
  await f.history.syncAll();

  const search = f.tool('search_history');
  for (const query of ['MIDDLE_MARKER', 'TAIL_MARKER', 'step 42']) {
    const found = plain(
      toolText(await call(search, id, { query, scope: 'p1' })),
    );
    assert.match(found, new RegExp(query.split(' ')[0]), `${query} missing`);
  }
  const found = plain(
    toolText(await call(search, id, { query: 'MIDDLE_MARKER', scope: 'p1' })),
  );
  const ref = /conv:\d+#[\w:]+/.exec(found)?.[0];
  assert.ok(ref, `no ref in ${found}`);

  const read = f.tool('read_history');
  const first = plain(
    toolText(await call(read, id, { ref, around: 0, limit: 300 })),
  );
  assert.match(first, /chars 1-300 of \d+/);
  assert.match(first, /continued at read_history/);
  assert.doesNotMatch(first, /TAIL_MARKER/);
  let offset = Number(/offset=(\d+)/.exec(first)![1]);
  let all = first;
  for (let page = 0; page < 10; page++) {
    const chunk = plain(
      toolText(await call(read, id, { ref, around: 0, offset, limit: 8000 })),
    );
    all += chunk;
    if (chunk.includes('end of entry')) break;
    offset = Number(/offset=(\d+)/.exec(chunk)![1]);
  }
  assert.match(all, /TAIL_MARKER/);
  assert.match(all, /end of entry/);
  // The ref always points at the entry, not the chunk that happened to match.
  assert.doesNotMatch(ref!, /:chunk:/);
  // Context read still shows neighbouring turns around the target.
  const context = plain(
    toolText(await call(read, id, { ref, around: 1, limit: 200 })),
  );
  assert.match(context, /run the migration/);
  assert.match(context, /MIDDLE_MARKER|build log start/);

  // Unicode paging never splits a surrogate pair.
  const page = pageText('😀'.repeat(10), 3, 2);
  assert.equal(page.page, '😀😀');
  assert.equal(page.next, 5);
  assert.equal(page.total, 10);
});

test('recall budgets bound the complete output, including footer and newlines', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tian-recallbudget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Db(join(dir, 'data'));
  const memory = new MemoryStore(db, 'p1', join(dir, 'mem'));
  memory.remember({ text: `sample ${'a'.repeat(900)}` });
  memory.remember({ text: `sample ${'b'.repeat(900)}` });

  const cost = (value: string) =>
    Math.ceil(Buffer.byteLength(value, 'utf8') / 3);

  // Multi-result omission: the whole string (two lines + footer) fits.
  const wide = memory.recall('sample', { budget: 60 });
  assert.ok(cost(wide) <= 60, `over budget: ${cost(wide)}`);
  assert.match(wide, /more match\(es\)/);
  assert.match(wide, /^#\d+ \[/);

  // A budget that only allows one truncated hit still fits with its footer.
  const tight = memory.recall('sample', { budget: 30 });
  assert.ok(cost(tight) <= 30, `over budget: ${cost(tight)}`);
  assert.match(tight, /…/);
  assert.match(tight, /1 more match\(es\)/);

  // No match is explicit and cheap with the default budget.
  assert.equal(memory.recall('nothing-here'), '(no matches)');
  // …and the budget contract covers these early returns too: `(no matches)`
  // costs 4 tokens, so budget 1 is an explicit argument error, not a body that
  // silently exceeds it. A budget of exactly 4 is accepted.
  assert.throws(
    () => memory.recall('nothing-here', { budget: 1 }),
    /too small for this result/,
  );
  assert.equal(memory.recall('nothing-here', { budget: 4 }), '(no matches)');
  // An empty query takes the same early return and the same contract.
  assert.equal(memory.recall(''), '(no matches)');
  assert.throws(
    () => memory.recall('   ', { budget: 1 }),
    /too small for this result/,
  );
  assert.equal(memory.recall('', { budget: 4 }), '(no matches)');
  // A non-integer budget is rejected rather than rounded into a claim.
  assert.throws(
    () => memory.recall('nothing-here', { budget: 3.5 }),
    /too small for this result/,
  );

  // A budget too small for the status footer is an explicit argument error,
  // never a body that claims to fit while exceeding it.
  assert.throws(
    () => memory.recall('sample', { budget: 1 }),
    /too small for this result/,
  );

  // With enough budget every hit renders and the measured output still fits.
  const full = memory.recall('sample', { budget: 2_000 });
  assert.ok(cost(full) <= 2_000);
  assert.equal(full.split('\n').length, 2);
  assert.doesNotMatch(full, /more match/);
});

test('memory writes are idempotent under a replayed operation and duplicates add evidence once', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  f.turn = { entryId: '5', kind: 'user', text: '记住项目用 pnpm' };
  const remember = f.tool('remember');
  const args = {
    text: '项目用 pnpm',
    source: 'user',
    operationId: 'ignored',
  };
  await call(remember, id, args, 'same-call');
  // The same durable call replayed: operationId is derived from task+callId, so
  // the second execution is a no-op rather than a second row.
  await call(remember, id, args, 'same-call');
  assert.equal(f.scopes.memory('global').dump().items.length, 1);

  // A different call with the same text returns the same id and records the
  // new evidence without duplicating the row.
  f.turn = { entryId: '6', kind: 'user', text: '对，项目用 pnpm' };
  const again = await call(remember, id, {
    text: '项目用 pnpm',
    source: 'user',
  });
  assert.match(toolText(again), /already says that/);
  assert.match(toolText(again), /evidence recorded/);
  assert.equal(f.scopes.memory('global').dump().items.length, 1);
  // The duplicate is one review record with two citations, not a second fact
  // or a second audit write.
  assert.equal(
    f.db.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM memory_versions WHERE action = 'evidence'",
      )
      .get()?.n,
    1,
  );
  assert.equal(f.scopes.memory('global').dump().items[0].evidence?.length, 2);
});

test('candidates never enter Core automatically, and ordinary promotion keeps both facts', async (t) => {
  const f = await harness(t);
  await f.openConversation('p1');
  const memory = f.scopes.memory('p1');
  const old = memory.remember({
    text: 'Deploys happen on Fridays',
    kind: 'decision',
    core: true,
  });
  const candidate = memory.candidate({
    text: 'Deploys happen on Mondays',
    kind: 'decision',
    confidence: 0.7,
    sourceRef: 'conv:9#1',
    supersedes: old.memory.seq,
  })!;
  // Extraction alone never changes Core or default recall.
  assert.doesNotMatch(memory.wake(), /Mondays/);
  assert.equal(memory.recall('Mondays'), '(no matches)');
  // The user revises the target while the candidate waits.
  memory.revise(
    old.memory.seq,
    'Deploys happen on Sundays',
    'correction',
    'user',
  );
  // Ordinary activation ignores the stale hint instead of replacing the newer
  // fact; the candidate becomes active and searchable on its own.
  const promoted = f.data.promote('p1', candidate.seq);
  assert.equal(promoted.memory.status, 'active');
  assert.equal(promoted.superseded, null);
  assert.equal(
    memory.dump().items.find((item) => item.seq === candidate.seq)?.status,
    'active',
  );
  // The current fact is still in Core and the candidate stayed out of it.
  assert.match(memory.wake(), /Sundays/);
  assert.doesNotMatch(memory.wake(), /Mondays/);
  assert.match(memory.recall('Mondays'), /Mondays/);
});

test('the chief owns General memory: writes land there, Core renders only General', async (t) => {
  const f = await harness(t);
  const project = await f.openConversation('p1');
  const general = await f.openConversation('global');
  // A project's memory is its manager's; seed it directly.
  f.scopes.memory('p1').remember({
    text: '项目用 SQLite',
    core: true,
    actor: 'manager',
  });
  // Even from a project conversation, the chief writes General memory.
  f.turn = { entryId: '1', kind: 'user', text: 'Tian 偏好中文' };
  const written = await call(f.tool('remember'), String(project.id), {
    text: 'Tian 偏好中文',
    core: true,
    source: 'user',
  });
  assert.match(toolText(written), /\[global\]/);
  // There is no scope or target escape hatch on the write tools.
  f.turn = { entryId: '2', kind: 'user', text: '项目改用 pnpm' };
  await call(f.tool('remember'), String(general.id), {
    text: '项目改用 pnpm',
    scope: 'p1',
    target: 'project',
  });
  f.scopes.memory('p1').candidate({
    text: 'A project-only candidate',
    kind: 'fact',
    confidence: 0.5,
    sourceRef: 'conv:1#3',
  });

  assert.deepEqual(
    f.scopes
      .memory('global')
      .dump()
      .items.map((item) => item.content),
    ['Tian 偏好中文', '项目改用 pnpm'],
  );
  assert.deepEqual(
    f.scopes
      .memory('p1')
      .dump()
      .items.map((item) => item.content),
    ['项目用 SQLite', 'A project-only candidate'],
  );
  assert.equal(
    f.scopes.memory('global').recall('project-only candidate'),
    '(no matches)',
  );
  // revise / forget / select act on General #seq, never the project's #0.
  await call(f.tool('forget'), String(project.id), {
    seq: 0,
    reason: 'test',
  });
  assert.equal(f.scopes.memory('p1').dump().items[0].status, 'active');
  assert.equal(f.scopes.memory('global').dump().items[0].status, 'deleted');
  // The chief reads a project's memory only on demand, marked read-only.
  const read = toolText(
    await call(f.tool('recall'), String(general.id), {
      query: 'SQLite',
      scope: 'proj',
    }),
  );
  assert.match(read, /read-only; owned by Manager/);
  assert.match(read, /项目用 SQLite/);
  // The chief's Core is General only, even in a project conversation.
  const sections = f.chief.sections?.find((s) => s.key === 'memory');
  assert.ok(sections);
  const rendered = String(
    await sections.render({ conversationId: project.id } as never, {} as never),
  );
  assert.match(rendered, /\[global\]/);
  assert.doesNotMatch(rendered, /\[project/);
  assert.doesNotMatch(rendered, /项目用 SQLite/);
});

test('the chief writes only General notes and reads project notes read-only', async (t) => {
  const f = await harness(t);
  const project = await f.openConversation('p1');
  const id = String(project.id);
  f.scopes.writeNote('p1', 'plan', 'project plan: ship M4');
  await call(f.tool('write_note'), id, {
    name: 'people',
    content: 'Tian works with 阿七',
    scope: 'p1',
  });
  assert.deepEqual(f.scopes.listNotes('global'), ['people.md']);
  assert.deepEqual(f.scopes.listNotes('p1'), ['plan.md']);
  await call(f.tool('append_note'), id, { name: 'people', content: '\nmore' });
  assert.match(f.scopes.readNote('global', 'people'), /more/);
  // Default reads are General; a scope reads the project, marked read-only.
  assert.match(
    toolText(await call(f.tool('list_notes'), id, {})),
    /^people\.md$/,
  );
  const listed = toolText(
    await call(f.tool('list_notes'), id, { scope: 'p1' }),
  );
  assert.match(listed, /read-only/);
  assert.match(listed, /plan\.md/);
  assert.match(
    toolText(
      await call(f.tool('read_note'), id, { name: 'plan', scope: 'p1' }),
    ),
    /read-only[\s\S]*ship M4/,
  );
  assert.match(
    toolText(
      await call(f.tool('search_notes'), id, { query: 'M4', scope: 'p1' }),
    ),
    /plan\.md:1/,
  );
});

test('notifications drive Core snapshot refreshes while provenance stays system', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  // Turn 1: an explicit save request, selected into Core.
  f.turn = {
    entryId: '10',
    kind: 'user',
    text: '记住：项目部署走 release 分支',
  };
  await call(f.tool('remember'), id, {
    text: '项目部署走 release 分支',
    source: 'user',
    core: true,
  });
  const sections = f.chief.sections?.find(
    (section) => section.key === 'memory',
  );
  assert.ok(sections);
  const render = () =>
    sections.render({ conversationId: id } as never, {} as never);
  const first = String(await render());
  assert.match(first, /release 分支/);
  // Same turn marker: the snapshot is stable even after writes bumped version.
  assert.equal(String(await render()), first);

  // A system wake after a revision from ANOTHER channel must not keep serving
  // the stale snapshot: any input kind is a turn marker.
  f.scopes.memory('global').deselect(0);
  f.turn = {
    entryId: '77',
    kind: 'system.notification',
    text: '[goal wake] nightly check',
  };
  const refreshed = String(await render());
  assert.notEqual(refreshed, first);
  assert.doesNotMatch(refreshed, /release 分支/);
  // Same wake again: stable within the turn.
  assert.equal(String(await render()), refreshed);

  // The wake itself is traceable evidence for writes, but never user-confirmed.
  const wakeWrite = await call(f.tool('remember'), id, {
    text: 'Nightly checks run at 03:00',
    source: 'user',
  });
  assert.match(toolText(wakeWrite), /agent-inferred/);
  assert.match(toolText(wakeWrite), /not started by Tian/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref FROM memories WHERE seq = 1')
        .get() as { source_ref: string }
    ).source_ref,
    `conv:${id}#77`,
  );
});

test('writes bind the exact current input even for agent-inferred facts', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  // A worker prompt: traceable, never a user statement.
  f.turn = {
    entryId: '9',
    kind: 'worker.input',
    text: 'Fix the flaky migration test',
  };
  const result = await call(f.tool('remember'), id, {
    text: 'The migration test is flaky on CI',
  });
  assert.match(toolText(result), /agent-inferred/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref, trust_level FROM memories WHERE seq = 0')
        .get() as { source_ref: string; trust_level: string }
    ).source_ref,
    `conv:${id}#9`,
  );
  // A system wake is equally traceable.
  f.turn = {
    entryId: '11',
    kind: 'system.notification',
    text: '[run finished] report ready',
  };
  const revised = await call(f.tool('revise'), id, {
    seq: 0,
    text: 'The migration test is flaky on CI runners',
    reason: 'refine wording',
  });
  // An unverified correction is a review candidate, not an automatic replace.
  assert.match(toolText(revised), /candidate/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref FROM memories WHERE seq = 1')
        .get() as { source_ref: string }
    ).source_ref,
    `conv:${id}#11`,
  );
  // An unverified agent write is a candidate, never silently active.
  assert.equal(f.scopes.memory('global').dump().items[0].status, 'candidate');
  assert.equal(f.scopes.memory('global').dump().items[1].supersedes, null);
});

test('the newest input wins even when it carries no text', async (t) => {
  const f = await harness(t);
  const conversation = await f.openConversation('p1');
  const id = String(conversation.id);
  // The fixture mirrors Service.currentInput: the newest input is returned
  // with whatever text it has, never scanning back to an older user turn.
  f.turn = { entryId: '70', kind: 'user', text: '' };
  const empty = await call(f.tool('remember'), id, {
    text: 'A fact from an image-only turn',
    source: 'user',
  });
  assert.match(toolText(empty), /agent-inferred/);
  assert.match(toolText(empty), /input is empty/);
  assert.equal(
    (
      f.db.sqlite
        .prepare('SELECT source_ref FROM memories WHERE seq = 0')
        .get() as { source_ref: string }
    ).source_ref,
    `conv:${id}#70`,
  );
  // An earlier textual turn is not reused for this request.
  assert.equal(
    verifyUserEvidence('A fact from an image-only turn', {
      entryId: '70',
      kind: 'user',
      text: '',
    }).confirmed,
    false,
  );
});

test('the shared search plan keeps one rule set for memory, history and notes', () => {
  const plan = planSearch('SQLite  记忆');
  assert.deepEqual(plan.terms, ['SQLite', '记忆']);
  assert.deepEqual(plan.long, ['SQLite']);
  assert.deepEqual(plan.short, ['记忆']);
  assert.equal(plan.match, '"SQLite"');
  assert.equal(planSearch('中文').match, null);
  assert.deepEqual(planSearch('  ').terms, []);
});
