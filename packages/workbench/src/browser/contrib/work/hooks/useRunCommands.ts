/**
 * Run commands through the typed runs proxy (IRunsService). Results are never thrown:
 * a failed command returns its OrchError, which the pane shows.
 */
import { useCallback, useState } from 'react';
import type { OrchError, RunId } from '@orch/contracts';
import { getWorkServices } from '../workServices.js';
import { dataStrings } from '../../../services/dataStrings.js';

export type RunCommand = 'pause' | 'stop' | 'startNow';

export interface RunCommands {
  readonly error: OrchError | null;
  run(command: RunCommand): Promise<boolean>;
  send(text: string): Promise<boolean>;
}

const NOT_CONNECTED: OrchError = {
  code: 'internal',
  message: dataStrings.coreUnavailable.message,
  fix: dataStrings.coreUnavailable.fix,
};

export function useRunCommands(runId: RunId): RunCommands {
  const [error, setError] = useState<OrchError | null>(null);

  const finish = useCallback((result: { ok: true } | { ok: false; error: OrchError }): boolean => {
    if (result.ok) {
      setError(null);
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  const run = useCallback(
    async (command: RunCommand): Promise<boolean> => {
      const services = getWorkServices();
      if (!services) return finish({ ok: false, error: NOT_CONNECTED });
      const result = await services.runs[command](runId);
      return finish(result.ok ? { ok: true } : { ok: false, error: result.error });
    },
    [runId, finish],
  );

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const services = getWorkServices();
      if (!services) return finish({ ok: false, error: NOT_CONNECTED });
      const result = await services.runs.send(runId, text);
      return finish(result.ok ? { ok: true } : { ok: false, error: result.error });
    },
    [runId, finish],
  );

  return { error, run, send };
}
