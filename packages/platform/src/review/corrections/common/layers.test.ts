import { describe, expect, it } from 'vitest';
import type { AccountId, CorrectionLayer, Job, JobId, Run, RunId } from '@orchagents/contracts';
import { appendLesson, buildCorrectionJobSpec, CORRECTION_LAYERS, isJobLayer, LESSONS_HEADING } from './layers.js';

describe('CORRECTION_LAYERS (REV-06)', () => {
  it('orders layers strongest first', () => {
    expect(CORRECTION_LAYERS).toEqual(['codebase', 'lint', 'agent_rule', 'review_note']);
  });
});

describe('isJobLayer', () => {
  it.each(['codebase', 'lint'] as CorrectionLayer[])('returns true for %s', (layer) => {
    expect(isJobLayer(layer)).toBe(true);
  });

  it.each(['agent_rule', 'review_note'] as CorrectionLayer[])('returns false for %s', (layer) => {
    expect(isJobLayer(layer)).toBe(false);
  });
});

function singleJob(over: Partial<Job['spec']> = {}): Job {
  return {
    id: 'j-01' as JobId,
    title: 'test',
    spec: {
      mode: 'single',
      goal: 'original goal',
      repoPath: '/repo',
      checks: [],
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      onLimit: 'switch-account',
      ...over,
    } as Job['spec'],
    status: 'running',
    step: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    scheduledFor: null,
  };
}

describe('buildCorrectionJobSpec (REV-06)', () => {
  it('uses the original single-mode spec for orchestrator/workers/onLimit and the action as goal', () => {
    const job = singleJob({ checks: [{ kind: 'command', run: 'pnpm test' }], onLimit: 'switch-agent' });
    const spec = buildCorrectionJobSpec(job, null, 'Fix the failing test');
    expect(spec).toEqual({
      mode: 'single',
      goal: 'Fix the failing test',
      repoPath: '/repo',
      checks: [{ kind: 'command', run: 'pnpm test' }],
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      onLimit: 'switch-agent',
    });
  });

  it('carries the original checks from the job', () => {
    const checks: Job['spec']['checks'] = [
      { kind: 'command', run: 'pnpm lint' },
      { kind: 'http', url: 'http://localhost:3000', expectStatus: 200 },
    ];
    const job = singleJob({ checks });
    const spec = buildCorrectionJobSpec(job, null, 'Fix lint errors');
    expect(spec?.checks).toEqual(checks);
  });

  it('defaults onLimit to switch-account when the original omits it', () => {
    const job = singleJob();
    delete (job.spec as { onLimit?: string }).onLimit;
    const spec = buildCorrectionJobSpec(job, null, 'action');
    expect(spec?.onLimit).toBe('switch-account');
  });

  it('for non-single mode, uses the original run agent and account auto', () => {
    const compareJob: Job = {
      id: 'j-cmp' as JobId,
      title: 'compare',
      spec: {
        mode: 'compare',
        goal: 'original',
        repoPath: '/repo',
        checks: [{ kind: 'command', run: 'pnpm test' }],
        agents: ['codex'],
        combine: true,
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      scheduledFor: null,
    };
    const run: Run = {
      id: 'r-01' as RunId,
      jobId: 'j-cmp' as JobId,
      parentId: null,
      depth: 0,
      role: 'implementer',
      task: 'original',
      agent: 'codex',
      accountId: 'codex-a' as AccountId,
      status: 'done',
      worktree: null,
      readOnly: false,
      sessionId: null,
      startedAt: null,
      resumesAt: null,
    };
    const spec = buildCorrectionJobSpec(compareJob, run, 'Fix the diff');
    expect(spec).toEqual({
      mode: 'single',
      goal: 'Fix the diff',
      repoPath: '/repo',
      checks: [{ kind: 'command', run: 'pnpm test' }],
      orchestrator: { agent: 'codex', account: 'auto' },
      workers: ['codex'],
      onLimit: 'switch-account',
    });
  });

  it('returns null for non-single mode when the run is missing', () => {
    const compareJob: Job = {
      id: 'j-cmp' as JobId,
      title: 'compare',
      spec: {
        mode: 'compare',
        goal: 'original',
        repoPath: '/repo',
        checks: [],
        agents: ['codex'],
        combine: true,
        onLimit: 'switch-account',
      },
      status: 'done',
      step: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      scheduledFor: null,
    };
    expect(buildCorrectionJobSpec(compareJob, null, 'Fix')).toBeNull();
  });
});

describe('appendLesson (REV-06 agent_rule)', () => {
  it('creates the ## Lessons heading when it is missing', () => {
    const content = '# Title\n\nSome intro.\n';
    const result = appendLesson(content, 'Add a test for the login flow');
    expect(result.added).toBe(true);
    expect(result.content).toBe('# Title\n\nSome intro.\n\n## Lessons\n- Add a test for the login flow\n');
  });

  it('creates the heading in an empty file', () => {
    const result = appendLesson('', 'First lesson');
    expect(result.added).toBe(true);
    const expected = `## Lessons\n- First lesson\n`;
    expect(result.content).toBe(expected);
    expect(result.content.startsWith(LESSONS_HEADING)).toBe(true);
  });

  it('appends under an existing ## Lessons heading', () => {
    const content = `# AGENTS.md\n\n## Lessons\n- Use the fake agent in tests.\n`;
    const result = appendLesson(content, 'Never commit secrets');
    expect(result.added).toBe(true);
    expect(result.content).toBe(
      `# AGENTS.md\n\n## Lessons\n- Use the fake agent in tests.\n- Never commit secrets\n`,
    );
  });

  it('appends before the next ## heading, not at the end of the file', () => {
    const content = `# AGENTS.md\n\n## Lessons\n- First lesson.\n\n## Other\nMore.\n`;
    const result = appendLesson(content, 'Second lesson');
    expect(result.added).toBe(true);
    expect(result.content).toBe(
      `# AGENTS.md\n\n## Lessons\n- First lesson.\n- Second lesson\n\n## Other\nMore.\n`,
    );
  });

  it('never duplicates a line already present', () => {
    const content = `# AGENTS.md\n\n## Lessons\n- Don't forget the tests.\n`;
    const result = appendLesson(content, "Don't forget the tests.");
    expect(result.added).toBe(false);
    expect(result.content).toBe(content);
  });

  it('never duplicates even across sections', () => {
    const content = `# AGENTS.md\n\n## Lessons\nOther point.\n\n## Notes\n- Add a test helper\n`;
    const result = appendLesson(content, 'Add a test helper');
    expect(result.added).toBe(false);
    expect(result.content).toBe(content);
  });
});
