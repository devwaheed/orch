import { describe, expect, it } from 'vitest';
import type { JobStatus } from '@orch/contracts';
import { hasActiveJob } from './activeJob.js';

const jobs = (...statuses: JobStatus[]): Array<{ status: JobStatus }> => statuses.map((status) => ({ status }));

describe('REL-02 active job', () => {
  it('is false when there are no jobs', () => {
    expect(hasActiveJob([])).toBe(false);
  });

  it('is true while a job is running, waiting on quota or paused', () => {
    expect(hasActiveJob(jobs('running'))).toBe(true);
    expect(hasActiveJob(jobs('waiting_quota'))).toBe(true);
    expect(hasActiveJob(jobs('paused'))).toBe(true);
  });

  it('is false for finished or not-yet-started jobs', () => {
    expect(hasActiveJob(jobs('done'))).toBe(false);
    expect(hasActiveJob(jobs('failed'))).toBe(false);
    expect(hasActiveJob(jobs('cancelled'))).toBe(false);
    expect(hasActiveJob(jobs('scheduled'))).toBe(false);
  });

  it('is true when any one job among finished ones is active', () => {
    expect(hasActiveJob(jobs('done', 'failed', 'running', 'cancelled'))).toBe(true);
  });
});
