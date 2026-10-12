/**
 * Mount point for the paused-by-limit card (S3-03: "Paused by an account limit",
 * resume on another account, More resume options, auto-resume at reset).
 * Sits between the pane header and the output.
 */
import type { Run } from '@orchagents/contracts';
import { PausedLimitCard } from './paused/PausedLimitCard.js';

export function PausedLimitSlot({ run }: { readonly run: Pick<Run, 'id' | 'status' | 'resumesAt' | 'accountId' | 'agent' | 'sessionId'> }) {
  if (run.status !== 'paused_limit') {
    return null;
  }
  return <PausedLimitCard run={run} />;
}