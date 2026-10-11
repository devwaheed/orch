import { createServiceId } from '@orch/base';
import type { IJobsService as IJobsServiceContract, JobId, OrchError } from '@orch/contracts';

export type IJobsService = IJobsServiceContract;
export const IJobsService = createServiceId<IJobsService>('jobs');

/** Format job counter to base-36 (JOB-01) */
export function formatJobId(counter: number): JobId {
  return `j-${counter.toString(36)}` as JobId;
}

export function parseJobIdCounter(id: string): number | null {
  if (!id.startsWith('j-')) return null;
  const n = parseInt(id.slice(2), 36);
  return Number.isFinite(n) ? n : null;
}

export const JOB_ERRORS = {
  notFound: (jobId: string): OrchError => ({
    code: 'not_found',
    message: `Job ${jobId} was not found.`,
    fix: 'Check the job id in orch ps, then try again.',
  }),
  noAccountAvailable: (agent: string, reason?: string): OrchError => ({
    code: 'account_limited',
    message: `No ${agent} account is available to run this job${reason ? `: ${reason}` : '.'}`,
    fix: 'Wait for existing runs to finish or add another account in Settings → Accounts.',
  }),
  unsupportedMode: (mode: string): OrchError => ({
    code: 'validation_failed',
    message: `Job mode "${mode}" is not supported yet.`,
    fix: 'Use single mode for this job.',
  }),
  engineError: (message: string): OrchError => ({
    code: 'internal',
    message: `Could not start job in the engine: ${message}`,
    fix: 'Check engine status with orch doctor, then try again.',
  }),
  notAutoloop: (jobId: string): OrchError => ({
    code: 'validation_failed',
    message: `Job ${jobId} is not an autoloop job.`,
    fix: 'Plan approval is only available for autoloop jobs.',
  }),
  notAwaitingApproval: (jobId: string): OrchError => ({
    code: 'validation_failed',
    message: `Job ${jobId} is not waiting for plan approval.`,
    fix: 'Only a running autoloop job at the Plan step can be approved or rejected.',
  }),
};

/** JOB-09 combine prompt. Lead-drafted; listed for owner review. */
export const COMPARE_COMBINE = (goal: string, answers: ReadonlyArray<{ agent: string; text: string }>): string =>
  `${answers.length} agents worked on the same goal: "${goal}". Their answers follow. Write one recommendation: the approach you'd take and why, in a few short paragraphs. Then list every point where the answers disagree, naming which agent said what. Don't change any files.\n\n` +
  answers.map((a) => `## ${a.agent}\n\n${a.text}`).join('\n\n');

/** Check summaries on a review. "Not run" is lead-drafted; listed for owner review. */
export const JOB_CHECK_COPY = { passed: 'Passed', failed: 'Failed check', notRun: 'Not run' } as const;
