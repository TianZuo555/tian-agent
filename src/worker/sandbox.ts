import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { Context } from '@earendil-works/chord';
import {
  FileError,
  err,
  type ExecutionEnv,
  type ExecutionError,
  type FileSystem,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type WatchTarget,
} from '@earendil-works/pi-durable/env';

/**
 * macOS Seatbelt sandbox for Worker commands (todo-worker-sandbox.md). Every
 * Worker `exec` runs under `sandbox-exec -f <profile>`; the in-process file
 * tools get the same allow/deny rules because Seatbelt cannot see them.
 * One profile file per Run lives at <dataDir>/sandbox/<runId>.sb for audit.
 */

export interface SandboxSpec {
  runId: string;
  /** Canonical writable work root: the worktree, or rootPath in-place. */
  workRoot: string;
  /** Canonical `<repo>/.git/worktrees/<id>` or `<root>/.git`; null outside git. */
  gitDir: string | null;
  dataDir: string;
  socketPath: string | null;
  /** `sandboxNetwork`: external network on; localhost always stays open. */
  network: boolean;
  /** `sandboxExtraWrite`: extra writable roots, one per line in settings. */
  extraWrite: string[];
  /** `sandboxAllowRead`: denied-read paths this project re-allows. */
  allowRead: string[];
  /** Files inside a writable root that stay read-only (an external CLI's config). */
  readOnly?: string[];
}

const HOME = homedir();
const TMP = realpathSync(tmpdir());
// clang/swift module cache: $TMPDIR's sibling per-user `C` directory
// (confstr _CS_DARWIN_USER_CACHE_DIR), not under `T`.
const USER_CACHE = join(dirname(TMP), 'C');

/** Secret paths a Worker may never read or write. */
const DENY_READ_DIRS = [
  join(HOME, '.ssh'),
  join(HOME, '.aws'),
  join(HOME, '.gnupg'),
  join(HOME, '.config', 'gh'),
  join(HOME, '.docker'),
  join(HOME, '.kube'),
  join(HOME, 'Library', 'Keychains'),
];
const DENY_READ_FILES = [join(HOME, '.netrc'), join(HOME, '.npmrc')];

/** Toolchain caches a build or test run legitimately writes into. */
const CACHE_WRITE_ROOTS = [
  TMP,
  USER_CACHE,
  '/private/tmp',
  join(HOME, 'Library', 'Caches'),
  join(HOME, '.cache'),
  join(HOME, '.npm'),
  join(HOME, 'Library', 'pnpm'),
  join(HOME, '.local', 'share', 'pnpm'),
  join(HOME, '.local', 'share', 'mise'),
  join(HOME, '.cargo', 'registry'),
  join(HOME, 'go', 'pkg', 'mod'),
  join(HOME, 'Library', 'Developer', 'Xcode', 'DerivedData'),
  join(HOME, 'Library', 'org.swift.swiftpm'),
];

const SANDBOX_BIN = '/usr/bin/sandbox-exec';
const subpath = (path: string) => `(subpath "${escape(path)}")`;
const escape = (path: string) =>
  path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

/** `git rev-parse --path-format=absolute --git-dir` for the run's work root. */
export function worktreeGitDir(workRoot: string): string | null {
  try {
    const out = execFileSync('git', [
      '-C',
      workRoot,
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ])
      .toString()
      .trim();
    return realpathSync(out);
  } catch {
    return null;
  }
}

/** Newline-separated setting text → absolute canonical paths. */
export function pathLines(text: string, cwd = '/'): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return realpathSync(resolve(cwd, line));
      } catch {
        return resolve(cwd, line);
      }
    });
}

let selfTest: boolean | null = null;
/** Startup probe; a `false` result means sandboxed projects must fail closed. */
export function sandboxAvailable(): boolean {
  if (selfTest !== null) return selfTest;
  if (process.platform !== 'darwin' || !existsSync(SANDBOX_BIN))
    return (selfTest = false);
  try {
    execFileSync(SANDBOX_BIN, [
      '-p',
      '(version 1)(allow default)',
      '/usr/bin/true',
    ]);
    selfTest = true;
  } catch {
    selfTest = false;
  }
  return selfTest;
}

/**
 * Canonical root for policy: realpath when the path exists, else resolve.
 * tmpdir() returns `/var/...` while its real path is `/private/var/...` —
 * every emitted rule and every in-process check needs the real form.
 */
function canon(path: string): string {
  return canonical(path, '/');
}

