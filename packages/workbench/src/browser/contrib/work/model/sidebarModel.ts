/**
 * Pure view-model for the jobs sidebar: the step line and run row indent.
 */
import type { Job, JobStep, Run, SpecQueue, SpecRun } from '@orchagents/contracts';
import { workStrings } from '../strings.js';

export interface StepLineView {
  /** "Now: Implement" */
  readonly now: string;
  /** "step 2 of 5" */
  readonly progress: string;
  /** "try 1" */
  readonly attempt: string;
  /** The full line: "Now: Implement · step 2 of 5 · try 1" */
  readonly text: string;
  /** true when the same step failed 2+ times: the line turns amber */
  readonly looping: boolean;
}

export function stepLineView(step: JobStep): StepLineView {
  const now = workStrings.step.now(step.name);
  const progress = workStrings.step.progress(step.index, step.total);
  const attempt = workStrings.step.attempt(step.attempt);
  return {
    now,
    progress,
    attempt,
    text: [now, progress, attempt].join(' · '),
    looping: step.looping,
  };
}

/** Left padding of a run row: runs nest under their job, one level per depth. */
export function runRowIndentPx(depth: number): number {
  return 14 + depth * 14;
}

/** Right aligned metadata shown for the three demo jobs in the prototype. */
export function jobMeta(job: Pick<Job, 'status' | 'scheduledFor'>, runCount: number): string {
  if (job.status === 'running') return `${runCount} runs`;
  if (job.status === 'waiting_quota' && job.scheduledFor) {
    const scheduled = new Date(job.scheduledFor);
    return `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`;
  }
  if (job.status === 'done') return workStrings.sidebar.doneMeta;
  return '';
}

/**
 * Maps jobs to their originating SpecRun by checking specRun.jobId first,
 * then falling back to matching job.spec.storyPath against specRun.file.
 */
export function buildSpecJobMap(queues: readonly SpecQueue[]): (job: Job) => SpecRun | undefined {
  const byJobId = new Map<string, SpecRun>();
  const byStoryPath = new Map<string, SpecRun>();
  for (const q of queues) {
    for (const specRun of q.specs) {
      if (specRun.jobId) {
        byJobId.set(`${q.repoPath}:${specRun.jobId}`, specRun);
      }
      if (specRun.file) {
        byStoryPath.set(`${q.repoPath}:${specRun.file}`, specRun);
      }
    }
  }
  return (job: Job): SpecRun | undefined => {
    const matchId = byJobId.get(`${job.spec.repoPath}:${job.id}`);
    if (matchId) return matchId;
    if (job.spec?.storyPath) {
      const repo = job.spec.repoPath;
      if (repo && byStoryPath.has(`${repo}:${job.spec.storyPath}`)) {
        return byStoryPath.get(`${repo}:${job.spec.storyPath}`);
      }
      return undefined;
    }
    return undefined;
  };
}

export function partitionJobs(jobs: readonly Job[], queues: readonly SpecQueue[], repoPath: string): {
  specJobs: Job[];
  nonSpecJobs: Job[];
  specForJob: (job: Job) => SpecRun | undefined;
} {
  const specForJob = buildSpecJobMap(queues);
  const specJobs: Job[] = [];
  const nonSpecJobs: Job[] = [];
  for (const job of jobs) {
    if (job.spec.repoPath !== repoPath) continue;
    if (specForJob(job)) {
      specJobs.push(job);
    } else {
      nonSpecJobs.push(job);
    }
  }
  return { specJobs, nonSpecJobs, specForJob };
}

/** Picks the run to show on first entering Live, scoped to the open project. */
export function autoOpenRun(
  jobs: readonly Job[],
  runs: readonly Run[],
  queue: SpecQueue | null,
  selectedSpecId: string | null,
  repoPath: string,
): { jobId: string; runId: string } | null {
  const projectJobs = jobs.filter((job) => job.spec.repoPath === repoPath);
  const projectJobIds = new Set(projectJobs.map((job) => job.id));
  const projectRuns = runs.filter((run) => projectJobIds.has(run.jobId));
  const selectedSpec = queue?.repoPath === repoPath
    ? queue.specs.find((spec) => spec.id === selectedSpecId && ['running', 'verifying', 'auditing'].includes(spec.state))
    : undefined;
  const selectedRun = selectedSpec?.jobId
    ? projectRuns.find((run) => run.jobId === selectedSpec.jobId && run.status === 'running')
    : undefined;
  const running = [...projectRuns]
    .filter((run) => run.status === 'running')
    .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))[0];
  const recent = [...projectRuns]
    .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))[0];
  const target = selectedRun ?? running ?? recent;
  return target ? { jobId: target.jobId, runId: target.id } : null;
}
