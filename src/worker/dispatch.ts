import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: number }).code !== 'number') {
          reject(error);
          return;
        }
        resolveResult({
          code: (error as { code?: number } | null)?.code ?? 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}
async function checked(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0)
    throw new Error(
      `git ${args[0]}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  return result.stdout.trim();
}
export async function isGitRepo(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const result = await git(path, ['rev-parse', '--is-inside-work-tree']);
  return result.code === 0 && result.stdout.trim() === 'true';
}
export async function addWorktree(
  rootPath: string,
  base: string,
  runId: string,
  worktreeBase: string,
) {
  mkdirSync(worktreeBase, { recursive: true });
  const worktreePath = join(worktreeBase, runId);
  const branch = `tian/${runId}`;
  if (existsSync(worktreePath)) {
    const [actual, commonDir, expected] = await Promise.all([
      checked(worktreePath, ['branch', '--show-current']),
      checked(worktreePath, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]),
      checked(rootPath, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ]),
    ]);
    if (actual !== branch || resolve(commonDir) !== resolve(expected))
      throw new Error(`Worktree path is occupied: ${worktreePath}`);
  } else {
    await checked(rootPath, [
      'worktree',
      'add',
      '-b',
      branch,
      worktreePath,
      base,
    ]);
  }
  return { worktreePath, branch };
}

/** Retrying collection must not create extra empty commits. */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<void> {
  await checked(worktreePath, ['add', '-A']);
  const staged = await git(worktreePath, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) return;
  if (staged.code !== 1) throw new Error(`git diff: ${staged.stderr}`);
  await checked(worktreePath, [
    '-c',
    'user.name=tian-worker',
    '-c',
    'user.email=tian@local',
    'commit',
    '-m',
    message,
  ]);
}
export async function diffStat(
  rootPath: string,
  base: string,
  branch: string,
): Promise<string> {
  return checked(rootPath, ['diff', '--stat', `${base}...${branch}`]);
}
export async function diff(
  rootPath: string,
  base: string,
  branch: string,
  maxChars = 200_000,
): Promise<string> {
  const result = await checked(rootPath, ['diff', `${base}...${branch}`]);
  return result.length > maxChars
    ? `${result.slice(0, maxChars)}\n… (diff truncated at ${maxChars} chars)`
    : result;
}
export async function isLanded(
  rootPath: string,
  base: string,
  branch: string,
): Promise<boolean> {
  const result = await git(rootPath, [
    'merge-base',
    '--is-ancestor',
    branch,
    base,
  ]);
  if (result.code > 1) throw new Error(`git merge-base: ${result.stderr}`);
  return result.code === 0;
}

/** A land operation always targets the branch captured at dispatch. */
export async function merge(
  rootPath: string,
  branch: string,
  base: string,
): Promise<string> {
  const current = await checked(rootPath, ['branch', '--show-current']);
  if (current !== base)
    throw new Error(
      `Checkout is on ${current || '(detached HEAD)'}; switch to ${base} before landing`,
    );
  if (
    await checked(rootPath, ['status', '--porcelain', '--untracked-files=no'])
  )
    throw new Error('Commit or stash tracked changes before landing');
  return checked(rootPath, [
    'merge',
    '--no-ff',
    '-m',
    `land ${branch}`,
    branch,
  ]);
}
export async function discardWorktree(
  rootPath: string,
  worktreePath: string | null,
  branch: string | null,
): Promise<void> {
  if (worktreePath && existsSync(worktreePath))
    await checked(rootPath, ['worktree', 'remove', '--force', worktreePath]);
  if (branch) {
    const existing = await git(rootPath, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]);
    if (existing.code === 0) await checked(rootPath, ['branch', '-D', branch]);
    else if (existing.code !== 1)
      throw new Error(`git show-ref: ${existing.stderr}`);
  }
}
export function gh(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile('gh', args, { cwd, timeout: 120_000 }, (error, stdout, stderr) =>
      error
        ? reject(new Error(String(stderr || error)))
        : resolveResult(String(stdout).trim()),
    );
  });
}
