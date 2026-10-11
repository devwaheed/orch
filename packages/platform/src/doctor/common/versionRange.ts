/**
 * Version parsing and the tiny semver range check the doctor needs for
 * `testedVersions` (adapters use forms like ">=2.0.0 <3.0.0"). No dependency:
 * only `>=`, `>`, `<=`, `<`, `=` comparators with full x.y.z versions, joined by spaces.
 * Plain TypeScript; no Node APIs.
 */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Finds the first x.y.z in a tool's output, e.g. "2.0.14 (Claude Code)". */
export function parseVersion(text: string): Version | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const COMPARATOR = /^(>=|<=|>|<|=)?(\d+)\.(\d+)\.(\d+)$/;

/**
 * True when the version satisfies every comparator in the range.
 * Returns null when the range uses a form this check does not understand,
 * so the caller can say it could not compare instead of guessing.
 */
export function satisfiesRange(version: Version, range: string): boolean | null {
  const tokens = range.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  let all = true;
  for (const token of tokens) {
    const match = COMPARATOR.exec(token);
    if (!match) return null;
    const bound: Version = { major: Number(match[2]), minor: Number(match[3]), patch: Number(match[4]) };
    const cmp = compareVersions(version, bound);
    const op = match[1] ?? '=';
    const holds =
      op === '>=' ? cmp >= 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : op === '<' ? cmp < 0 : cmp === 0;
    all = all && holds;
  }
  return all;
}

export function formatVersion(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}
