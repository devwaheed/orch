/**
 * The current project: the folder chosen in the title bar picker, else the repo of the
 * most recent job (Job.spec.repoPath). Empty until one of them exists.
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

/** Fills activeProject from the jobs store when nothing is chosen yet. Call after the jobs change. */
export function syncActiveProject(): void {
  if (useWorkbenchStore.getState().activeProject) return;
  const project = projectFromJobs(useJobsStore.getState().jobs);
  if (project) {
    useWorkbenchStore.getState().setActiveProject(project);
  }
}
