import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db, RunRow } from './db.js';
import type { Scopes } from './scopes.js';
import type { EventLog } from './events.js';
import type { IssueReporter } from './improvements.js';
import type { Emit } from '../shared/types.js';
import { atomicWrite } from './files.js';
import * as Git from './dispatch.js';
import type { RunProgress, RunToolCall } from './run-progress.js';

export interface WorkerSubmission {
  wait(): Promise<{ status: 'done' | 'unanswered'; reason?: string }>;
}
export interface WorkerConversation {
  id: string;
  submit(prompt: string, requestId: string): Promise<WorkerSubmission>;
  abort(): Promise<void>;
  lastText(): Promise<string>;
  /** Recent tool calls, oldest first, as a progress snapshot shows them. */
  recentToolCalls(limit: number): Promise<RunToolCall[]>;
}
export interface WorkerRuntime {
  create(run: RunRow): Promise<WorkerConversation>;
  get(id: string): Promise<WorkerConversation>;
}
export interface DispatchInput {
  projectRef: string;
  prompt: string;
  chiefConversationId: string | null;
  /** Code tasks record the task this run executes. */
  taskId?: number;
  operationId?: string;
  /** Magpie model id pinned for this run's worker; unset = the app default. */
  model?: string | null;
  /** pi thinking level pinned for this run's worker; unset = the model's own. */
  thinkingLevel?: string | null;
}

/**
 * Run deadline helpers. `run_timeout_min = 0` means the run has no deadline: the
 * stored `deadline_at` stays empty and every check treats it as unlimited.
 */
function deadlineFor(timeoutMin: number): string {
  if (timeoutMin <= 0) return '';
  return new Date(Date.now() + timeoutMin * 60_000).toISOString();
}

/** Milliseconds left before `deadlineAt`, or null when the run is unbounded. */
function remainingMs(deadlineAt: string): number | null {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  // An unparseable deadline is treated as expired so a bad row cannot hang.
  return Number.isFinite(deadline) ? deadline - Date.now() : 0;
}

function hasPassed(deadlineAt: string): boolean {
  const remaining = remainingMs(deadlineAt);
  return remaining !== null && remaining <= 0;
}

/**
 * Skill matching and experience review (PRD §6.1–6.2), provided by the Skill
 * Registry; absent = runs carry no skills and are never reviewed.
 */
export interface SkillProvider {
  matchApproved(
    scopeId: string,
    taskText: string,
  ): { id: string; name: string; version: number }[];
  review(run: RunRow, report: string, stopped?: string): void;
}

/** Owns execution, attempts, review transitions, and recovery of external work. */
export class RunOrchestrator {
  private locks = new Map<string, Promise<unknown>>();
  private collectors = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;

  constructor(
    private db: Db,
    private scopes: Scopes,
    private runtime: WorkerRuntime,
    private userDataDir: string,
    private emit: Emit,
    private notify: () => Promise<void>,
    private events?: EventLog,
    /** Automatic issue sink for failures that otherwise only reach the console. */
    private onIssue?: IssueReporter,
    /** Skill registry; absent = no skill matching, injection, or review. */
    private skills?: SkillProvider,
  ) {}

  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const running = (this.locks.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(action);
    this.locks.set(key, running);
    try {
      return await running;
    } finally {
      if (this.locks.get(key) === running) this.locks.delete(key);
    }
  }
  private require(id: string): RunRow {
    const run = this.db.getRun(id);
    if (!run) throw new Error(`Unknown run: ${id}`);
    return run;
  }
  private changed(): void {
    this.emit('runs', this.db.listRuns(null));
  }

