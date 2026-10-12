import { describe, expect, it } from 'vitest';
import type { QueueId, SpecId, SpecRun, SpecState } from '@orchagents/contracts';
import { getNextSpecToMerge, isReadyToMerge } from '../node/specMerge.js';

describe('specMerge (SQ-14, SQ-17, SQ-18, §7)', () => {
  const makeSpec = (
    id: string,
    position: number,
    state: SpecState = 'approved',
    dependsOn: string[] = [],
  ): SpecRun => ({
    id: id as SpecId,
    queueId: 'q-test' as QueueId,
    position,
    file: `docs/specs/${id}.md`,
    spec: {
      id,
      title: `Spec ${id}`,
      depends_on: dependsOn,
      scope: [],
      done_when: [{ by: 'audit', text: 'audit' }],
      agent: 'auto',
    },
    state,
    attempt: 1,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
  });

  describe('isReadyToMerge & getNextSpecToMerge', () => {
    it('returns false if spec is not approved', () => {
      const s = makeSpec('1', 1, 'verified');
      expect(isReadyToMerge(s, [s])).toBe(false);
    });

    it('returns true if spec has no unmerged dependencies', () => {
      const s = makeSpec('1', 1, 'approved');
      expect(isReadyToMerge(s, [s])).toBe(true);
    });

    it('returns false if a dependency is not yet merged', () => {
      const s1 = makeSpec('1', 1, 'approved');
      const s2 = makeSpec('2', 2, 'approved', ['1']);
      expect(isReadyToMerge(s2, [s1, s2])).toBe(false);

      // Once s1 is merged
      const s1Merged = { ...s1, state: 'merged' as const };
      expect(isReadyToMerge(s2, [s1Merged, s2])).toBe(true);
    });

    it('SQ-17: 10 and 11 approved, 11 depends on 10 -> 10 merges first, then 11', () => {
      const s10 = makeSpec('10', 1, 'approved');
      const s11 = makeSpec('11', 2, 'approved', ['10']);
      const specs = [s10, s11];

      // Next to merge should be s10
      const next1 = getNextSpecToMerge(specs);
      expect(next1?.id).toBe('10');

      // After 10 merges
      const s10Merged = { ...s10, state: 'merged' as const };
      const next2 = getNextSpecToMerge([s10Merged, s11]);
      expect(next2?.id).toBe('11');
    });

    it('SQ-14: merges approved specs in position order', () => {
      const sA = makeSpec('A', 1, 'approved');
      const sB = makeSpec('B', 2, 'approved');
      // Independent specs: A comes first because position is 1
      expect(getNextSpecToMerge([sA, sB])?.id).toBe('A');
    });
  });
});
