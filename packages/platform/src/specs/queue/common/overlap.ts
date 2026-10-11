/**
 * Scope overlap calculation (docs/specs/spec-queue.md §5).
 * Pure functions: no Node built-ins.
 *
 * "Overlap (conservative): for each glob, take its static prefix (the path segments
 * before the first segment containing *, ?, [ or {). Two scopes overlap if any prefix
 * from one equals, or is a parent path of, any prefix from the other.
 * Example: src/auth/** and src/auth/providers/github.ts overlap; src/auth/** and
 * test/auth/** don't. A spec whose scope is empty never runs alongside another spec."
 */

/**
 * Extracts the static prefix before the first segment containing *, ?, [, or {.
 */
export function extractStaticPrefix(glob: string): string {
  const normalized = glob.replaceAll('\\', '/').trim();
  const segments = normalized.split('/');
  const prefixSegments: string[] = [];

  for (const seg of segments) {
    if (seg.includes('*') || seg.includes('?') || seg.includes('[') || seg.includes('{')) {
      break;
    }
    prefixSegments.push(seg);
  }

  return prefixSegments.join('/');
}

/**
 * Checks whether prefixA equals prefixB or is a parent path of prefixB.
 */
export function isParentOrEqual(prefixA: string, prefixB: string): boolean {
  if (prefixA === prefixB) {
    return true;
  }
  if (prefixA === '') {
    return true;
  }
  return prefixB.startsWith(prefixA + '/');
}

/**
 * Checks whether two scopes overlap per docs/specs/spec-queue.md §5.
 * A spec whose scope is empty never runs alongside another spec (returns true).
 */
export function scopesOverlap(scopeA: readonly string[], scopeB: readonly string[]): boolean {
  // §5: "A spec whose scope is empty never runs alongside another spec."
  if (scopeA.length === 0 || scopeB.length === 0) {
    return true;
  }

  for (const globA of scopeA) {
    const prefA = extractStaticPrefix(globA);
    for (const globB of scopeB) {
      const prefB = extractStaticPrefix(globB);
      if (isParentOrEqual(prefA, prefB) || isParentOrEqual(prefB, prefA)) {
        return true;
      }
    }
  }

  return false;
}