  async dispatch(input: DispatchInput): Promise<RunRow> {
    const id = input.operationId
      ? `r-${createHash('sha256').update(input.operationId).digest('hex').slice(0, 24)}`
      : `r-${randomUUID()}`;
    return this.locked(id, async () => {
      const existing = this.db.getRun(id);
      if (existing) return existing;
      const project =
        this.db.getProject(input.projectRef) ??
        this.db.projectByName(input.projectRef);
      if (!project) throw new Error(`Unknown project: ${input.projectRef}`);
      if (input.taskId != null) {
        const task = this.db.getTask(input.taskId);
        if (!task) throw new Error(`Unknown task: ${input.taskId}`);
        if (task.scopeId !== project.id)
          throw new Error(
            `task #${input.taskId} belongs to ${task.scopeId}, not ${project.id}`,
          );
      }
      if (project.agentKind !== 'durable-worker')
        throw new Error(`Unsupported agent kind: ${project.agentKind}`);
      const isGit = await Git.isGitRepo(project.rootPath);
      if (!isGit && !project.allowInPlace)
        throw new Error(
          'This project is not a Git repository. Explicitly enable in-place execution in project settings first.',
        );
      const startedAt = new Date().toISOString();
      // Match approved skills once, at dispatch; the run row records exactly
      // which versions the worker was given (PRD §6.2).
      const matches =
        this.skills?.matchApproved(project.id, input.prompt) ?? [];
      const run: RunRow = {
        id,
        projectId: project.id,
        conversationId: null,
        chiefConversationId: input.chiefConversationId,
        agentKind: 'durable-worker',
        prompt: input.prompt,
        currentPrompt: input.prompt,
        rootPath: project.rootPath,
        baseBranch: project.baseBranch,
        executionMode: isGit ? 'worktree' : 'in-place',
        worktreePath: isGit ? join(this.userDataDir, 'worktrees', id) : null,
        branch: isGit ? `tian/${id}` : null,
        status: 'queued',
        reviewStatus: 'pending',
        attempt: 1,
        error: null,
        prUrl: null,
        reportPath: join(this.scopes.runsDir(project.id), `${id}.md`),
        exitCode: null,
        taskId: input.taskId ?? null,
        injectedSkills: matches.map((skill) => ({
          id: skill.id,
          name: skill.name,
          version: skill.version,
        })),
        model: input.model ?? null,
        thinkingLevel: input.thinkingLevel ?? null,
        startedAt,
        finishedAt: null,
        deadlineAt: deadlineFor(project.runTimeoutMin),
      };
      // Claim the slot atomically: the same dispatcher sending the same
      // briefing while a run is still in flight reuses that run — a replayed
      // or double-fired dispatch must not stack identical runs. A prior fold
      // is remembered too, so a retry after the run settles still resolves
      // to it instead of launching a second worker.
      const claimed = this.db.transaction(() => {
        const folded = input.operationId
          ? this.db.dispatchFold(input.operationId)
          : undefined;
        if (folded) {
          const original = this.db.getRun(folded);
          if (original) return original;
        }
        const duplicate = this.db.activeRunByPrompt(
          project.id,
          run.prompt,
          run.chiefConversationId,
        );
        if (duplicate) {
          if (input.operationId)
            this.db.recordDispatchFold(input.operationId, duplicate.id);
          return duplicate;
        }
        this.db.addRun(run);
        return run;
      });
      if (claimed !== run) return claimed;
      // Fail synchronously if isolation cannot be created; never change execution mode.
      try {
        await this.prepare(run);
      } catch (error) {
        await this.fail(run, error);
        throw error;
      }
      this.launch(id);
      this.events?.record({
        id: `run:${id}:dispatched`,
        type: 'run.dispatched',
        actor: !input.chiefConversationId
          ? 'system'
          : this.db.isManagerConversation(input.chiefConversationId)
            ? 'manager'
            : 'chief',
        scopeId: run.projectId,
        runId: id,
        conversationId: input.chiefConversationId,
        summary: `Dispatched to ${project.name}: ${input.prompt.split('\n')[0].slice(0, 120)}`,
        payload: {
          prompt: input.prompt.slice(0, 2000),
          model: run.model,
          thinkingLevel: run.thinkingLevel,
        },
      });
      this.changed();
      return this.require(id);
    });
  }

