import type { SpecFile } from '@orch/contracts';
import { describe, expect, it } from 'vitest';
import { sortSpecsByNumericId, validateSpecs, type LoadedSpecDefinition } from './validate.js';

function makeSpec(id: string, depends_on: string[] = [], scope: string[] = []): LoadedSpecDefinition {
  const spec: SpecFile = {
    id,
    title: `Spec ${id}`,
    depends_on,
    scope,
    done_when: [{ by: 'audit', text: `Verify ${id}` }],
    agent: 'auto',
  };
  return {
    file: `docs/specs/${id.padStart(3, '0')}-spec.md`,
    spec,
  };
}

describe('validateSpecs', () => {
  it('passes on valid specs with properly ordered dependencies', () => {
    const s1 = makeSpec('1');
    const s2 = makeSpec('2', ['1']);
    const s3 = makeSpec('3', ['1', '2']);
    const problems = validateSpecs([s1, s2, s3]);
    expect(problems).toEqual([]);
  });

  it('detects duplicate_id (SQ-21)', () => {
    const s1 = makeSpec('42');
    const s2 = { ...makeSpec('42'), file: 'docs/specs/042-duplicate.md' };
    const problems = validateSpecs([s1, s2]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      file: 'docs/specs/042-duplicate.md',
      code: 'duplicate_id',
      message: 'Spec 42 is defined in both docs/specs/042-spec.md and docs/specs/042-duplicate.md.',
    });
  });

  it('detects unknown_dependency', () => {
    const s1 = makeSpec('1', ['99']);
    const problems = validateSpecs([s1]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      file: 'docs/specs/001-spec.md',
      code: 'unknown_dependency',
      message: "Spec 1 depends on 99, which doesn't exist.",
    });
  });

  it('detects dependency_later_in_order (SQ-20)', () => {
    const s1 = makeSpec('1', ['2']);
    const s2 = makeSpec('2');
    const problems = validateSpecs([s1, s2]);
    expect(problems.some((p) => p.code === 'dependency_later_in_order')).toBe(true);
    const prob = problems.find((p) => p.code === 'dependency_later_in_order');
    expect(prob).toEqual({
      file: 'docs/specs/001-spec.md',
      code: 'dependency_later_in_order',
      message: 'Spec 1 depends on 2, which comes later. Dependencies must come first.',
    });
  });

  it('detects simple 2-node dependency_cycle', () => {
    const s1 = makeSpec('1', ['2']);
    const s2 = makeSpec('2', ['1']);
    const problems = validateSpecs([s1, s2]);
    const cycleProblem = problems.find((p) => p.code === 'dependency_cycle');
    expect(cycleProblem).toBeDefined();
    expect(cycleProblem?.message).toBe('Specs 1 → 2 → 1 depend on each other.');
  });

  it('detects multi-node dependency_cycle', () => {
    const s1 = makeSpec('1', ['3']);
    const s2 = makeSpec('2', ['1']);
    const s3 = makeSpec('3', ['2']);
    const problems = validateSpecs([s1, s2, s3]);
    const cycleProblem = problems.find((p) => p.code === 'dependency_cycle');
    expect(cycleProblem).toBeDefined();
    expect(cycleProblem?.message).toBe('Specs 1 → 3 → 2 → 1 depend on each other.');
  });

  it('detects scope_outside_repo', () => {
    const s1 = makeSpec('1', [], ['../outside/**']);
    const problems = validateSpecs([s1]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toEqual({
      file: 'docs/specs/001-spec.md',
      code: 'scope_outside_repo',
      message: 'Spec 1: scope ../outside/** points outside the repository.',
    });
  });
});

describe('sortSpecsByNumericId', () => {
  it('orders specs by ascending numeric id', () => {
    const s1 = makeSpec('2');
    const s2 = makeSpec('10');
    const s3 = makeSpec('1');
    const sorted = sortSpecsByNumericId([s1, s2, s3]);
    expect(sorted.map((s) => s.spec.id)).toEqual(['1', '2', '10']);
  });
});
