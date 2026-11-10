import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
} from 'node:child_process';
import type { Db, RunRow } from './db.js';
import type { RunToolCall } from './run-progress.js';
import type {
  WorkerConversation,
  WorkerRuntime,
  WorkerSubmission,
} from './runs.js';
import * as Git from './dispatch.js';
import { sandboxArgv } from './sandbox.js';

/**
 * Codex adapter (M6 phase 4): one `codex exec --json` process per Attempt.
 * Baseline contract: one-shot execution plus resume. A run's first submit
 * runs `codex exec`; a follow-up Attempt resumes the session stored on the
 * run row; a resubmit of the SAME attempt means the process died — an
 * automatic restart resume, allowed once per attempt with the guards from
 * agent-work.md. A second kill in one attempt ends as `interrupted`.
 *
 * Env allow-list: the child inherits only the whitelisted slice of
 * process.env — service socket paths, provider keys, and anything else stay
 * on the service side. Unsandboxed projects keep the CLI's own
 * `--sandbox workspace-write`; a sandboxed project runs codex under the
 * per-Run Seatbelt profile with the CLI sandbox off (nested Seatbelt fails).
 *
 * Flags go before `resume`: `codex exec resume` rejects `--sandbox`.
 */

/** Environment variables a codex process may inherit — nothing else leaks. */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'TMPDIR',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'CODEX_HOME',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
];

export interface WorkerOutcome {
  status: 'done' | 'unanswered' | 'interrupted';
  reason?: string;
}

export interface CodexRuntimeOptions {
  /** The codex binary; default resolves on PATH. */
  bin?: string;
  /** Injectable process spawner for tests. */
  spawn?: typeof spawn;
  /** Extra environment on top of the allow-listed slice. */
  env?: NodeJS.ProcessEnv;
  /** Token usage from `turn.completed` events, if the caller records it. */
  onUsage?: (runId: string, usage: unknown) => void;
  /**
   * Seatbelt (todo-worker-sandbox.md): the per-Run profile path for a
   * sandboxed project, null = run unsandboxed. Throws to fail closed.
   */
  sandboxProfile?: (run: RunRow) => string | null;
  /** Non-blocking notice to the supervising Manager: an automatic resume started. */
  onAutoResume?: (run: RunRow) => void;
}

const truncate = (value: string, max = 160) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/**
 * A hard service crash can leave the previous codex process group alive
 * (it dies only when it next writes to the closed pipe). Kill it before a
 * resume so two processes never share one worktree. The command check
 * guards against a reused pid after a reboot.
 */
function killStale(pid: number | null | undefined): void {
  if (!pid) return;
  let command = '';
  try {
    command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)])
      .toString()
      .trim();
  } catch {
    return; // no such process
  }
  if (!command.includes('codex')) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function processEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** The `codex exec --json` event fields this adapter reads. */
interface CodexEvent {
  type?: string;
  thread_id?: string;
  session_id?: string;
  item?: { type?: string; text?: string; [key: string]: unknown };
  usage?: unknown;
}

class CodexConversation implements WorkerConversation {
  private calls: RunToolCall[] = [];
  private text = '';
  private child: ChildProcess | null = null;
  private end: ((value: WorkerOutcome) => void) | null = null;
  private stderr: string[] = [];

  constructor(
    readonly id: string,
    private runId: string,
    private db: Db,
    private opts: CodexRuntimeOptions,
  ) {}

  private run(): RunRow {
    const run = this.db.getRun(this.runId);
    if (!run) throw new Error(`Unknown run ${this.runId}`);
    return run;
  }

  private cwd(run: RunRow): string {
    return run.worktreePath ?? run.rootPath;
  }

  /**
   * One submit = one `codex exec` process. Three shapes: the first submit of
   * a run starts a session; a NEW attempt resumes the stored session with the
   * follow-up prompt; a resubmit of the same attempt means the process died —
   * the one automatic resume an attempt gets.
   */
  async submit(prompt: string, _requestId: string): Promise<WorkerSubmission> {
    const run = this.run();
    // `externalAttempt` is written at launch, before codex reports a
    // session: a resubmit of that attempt is always a restart recovery.
    const sameAttempt = run.externalAttempt === run.attempt;
    const wait = sameAttempt
      ? this.autoResume(run, prompt)
      : this.launch(run, prompt, run.externalSession !== null);
    return { wait };
  }

