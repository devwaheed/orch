/**
 * Jobs sidebar state: which jobs are expanded. A job that was never toggled
 * follows the default for its status (see sidebar/JobsSidebar.tsx).
 */
import { create } from 'zustand';
import type { JobId } from '@orchagents/contracts';

export interface SidebarStore {
  readonly openJobs: Readonly<Record<string, boolean>>;
  setJobOpen(jobId: JobId, open: boolean): void;
}

const demo = typeof window !== 'undefined' && window.orch?.app.demo === true;

export const useSidebarStore = create<SidebarStore>()((set) => ({
  openJobs: demo ? { 'j-07': true } : {},
  setJobOpen: (jobId, open) => set((state) => ({ openJobs: { ...state.openJobs, [jobId]: open } })),
}));
