import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Git subprocess helpers for dispatch worktrees. Never throws on exit code —
 * callers inspect `code`; a thrown error means spawn itself failed. */
export function git(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof (error as { code?: number }).code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          code: (error as { code?: number } | null)?.code ?? 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

export async function isGitRepo(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const r = await git(path, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

/** Cut a `tian/<runId>` branch off `base` into a fresh worktree. */
export async function addWorktree(
  rootPath: string,
  base: string,
  runId: string,
  worktreeBase: string,
): Promise<{ worktreePath: string; branch: string }> {
  mkdirSync(worktreeBase, { recursive: true });
  const worktreePath = join(worktreeBase, runId);
  const branch = `tian/${runId}`;
  const r = await git(rootPath, [
    'worktree',
    'add',
    '-b',
    branch,
    worktreePath,
    base,
  ]);
  if (r.code !== 0) throw new Error(`git worktree add: ${r.stderr.trim()}`);
  return { worktreePath, branch };
}

/** Commit whatever the worker left in the worktree. Empty tree is fine. */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<void> {
  await git(worktreePath, ['add', '-A']);
  await git(worktreePath, [
    '-c',
    'user.name=tian-worker',
    '-c',
    'user.email=tian@local',
    'commit',
    '--allow-empty',
    '-m',
    message,
  ]);
}

/** `base...branch` diff stat from the main checkout. */
export async function diffStat(
  rootPath: string,
  base: string,
  branch: string,
): Promise<string> {
  const r = await git(rootPath, ['diff', '--stat', `${base}...${branch}`]);
  return r.code === 0 ? r.stdout.trim() : `(diff failed: ${r.stderr.trim()})`;
}

export async function diff(
  rootPath: string,
  base: string,
  branch: string,
  maxChars = 200_000,
): Promise<string> {
  const r = await git(rootPath, ['diff', `${base}...${branch}`]);
  if (r.code !== 0) return `(diff failed: ${r.stderr.trim()})`;
  const out = r.stdout;
  return out.length > maxChars
    ? `${out.slice(0, maxChars)}\n… (diff truncated at ${maxChars} chars)`
    : out;
}

/** Merge the run branch into the main checkout's current branch. */
export async function merge(
  rootPath: string,
  branch: string,
): Promise<{ code: number; output: string }> {
  const r = await git(rootPath, [
    'merge',
    '--no-ff',
    '-m',
    `land ${branch}`,
    branch,
  ]);
  return { code: r.code, output: `${r.stdout}${r.stderr}`.trim() };
}

/** Remove the worktree and delete its branch. Best-effort. */
export async function discardWorktree(
  rootPath: string,
  worktreePath: string | null,
  branch: string | null,
): Promise<void> {
  if (worktreePath) {
    await git(rootPath, ['worktree', 'remove', '--force', worktreePath]).catch(
      () => {},
    );
  }
  if (branch) {
    await git(rootPath, ['branch', '-D', branch]).catch(() => {});
  }
}