  /**
   * The process died mid-attempt — resume once, with the guards from
   * agent-work.md. A second kill, a missing session id, or a failed resume
   * ends the attempt `interrupted`.
   */
  private autoResume(
    run: RunRow,
    prompt: string,
  ): () => Promise<WorkerOutcome> {
    // Even an unrecoverable attempt must stop its surviving process group.
    killStale(run.externalPid);
    if (run.autoResumed === run.attempt)
      return async () => ({
        status: 'interrupted',
        reason: `codex process killed a second time in attempt ${run.attempt}`,
      });
    if (!run.externalSession)
      return async () => ({
        status: 'interrupted',
        reason: `codex process killed before it reported a session id (attempt ${run.attempt})`,
      });
    this.db.patchRun(run.id, { autoResumed: run.attempt });
    this.opts.onAutoResume?.(run);
    return async () => {
      // Guard: snapshot the worktree before resuming — earlier work stays visible.
      try {
        await Git.commitAll(
          this.cwd(run),
          `tian run ${run.id} attempt ${run.attempt} (pre-resume snapshot)`,
        );
      } catch {
        /* A dirty-worktree snapshot is best-effort before a resume. */
      }
      // Guard: the prompt names the kill and the last tool call, so the agent
      // checks the worktree instead of repeating a side effect.
      // The last call is read from the run row: after a service restart this
      // conversation object is new and holds no in-memory state.
      const lastCall = this.db.getRun(run.id)?.externalLastCall;
      const notice = [
        `The previous codex process was killed mid-attempt${
          lastCall ? `; its last tool call was ${lastCall}` : ''
        }. That call may be incomplete — check the worktree state first and do not repeat a side effect without checking.`,
        prompt,
      ].join('\n\n');
      const outcome = await this.launch(run, notice, true)();
      return outcome.status === 'done'
        ? outcome
        : {
            status: 'interrupted',
            reason: `automatic resume failed: ${outcome.reason ?? 'unknown'}`,
          };
    };
  }

  /** Spawn the process; resolves when it exits. */
  private launch(
    run: RunRow,
    prompt: string,
    resume: boolean,
  ): () => Promise<WorkerOutcome> {
    const profile = this.opts.sandboxProfile?.(run) ?? null;
    const command = [
      this.opts.bin ?? 'codex',
      'exec',
      '--json',
      '--sandbox',
      // The outer Seatbelt profile is the single boundary when present.
      profile ? 'danger-full-access' : 'workspace-write',
      '--skip-git-repo-check',
      ...(run.model ? ['--model', run.model] : []),
      ...(run.thinkingLevel
        ? [
            '--config',
            `model_reasoning_effort=${JSON.stringify(run.thinkingLevel)}`,
          ]
        : []),
      ...(resume ? ['resume', run.externalSession!] : []),
      // The prompt is data: a leading `-` (a Markdown bullet) must not parse
      // as a flag, and a bare `resume` or `review` must not pick a subcommand.
      '--',
      prompt,
    ];
    const argv = profile ? sandboxArgv(profile, command) : command;
    // Mark the attempt as launched before codex reports a session id, so a
    // restart recovery recognizes the resubmit (see submit()).
    this.db.patchRun(run.id, { externalAttempt: run.attempt });
    const child = (this.opts.spawn ?? spawn)(argv[0], argv.slice(1), {
      cwd: this.cwd(run),
      env: processEnv(this.opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group: abort() kills the whole tree
    });
    this.child = child;
    // The process group id (detached: pgid = pid), for killStale after a crash.
    if (child.pid) this.db.patchRun(run.id, { externalPid: child.pid });
    this.stderr = [];
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      // A finished (aborted) process may still flush output: ignore it, the
      // service may already have closed the database.
      if (this.child !== child) return;
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) this.onEvent(line);
    });
    child.stderr?.on('data', (chunk: Buffer) =>
      this.stderr.push(chunk.toString('utf8')),
    );
    const done = new Promise<WorkerOutcome>((resolve) => {
      this.end = resolve;
      child.on('error', (error) =>
        this.finish({ status: 'unanswered', reason: String(error) }),
      );
      child.on('exit', (code) => {
        if (this.child !== child) return;
        if (buffer.trim()) this.onEvent(buffer);
        this.finish(
          code === 0
            ? { status: 'done' }
            : {
                status: 'unanswered',
                reason:
                  `codex exited ${code}: ` +
                  (this.stderr.join('').trim().slice(-400) || 'no stderr'),
              },
        );
      });
    });
    return () => done;
  }

  private finish(value: WorkerOutcome): void {
    this.child = null;
    this.end?.(value);
    this.end = null;
  }

  private onEvent(line: string): void {
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      return;
    }
    const session = event.thread_id ?? event.session_id;
    const run = this.db.getRun(this.runId);
    if (session && run && !run.externalSession)
      this.db.patchRun(run.id, { externalSession: session });
    const item = event.item;
    if (item && item.type === 'agent_message') {
      if (event.type === 'item.completed' && item.text) this.text = item.text;
    } else if (
      item &&
      (event.type === 'item.started' || event.type === 'item.completed')
    ) {
      const call = {
        name: item.type ?? 'item',
        args: truncate(JSON.stringify(item)),
      };
      if (event.type === 'item.completed') this.calls.push(call);
      // Persist the latest started or finished call: a killed process leaves
      // it here for the resume prompt (agent-work.md restart guards).
      this.db.patchRun(this.runId, {
        externalLastCall: `${call.name}: ${call.args}`,
      });
    }
    if (event.usage) this.opts.onUsage?.(this.runId, event.usage);
  }

  async abort(): Promise<void> {
    const child = this.child;
    if (!child) return;
    // Negative pid kills the whole process group — no orphaned subprocesses.
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
    this.finish({ status: 'unanswered', reason: 'stopped' });
  }

  async lastText(): Promise<string> {
    return this.text;
  }
  async recentToolCalls(limit: number): Promise<RunToolCall[]> {
    return this.calls.slice(-limit);
  }
}

