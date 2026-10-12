/**
 * Reordering logic for specs (docs/specs/spec-queue.md §10).
 * Pure functions: no Node built-ins.
 *
 * "Only queued and blocked specs can move. A spec can't move before any spec it depends on,
 * and can't move after any spec that depends on it. Moving a spec never moves other specs.
 * Invalid moves are rejected with conflict and the message
 * 'Spec {id} depends on {dep}, so it can't run before it.'
 * (or 'Spec {dep} depends on {id}, so {id} can't move after it.')."
 */
import { err, ok } from '@orchagents/base';
import type { Result, SpecId, SpecRun } from '@orchagents/contracts';

/**
 * Builds a map from spec ID to all its dependencies (direct and indirect).
 */
export function buildDependencyGraph(specs: readonly SpecRun[]): Map<SpecId, Set<SpecId>> {
  const direct = new Map<SpecId, readonly SpecId[]>();
  for (const s of specs) {
    direct.set(s.id, s.spec.depends_on as SpecId[]);
  }

  const all = new Map<SpecId, Set<SpecId>>();

  function resolveDeps(id: SpecId, visited: Set<SpecId>): Set<SpecId> {
    const existing = all.get(id);
    if (existing) {
      return existing;
    }
    const deps = new Set<SpecId>();
    visited.add(id);
    for (const dep of direct.get(id) ?? []) {
      deps.add(dep);
      if (!visited.has(dep)) {
        for (const trans of resolveDeps(dep, visited)) {
          deps.add(trans);
        }
      }
    }
    visited.delete(id);
    all.set(id, deps);
    return deps;
  }

  for (const s of specs) {
    resolveDeps(s.id, new Set<SpecId>());
  }

  return all;
}

/**
 * Validates moving `specId` to `toPosition` (1-indexed).
 * If valid, returns the new reordered array of SpecRun objects with updated `position` numbers.
 */
export function reorderSpec(
  specs: readonly SpecRun[],
  specId: SpecId,
  toPosition: number,
): Result<SpecRun[]> {
  const currentIdx = specs.findIndex((s) => s.id === specId);
  if (currentIdx === -1) {
    return err({
      code: 'not_found',
      message: `Spec ${specId} not found in queue.`,
      fix: 'Verify the spec ID exists in the queue.',
    });
  }

  const spec = specs[currentIdx]!;
  if (spec.state !== 'queued' && spec.state !== 'blocked') {
    return err({
      code: 'conflict',
      message: `Only queued and blocked specs can move. Spec ${specId} is ${spec.state}.`,
      fix: 'Wait until the spec is queued or blocked before moving it.',
    });
  }

  if (toPosition < 1 || toPosition > specs.length) {
    return err({
      code: 'validation_failed',
      message: `Invalid position ${toPosition}. Must be between 1 and ${specs.length}.`,
      fix: `Choose a position between 1 and ${specs.length}.`,
    });
  }

  // Target index (0-indexed)
  const targetIdx = toPosition - 1;
  if (targetIdx === currentIdx) {
    return ok([...specs]);
  }

  // Create new list by moving the spec
  const nextList = [...specs];
  nextList.splice(currentIdx, 1);
  nextList.splice(targetIdx, 0, spec);

  const depGraph = buildDependencyGraph(specs);
  const specDeps = depGraph.get(specId) ?? new Set<SpecId>();

  // In the new list, check if specId appears before any spec it depends on
  for (let i = 0; i < nextList.length; i++) {
    const candidate = nextList[i]!;
    if (candidate.id === specId) {
      continue;
    }

    if (specDeps.has(candidate.id)) {
      // candidate is a dependency of specId. candidate must come before specId (i < targetIdx).
      if (targetIdx < i) {
        return err({
          code: 'conflict',
          message: `Spec ${specId} depends on ${candidate.id}, so it can't run before it.`,
          fix: 'Move dependencies before the dependent spec.',
        });
      }
    }

    const candidateDeps = depGraph.get(candidate.id) ?? new Set<SpecId>();
    if (candidateDeps.has(specId)) {
      // candidate depends on specId. specId must come before candidate (targetIdx < i).
      if (targetIdx > i) {
        return err({
          code: 'conflict',
          message: `Spec ${candidate.id} depends on ${specId}, so ${specId} can't move after it.`,
          fix: 'Move dependent specs after the dependency.',
        });
      }
    }
  }

  // Update position attributes
  const updatedSpecs = nextList.map((item, index) => ({
    ...item,
    position: index + 1,
  }));

  return ok(updatedSpecs);
}
