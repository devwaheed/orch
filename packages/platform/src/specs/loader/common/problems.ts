/**
 * Spec load problems and error formatting per docs/specs/spec-queue.md §11.
 * Messages must match the exact locked copy from §11.
 */
import type { SpecLoadProblem } from '@orch/contracts';

/**
 * invalid_front_matter: {file}: {first schema error}. See docs/specs/templates/spec.md.
 */
export function invalidFrontMatter(file: string, firstSchemaError: string): SpecLoadProblem {
  return {
    file,
    code: 'invalid_front_matter',
    message: `${file}: ${firstSchemaError}. See docs/specs/templates/spec.md.`,
  };
}

/**
 * duplicate_id: Spec {id} is defined in both {file1} and {file2}.
 */
export function duplicateId(id: string, file1: string, file2: string): SpecLoadProblem {
  return {
    file: file2,
    code: 'duplicate_id',
    message: `Spec ${id} is defined in both ${file1} and ${file2}.`,
  };
}

/**
 * unknown_dependency: Spec {id} depends on {dep}, which doesn't exist.
 */
export function unknownDependency(id: string, dep: string, file: string): SpecLoadProblem {
  return {
    file,
    code: 'unknown_dependency',
    message: `Spec ${id} depends on ${dep}, which doesn't exist.`,
  };
}

/**
 * dependency_later_in_order: Spec {id} depends on {dep}, which comes later. Dependencies must come first.
 */
export function dependencyLaterInOrder(id: string, dep: string, file: string): SpecLoadProblem {
  return {
    file,
    code: 'dependency_later_in_order',
    message: `Spec ${id} depends on ${dep}, which comes later. Dependencies must come first.`,
  };
}

/**
 * dependency_cycle: Specs {a} → {b} → … → {a} depend on each other.
 */
export function dependencyCycle(cycle: readonly string[], file: string): SpecLoadProblem {
  return {
    file,
    code: 'dependency_cycle',
    message: `Specs ${cycle.join(' → ')} depend on each other.`,
  };
}

/**
 * scope_outside_repo: Spec {id}: scope {glob} points outside the repository.
 */
export function scopeOutsideRepo(id: string, glob: string, file: string): SpecLoadProblem {
  return {
    file,
    code: 'scope_outside_repo',
    message: `Spec ${id}: scope ${glob} points outside the repository.`,
  };
}

/**
 * Checks whether a scope glob points outside the repository root.
 * Repo-relative globs cannot be absolute, have drive letters, or traverse above root via '..'.
 */
export function isScopeOutsideRepo(glob: string): boolean {
  if (glob.startsWith('/') || glob.startsWith('\\') || glob.startsWith('~')) {
    return true;
  }
  if (/^[a-zA-Z]:[/\\]/.test(glob)) {
    return true;
  }
  if (glob.startsWith('//') || glob.startsWith('\\\\')) {
    return true;
  }
  const parts = glob.split(/[/\\]+/);
  let depth = 0;
  for (const part of parts) {
    if (part === '..') {
      depth--;
      if (depth < 0) {
        return true;
      }
    } else if (part !== '.' && part !== '') {
      depth++;
    }
  }
  return false;
}
