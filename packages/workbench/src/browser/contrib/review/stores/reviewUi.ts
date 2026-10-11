/**
 * Review area UI state: which worktree and file are selected, the request-changes composer,
 * the discard confirmation, and the last action's busy flag and error. The review data itself
 * lives in services/stores/review.ts (fed by review.changed).
 */
import { create } from 'zustand';
import type { OrchError, WorktreeId } from '@orch/contracts';

/** Which action is in flight, so its button can be disabled. */
export type ReviewBusy = 'merge' | 'request' | 'discard' | null;

export interface ReviewUiState {
  readonly selected: WorktreeId | null;
  readonly selectedFile: string | null;
  readonly requestOpen: boolean;
  readonly requestText: string;
  readonly confirmDiscard: boolean;
  readonly busy: ReviewBusy;
  readonly error: OrchError | null;
  select(worktree: WorktreeId): void;
  selectFile(path: string): void;
  openRequest(): void;
  closeRequest(): void;
  setRequestText(text: string): void;
  askDiscard(): void;
  cancelDiscard(): void;
  setBusy(busy: ReviewBusy): void;
  setError(error: OrchError | null): void;
}

export const useReviewUiStore = create<ReviewUiState>()((set) => ({
  selected: null,
  selectedFile: null,
  requestOpen: false,
  requestText: '',
  confirmDiscard: false,
  busy: null,
  error: null,
  select: (worktree) =>
    set({ selected: worktree, selectedFile: null, requestOpen: false, requestText: '', confirmDiscard: false, error: null }),
  selectFile: (path) => set({ selectedFile: path }),
  openRequest: () => set({ requestOpen: true, error: null }),
  closeRequest: () => set({ requestOpen: false, requestText: '', error: null }),
  setRequestText: (requestText) => set({ requestText }),
  askDiscard: () => set({ confirmDiscard: true, error: null }),
  cancelDiscard: () => set({ confirmDiscard: false }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
}));
