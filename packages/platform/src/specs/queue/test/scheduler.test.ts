import { describe, expect, it } from 'vitest';
import type { AgentId, QueueId, SpecId, SpecQueue, SpecQueueSettings, SpecRun, SpecState, Timestamp } from '@orchagents/contracts';
import { DEFAULT_SPEC_QUEUE_SETTINGS, isDependencySatisfied, scheduleQueue } from '../common/scheduler.js';

describe('scheduler (SQ-01..SQ-07, §5)', () => {
  const makeSpec = (
    id: string,
    position: number,
    state: SpecState = 'queued',
    dependsOn: string[] = [],
    scope: string[] = ['src/**'],
  ): SpecRun => ({
    id: id as SpecId,
    queueId: 'q-test' as QueueId,
    position,
    file: `docs/specs/${id}.md`,
    spec: {
      id,
      title: `Spec ${id}`,
      depends_on: dependsOn,
      scope,
      done_when: [{ by: 'audit', text: 'audit' }],
      agent: 'auto',
    },
    state,
    attempt: null,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
    history: [],
  });

  const makeQueue = (specs: SpecRun[], overrides: Partial<SpecQueueSettings> = {}): SpecQueue => ({
    id: 'q-test' as QueueId,
    repoPath: '/repo',
    paused: false,
    createdAt: new Date().toISOString() as Timestamp,
    settings: {
      ...DEFAULT_SPEC_QUEUE_SETTINGS,
      ...overrides,
    },
    specs,
  });

  describe('isDependencySatisfied', () => {
    it('handles advance = verified', () => {
      expect(isDependencySatisfied('verified', 'verified')).toBe(true);
      expect(isDependencySatisfied('approved', 'verified')).toBe(true);
      expect(isDependencySatisfied('merged', 'verified')).toBe(true);
      expect(isDependencySatisfied('running', 'verified')).toBe(false);
      expect(isDependencySatisfied('queued', 'verified')).toBe(false);
    });

    it('handles advance = approved', () => {
      expect(isDependencySatisfied('verified', 'approved')).toBe(false);
      expect(isDependencySatisfied('approved', 'approved')).toBe(true);
      expect(isDependencySatisfied('merged', 'approved')).toBe(true);
    });

    it('handles advance = merged', () => {
      expect(isDependencySatisfied('verified', 'merged')).toBe(false);
      expect(isDependencySatisfied('approved', 'merged')).toBe(false);
      expect(isDependencySatisfied('merged', 'merged')).toBe(true);
    });
  });

  describe('scheduleQueue scenarios', () => {
    // SQ-01: Specs 1, 2 (2 depends on 1), strict | Queue starts | 1 runs; 2 stays queued
    it('SQ-01: linear DAG in strict mode starts 1 and keeps 2 queued', () => {
      const s1 = makeSpec('1', 1);
      const s2 = makeSpec('2', 2, 'queued', ['1']);
      const queue = makeQueue([s1, s2], { order: 'strict' });

      const res = scheduleQueue(queue);
      expect(res.specsToStart.map((s) => s.id)).toEqual(['1']);
      const updatedS2 = res.updatedSpecs.find((s) => s.id === '2');
      expect(updatedS2?.state).toBe('queued');
    });

    // SQ-02: SQ-01, advance = verified | 1 is verified | 2 starts without any action
    it('SQ-02: when 1 is verified, 2 starts automatically', () => {
      const s1 = makeSpec('1', 1, 'verified');
      const s2 = makeSpec('2', 2, 'queued', ['1']);
      const queue = makeQueue([s1, s2], { advance: 'verified' });

      const res = scheduleQueue(queue);
      expect(res.specsToStart.map((s) => s.id)).toEqual(['2']);
    });

    // SQ-03: SQ-01, advance = approved | 1 is verified | 2 waits until 1 is approved
    it('SQ-03: advance = approved waits until 1 is approved', () => {
      const s1 = makeSpec('1', 1, 'verified');
      const s2 = makeSpec('2', 2, 'queued', ['1']);
      const queue = makeQueue([s1, s2], { advance: 'approved' });

      const res = scheduleQueue(queue);
      expect(res.specsToStart).toHaveLength(0);

      // Once 1 is approved
      const s1Approved = { ...s1, state: 'approved' as const };
      const res2 = scheduleQueue({ ...queue, specs: [s1Approved, s2] });
      expect(res2.specsToStart.map((s) => s.id)).toEqual(['2']);
    });

    // SQ-04: SQ-01, advance = merged | 1 is approved | 2 waits until 1 is merged
    it('SQ-04: advance = merged waits until 1 is merged', () => {
      const s1 = makeSpec('1', 1, 'approved');
      const s2 = makeSpec('2', 2, 'queued', ['1']);
      const queue = makeQueue([s1, s2], { advance: 'merged' });

      const res = scheduleQueue(queue);
      expect(res.specsToStart).toHaveLength(0);

      // Once 1 is merged
      const s1Merged = { ...s1, state: 'merged' as const };
      const res2 = scheduleQueue({ ...queue, specs: [s1Merged, s2] });
      expect(res2.specsToStart.map((s) => s.id)).toEqual(['2']);
    });

    // SQ-05: Specs 3 (`src/a/**`), 4 (`test/a/**`), waves, max 2 | Queue starts | 3 and 4 run together
    it('SQ-05: disjoint specs run together in waves mode up to max_parallel', () => {
      const s3 = makeSpec('3', 1, 'queued', [], ['src/a/**']);
      const s4 = makeSpec('4', 2, 'queued', [], ['test/a/**']);
      const queue = makeQueue([s3, s4], { order: 'waves', max_parallel: 2 });

      const res = scheduleQueue(queue);
      expect(res.specsToStart.map((s) => s.id)).toEqual(['3', '4']);
    });

    // SQ-06: Specs 5 (`src/a/**`), 6 (`src/a/b.ts`), waves | Queue starts | 6 waits for 5 (overlap)
    it('SQ-06: overlapping scopes block parallel execution in waves mode', () => {
      const s5 = makeSpec('5', 1, 'queued', [], ['src/a/**']);
      const s6 = makeSpec('6', 2, 'queued', [], ['src/a/b.ts']);
      const queue = makeQueue([s5, s6], { order: 'waves', max_parallel: 2 });

      const res = scheduleQueue(queue);
      // Only 5 starts; 6 overlaps with 5 so it cannot start concurrently
      expect(res.specsToStart.map((s) => s.id)).toEqual(['5']);
    });

    // SQ-07: Spec 7 with empty scope, waves | Another spec is active | 7 does not start until it's alone
    it('SQ-07: spec with empty scope never runs alongside another spec', () => {
      const s1 = makeSpec('1', 1, 'running', [], ['src/a/**']);
      const s7 = makeSpec('7', 2, 'queued', [], []); // empty scope
      const queue = makeQueue([s1, s7], { order: 'waves', max_parallel: 2 });

      const res = scheduleQueue(queue);
      expect(res.specsToStart).toHaveLength(0);
    });

    // SQ-10: Spec 9 depends on 8; 8 needs_you | Scheduler runs | 9 blocked, blockedBy = [8]
    it('SQ-10: dependent becomes blocked when dependency is needs_you', () => {
      const s8 = makeSpec('8', 1, 'needs_you');
      const s9 = makeSpec('9', 2, 'queued', ['8']);
      const queue = makeQueue([s8, s9]);

      const res = scheduleQueue(queue);
      const s9Updated = res.updatedSpecs.find((s) => s.id === '9');
      expect(s9Updated?.state).toBe('blocked');
      expect(s9Updated?.blockedBy).toEqual(['8']);
    });

    // SQ-11: SQ-10 | You retry 8 | 9 returns to queued; 8 attempt resets
    it('SQ-11: retrying dependency unblocks dependent back to queued', () => {
      const s8Retried = makeSpec('8', 1, 'queued'); // retried
      const s9 = { ...makeSpec('9', 2, 'blocked', ['8']), blockedBy: ['8' as SpecId] };
      const queue = makeQueue([s8Retried, s9]);

      const res = scheduleQueue(queue);
      const s9Updated = res.updatedSpecs.find((s) => s.id === '9');
      expect(s9Updated?.state).toBe('queued');
      expect(s9Updated?.blockedBy).toEqual([]);
    });

    it('SQ-16: does not start new specs when queue is paused', () => {
      const s1 = makeSpec('1', 1, 'queued');
      const queue = { ...makeQueue([s1]), paused: true };

      const res = scheduleQueue(queue);
      expect(res.specsToStart).toHaveLength(0);
    });

    it('transitions to waiting_quota when agent has no room', () => {
      const s1 = makeSpec('1', 1, 'queued');
      const queue = makeQueue([s1]);

      const res = scheduleQueue(queue, {
        hasRoom: (_agent: AgentId) => {
          void _agent;
          return false;
        },
      });
      expect(res.specsToStart.map((s) => s.id)).toEqual(['1']);
      expect(res.specsToStart[0]?.state).toBe('waiting_quota');
    });
  });
});