  private async prepare(run: RunRow): Promise<void> {
    if (run.executionMode === 'worktree') {
      await Git.addWorktree(
        run.rootPath,
        run.baseBranch,
        run.id,
        join(this.userDataDir, 'worktrees'),
      );
    }
    if (!run.conversationId) {
      const conversation = await this.runtime.create(run);
      this.db.patchRun(run.id, { conversationId: conversation.id });
    }
  }

  async recover(): Promise<void> {
    // Finish previously authorized review operations before restoring executions.
    await Promise.all(
      this.db.unsettledReviews().map(async (run) => {
        try {
          if (run.reviewStatus === 'discarding') await this.discard(run.id);
          else if (run.reviewStatus === 'landing') await this.land(run.id);
          else await this.ship(run.id);
        } catch (error) {
          this.db.patchRun(run.id, { error: String(error) });
          this.onIssue?.('run.recovery', error, {
            scopeId: run.projectId,
            runId: run.id,
            taskId: run.taskId ?? undefined,
          });
        }
      }),
    );
    for (const run of this.db.activeRuns()) {
      if (run.reviewStatus === 'pending') this.launch(run.id);
    }
    this.changed();
  }

  private launch(id: string): void {
    if (this.closing || this.collectors.has(id)) return;
    const collector = this.execute(id)
      .catch(async (error) => {
        if (!this.closing)
          await this.locked(id, async () => {
            const run = this.require(id);
            if (
              run.reviewStatus === 'pending' &&
              ['queued', 'running', 'collecting'].includes(run.status)
            )
              await this.fail(run, error);
          });
      })
      .catch((error) => {
        const run = this.db.getRun(id);
        this.onIssue?.('run.launch', error, {
          ...(run ? { scopeId: run.projectId } : {}),
          runId: id,
          taskId: run?.taskId ?? undefined,
          conversationId: run?.chiefConversationId ?? undefined,
        });
      })
      .finally(() => {
        this.collectors.delete(id);
      });
    this.collectors.set(id, collector);
  }

  private async execute(id: string): Promise<void> {
    const prepared = await this.locked(id, async () => {
      let run = this.require(id);
      if (this.closing || run.reviewStatus !== 'pending') return null;
      // An agent or Tian stopped this attempt before it started; never submit.
      if (run.status === 'interrupted') return null;
      if (run.status === 'collecting')
        return {
          run,
          conversation: await this.runtime.get(run.conversationId!),
          submission: null,
        };
      if (hasPassed(run.deadlineAt)) {
        const error = new Error('Run exceeded its deadline');
        if (run.conversationId) {
          const conversation = await this.runtime.get(run.conversationId);
          await conversation.abort();
          await this.collect(
            this.db.patchRun(id, {
              status: 'collecting',
              error: error.message,
            }),
            conversation,
          );
        } else await this.fail(run, error);
        return null;
      }
      if (run.reportPath && existsSync(run.reportPath))
        unlinkSync(run.reportPath);
      await this.prepare(run);
      run = this.require(id);
      const conversation = await this.runtime.get(run.conversationId!);
      const submission = await conversation.submit(
        run.currentPrompt,
        `run:${id}:attempt:${run.attempt}`,
      );
      run = this.db.patchRun(id, { status: 'running' });
      this.db.recordAttempt(run);
      this.changed();
      return { run, conversation, submission };
    });
    if (!prepared) return;
    const { conversation, submission } = prepared;
    let failure: string | null = null;
    if (submission) {
      // Fewer than `remaining` ms are left, or there is no deadline at all.
      const remaining = remainingMs(prepared.run.deadlineAt);
      let timedOut = remaining !== null && remaining <= 0;
      if (timedOut) await conversation.abort();
      else if (remaining !== null) {
        const timer = setTimeout(() => {
          timedOut = true;
          void conversation.abort().catch((error) =>
            this.onIssue?.('run.abort', error, {
              scopeId: prepared.run.projectId,
              runId: id,
            }),
          );
        }, remaining);
        this.timers.set(id, timer);
      }
      try {
        const result = await submission.wait();
        if (result.status !== 'done')
          failure = result.reason || 'Worker did not complete successfully';
      } finally {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
      }
      if (timedOut) failure = 'Run exceeded its deadline';
    }
    if (this.closing) return;
    await this.locked(id, async () => {
      let run = this.require(id);
      if (this.closing || run.reviewStatus !== 'pending') return;
      // A stop already finished the attempt; its abort settles the wait but
      // the outcome is already recorded, so never collect over it.
      if (run.status === 'interrupted') return;
      // Persist the outcome before collecting so a restart cannot turn failure into success.
      run = this.db.patchRun(id, {
        status: 'collecting',
        error: failure ?? run.error,
      });
      await this.collect(run, conversation);
    });
    const run = this.require(id);
    if (
      !this.closing &&
      run.status === 'done' &&
      run.reviewStatus === 'pending' &&
      this.db.getProject(run.projectId)?.autoLand === 1 &&
      run.branch
    ) {
      await this.land(id);
    }
  }