/** The Seatbelt program for one Run; `sandbox-exec` reads it verbatim. */
export function sandboxProfile(spec: SandboxSpec): string {
  const writeRoots = [
    spec.workRoot,
    ...(spec.gitDir ? [spec.gitDir] : []),
    ...CACHE_WRITE_ROOTS,
    ...spec.extraWrite,
  ].map(canon);
  const readBack = [spec.workRoot, ...(spec.gitDir ? [spec.gitDir] : [])].map(
    canon,
  );
  const dataDir = canon(spec.dataDir);
  const socket = spec.socketPath ? canon(spec.socketPath) : null;
  const allowRead = new Set(spec.allowRead.map(canon));
  const lines: string[] = ['(version 1)', '(allow default)', ''];
  if (!spec.network)
    lines.push(
      '; External network off; localhost stays open for dev servers.',
      '(deny network*)',
      '(allow network* (remote ip "localhost:*") (remote unix-socket))',
      '',
    );
  if (socket)
    lines.push(
      '; The service socket accepts every command: always closed.',
      `(deny network-outbound (remote unix-socket (path-literal "${escape(socket)}")))`,
      '',
    );
  const denyReads = [
    dataDir,
    ...DENY_READ_DIRS.map(canon).filter((dir) => !allowRead.has(dir)),
  ];
  const denyFiles = DENY_READ_FILES.map(canon).filter(
    (file) => !allowRead.has(file),
  );
  lines.push(
    '; Service data and credentials: no reads or writes.',
    `(deny file-read* file-write* ${denyReads.map(subpath).join(' ')}`,
    `  ${denyFiles.map((f) => `(literal "${escape(f)}")`).join(' ')})`,
    '',
    '; Writes denied everywhere, then re-allowed at the run roots.',
    '(deny file-write*)',
    `(allow file-write* ${writeRoots.map(subpath).join(' ')}`,
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty")',
    '  (literal "/dev/dtracehelper") (regex #"^/dev/fd/"))',
    '',
    '; The work root may live under the denied data dir: allow it back.',
    `(allow file-read* ${readBack.map(subpath).join(' ')})`,
  );
  const readOnly = (spec.readOnly ?? []).map(canon);
  if (readOnly.length)
    lines.push(
      '',
      '; Configuration inside a writable root stays read-only.',
      `(deny file-write* ${readOnly.map((f) => `(literal "${escape(f)}")`).join(' ')})`,
    );
  return lines.join('\n') + '\n';
}

