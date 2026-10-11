/**
 * A tiny glob matcher, just enough for the TRU-03 auto-merge allowlist: `**`
 * matches any number of whole path segments and `*` matches any characters
 * except a separator. Patterns are anchored at both ends, so `docs/**` matches
 * `docs/x.md` but not `src/docs/x.md`. No new dependency.
 */

/** Windows paths use `\`; the allowlist is written with `/`. */
export function normalizeSlashes(path: string): string {
  return path.replaceAll('\\', '/');
}

const GLOB_SPECIAL = /[.*+?^${}()|[\]\\]/;

function escapeChar(char: string): string {
  return GLOB_SPECIAL.test(char) ? `\\${char}` : char;
}

/** Compiles one glob pattern into an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === undefined) {
      break;
    }
    if (char !== '*') {
      source += char === '/' ? '/' : escapeChar(char);
      index += 1;
      continue;
    }
    if (pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        // `**/` also matches no directory at all, as in git.
        source += '(?:[^/]+/)*';
        index += 3;
      } else {
        // A trailing `**` matches everything below it.
        source += '.*';
        index += 2;
      }
      continue;
    }
    // `*` never crosses a separator.
    source += '[^/]*';
    index += 1;
  }
  return new RegExp(`^${source}$`);
}

/** True when `path` matches `pattern`, with either separator. */
export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizeSlashes(path));
}
