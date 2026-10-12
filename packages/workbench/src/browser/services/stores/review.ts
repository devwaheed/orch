/** Review store: worktrees awaiting a verdict or merge. Fed by review.changed. */
import { create } from 'zustand';
import type { WorktreeReview } from '@orchagents/contracts';

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
