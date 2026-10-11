import { createServiceId } from '@orch/base';
import type { IRunsService as IRunsServiceContract, OrchError, RunId } from '@orch/contracts';

export type IRunsService = IRunsServiceContract;
export const IRunsService = createServiceId<IRunsService>('runs');

/** Format run counter to base-36 (JOB-01) */
export function formatRunId(counter: number): RunId {
  return `r-${counter.toString(36)}` as RunId;
}

export function parseRunIdCounter(id: string): number | null {
  if (!id.startsWith('r-')) return null;
  const n = parseInt(id.slice(2), 36);
  return Number.isFinite(n) ? n : null;
}

export const RUN_ERRORS = {
  notFound: (runId: string): OrchError => ({
    code: 'not_found',
    message: `Run ${runId} was not found.`,
    fix: 'Check the run id in orch ps, then try again.',
  }),
  noSession: (runId: string): OrchError => ({
    code: 'internal',
    message: `Run ${runId} does not have an active session.`,
    fix: 'Wait for the agent to start or restart the run.',
  }),
  cannotResume: (runId: string, reason: string): OrchError => ({
    code: 'conflict',
    message: `Could not resume run ${runId}: ${reason}`,
    fix: 'Check account limits and try again.',
  }),
};

/** Sent to an agent whose session was resumed after a usage limit (QTA-03). Lead-drafted; listed for owner review. */
export const CONTINUE_AFTER_LIMIT = 'You were stopped by a usage limit. Continue the task from where you left off.';

/** Sent to the agent that takes over a run on switch-agent (JOB-08). Lead-drafted; listed for owner review. */
export const TAKE_OVER_AFTER_LIMIT = (goal: string): string =>
  `You are taking over this task from another agent that was stopped by a usage limit: ${goal}\nThe work so far is in this folder. Continue from there.`;
