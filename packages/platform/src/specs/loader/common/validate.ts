/**
 * Validation logic for loaded spec files (duplicate IDs, ordering, scopes, dependencies, cycles).
 * Pure TypeScript (no Node built-ins).
 */
import type { SpecFile, SpecLoadProblem } from '@orchagents/contracts';
import {
  dependencyCycle,
  dependencyLaterInOrder,
  duplicateId,
  isScopeOutsideRepo,
  scopeOutsideRepo,
  unknownDependency,
} from './problems.js';

export interface LoadedSpecDefinition {
  readonly file: string;
  readonly spec: SpecFile;
}

/**
 * Validates a collection of loaded specs and returns all detected problems.
 */
export function validateSpecs(specs: readonly LoadedSpecDefinition[]): SpecLoadProblem[] {
  const problems: SpecLoadProblem[] = [];

  // 1. Check duplicate IDs
  const idToFile = new Map<string, string>();
  for (const item of specs) {
    const existingFile = idToFile.get(item.spec.id);
    if (existingFile !== undefined) {
      problems.push(duplicateId(item.spec.id, existingFile, item.file));
    } else {
      idToFile.set(item.spec.id, item.file);
    }
  }

  // 2. Check scopes outside repo
  for (const item of specs) {
    for (const glob of item.spec.scope) {
      if (isScopeOutsideRepo(glob)) {
        problems.push(scopeOutsideRepo(item.spec.id, glob, item.file));
      }
    }
  }

  // 3. Check dependencies (unknown or later in order)
  const knownIds = new Set(specs.map((s) => s.spec.id));
  for (const item of specs) {
    const currentId = item.spec.id;
    const currentNum = Number(currentId);

    for (const dep of item.spec.depends_on) {
      if (!knownIds.has(dep)) {
        problems.push(unknownDependency(currentId, dep, item.file));
      } else if (Number(dep) > currentNum) {
        // Dependencies must come first (smaller id / earlier in numeric order)
        problems.push(dependencyLaterInOrder(currentId, dep, item.file));
      }
    }
  }

  // 4. Check dependency cycles
  const cycles = findDependencyCycles(specs, knownIds);
  const specByFirstId = new Map<string, LoadedSpecDefinition>();
  for (const s of specs) {
    if (!specByFirstId.has(s.spec.id)) {
      specByFirstId.set(s.spec.id, s);
    }
  }

  for (const cycle of cycles) {
    const startId = cycle[0];
    const firstSpec = (startId ? specByFirstId.get(startId) : undefined) ?? specs[0];
    if (firstSpec) {
      problems.push(dependencyCycle(cycle, firstSpec.file));
    }
  }

  return problems;
}

/**
 * Finds all elementary cycles in the dependency graph.
 * Canonicalizes each cycle starting from the minimum numeric ID.
 */
export function findDependencyCycles(
  specs: readonly LoadedSpecDefinition[],
  knownIds: ReadonlySet<string>,
): string[][] {
  const adj = new Map<string, string[]>();
  for (const s of specs) {
    if (!adj.has(s.spec.id)) {
      adj.set(s.spec.id, []);
    }
    for (const dep of s.spec.depends_on) {
      if (knownIds.has(dep)) {
        adj.get(s.spec.id)!.push(dep);
      }
    }
  }

  const foundCycles: string[][] = [];
  const seenSignatures = new Set<string>();

  // Sort node IDs numerically
  const allNodeIds = Array.from(adj.keys()).sort((a, b) => Number(a) - Number(b));

  for (const start of allNodeIds) {
    const startNum = Number(start);
    const path: string[] = [start];
    const inPath = new Set<string>([start]);

    function dfs(current: string) {
      const neighbors = adj.get(current) ?? [];
      for (const next of neighbors) {
        if (next === start) {
          // Cycle completed
          const cycle = [...path, start];
          const sig = cycle.join('->');
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            foundCycles.push(cycle);
          }
        } else if (!inPath.has(next) && Number(next) >= startNum) {
          inPath.add(next);
          path.push(next);
          dfs(next);
          path.pop();
          inPath.delete(next);
        }
      }
    }

    dfs(start);
  }

  return foundCycles;
}

/**
 * Sorts specs in ascending numeric id order (docs/specs/spec-queue.md §2).
 */
export function sortSpecsByNumericId<T extends { readonly spec: SpecFile; readonly file: string }>(
  specs: readonly T[],
): T[] {
  return [...specs].sort((a, b) => {
    const diff = Number(a.spec.id) - Number(b.spec.id);
    if (diff !== 0) {
      return diff;
    }
    return a.file.localeCompare(b.file);
  });
}
