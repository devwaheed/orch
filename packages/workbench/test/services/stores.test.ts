import { beforeEach, describe, expect, it } from 'vitest';
import type { ConfigFieldError, Job, JobId, WorktreeReview } from '@orchagents/contracts';
import { applyOrchEvent } from '../../src/browser/services/stores/apply.js';
import { useConfigErrorsStore } from '../../src/browser/services/stores/config.js';
import { projectFromJobs, syncActiveProject } from '../../src/browser/services/stores/project.js';
import { useJobsStore } from '../../src/browser/services/stores/work.js';
import { projectReviews } from '../../src/browser/services/stores/review.js';
import { sampleReview } from '../fixtures.js';
import { useWorkbenchStore } from '../../src/browser/services/workbenchStore.js';

function job(id: string, repoPath: string, createdAt: string): Job {
  return {
    id: id as JobId,
    title: id,
    spec: { mode: 'single', goal: 'g', repoPath, checks: [], onLimit: 'switch-account', orchestrator: { agent: 'claude', account: 'auto' }, workers: ['claude'] },
    status: 'running',
    step: null,
    createdAt,
    scheduledFor: null,
  } as Job;
}

const errors: ConfigFieldError[] = [{ path: 'routing', line: 2, message: 'Unknown routing rule.' }];

describe('config.invalid', () => {
  beforeEach(() => useConfigErrorsStore.setState({ errors: [] }));

  it('stores the field errors in the config store', () => {
    applyOrchEvent({ type: 'config.invalid', errors });
    expect(useConfigErrorsStore.getState().errors).toEqual(errors);
  });

  it('a second config.invalid replaces the first', () => {
    applyOrchEvent({ type: 'config.invalid', errors });
    applyOrchEvent({ type: 'config.invalid', errors: [] });
    expect(useConfigErrorsStore.getState().errors).toEqual([]);
  });
});

describe('current project', () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: [] });
    useWorkbenchStore.setState({ activeProject: '' });
  });

  it('is empty when there are no jobs', () => {
    expect(projectFromJobs([])).toBe('');
  });

  it('is the repo of the most recently created job', () => {
    const jobs = [
      job('j-1', '/repos/old', '2026-10-01T09:00:00Z'),
      job('j-2', '/repos/new', '2026-10-05T09:00:00Z'),
      job('j-3', '/repos/middle', '2026-10-02T09:00:00Z'),
    ];
    expect(projectFromJobs(jobs)).toBe('/repos/new');
  });

  it('compares timestamps as times, not as text', () => {
    const jobs = [job('j-1', '/repos/a', '2026-10-09T08:00:00Z'), job('j-2', '/repos/b', '2026-10-09T10:30:00Z')];
    expect(projectFromJobs(jobs)).toBe('/repos/b');
  });

  it('follows a job.changed event into activeProject', () => {
    applyOrchEvent({ type: 'job.changed', job: job('j-1', '/repos/api-server', '2026-10-05T09:00:00Z') });
    expect(useWorkbenchStore.getState().activeProject).toBe('/repos/api-server');
  });

  it('syncActiveProject reads the jobs store', () => {
    useJobsStore.getState().setJobs([job('j-1', '/repos/x', '2026-10-05T09:00:00Z')]);
    syncActiveProject();
    expect(useWorkbenchStore.getState().activeProject).toBe('/repos/x');
  });

  it('shows only reviews whose job belongs to the active project', () => {
    const first = job('j-1', '/repos/a', '2026-10-05T09:00:00Z');
    const second = job('j-2', '/repos/b', '2026-10-06T09:00:00Z');
    const review = (jobId: JobId) => sampleReview({ worktree: 'orch/spec-1' as WorktreeReview['worktree'], jobId });
    expect(projectReviews([review(first.id), review(second.id)], [first, second], '/repos/b')).toEqual([review(second.id)]);
  });
});
