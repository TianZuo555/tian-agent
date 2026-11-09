import type { ReviewStatus, RunInfo, RunStatus } from './types';

/**
 * The Run lifecycle (D5, D15, docs/agent-work.md): an execution status and a
 * Review status, recorded separately. This module is the single source for
 * which status changes are legal and which actions a Run accepts. The
 * service enforces it, the agent tools describe it, and the UI offers only
 * the actions it allows. Change the rules here, never at a call site.
 */

/** An attempt waits for a slot, runs, or is being collected. */
export const ACTIVE_RUN_STATUSES = [
  'queued',
  'running',
  'collecting',
] as const satisfies readonly RunStatus[];

/** The attempt ended; the Run waits for a follow-up or a Review. */
export const FINISHED_RUN_STATUSES = [
  'done',
  'failed',
  'interrupted',
] as const satisfies readonly RunStatus[];

/** Review operations stored before they start, so recovery finishes them. */
export const UNSETTLED_REVIEW_STATUSES = [
  'landing',
  'shipping',
  'discarding',
] as const satisfies readonly ReviewStatus[];

/** Allowed execution status changes. Repeating the current status is a no-op. */
export const RUN_STATUS_TRANSITIONS: Readonly<
  Record<RunStatus, readonly RunStatus[]>
> = {
  // A deadline that passed while the attempt waited collects what exists.
  queued: ['running', 'collecting', 'failed', 'interrupted'],
  running: ['collecting', 'failed', 'interrupted'],
  // A discard that aborts a collecting attempt ends it interrupted.
  collecting: ['done', 'failed', 'interrupted'],
  // A follow-up starts the next attempt.
  done: ['queued'],
  failed: ['queued'],
  interrupted: ['queued'],
};

/** Allowed Review status changes. Repeating the current status is a no-op. */
export const REVIEW_TRANSITIONS: Readonly<
  Record<ReviewStatus, readonly ReviewStatus[]>
> = {
  pending: ['landing', 'shipping', 'discarding'],
  // A failed land or ship keeps its status, so it can be retried or discarded.
  landing: ['landed', 'discarding'],
  shipping: ['shipped', 'discarding'],
  // A shipped branch can still land into the local base branch.
  shipped: ['landing', 'discarding'],
  discarding: ['discarded'],
  landed: [],
  discarded: [],
};

type RunState = Pick<RunInfo, 'status' | 'reviewStatus'>;

const includes = <T extends string>(list: readonly T[], value: string) =>
  (list as readonly string[]).includes(value);

/** Throws when the tables do not allow a change from `from` to `to`. */
export function assertRunTransition(
  id: string,
  from: RunState,
  to: Partial<RunState>,
): void {
  if (
    to.status !== undefined &&
    to.status !== from.status &&
    !includes(RUN_STATUS_TRANSITIONS[from.status], to.status)
  )
    throw new Error(
      `Illegal run transition for ${id}: status ${from.status} → ${to.status}`,
    );
  if (
    to.reviewStatus !== undefined &&
    to.reviewStatus !== from.reviewStatus &&
    !includes(REVIEW_TRANSITIONS[from.reviewStatus], to.reviewStatus)
  )
    throw new Error(
      `Illegal run transition for ${id}: review ${from.reviewStatus} → ${to.reviewStatus}`,
    );
}

export const isRunActive = (run: Pick<RunInfo, 'status'>) =>
  includes(ACTIVE_RUN_STATUSES, run.status);

export const isRunFinished = (run: Pick<RunInfo, 'status'>) =>
  includes(FINISHED_RUN_STATUSES, run.status);

/** The user's and the agents' operations on a Run. */
export type RunAction = 'stop' | 'followUp' | 'land' | 'ship' | 'discard';

export type RunGateState = Pick<
  RunInfo,
  'status' | 'reviewStatus' | 'branch' | 'worktreePath'
>;

/**
 * Why the Run refuses `action` in its current state, or null when it accepts
 * it. Gates on stored state only; the service still checks the worktree and
 * the worker conversation when it runs the action.
 */
export function runActionBlocker(
  run: RunGateState,
  action: RunAction,
): string | null {
  const review = `its review is ${run.reviewStatus}`;
  const unfinished = `its attempt is still ${run.status}`;
  switch (action) {
    case 'stop':
      if (run.status !== 'queued' && run.status !== 'running')
        return `its attempt is ${run.status}; only a queued or running attempt stops`;
      return run.reviewStatus === 'pending' ? null : review;
    case 'followUp':
      if (!isRunFinished(run)) return unfinished;
      return run.reviewStatus === 'pending' ? null : review;
    case 'land':
      if (!run.branch) return 'it has no Git branch';
      if (!isRunFinished(run)) return unfinished;
      return includes(['pending', 'shipped', 'landing'], run.reviewStatus)
        ? null
        : review;
    case 'ship':
      if (!run.branch || !run.worktreePath)
        return 'it has no Git branch or worktree';
      if (!isRunFinished(run)) return unfinished;
      return includes(['pending', 'shipping'], run.reviewStatus)
        ? null
        : review;
    case 'discard':
      return run.reviewStatus === 'landed' || run.reviewStatus === 'discarded'
        ? review
        : null;
  }
}

export const canRunAction = (run: RunGateState, action: RunAction) =>
  runActionBlocker(run, action) === null;

/**
 * The one status a person reads: a Review result or a running Review
 * operation wins over the execution status it follows.
 */
export function runDisplayStatus(
  run: RunState,
): RunStatus | Exclude<ReviewStatus, 'pending'> {
  const { status, reviewStatus } = run;
  return reviewStatus === 'pending' ? status : reviewStatus;
}

/** The status agents read: `running`, or `done, landed` once a Review began. */
export function runStateLabel(run: RunState): string {
  return run.reviewStatus === 'pending'
    ? run.status
    : `${run.status}, ${run.reviewStatus}`;
}
