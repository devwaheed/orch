import { describe, expect, it } from 'vitest';
import type { QueueId, SpecId, SpecRun, SpecState } from '@orchagents/contracts';
import { reorderSpec } from '../common/reorder.js';

describe('reorderSpec (SQ-19, §10)', () => {
  const makeSpec = (
    id: string,
    position: number,
    state: SpecState = 'queued',
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

  it('reorders specs when dependencies are respected', () => {
    // Specs: 1, 2, 3 (independent)
    const specs = [makeSpec('1', 1), makeSpec('2', 2), makeSpec('3', 3)];
    // Move 3 to position 1 -> 3, 1, 2
    const result = reorderSpec(specs, '3' as SpecId, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((s) => s.id)).toEqual(['3', '1', '2']);
      expect(result.value.map((s) => s.position)).toEqual([1, 2, 3]);
    }
  });

  it('rejects moving an active spec (§10)', () => {
    const specs = [makeSpec('1', 1, 'running'), makeSpec('2', 2)];
    const result = reorderSpec(specs, '1' as SpecId, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.message).toBe(
        'Only queued and blocked specs can move. Spec 1 is running.',
      );
    }
  });

  it('rejects moving a spec before its dependency (§10)', () => {
    // 1 -> 2 (2 depends on 1)
    const specs = [makeSpec('1', 1), makeSpec('2', 2, 'queued', ['1']), makeSpec('3', 3)];
    // Try to move 2 before 1 (to position 1)
    const result = reorderSpec(specs, '2' as SpecId, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.message).toBe(
        "Spec 2 depends on 1, so it can't run before it.",
      );
    }
  });

  it('rejects moving a dependency after its dependent (§10)', () => {
    // 1 -> 2 (2 depends on 1)
    const specs = [makeSpec('1', 1), makeSpec('2', 2, 'queued', ['1']), makeSpec('3', 3)];
    // Try to move 1 after 2 (to position 2 or 3)
    const result = reorderSpec(specs, '1' as SpecId, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
      expect(result.error.message).toBe(
        "Spec 2 depends on 1, so 1 can't move after it.",
      );
    }
  });

  it('allows moving a dependent spec after another independent spec', () => {
    // 1, 2, 3 where 3 depends on 1
    const specs = [makeSpec('1', 1), makeSpec('2', 2), makeSpec('3', 3, 'queued', ['1'])];
    // Move 2 to position 3 (after 3) -> 1, 3, 2
    const result = reorderSpec(specs, '2' as SpecId, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((s) => s.id)).toEqual(['1', '3', '2']);
      expect(result.value.map((s) => s.position)).toEqual([1, 2, 3]);
    }
  });
});
