/**
 * When a pane opens a run, loads the lines it has missed (IRunsService.lines) into the
 * runs store. Live lines arrive through run.line events, and the store ignores a seq it
 * already has, so the two sources can overlap safely.
 */
import { useEffect, useState } from 'react';
import type { OrchError, RunId } from '@orch/contracts';
import { useRunsStore } from '../../../services/stores/work.js';
import { getWorkServices } from '../workServices.js';
import { dataStrings } from '../../../services/dataStrings.js';

export function useRunCatchUp(runId: RunId): OrchError | null {
  const [error, setError] = useState<OrchError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const services = getWorkServices();
    if (!services) {
      setError({ code: 'internal', message: dataStrings.coreUnavailable.message, fix: dataStrings.coreUnavailable.fix });
      return;
    }
    setError(null);
    const known = useRunsStore.getState().lines[runId] ?? [];
    // lines() is exclusive (seq > afterSeq) and seq starts at 0, so -1 means "from the start".
    const afterSeq = known.reduce((max, line) => Math.max(max, line.seq), -1);
    void services.runs.lines(runId, afterSeq).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      for (const line of result.value) {
        useRunsStore.getState().appendLine(line);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return error;
}