  private async collect(
    run: RunRow,
    conversation: WorkerConversation,
  ): Promise<void> {
    const cwd = run.worktreePath ?? run.rootPath;
    const reportFile = join(cwd, 'TIAN_REPORT.md');
    let report =
      run.reportPath && existsSync(run.reportPath)
        ? readFileSync(run.reportPath, 'utf8')
        : '';
    if (existsSync(reportFile))
      report = readFileSync(reportFile, 'utf8').trim();
    if (!report) report = (await conversation.lastText()) || '(no report)';
    if (run.reportPath) {
      mkdirSync(dirname(run.reportPath), { recursive: true });
      atomicWrite(run.reportPath, report);
      atomicWrite(
        join(dirname(run.reportPath), `${run.id}-attempt-${run.attempt}.md`),
        report,
      );
    }
    if (existsSync(reportFile)) unlinkSync(reportFile);
    if (run.worktreePath)
      await Git.commitAll(
        run.worktreePath,
        `tian run ${run.id} attempt ${run.attempt}`,
      );
    const diffstat = run.branch
      ? await Git.diffStat(run.rootPath, run.baseBranch, run.branch)
      : '';
    const status = run.error ? 'failed' : 'done';
    const content = [
      `[run ${run.id} attempt ${run.attempt} ${status}]`,
      run.error ? `error: ${run.error}` : '',
      `Report:\n${report.slice(0, 12_000)}`,
      diffstat ? `Diffstat:\n${diffstat}` : '',
      run.chiefConversationId &&
      this.db.isManagerConversation(run.chiefConversationId)
        ? 'Read more with read_run_report or read_run_diff. Judge the result, close its task, and report_chief what matters.'
        : 'Record lasting outcomes with note and tell Tian briefly. Read more with read_run_report or read_run_diff.',
    ]
      .filter(Boolean)
      .join('\n\n');
    this.db.finishRun(run.id, status, run.error, {
      id: `run:${run.id}:attempt:${run.attempt}:finished`,
      scopeId: run.projectId,
      conversationId: run.chiefConversationId,
      content,
    });
    this.events?.record({
      id: `run:${run.id}:attempt:${run.attempt}:finished`,
      type: 'run.finished',
      actor: 'worker',
      scopeId: run.projectId,
      runId: run.id,
      conversationId: run.chiefConversationId,
      summary: `Run ${run.id} attempt ${run.attempt} ${status}${run.error ? `: ${run.error}` : ''}`,
      payload: { status, error: run.error },
    });
    if (run.error)
      this.onIssue?.('run.failure', new Error(run.error), {
        scopeId: run.projectId,
        runId: run.id,
        taskId: run.taskId ?? undefined,
        conversationId: run.chiefConversationId ?? undefined,
        eventId: `run:${run.id}:attempt:${run.attempt}:finished`,
      });
    this.changed();
    this.reviewExperience(this.db.getRun(run.id) ?? run, report);
    await this.notify();
  }

