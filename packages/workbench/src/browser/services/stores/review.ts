/** Review store: worktrees awaiting a verdict or merge. Fed by review.changed. */
import { create } from 'zustand';
import type { WorktreeReview } from '@orchagents/contracts';
import type { Job } from '@orchagents/contracts';

/** Reviews shown for the open project, matching the Live view's repo filter. */
export function projectReviews(worktrees: readonly WorktreeReview[], jobs: readonly Job[], activeProject: string): readonly WorktreeReview[] {
  return worktrees.filter((review) =>
    jobs.some((job) => job.id === review.jobId && job.spec.repoPath === activeProject),
  );
}

export interface ReviewState {
  readonly worktrees: readonly WorktreeReview[];
  setWorktrees(worktrees: readonly WorktreeReview[]): void;
  upsertWorktree(review: WorktreeReview): void;
}

export const useReviewStore = create<ReviewState>()((set) => ({
  worktrees: [],
  setWorktrees: (worktrees) => set({ worktrees: [...worktrees] }),
  upsertWorktree: (review) =>
    set((s) => {
      const index = s.worktrees.findIndex((w) => w.worktree === review.worktree);
      if (index === -1) {
        return { worktrees: [...s.worktrees, review] };
      }
      return { worktrees: s.worktrees.map((w, i) => (i === index ? review : w)) };
    }),
}));
