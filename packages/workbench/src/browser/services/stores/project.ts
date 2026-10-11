/**
 * The current project: the repo of the most recent job (Job.spec.repoPath). The core
 * has no "open folder" setting yet, so this is the only source. Empty when there are no jobs.
 */
import type { Job } from '@orch/contracts';
import { useWorkbenchStore } from '../workbenchStore.js';
import { useJobsStore } from './work.js';

/** The repo path of the job created last, or '' when there is none. */
export function projectFromJobs(jobs: readonly Job[]): string {
  let latest: Job | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const job of jobs) {
    const time = Date.parse(job.createdAt);
    if (Number.isNaN(time)) continue;
    if (time > latestTime) {
      latest = job;
      latestTime = time;
    }
  }
  return latest ? latest.spec.repoPath : '';
}

/** Recomputes activeProject from the jobs store. Call after the jobs change. */
export function syncActiveProject(): void {
  const project = projectFromJobs(useJobsStore.getState().jobs);
  if (useWorkbenchStore.getState().activeProject !== project) {
    useWorkbenchStore.getState().setActiveProject(project);
  }
}