  /** Whatever the attempt left on disk: its report file, else its TIAN_REPORT.md. */
  private currentReport(run: RunRow): string {
    const file = join(run.worktreePath ?? run.rootPath, 'TIAN_REPORT.md');
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    return run.reportPath && existsSync(run.reportPath)
      ? readFileSync(run.reportPath, 'utf8')
      : '';
  }

  /** Experience review is best-effort: it must never fail the run. */
  private reviewExperience(
    run: RunRow,
    report: string,
    stopped?: string,
  ): void {
    if (!this.skills) return;
    try {
      this.skills.review(run, report, stopped);
    } catch (error) {
      console.error(`Experience review ${run.id}:`, error);
    }
  }

  private async fail(run: RunRow, error: unknown): Promise<void> {
    this.db.finishRun(run.id, 'failed', String(error), {
      id: `run:${run.id}:attempt:${run.attempt}:finished`,
      scopeId: run.projectId,
      conversationId: run.chiefConversationId,
      content: `[run ${run.id} failed]\n${String(error)}`,
    });
    this.events?.record({
      id: `run:${run.id}:attempt:${run.attempt}:finished`,
      type: 'run.finished',
      actor: 'system',
      scopeId: run.projectId,
      runId: run.id,
      conversationId: run.chiefConversationId,
      summary: `Run ${run.id} attempt ${run.attempt} failed: ${String(error).slice(0, 160)}`,
      payload: { status: 'failed', error: String(error) },
    });
    this.onIssue?.('run.failure', error, {
      scopeId: run.projectId,
      runId: run.id,
      taskId: run.taskId ?? undefined,
      conversationId: run.chiefConversationId ?? undefined,
      eventId: `run:${run.id}:attempt:${run.attempt}:finished`,
    });
    this.changed();
    await this.notify();
  }

  async followUp(id: string, prompt: string): Promise<RunRow> {
    // Wait for the previous collector (including auto-land) before accepting a new attempt.
    await this.collectors.get(id);
    return this.locked(id, async () => {
      const run = this.require(id);
      if (
        !['done', 'failed', 'interrupted'].includes(run.status) ||
        run.reviewStatus !== 'pending'
      )
        throw new Error('Run is not available for follow-up');
      if (
        !run.conversationId ||
        (run.worktreePath && !existsSync(run.worktreePath))
      )
        throw new Error('Worker or worktree no longer exists');
      const timeout = this.db.getProject(run.projectId)?.runTimeoutMin ?? 0;
      const next = this.db.transaction(() => {
        const value = this.db.patchRun(id, {
          status: 'queued',
          currentPrompt: prompt,
          attempt: run.attempt + 1,
          error: null,
          exitCode: null,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          deadlineAt: deadlineFor(timeout),
        });
        this.db.recordAttempt(value);
        return value;
      });
      // Clear only the current report, keeping every previous attempt's artifact.
      if (next.reportPath && existsSync(next.reportPath))
        unlinkSync(next.reportPath);
      this.launch(id);
      this.changed();
      return next;
    });
  }

  async land(id: string): Promise<string> {
    return this.locked(id, () =>
      this.locked(`project:${this.require(id).projectId}`, async () => {
        const run = this.require(id);
        if (run.reviewStatus === 'landed') return 'Already landed';
        if (
          !run.branch ||
          !['done', 'failed', 'interrupted'].includes(run.status) ||
          !['pending', 'shipped', 'landing'].includes(run.reviewStatus)
        )
          throw new Error('Run is not available to land');
        this.db.patchRun(id, { reviewStatus: 'landing', error: null });
        this.changed();
        let output = 'Already merged';
        try {
          if (!(await Git.isLanded(run.rootPath, run.baseBranch, run.branch)))
            output = await Git.merge(run.rootPath, run.branch, run.baseBranch);
          await Git.discardWorktree(run.rootPath, run.worktreePath, null);
          this.db.patchRun(id, { reviewStatus: 'landed', worktreePath: null });
          this.events?.record({
            id: `run:${id}:landed`,
            type: 'run.landed',
            actor: 'user',
            scopeId: run.projectId,
            runId: id,
            summary: `Run ${id} landed into ${run.baseBranch}`,
          });
        } catch (error) {
          this.db.patchRun(id, { error: String(error) });
          this.onIssue?.('run.land', error, {
            scopeId: run.projectId,
            runId: id,
            taskId: run.taskId ?? undefined,
          });
          throw error;
        } finally {
          this.changed();
        }
        return output;
      }),
    );
  }

