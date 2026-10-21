// Optional integration test: consumes model tokens and performs real worker edits.
// All data and Git operations stay inside a unique temporary directory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { Service } from '../src/worker/service.js';
import type { ChatSnapshot } from '../src/shared/types.js';

const directory = mkdtempSync(join(tmpdir(), 'tian-model-e2e-'));
const projectPath = join(directory, 'project');
mkdirSync(projectPath);
writeFileSync(join(projectPath, 'README.md'), '# Temporary test project\n');
const git = (args: string[]) =>
  execFileSync('git', ['-C', projectPath, ...args], { stdio: 'pipe' });
git(['init', '-b', 'main']);
git(['add', 'README.md']);
git([
  '-c',
  'user.name=test',
  '-c',
  'user.email=test@local',
  'commit',
  '-m',
  'initial',
]);
git(['config', 'user.name', 'test']);
git(['config', 'user.email', 'test@local']);
let chiefView: ChatSnapshot | null = null;
const service = new Service(join(directory, 'data'), (channel, payload) => {
  if (channel === 'view') chiefView = (payload as { view: ChatSnapshot }).view;
});
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Model integration timed out');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

try {
  await service.init();
  const project = (
    await service.addProject('temporary', projectPath, 'Manager')
  ).find((scope) => scope.kind === 'project')!;
  const conversation = await service.createConversation(project.id);
  await service.watch(conversation.conversationId);
  const run = await service.dispatchRun({
    projectRef: project.id,
    chiefConversationId: conversation.conversationId,
    prompt:
      'Create hello.txt containing exactly "hello from worker" followed by a newline. Write your report to TIAN_REPORT.md. Do not commit.',
  });
  await until(() =>
    ['done', 'failed', 'interrupted'].includes(
      service.runList(null).find((value) => value.id === run.id)!.status,
    ),
  );
  const finished = service.runList(null).find((value) => value.id === run.id)!;
  assert.equal(
    finished.status,
    'done',
    finished.error ?? 'Worker did not succeed',
  );
  assert.equal(existsSync(join(projectPath, 'hello.txt')), false);
  assert.match(await service.runDiff(run.id), /hello from worker/);
  assert.ok(service.runReport(run.id).length > 0);
  await service.landRun(run.id);
  assert.equal(
    service.runList(null).find((value) => value.id === run.id)!.reviewStatus,
    'landed',
  );
  assert.equal(
    readFileSync(join(projectPath, 'hello.txt'), 'utf8'),
    'hello from worker\n',
  );
  assert.equal(existsSync(run.worktreePath!), false);
  await until(
    () =>
      !!chiefView?.rows.some((row) => row.role === 'assistant') &&
      !chiefView?.busy,
  );
  console.log('Real-model dispatch, report, diff, land, and chief wake: PASS');
} finally {
  await service.close();
  rmSync(directory, { recursive: true, force: true });
}
