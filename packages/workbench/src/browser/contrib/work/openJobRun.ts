import type { JobId, RunId } from '@orchagents/contracts';
import { useSidebarStore } from './stores/sidebarStore.js';
import { usePanesStore } from './stores/panesStore.js';
import { useRunsStore } from '../../services/stores/work.js';
import type { Job, Run, SpecQueue } from '@orchagents/contracts';
import { autoOpenRun } from './model/sidebarModel.js';

/**
 * Expands a job in the Live sidebar and opens its first active run (or first run)
 * in the focused editor pane.
 */
export function openJobRun(jobId: string, preferredRunId?: string): void {
  useSidebarStore.getState().setJobOpen(jobId as JobId, true);
  if (preferredRunId) {
    usePanesStore.getState().dispatch({ type: 'open', runId: preferredRunId as RunId });
  } else {
    const runs = useRunsStore.getState().runs.filter((r) => r.jobId === jobId);
    const target = runs.find((r) => r.status === 'running') ?? runs[0];
    if (target) {
      usePanesStore.getState().dispatch({ type: 'open', runId: target.id });
    }
  }
}

/** Opens the project's best run when Live starts, without replacing an open editor run. */
export function openProjectRunIfNoneOpen(
  jobs: readonly Job[],
  runs: readonly Run[],
  queue: SpecQueue | null,
  selectedSpecId: string | null,
  repoPath: string,
  force = false,
): boolean {
  const panes = usePanesStore.getState();
  if (!force && (panes.activeA || panes.activeB)) return true;
  const target = autoOpenRun(jobs, runs, queue, selectedSpecId, repoPath);
  if (!target) return false;
  openJobRun(target.jobId, target.runId);
  return true;
}
