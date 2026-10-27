/**
 * State persistence and restart recovery for spec queue (docs/specs/spec-queue.md §9).
 * State is persisted in `<repo>/.orch/queue-state.json`.
 */
import { err, ok } from '@orchagents/base';
import { SpecQueue, type Result, type SpecRun } from '@orchagents/contracts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { changeSpecState } from '../common/stateMachine.js';

export const QUEUE_STATE_FILENAME = 'queue-state.json';

export function getQueueStatePath(repoPath: string): string {
  return path.join(repoPath, '.orch', QUEUE_STATE_FILENAME);
}

/**
 * Saves the SpecQueue state to `<repo>/.orch/queue-state.json`.
 */
export async function saveQueueState(queue: SpecQueue): Promise<Result<void>> {
  const filePath = getQueueStatePath(queue.repoPath);
  const dirPath = path.dirname(filePath);

  try {
    await mkdir(dirPath, { recursive: true });
    const content = JSON.stringify(queue, null, 2);
    await writeFile(filePath, content, 'utf8');
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'internal',
      message: `Failed to persist queue state: ${(error as Error).message}`,
      fix: 'Check write permissions for the .orch directory.',
    });
  }
}

/**
 * Loads the persisted SpecQueue state from `<repo>/.orch/queue-state.json` if it exists.
 * Returns null if the file does not exist.
 */
export async function loadPersistedQueueState(repoPath: string): Promise<Result<SpecQueue | null>> {
  const filePath = getQueueStatePath(repoPath);

  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const checked = SpecQueue.safeParse(parsed);
    if (!checked.success) {
      return err({
        code: 'validation_failed',
        message: `Persisted queue state in ${filePath} is invalid: ${checked.error.message}`,
        fix: 'Inspect or remove the corrupt .orch/queue-state.json file.',
      });
    }
    return ok(checked.data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(null);
    }
    return err({
      code: 'internal',
      message: `Failed to read persisted queue state: ${(error as Error).message}`,
      fix: 'Check file read permissions for .orch/queue-state.json.',
    });
  }
}

/**
 * Applies restart recovery (§9):
 * If orch restarted and active specs lost their engine workflow, returns them to `queued`
 * with their attempt count kept and note "Restarted after orch closed".
 */
export function recoverActiveSpecs(
  specs: readonly SpecRun[],
  isWorkflowActive: (workflowId: string | null) => boolean,
): { recoveredSpecs: SpecRun[]; changed: boolean } {
  let changed = false;

  const recoveredSpecs: SpecRun[] = specs.map((spec) => {
    if (spec.state === 'running' || spec.state === 'verifying' || spec.state === 'auditing') {
      const active = isWorkflowActive(spec.jobId);
      if (!active) {
        changed = true;
        // Attempt count kept per §9 ("Spec returns to queued with its attempt count kept")
        return changeSpecState(spec, 'queued', spec.attempt, new Date().toISOString());
      }
    }
    return spec;
  });

  return { recoveredSpecs, changed };
}
