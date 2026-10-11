/**
 * A tiny glob matcher for the patterns the guardrails use (JOB-05, JOB-06).
 * It supports `**` (any number of path segments), `*` (any characters within a
 * single segment) and `?` (one character within a segment). Every other
 * character, including `.`, is literal. Paths are repo-relative with `/`
 * separators.
 *
 * Matching follows the gitignore convention:
 * - a pattern without `/` matches the file name at any depth (`tsconfig*.json`);
 * - a pattern with `/` is relative to the repo root, except a leading double
 *   star and slash, which matches at any depth (for example, test files).
 */

function escapeRegExpChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

function compile(pattern: string): string {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] ?? '';
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExpChar(ch);
    }
  }
  return source;
}

/** Compiles one glob to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const body = compile(pattern);
  const prefix = pattern.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${prefix}${body}$`);
}

/** True when `path` matches `pattern`. */
export function globMatch(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

/** True when `path` matches any of `patterns`. */
export function globMatchAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globMatch(pattern, path));
}