  /**
   * Stop the current attempt and keep everything it produced: the worker is
   * aborted, the attempt's uncommitted edits are snapshotted onto the run
   * branch (runDiff/land/ship read commits, so otherwise they would be
   * lost), and the run ends `interrupted` with review still `pending` —
   * its worktree stays for inspection, landing, or a follow-up. One gate
   * for Tian's button and the agents' stop_run: only a queued or running
   * attempt with pending review responds; `strict` callers get an error
   * instead of a quiet no-op.
   */
  async stop(
    id: string,
    opts?: {
      reason?: string;
      actor?: 'user' | 'chief' | 'manager';
      strict?: boolean;
    },
  ): Promise<RunRow> {
    return this.locked(id, async () => {
      const run = this.require(id);
      if (
        !['queued', 'running'].includes(run.status) ||
        run.reviewStatus !== 'pending'
      ) {
        if (opts?.strict)
          throw new Error(
            `Run ${id} is not running (${run.status}${run.reviewStatus !== 'pending' ? `, review ${run.reviewStatus}` : ''})`,
          );
        return run;
      }
      const actor = opts?.actor ?? 'user';
      const who = actor === 'user' ? 'Tian' : 'its agent';
      const note = opts?.reason?.trim()
        ? `Stopped by ${who}: ${opts.reason.trim()}`
        : `Stopped by ${who}`;
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      if (run.conversationId)
        await (await this.runtime.get(run.conversationId)).abort();
      // Snapshot whatever the worker left behind: runDiff/land/ship read
      // branch commits, so uncommitted edits would land nothing and the
      // later cleanup would delete them unseen. Best-effort — a failed
      // snapshot must not undo the stop.
      if (run.worktreePath) {
        try {
          await Git.commitAll(
            run.worktreePath,
            `tian run ${id} attempt ${run.attempt} (stopped)`,
          );
        } catch (error) {
          this.onIssue?.('run.stop.commit', error, {
            scopeId: run.projectId,
            runId: id,
            taskId: run.taskId ?? undefined,
          });
        }
      }
      const stopped = this.db.finishRun(id, 'interrupted', note, {
        id: `run:${id}:attempt:${run.attempt}:stopped`,
        scopeId: run.projectId,
        conversationId: run.chiefConversationId,
        content: `[run ${id} stopped]\n${note}. Partial work is committed on the run's branch; follow up to continue or discard to remove it.`,
      });
      this.events?.record({
        id: `run:${id}:attempt:${run.attempt}:stopped`,
        type: 'run.stopped',
        actor,
        scopeId: run.projectId,
        runId: id,
        conversationId: run.chiefConversationId,
        summary: `${note} (${run.id} attempt ${run.attempt})`,
        payload: { attempt: run.attempt },
      });
      this.changed();
      await this.notify();
      // Review the attempt like any other ending, but never as a failure of
      // the injected skills: a stop is a recall, not proof they were wrong.
      this.reviewExperience(this.require(id), this.currentReport(run), note);
      return this.require(id);
    });
  }

