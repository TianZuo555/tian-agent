// E2E smoke for the dispatch pipeline: real Service, temp git project,
// worker agent edits a file in a worktree, report + diff + inbox + wake.
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../src/worker/service.js';

const userDataDir = mkdtempSync(join(tmpdir(), 'tian-e2e-'));
const projectPath = '/tmp/tian-e2e-proj';

const views: { conversationId: string; kinds: string[]; texts: string[] }[] =
  [];
const svc = new Service(userDataDir, (channel: string, payload: unknown) => {
  if (channel === 'runs')
    console.log(
      '  [event runs]',
      (payload as { id: string; status: string }[])
        .map((r) => `${r.id}:${r.status}`)
        .join(', '),
    );
  if (channel === 'inbox') console.log('  [event inbox]', payload);
  if (channel === 'view') {
    const p = payload as {
      conversationId: string;
      view: { entries?: { kind: string; model?: unknown[] }[] };
    };
    const entries = p.view.entries ?? [];
    views.push({
      conversationId: p.conversationId,
      kinds: entries.map((e) => e.kind),
      texts: entries
        .flatMap((e) =>
          (e.model ?? []).flatMap((m) => {
            const c = (m as { content?: unknown }).content;
            return typeof c === 'string'
              ? [c]
              : ((c as { text?: string }[]) ?? []).map((x) => x?.text ?? '');
          }),
        )
        .filter(Boolean),
    });
  }
});
await svc.init();
console.log('service up, model:', svc.getSettings().model);

svc.addProject('e2eproj', projectPath);
console.log('project registered');

// chief conversation in the project scope
const scopes = svc.listScopes();
const proj = scopes.find((s) => s.name === 'e2eproj')!;
const conv = await svc.createConversation(proj.id);
await svc.watch(conv.conversationId);
console.log('chief conversation:', conv.conversationId);

// dispatch directly (same path the chief tool takes)
const run = await svc.dispatchRun({
  projectRef: proj.id,
  prompt:
    'Create a file hello.txt containing exactly the line "hello from worker". ' +
    'Then write your report to TIAN_REPORT.md.',
  chiefConversationId: conv.conversationId,
});
console.log('dispatched run:', run.id, 'worktree:', run.worktreePath);

// poll until terminal state (timeout guard 90s for the test)
const deadline = Date.now() + 90_000;
let row = svc.runList(null).find((r) => r.id === run.id)!;
while (
  (row.status === 'running' || row.status === 'queued') &&
  Date.now() < deadline
) {
  await new Promise((r) => setTimeout(r, 2000));
  row = svc.runList(null).find((r) => r.id === run.id)!;
}
console.log('final status:', row.status);

console.log('--- report ---');
console.log(await svc.runReport(run.id));
console.log('--- diff stat + diff ---');
console.log(await svc.runDiff(run.id));

const inboxDir = join(projectPath, '.tian', 'inbox');
console.log('inbox files:', existsSync(inboxDir) ? readdirSync(inboxDir) : []);

// review actions: land the branch back, then confirm file landed
if (row.status === 'done' && row.branch) {
  const out = await svc.landRun(run.id);
  console.log('--- land ---');
  console.log(out);
  console.log(
    'hello.txt in main checkout:',
    existsSync(join(projectPath, 'hello.txt')),
  );
  const landed = svc.runList(null).find((r) => r.id === run.id)!;
  console.log('run status after land:', landed.status);

  // discard path on a second run row (reuse same branch name pattern)
  const run2 = await svc.dispatchRun({
    projectRef: proj.id,
    prompt: 'Create discard-me.txt with one line, then write TIAN_REPORT.md.',
    chiefConversationId: conv.conversationId,
  });
  const deadline2 = Date.now() + 90_000;
  let row2 = svc.runList(null).find((r) => r.id === run2.id)!;
  while (
    (row2.status === 'running' || row2.status === 'queued') &&
    Date.now() < deadline2
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    row2 = svc.runList(null).find((r) => r.id === run2.id)!;
  }
  console.log('run2 status:', row2.status);
  await svc.discardRun(run2.id);
  const d2 = svc.runList(null).find((r) => r.id === run2.id)!;
  console.log(
    'run2 after discard:',
    d2.status,
    'worktree gone:',
    !existsSync(run2.worktreePath ?? ''),
  );
}

// chief should have been woken — wait for the wake turn, then inspect
await new Promise((r) => setTimeout(r, 30_000));
const last = views
  .filter((v) => v.conversationId === conv.conversationId)
  .at(-1);
console.log('chief transcript kinds:', last?.kinds.join(', '));
console.log(
  'chief last texts:',
  last?.texts.slice(-2).map((t) => t.slice(0, 400)),
);

await svc.close();
console.log('E2E DONE');
process.exit(0);
