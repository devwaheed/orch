/**
 * The Plan view's data: dependency waves, the seven status groups, stage minutes from a
 * spec's history and the affected path. Pure functions only; no services or React.
 */
import { describe, expect, it } from 'vitest';
import type { QueueId, SpecFile, SpecRun, SpecState, SpecStateChange } from '@orchagents/contracts';
import { AccountId, SpecId } from '@orchagents/contracts';
import {
  affectedPath,
  axisTicks,
  graphSpecs,
  computeWaves,
  maxWave,
  specGroup,
  stageMinutes,
  stageRows,
} from '../src/browser/contrib/specs/planView.js';

function makeSpecFile(id: string, dependsOn: string[] = []): SpecFile {
  return {
    id,
    title: `Spec ${id} title`,
    depends_on: dependsOn,
    scope: [`src/${id}/**`],
    done_when: [{ by: 'check', text: 'Tests pass', check: { kind: 'command', run: 'pnpm test' } }],
    agent: 'claude',
  };
}

function makeSpecRun(
  id: string,
  position: number,
  state: SpecState,
  options: { dependsOn?: string[]; history?: SpecStateChange[] } = {},
): SpecRun {
  return {
    id: SpecId.parse(id),
    queueId: 'q-test' as QueueId,
    position,
    file: `docs/specs/${id}-test.md`,
    spec: makeSpecFile(id, options.dependsOn ?? []),
    state,
    attempt: 1,
    jobId: null,
    worktree: null,
    implementer: { agent: 'claude', accountId: AccountId.parse('claude-work') },
    criteria: [{ index: 0, state: 'met', summary: 'Passed', auditor: null }],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
    history: options.history ?? [],
  };
}

describe('computeWaves', () => {
  it('puts a spec one wave after its deepest dependency', () => {
    const specs = [
      makeSpecRun('1', 1, 'merged'),
      makeSpecRun('2', 2, 'merged', { dependsOn: ['1'] }),
      makeSpecRun('3', 3, 'queued', { dependsOn: ['2'] }),
      makeSpecRun('4', 4, 'queued', { dependsOn: ['1'] }),
    ];

    const waves = computeWaves(specs);

    expect(waves.get('1')).toBe(1);
    expect(waves.get('2')).toBe(2);
    expect(waves.get('3')).toBe(3);
    expect(waves.get('4')).toBe(2);
    expect(maxWave(waves)).toBe(3);
  });

  it('ignores missing dependencies and survives a cycle', () => {
    const specs = [
      makeSpecRun('1', 1, 'queued', { dependsOn: ['missing'] }),
      makeSpecRun('2', 2, 'queued', { dependsOn: ['3'] }),
      makeSpecRun('3', 3, 'queued', { dependsOn: ['2'] }),
    ];

    const waves = computeWaves(specs);

    expect(waves.get('1')).toBe(1);
    expect(waves.get('2')).toBeGreaterThanOrEqual(1);
    expect(waves.get('3')).toBeGreaterThanOrEqual(1);
  });
});

describe('specGroup', () => {
  it('maps each state to the Plan group', () => {
    const merged = makeSpecRun('1', 1, 'merged');
    const running = makeSpecRun('2', 2, 'running');
    const verifying = makeSpecRun('3', 3, 'verifying');
    const auditing = makeSpecRun('4', 4, 'auditing');
    const verified = makeSpecRun('5', 5, 'verified');
    const approved = makeSpecRun('6', 6, 'approved');
    const needsYou = makeSpecRun('7', 7, 'needs_you');
    const blocked = makeSpecRun('8', 8, 'blocked');
    const waitingQuota = makeSpecRun('9', 9, 'waiting_quota');
    const skipped = makeSpecRun('10', 10, 'skipped');
    const cancelled = makeSpecRun('11', 11, 'cancelled');
    const all = [
      merged,
      running,
      verifying,
      auditing,
      verified,
      approved,
      needsYou,
      blocked,
      waitingQuota,
      skipped,
      cancelled,
    ];

    expect(specGroup(merged, all, 'merged')).toBe('shipped');
    expect(specGroup(running, all, 'merged')).toBe('coding');
    expect(specGroup(verifying, all, 'verified')).toBe('review');
    expect(specGroup(auditing, all, 'verified')).toBe('review');
    expect(specGroup(verified, all, 'verified')).toBe('review');
    expect(specGroup(approved, all, 'verified')).toBe('review');
    expect(specGroup(needsYou, all, 'verified')).toBe('waiting');
    expect(specGroup(blocked, all, 'verified')).toBe('blocked');
    expect(specGroup(waitingQuota, all, 'verified')).toBe('blocked');
    expect(specGroup(skipped, all, 'verified')).toBe('skipped');
    expect(specGroup(cancelled, all, 'verified')).toBe('skipped');
  });

  it('splits queued specs into ready and blocked by their dependencies', () => {
    const dependency = makeSpecRun('1', 1, 'merged');
    const ready = makeSpecRun('2', 2, 'queued', { dependsOn: ['1'] });
    const blocked = makeSpecRun('3', 3, 'queued', { dependsOn: ['4'] });
    const pending = makeSpecRun('4', 4, 'running');
    const all = [dependency, ready, blocked, pending];

    expect(specGroup(ready, all, 'merged')).toBe('ready');
    expect(specGroup(blocked, all, 'merged')).toBe('blocked');
  });

  it('treats verified and approved dependencies as met when advance is verified', () => {
    const verified = makeSpecRun('1', 1, 'verified');
    const approved = makeSpecRun('2', 2, 'approved');
    const readyVerified = makeSpecRun('3', 3, 'queued', { dependsOn: ['1'] });
    const readyApproved = makeSpecRun('4', 4, 'queued', { dependsOn: ['2'] });
    const notReadyWhenMerged = makeSpecRun('5', 5, 'queued', { dependsOn: ['1'] });
    const all = [verified, approved, readyVerified, readyApproved, notReadyWhenMerged];

    expect(specGroup(readyVerified, all, 'verified')).toBe('ready');
    expect(specGroup(readyApproved, all, 'verified')).toBe('ready');
    expect(specGroup(notReadyWhenMerged, all, 'merged')).toBe('blocked');
  });
});

