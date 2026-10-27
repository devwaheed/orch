import type { JobId, RunId } from '@orchagents/contracts';
import { useSidebarStore } from './stores/sidebarStore.js';
import { usePanesStore } from './stores/panesStore.js';
import { useRunsStore } from '../../services/stores/work.js';

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
