/**
 * Whether any job is active (S5-03, REL-02). The update is installed on restart
 * only when nothing is running. Pure: the caller supplies the jobs it read from
 * the core host.
 */
import type { Job, JobStatus } from '@orch/contracts';

/**
 * Job statuses that mean the job is in progress and must not be interrupted by an
 * update install. `done`, `failed` and `cancelled` are finished; `scheduled` has
 * not started, so the update may proceed (it just restarts the app).
 */
export const ACTIVE_JOB_STATUSES = ['running', 'waiting_quota', 'paused'] as const satisfies readonly JobStatus[];

export function hasActiveJob(jobs: readonly Pick<Job, 'status'>[]): boolean {
  const active: readonly JobStatus[] = ACTIVE_JOB_STATUSES;
  return jobs.some((job) => active.includes(job.status));
}
