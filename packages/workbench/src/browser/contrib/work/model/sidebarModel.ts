/**
 * Pure view-model for the jobs sidebar: the step line and run row indent.
 */
import type { Job, JobStep } from '@orchagents/contracts';
import { workStrings } from '../strings.js';

export interface StepLineView {
  /** "Now: Implement" */
  readonly now: string;
  /** "step 2 of 5" */
  readonly progress: string;
  /** "try 1" */
  readonly attempt: string;
  /** The full line: "Now: Implement · step 2 of 5 · try 1" */
  readonly text: string;
  /** true when the same step failed 2+ times: the line turns amber */
  readonly looping: boolean;
}

export function stepLineView(step: JobStep): StepLineView {
  const now = workStrings.step.now(step.name);
  const progress = workStrings.step.progress(step.index, step.total);
  const attempt = workStrings.step.attempt(step.attempt);
  return {
    now,
    progress,
    attempt,
    text: [now, progress, attempt].join(' · '),
    looping: step.looping,
  };
}

/** Left padding of a run row: runs nest under their job, one level per depth. */
export function runRowIndentPx(depth: number): number {
  return 14 + depth * 14;
}

/** Right aligned metadata shown for the three demo jobs in the prototype. */
export function jobMeta(job: Pick<Job, 'status' | 'scheduledFor'>, runCount: number): string {
  if (job.status === 'running') return `${runCount} runs`;
  if (job.status === 'waiting_quota' && job.scheduledFor) {
    const scheduled = new Date(job.scheduledFor);
    return `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`;
  }
  if (job.status === 'done') return workStrings.sidebar.doneMeta;
  return '';
}