  async discard(id: string): Promise<void> {
    await this.locked(id, async () => {
      const run = this.require(id);
      if (run.reviewStatus === 'discarded') return;
      if (run.reviewStatus === 'landed')
        throw new Error('A landed run cannot be discarded');
      this.db.patchRun(id, { reviewStatus: 'discarding' });
      this.changed();
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      try {
        if (run.conversationId)
          await (await this.runtime.get(run.conversationId)).abort();
        await Git.discardWorktree(run.rootPath, run.worktreePath, run.branch);
        const updated = this.db.patchRun(id, {
          reviewStatus: 'discarded',
          worktreePath: null,
          status: ['queued', 'running', 'collecting'].includes(run.status)
            ? 'interrupted'
            : run.status,
          finishedAt: run.finishedAt ?? new Date().toISOString(),
        });
        this.db.recordAttempt(updated);
        this.events?.record({
          id: `run:${id}:discarded`,
          type: 'run.discarded',
          actor: 'user',
          scopeId: run.projectId,
          runId: id,
          summary: `Run ${id} discarded`,
        });
      } catch (error) {
        this.db.patchRun(id, { error: String(error) });
        this.onIssue?.('run.discard', error, {
          scopeId: run.projectId,
          runId: id,
          taskId: run.taskId ?? undefined,
        });
        throw error;
      } finally {
        this.changed();
      }
    });
  }

  async ship(id: string): Promise<string> {
    return this.locked(id, async () => {
      const run = this.require(id);
      if (run.prUrl) return run.prUrl;
      if (
        !run.branch ||
        !run.worktreePath ||
        !['done', 'failed', 'interrupted'].includes(run.status) ||
        !['pending', 'shipping'].includes(run.reviewStatus)
      )
        throw new Error('Run is not available to ship');
      this.db.patchRun(id, { reviewStatus: 'shipping', error: null });
      this.changed();
      try {
        const pushed = await Git.git(run.worktreePath, [
          'push',
          '-u',
          'origin',
          run.branch,
        ]);
        if (pushed.code !== 0) throw new Error(`Push failed: ${pushed.stderr}`);
        const existing = JSON.parse(
          await Git.gh(run.worktreePath, [
            'pr',
            'list',
            '--head',
            run.branch,
            '--base',
            run.baseBranch,
            '--state',
            'all',
            '--json',
            'url',
            '--limit',
            '1',
          ]),
        ) as { url: string }[];
        const url =
          existing[0]?.url ??
          (await Git.gh(run.worktreePath, [
            'pr',
            'create',
            '--fill',
            '--base',
            run.baseBranch,
            '--head',
            run.branch,
          ]));
        this.db.patchRun(id, { reviewStatus: 'shipped', prUrl: url });
        this.events?.record({
          id: `run:${id}:shipped`,
          type: 'run.shipped',
          actor: 'user',
          scopeId: run.projectId,
          runId: id,
          summary: `Run ${id} shipped: ${url}`,
          payload: { prUrl: url },
        });
        return url;
      } catch (error) {
        this.db.patchRun(id, { error: String(error) });
        this.onIssue?.('run.ship', error, {
          scopeId: run.projectId,
          runId: id,
          taskId: run.taskId ?? undefined,
        });
        throw error;
      } finally {
        this.changed();
      }
    });
  }

  report(id: string): string {
    const run = this.require(id);
    return run.reportPath && existsSync(run.reportPath)
      ? readFileSync(run.reportPath, 'utf8')
      : '(no report written yet)';
  }
  /**
   * Live progress of one run for its steering agent (chief or manager): its
   * state and timing from the row, its last words and tool calls from the
   * worker conversation. Read-only; a discarded run keeps its last snapshot.
   */
  async progress(id: string, toolCallLimit = 5): Promise<RunProgress> {
    const run = this.require(id);
    const live = run.conversationId && run.reviewStatus !== 'discarded';
    const conversation = live
      ? await this.runtime.get(run.conversationId!).catch(() => undefined)
      : undefined;
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      reviewStatus: run.reviewStatus,
      attempt: run.attempt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      deadlineAt: run.deadlineAt,
      error: run.error,
      lastText: (await conversation?.lastText().catch(() => '')) ?? '',
      toolCalls:
        (await conversation?.recentToolCalls(toolCallLimit).catch(() => [])) ??
        [],
    };
  }
  async diff(id: string): Promise<string> {
    const run = this.require(id);
    return run.branch && run.reviewStatus !== 'discarded'
      ? Git.diff(run.rootPath, run.baseBranch, run.branch)
      : '(no diff available)';
  }
  pause(): void {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  async join(): Promise<void> {
    await Promise.allSettled(this.collectors.values());
  }
}
