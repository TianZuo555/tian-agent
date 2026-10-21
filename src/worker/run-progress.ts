import type { ReviewStatus, RunStatus } from '../shared/types.js';

/** One tool call the worker made, arguments shortened for reading. */
export interface RunToolCall {
  name: string;
  args: string;
}

/**
 * Live view of a run for the agents that steer it: what state it is in, how
 * long it has been running, and what it last said and did. Read-only — nothing
 * here changes a run.
 */
export interface RunProgress {
  id: string;
  projectId: string;
  status: RunStatus;
  reviewStatus: ReviewStatus;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  /** Empty string = the run has no deadline. */
  deadlineAt: string;
  error: string | null;
  /** Last assistant text of the attempt; empty when it has not spoken yet. */
  lastText: string;
  /** Oldest first, newest last. */
  toolCalls: RunToolCall[];
}

const MAX_LAST_TEXT = 1200;

const clock = (at: string) => at.slice(0, 16).replace('T', ' ');

function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** One text block both agents can read: state, timing, last output, last calls. */
export function describeRunProgress(
  progress: RunProgress,
  now = Date.now(),
): string {
  const lines = [
    `run ${progress.id} [${progress.status}] attempt ${progress.attempt} · ${progress.projectId}`,
  ];
  if (progress.status === 'running' || progress.status === 'queued') {
    const elapsed = now - Date.parse(progress.startedAt);
    const deadline = progress.deadlineAt
      ? `deadline in ${duration(Date.parse(progress.deadlineAt) - now)}`
      : 'no deadline';
    lines.push(
      `running for ${duration(elapsed)} since ${clock(progress.startedAt)}, ${deadline}`,
    );
  } else if (progress.finishedAt) {
    lines.push(
      `started ${clock(progress.startedAt)}, finished ${clock(progress.finishedAt)} (${duration(Date.parse(progress.finishedAt) - Date.parse(progress.startedAt))})`,
    );
  }
  if (progress.error) lines.push(`error: ${progress.error}`);

  const output = progress.lastText.trim();
  lines.push(
    '',
    output
      ? `last output:\n${output.length > MAX_LAST_TEXT ? `${output.slice(0, MAX_LAST_TEXT)}…` : output}`
      : 'last output: (the worker has not written anything yet)',
  );

  if (progress.toolCalls.length > 0) {
    lines.push('', 'recent tool calls (oldest first):');
    for (const call of progress.toolCalls)
      lines.push(`  ${call.name}(${call.args})`);
  }
  return lines.join('\n');
}
