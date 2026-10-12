/**
 * Loads the before/after contents of one changed file (IReviewService.diff) for the Monaco
 * diff. Reloads when the worktree, the file, or the review's state changes, so a new try
 * (request changes, REV-05) refreshes the diff. Ignores a reply that arrives after the
 * selection has changed.
 */
import { useEffect, useState } from 'react';
import type { OrchError, WorktreeReview } from '@orchagents/contracts';
import { reviewServices } from '../services.js';

export interface DiffState {
  readonly before: string;
  readonly after: string;
  readonly loading: boolean;
  readonly error: OrchError | null;
}

const EMPTY: DiffState = { before: '', after: '', loading: false, error: null };

export function useDiff(review: WorktreeReview | null, path: string | null): DiffState {
  const services = reviewServices();
  const worktree = review?.worktree ?? null;
  const state = review?.state ?? null;
  const [diff, setDiff] = useState<DiffState>(EMPTY);

  useEffect(() => {
    if (!services || worktree === null || path === null) {
      setDiff(EMPTY);
      return undefined;
    }
    let current = true;
    setDiff((prev) => ({ before: prev.before, after: prev.after, loading: true, error: null }));
    void services.review.diff(worktree, path).then((result) => {
      if (!current) return;
      if (result.ok) {
        setDiff({ before: result.value.before, after: result.value.after, loading: false, error: null });
      } else {
        setDiff({ before: '', after: '', loading: false, error: result.error });
      }
    });
    return () => {
      current = false;
    };
  }, [services, worktree, path, state]);

  return diff;
}
