import { describe, expect, it } from 'vitest';
import { autoOpenRun, partitionJobs, stepLineView, runRowIndentPx, jobMeta, tryForRun } from './sidebarModel.js';
import type { Job, Run, SpecQueue } from '@orchagents/contracts';

describe('stepLineView', () => {
  it('builds "Now: … · step i of n · try k" from the job step', () => {
    const view = stepLineView({ name: 'Implement', index: 2, total: 5, attempt: 1, looping: false });
    expect(view.now).toBe('Now: Implement');
    expect(view.progress).toBe('step 2 of 5');
    expect(view.attempt).toBe('try 1');
    expect(view.text).toBe('Now: Implement · step 2 of 5 · try 1');
    expect(view.looping).toBe(false);
  });

  it('keeps looping true so the line turns amber', () => {
    const view = stepLineView({ name: 'Verify', index: 4, total: 5, attempt: 3, looping: true });
    expect(view.text).toBe('Now: Verify · step 4 of 5 · try 3');
    expect(view.looping).toBe(true);
  });
});

describe('runRowIndentPx', () => {
  it('indents each depth level by 14px under a 14px base', () => {
    expect(runRowIndentPx(0)).toBe(14);
    expect(runRowIndentPx(1)).toBe(28);
    expect(runRowIndentPx(2)).toBe(42);
  });
});

describe('jobMeta', () => {
  it('shows run count, scheduled local reset and completed state', () => {
    const scheduledFor = new Date(2026, 9, 11, 15).toISOString();
    expect(jobMeta({ status: 'running', scheduledFor: null }, 6)).toBe('6 runs');
    expect(jobMeta({ status: 'waiting_quota', scheduledFor }, 0)).toBe('15:00');
    expect(jobMeta({ status: 'done', scheduledFor: null }, 0)).toBe('done');
  });
});

describe('project Live jobs', () => {
  const job = (id: string, repoPath: string, goal: string): Job => ({
    id: id as Job['id'], title: goal,
    spec: { mode: 'single', goal, repoPath, checks: [], onLimit: 'switch-account', orchestrator: { agent: 'codex', account: 'auto' }, workers: ['codex'] },
    status: 'running', step: null, createdAt: '2026-10-28T10:00:00.000Z', scheduledFor: null,
  });
  const queue = (repoPath: string, jobId: string): SpecQueue => ({
    id: `q-${repoPath}` as SpecQueue['id'], repoPath,
    settings: { source: 'docs/specs', order: 'waves', advance: 'verified', on_fail: 'retry-stop', max_parallel: 2, retries: 2, after_each: [] },
    paused: false, createdAt: '2026-10-28T10:00:00.000Z',
    specs: [{
      id: '1' as SpecQueue['specs'][number]['id'], queueId: `q-${repoPath}` as SpecQueue['id'], position: 1,
      file: 'docs/specs/001-add.md', spec: { id: '1', title: repoPath.endsWith('old') ? 'Old repo spec' : 'Add an add function', depends_on: [], scope: [], done_when: [{ by: 'audit', text: 'The goal is met' }], agent: 'auto', mode: 'single', agents: [] },
      state: 'running', attempt: 1, jobId: jobId as Job['id'], worktree: null, implementer: null,
      criteria: [], blockedBy: [], startedAt: '2026-10-28T10:00:00.000Z', finishedAt: null, tokens: 0, history: [],
    }],
  });

  it('uses the attempt in effect when a run started', () => {
    const spec = {
      ...queue('/repo/current', 'j-current').specs[0]!,
      attempt: 2,
      history: [
        { state: 'running' as const, at: '2026-10-28T10:00:00.000Z', attempt: 1 },
        { state: 'running' as const, at: '2026-10-28T12:00:00.000Z', attempt: 2 },
      ],
    };

    expect(tryForRun(spec, '2026-10-28T11:00:00.000Z')).toBe(1);
    expect(tryForRun(spec, '2026-10-28T13:00:00.000Z')).toBe(2);
    expect(tryForRun(spec, null)).toBe(2);
    expect(tryForRun(spec, undefined)).toBe(2);
  });

  it('shows only jobs from the open project and labels specs from that repo', () => {
    const current = job('j-1', '/repo/current', 'Implement current');
    const old = job('j-2', '/repo/old', 'Implement old');
    const queues = [queue('/repo/current', 'j-1'), queue('/repo/old', 'j-2')];
    const result = partitionJobs([current, old], queues, '/repo/current');
    expect(result.specJobs).toEqual([current]);
    expect(result.specForJob(current)?.spec.title).toBe('Add an add function');
    expect(result.specForJob(old)?.spec.title).toBe('Old repo spec');
  });

  it('matches an earlier spec job by story path when its id is no longer current', () => {
    const earlierJob = {
      ...job('j-earlier', '/repo/current', 'Earlier try goal'),
      spec: {
        ...job('j-earlier', '/repo/current', 'Earlier try goal').spec,
        storyPath: 'docs/specs/001-add.md',
      },
    };
    const specQueue = queue('/repo/current', 'j-current');
    const result = partitionJobs([earlierJob], [specQueue], '/repo/current');

    expect(result.specJobs).toEqual([earlierJob]);
    expect(result.specForJob(earlierJob)?.spec.title).toBe('Add an add function');
  });

  it('opens selected spec activity, then newest running run, then newest run in this repo', () => {
    const jobs = [job('j-1', '/repo/current', 'one'), job('j-2', '/repo/current', 'two'), job('j-old', '/repo/old', 'old')];
    const run = (id: string, jobId: string, status: Run['status'], startedAt: string): Run => ({
      id: id as Run['id'], jobId: jobId as Run['jobId'], parentId: null, depth: 0, role: 'implementer', task: id,
      agent: 'codex', accountId: 'codex-team' as Run['accountId'], status, worktree: null, readOnly: false,
      sessionId: null, startedAt, resumesAt: null,
    });
    const runs = [
      run('r-1', 'j-1', 'running', '2026-10-28T10:00:00.000Z'),
      run('r-2', 'j-2', 'running', '2026-10-28T11:00:00.000Z'),
      run('r-3', 'j-old', 'running', '2026-10-28T12:00:00.000Z'),
    ];
    const selectedQueue = queue('/repo/current', 'j-1');
    expect(autoOpenRun(jobs, runs, selectedQueue, '1', '/repo/current')).toEqual({ jobId: 'j-1', runId: 'r-1' });
    expect(autoOpenRun(jobs, runs, null, null, '/repo/current')).toEqual({ jobId: 'j-2', runId: 'r-2' });
    expect(autoOpenRun(jobs, [{ ...runs[0]!, status: 'done' }], null, null, '/repo/current')).toEqual({ jobId: 'j-1', runId: 'r-1' });
  });
});
