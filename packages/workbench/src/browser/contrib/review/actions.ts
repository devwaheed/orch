/**
 * What the Review screen does with the core: approve and merge (REV-01), request changes
 * (REV-05), and discard (REV-04). Each takes the narrow review port it calls, so tests pass
 * a fake; failures are reported as the OrchError the core sent, never thrown.
 *
 * `openEvidence` and `openInEditor` render the two buttons the design draws, but no contract
 * method opens an evidence bundle or an external editor. They are deliberately inert named
 * slots and are reported in the story summary as a gap for the owner to fill.
 */
import type { CorrectionLayer, IReviewService, WorktreeId } from '@orch/contracts';
import { useReviewUiStore } from './stores/reviewUi.js';

export type ReviewPort = Pick<IReviewService, 'approveAndMerge' | 'requestChanges' | 'discard' | 'correct'>;

/** REV-01: the core refuses unless the verdict is verified. Returns true on success. */
export async function approveAndMerge(port: ReviewPort, worktree: WorktreeId): Promise<boolean> {
  const ui = useReviewUiStore.getState();
  ui.setBusy('merge');
  ui.setError(null);
  const result = await port.approveAndMerge(worktree);
  const after = useReviewUiStore.getState();
  after.setBusy(null);
  if (!result.ok) {
    after.setError(result.error);
    return false;
  }
  return true;
}

/** REV-05: sends the feedback as the next turn and starts a new try. Returns true on success. */
export async function requestChanges(port: ReviewPort, worktree: WorktreeId, feedback: string): Promise<boolean> {
  const text = feedback.trim();
  if (text.length === 0) return false;
  const ui = useReviewUiStore.getState();
  ui.setBusy('request');
  ui.setError(null);
  const result = await port.requestChanges(worktree, text);
  const after = useReviewUiStore.getState();
  after.setBusy(null);
  if (!result.ok) {
    after.setError(result.error);
    return false;
  }
  after.closeRequest();
  return true;
}

/** REV-04: deletes the worktree and branch. The screen asks for confirmation first. */
export async function discard(port: ReviewPort, worktree: WorktreeId): Promise<boolean> {
  const ui = useReviewUiStore.getState();
  ui.setBusy('discard');
  ui.setError(null);
  const result = await port.discard(worktree);
  const after = useReviewUiStore.getState();
  after.setBusy(null);
  if (!result.ok) {
    after.setError(result.error);
    return false;
  }
  after.cancelDiscard();
  return true;
}

/** S4-03: apply a correction layer to a refuted worktree. Returns true on success. */
export async function applyCorrection(port: ReviewPort, worktree: WorktreeId, layer: CorrectionLayer, action: string): Promise<boolean> {
  const ui = useReviewUiStore.getState();
  ui.setBusy('correct');
  ui.setError(null);
  const result = await port.correct(worktree, layer, action);
  const after = useReviewUiStore.getState();
  if (!result.ok) {
    after.setBusy(null);
    after.setError(result.error);
    return false;
  }
  after.setBusy(null);
  if (result.value.followUpJobId) {
    after.markCorrectionDone(layer);
  } else {
    after.markCorrectionDone(layer);
  }
  return true;
}

/** No contract method opens the engine's evidence bundle (evidenceRef is opaque). Inert slot. */
export function openEvidence(): void {
  // Intentionally empty: see the file header.
}

/** No contract method opens a worktree in an external editor. Inert slot. */
export function openInEditor(): void {
  // Intentionally empty: see the file header.
}