export class CodexRuntime implements WorkerRuntime {
  /** Live conversations by id: abort/progress need the instance that spawned. */
  private conversations = new Map<string, CodexConversation>();

  /**
   * Service shutdown: kill every live codex process group. An external
   * Worker is not durable; the next start resumes it (agent-work.md).
   */
  async close(): Promise<void> {
    await Promise.all(
      [...this.conversations.values()].map((conversation) =>
        conversation.abort(),
      ),
    );
  }

  constructor(
    private db: Db,
    private opts: CodexRuntimeOptions = {},
  ) {}

  /**
   * Settings → Workers asks whether codex is usable: the binary must exist
   * and `codex login status` must pass. An expired sign-in reports
   * 'sign-in required' — never a generic failure.
   */
  async probe(): Promise<{
    installed: boolean;
    signedIn: boolean | null;
    detail: string;
  }> {
    const run = (args: string[]) =>
      new Promise<{ ok: boolean; out: string }>((resolve) => {
        execFile(
          this.opts.bin ?? 'codex',
          args,
          { timeout: 10_000, env: processEnv(this.opts.env) },
          (error, stdout, stderr) =>
            resolve({
              ok: !error,
              out: `${stdout}${stderr}`.trim(),
            }),
        );
      });
    const version = await run(['--version']);
    if (!version.ok)
      return {
        installed: false,
        signedIn: null,
        detail: version.out || 'codex binary not found',
      };
    const login = await run(['login', 'status']);
    return {
      installed: true,
      signedIn: login.ok,
      detail: login.ok
        ? version.out.split('\n')[0] || 'codex'
        : login.out || 'sign-in required',
    };
  }

  async create(run: RunRow): Promise<WorkerConversation> {
    return this.get(`codex-${run.id}`);
  }

  async get(id: string): Promise<WorkerConversation> {
    let conversation = this.conversations.get(id);
    if (!conversation) {
      const runId = id.startsWith('codex-') ? id.slice(6) : id;
      const run = this.db.getRun(runId);
      if (!run) throw new Error(`Unknown run for codex conversation ${id}`);
      conversation = new CodexConversation(id, runId, this.db, this.opts);
      this.conversations.set(id, conversation);
    }
    return conversation;
  }
}
