/**
 * UI state for the Report a problem dialog.
 */
import { create } from 'zustand';
import type { OrchError } from '@orchagents/contracts';

export interface BugReportUiState {
  readonly open: boolean;
  readonly files: string[];
  readonly loadingFiles: boolean;
  readonly saving: boolean;
  readonly savedPath: string | null;
  readonly error: OrchError | null;

  openDialog(): void;
  closeDialog(): void;
  setFiles(files: string[]): void;
  setLoadingFiles(loading: boolean): void;
  setSaving(saving: boolean): void;
  setSavedPath(path: string | null): void;
  setError(error: OrchError | null): void;
  reset(): void;
}

export const useBugReportUiStore = create<BugReportUiState>((set) => ({
  open: false,
  files: [],
  loadingFiles: false,
  saving: false,
  savedPath: null,
  error: null,

  openDialog: () =>
    set({
      open: true,
      files: [],
      loadingFiles: true,
      saving: false,
      savedPath: null,
      error: null,
    }),
  closeDialog: () => set({ open: false }),
  setFiles: (files) => set({ files, loadingFiles: false }),
  setLoadingFiles: (loadingFiles) => set({ loadingFiles }),
  setSaving: (saving) => set({ saving }),
  setSavedPath: (savedPath) => set({ savedPath, saving: false }),
  setError: (error) => set({ error, saving: false }),
  reset: () =>
    set({
      open: false,
      files: [],
      loadingFiles: false,
      saving: false,
      savedPath: null,
      error: null,
    }),
}));
