/**
 * Work stores: jobs, runs and the live output lines of each run.
 * Fed by job.changed, run.changed and run.line. Lines are appended in seq order and
 * a line already seen (same seq) is ignored.
 */
import { create } from 'zustand';
import type { Job, JobId, Run, RunId, RunLine } from '@orchagents/contracts';

export interface JobsState {
  readonly jobs: readonly Job[];
  setJobs(jobs: readonly Job[]): void;
  upsertJob(job: Job): void;
}

export const useJobsStore = create<JobsState>()((set) => ({
  jobs: [],
  setJobs: (jobs) => set({ jobs: [...jobs] }),
  upsertJob: (job) =>
    set((s) => {
      const index = s.jobs.findIndex((j) => j.id === job.id);
      if (index === -1) {
        return { jobs: [...s.jobs, job] };
      }
      return { jobs: s.jobs.map((j, i) => (i === index ? job : j)) };
    }),
}));

export interface RunsState {
  readonly runs: readonly Run[];
  /** Lines per run, ordered by seq. */
  readonly lines: Readonly<Record<string, readonly RunLine[]>>;
  /** Replaces the runs of one job with the list the core host sent. */
  setRunsForJob(jobId: JobId, runs: readonly Run[]): void;
  upsertRun(run: Run): void;
  appendLine(line: RunLine): void;
}

export const useRunsStore = create<RunsState>()((set) => ({
  runs: [],
  lines: {},
  setRunsForJob: (jobId, runs) =>
    set((s) => {
      const kept = s.runs.filter((r) => r.jobId !== jobId);
      return { runs: [...kept, ...runs] };
    }),
  upsertRun: (run) =>
    set((s) => {
      const index = s.runs.findIndex((r) => r.id === run.id);
      if (index === -1) {
        return { runs: [...s.runs, run] };
      }
      return { runs: s.runs.map((r, i) => (i === index ? run : r)) };
    }),
  appendLine: (line) =>
    set((s) => {
      const existing = s.lines[line.runId] ?? [];
      if (existing.some((l) => l.seq === line.seq)) {
        return {};
      }
      return { lines: { ...s.lines, [line.runId]: [...existing, line] } };
    }),
}));

const EMPTY_LINES: readonly RunLine[] = [];

/** The lines of one run, or an empty list. Use with a selector so only that run re-renders. */
export function selectRunLines(runId: RunId) {
  return (s: RunsState): readonly RunLine[] => s.lines[runId] ?? EMPTY_LINES;
}