describe('stageMinutes', () => {
  it('counts each stage until the next history entry and rounds the result', () => {
    const now = new Date('2026-10-11T10:55:00Z');
    const spec = makeSpecRun('1', 1, 'needs_you', {
      history: [
        { state: 'running', at: '2026-10-11T10:00:00Z', attempt: 1 },
        { state: 'verifying', at: '2026-10-11T10:10:00Z', attempt: 1 },
        { state: 'auditing', at: '2026-10-11T10:20:00Z', attempt: 1 },
        { state: 'needs_you', at: '2026-10-11T10:35:00Z', attempt: 1 },
      ],
    });

    expect(stageMinutes(spec, now)).toEqual({ code: 10, verify: 10, review: 15, fix: 0, merge: 0 });
  });

  it('runs the last open stage until now and marks the stage before needs_you critical', () => {
    const now = new Date('2026-10-11T11:00:00Z');
    const spec = makeSpecRun('1', 1, 'running', {
      history: [
        { state: 'running', at: '2026-10-11T10:00:00Z', attempt: 1 },
        { state: 'verifying', at: '2026-10-11T10:20:00Z', attempt: 1 },
        { state: 'needs_you', at: '2026-10-11T10:40:00Z', attempt: 1 },
        { state: 'running', at: '2026-10-11T10:50:00Z', attempt: 2 },
      ],
    });

    expect(stageMinutes(spec, now).fix).toBe(10);
    expect(stageRows(spec, now)).toEqual([
      { stage: 'code', label: 'Code', minutes: 20, tone: 'stable' },
      { stage: 'verify', label: 'Verify', minutes: 20, tone: 'critical' },
      { stage: 'review', label: 'Review', minutes: 0, tone: 'stable' },
      { stage: 'fix', label: 'Fix', minutes: 10, tone: 'warning' },
      { stage: 'merge', label: 'Merge', minutes: 0, tone: 'stable' },
    ]);
  });
});

describe('affectedPath', () => {
  it('includes the selected spec, its transitive dependencies and everything it unblocks', () => {
    const specs = [
      makeSpecRun('1', 1, 'merged'),
      makeSpecRun('2', 2, 'merged', { dependsOn: ['1'] }),
      makeSpecRun('3', 3, 'queued', { dependsOn: ['2'] }),
      makeSpecRun('4', 4, 'queued'),
    ];

    expect([...affectedPath(specs, '2')].sort()).toEqual(['1', '2', '3']);
    expect([...affectedPath(specs, '1')].sort()).toEqual(['1', '2', '3']);
    expect([...affectedPath(specs, '4')]).toEqual(['4']);
    expect([...affectedPath(specs, null)]).toEqual([]);
  });
});

describe('graphSpecs', () => {
  it('keeps shipped specs only where an open spec depends on them', () => {
    const specs = [makeSpecRun('1', 1, 'merged'), makeSpecRun('2', 2, 'merged'), makeSpecRun('3', 3, 'running', { dependsOn: ['2'] })];
    expect(graphSpecs(specs).map((s) => s.id)).toEqual(['2', '3']);
  });
});

describe('axisTicks', () => {
  it('labels the last 24 hours in local clock time, ending now', () => {
    const now = new Date(2026, 9, 27, 13, 30);
    expect(axisTicks(now).map((tick) => tick.label)).toEqual(['13:30', '17:30', '21:30', '01:30', '05:30', '09:30', '13:30']);
  });
});
