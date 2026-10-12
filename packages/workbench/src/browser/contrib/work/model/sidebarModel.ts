/**
 * Pure view-model for the jobs sidebar: the step line and run row indent.
 */
import type { JobStep } from '@orchagents/contracts';
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
