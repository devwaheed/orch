/**
 * Named slot for the "Stop this happening again" panel, owned by story S4-03. S3-01b mounts it exactly
 * where the design shows it — on a failing worktree — and now renders the real panel: the four
 * correction layers (codebase, lint, agent_rule, review_note), strongest first.
 */
import { useReviewUiStore } from '../stores/reviewUi.js';
import { useReviewStore } from '../../../services/stores/review.js';
import { reviewServices } from '../services.js';
import { CorrectionsPanel } from '../corrections/CorrectionsPanel.js';

export function CorrectionsSlot() {
  const selectedWorktree = useReviewUiStore((s) => s.selected);
  const reviews = useReviewStore((s) => s.worktrees);
  const services = reviewServices();

  const review = reviews.find((r) => r.worktree === selectedWorktree);
  if (!review || review.state !== 'failing') return null;

  const port = services?.review ?? null;
  if (!port) return null;

  return <CorrectionsPanel port={port} review={review} />;
}