/** Write `<dir>/<runId>.sb` and return its path; kept for audit. */
export function writeProfile(spec: SandboxSpec, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${spec.runId}.sb`);
  writeFileSync(path, sandboxProfile(spec));
  return path;
}

/** `/usr/bin/sandbox-exec -f <profile> <argv...>` for spawners. */
export function sandboxArgv(profilePath: string, argv: string[]): string[] {
  return [SANDBOX_BIN, '-f', profilePath, ...argv];
}

const under = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);

/**
 * Canonicalize for a path check. Existing paths resolve symlinks; missing
 * paths canonicalize the nearest existing parent (a new file's target).
 */
function canonical(path: string, cwd: string): string {
  const abs = resolve(cwd, path);
  let probe = abs;
  for (;;) {
    try {
      return realpathSync(probe) + abs.slice(probe.length);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return abs;
      probe = parent;
    }
  }
}

export class SandboxedExecutionEnv implements ExecutionEnv {
  readonly id: string;
  readonly cwd: string;
  private writeRoots: string[];
  private denyReads: string[];
  private allowReads: string[];
  /** Work roots stay readable even inside a denied directory. */
  private reallow: string[];

  constructor(
    private inner: ExecutionEnv,
    spec: SandboxSpec,
    private profilePath: string,
  ) {
    this.id = inner.id;
    this.cwd = inner.cwd;
    this.writeRoots = [
      spec.workRoot,
      ...(spec.gitDir ? [spec.gitDir] : []),
      ...CACHE_WRITE_ROOTS,
      ...spec.extraWrite,
    ].map(canon);
    this.reallow = [spec.workRoot, ...(spec.gitDir ? [spec.gitDir] : [])].map(
      canon,
    );
    this.denyReads = [
      canon(spec.dataDir),
      ...DENY_READ_DIRS,
      ...DENY_READ_FILES,
    ].map(canon);
    this.allowReads = spec.allowRead.map(canon);
  }

  private canWrite(path: string): boolean {
    const abs = canonical(path, this.cwd);
    return this.writeRoots.some((root) => under(abs, root));
  }
  private deniedRead(path: string): boolean {
    const abs = canonical(path, this.cwd);
    // Same precedence as the profile: denies first, then explicit re-allows.
    if (
      this.allowReads.some((root) => under(abs, root)) ||
      this.reallow.some((root) => under(abs, root))
    )
      return false;
    return this.denyReads.some((root) => under(abs, root));
  }
  /** `never` unifies: every Result<T> accepts this error shape. */
  private denied(path: string): Result<never, FileError> {
    return err(
      new FileError(
        'permission_denied',
        `Sandboxed worker may not touch ${path} (Operation not permitted)`,
        path,
      ),
    );
  }

  /** Both exec shapes run under the generated Seatbelt profile. */
  exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const argv =
      typeof command === 'string'
        ? sandboxArgv(this.profilePath, ['/bin/bash', '-c', command])
        : sandboxArgv(this.profilePath, [...command]);
    return this.inner.exec(argv, options, context);
  }

  // ── Writes: only under the run roots. ──────────────────────────────────
  writeFile(path: string, content: string | Uint8Array, context: Context) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.writeFile(path, content, context);
  }
  appendFile(path: string, content: string | Uint8Array, context: Context) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.appendFile(path, content, context);
  }
  truncateFile(path: string, size: number, context: Context) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.truncateFile(path, size, context);
  }
  flushFile(path: string, context: Context) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.flushFile(path, context);
  }
  renameFile(sourcePath: string, destinationPath: string, context: Context) {
    if (!this.canWrite(sourcePath) || !this.canWrite(destinationPath))
      return Promise.resolve(this.denied(sourcePath));
    return this.inner.renameFile(sourcePath, destinationPath, context);
  }
  createDir(
    path: string,
    options: Parameters<FileSystem['createDir']>[1],
    context: Context,
  ) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.createDir(path, options, context);
  }
  remove(
    path: string,
    options: Parameters<FileSystem['remove']>[1],
    context: Context,
  ) {
    if (!this.canWrite(path)) return Promise.resolve(this.denied(path));
    return this.inner.remove(path, options, context);
  }

  // ── Reads: denied paths fail; everything else delegates. ───────────────
  readTextFile(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.readTextFile(path, context);
  }
  openTextLineReader(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.openTextLineReader(path, context);
  }
  readTextLines(
    path: string,
    options: Parameters<FileSystem['readTextLines']>[1],
    context: Context,
  ) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.readTextLines(path, options, context);
  }
  readBinaryFile(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.readBinaryFile(path, context);
  }
  openBinaryReader(
    path: string,
    options: Parameters<FileSystem['openBinaryReader']>[1],
    context: Context,
  ) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.openBinaryReader(path, options, context);
  }
  fileInfo(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.fileInfo(path, context);
  }
  listDir(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.listDir(path, context);
  }
  listFiles(
    path: string,
    options: Parameters<NonNullable<FileSystem['listFiles']>>[1],
    context: Context,
  ) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    if (!this.inner.listFiles) return Promise.resolve(this.denied(path));
    return this.inner.listFiles(path, options, context);
  }
  openDirReader(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.openDirReader(path, context);
  }
  exists(path: string, context: Context) {
    if (this.deniedRead(path)) return Promise.resolve(this.denied(path));
    return this.inner.exists(path, context);
  }
  watch(
    targets: readonly WatchTarget[],
    onChange: Parameters<FileSystem['watch']>[1],
    context: Context,
  ) {
    const denied = targets.find((target) => this.deniedRead(target.path));
    if (denied) return Promise.resolve(this.denied(denied.path));
    return this.inner.watch(targets, onChange, context);
  }

  // ── Pure delegation: no I/O of its own to gate. ────────────────────────
  absolutePath(path: string, context: Context) {
    return this.inner.absolutePath(path, context);
  }
  joinPath(parts: string[], context: Context) {
    return this.inner.joinPath(parts, context);
  }
  canonicalPath(path: string, context: Context) {
    return this.inner.canonicalPath(path, context);
  }
  createTempDir(prefix: string | undefined, context: Context) {
    return this.inner.createTempDir(prefix, context);
  }
  createTempFile(
    options: Parameters<FileSystem['createTempFile']>[0],
    context: Context,
  ) {
    return this.inner.createTempFile(options, context);
  }
  cleanup(context: Context) {
    return this.inner.cleanup(context);
  }
}
