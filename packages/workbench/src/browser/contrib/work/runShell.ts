/**
 * The run pane's Shell action: opens the terminal dock with a new shell in the run's
 * worktree. The repo comes from the run's job (spec.repoPath).
 */
import type { Run } from '@orchagents/contracts';
import { openShellIn } from '../../parts/terminal/index.js';
import { useJobsStore } from '../../services/stores/work.js';
import { runWorktreePath } from './model/worktreePath.js';

/** Returns false when the run's job or repo is unknown, so nothing opens. */
export function openRunShell(run: Run): boolean {
  const job = useJobsStore.getState().jobs.find((j) => j.id === run.jobId);
  if (!job) return false;
  return openShellIn(runWorktreePath(job.spec.repoPath, run.id)) !== null;
}
