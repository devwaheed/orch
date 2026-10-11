/**
 * Mount point for the paused-by-limit card (S3-03: "Paused by an account limit",
 * resume on another account, More resume options, auto-resume at reset).
 * Sits between the pane header and the output. Renders nothing until S3-03 lands.
 */
import type { RunId, RunStatus } from '@orch/contracts';

export function PausedLimitSlot({ runId, status }: { readonly runId: RunId; readonly status: RunStatus }): null {
  void runId;
  void status;
  return null;
}
