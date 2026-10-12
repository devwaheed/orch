import { describe, expect, it } from 'vitest';
import type { JobMode, TrustLevel } from '@orchagents/contracts';
import {
  AUTO_MERGE_FILE_PATTERNS,
  AUTO_MERGE_MAX_CHANGED_LINES,
  autoMergeAllowed,
  matchesAutoMergePath,
  type AutoMergeInput,
} from '../common/autoMerge.js';
import { globToRegExp, matchesGlob, normalizeSlashes } from '../common/glob.js';

function input(over: Partial<AutoMergeInput> = {}): AutoMergeInput {
  return {
    level: 3,
    mode: 'single',
    specQueue: false,
    changedFiles: ['README.md'],
    changedLines: 10,
    ...over,
  };
}

describe('TRU-03 the changed files a level-3 agent may auto-merge', () => {
  it.each<{ path: string; want: boolean }>([
    { path: 'README.md', want: true },
    { path: 'CHANGELOG.md', want: true },
    { path: 'docs/setup.md', want: true },
    { path: 'docs/a/b/c.md', want: true },
    { path: 'test/helper.js', want: true },
    { path: 'tests/a/b.test.ts', want: true },
    { path: 'src/foo.test.ts', want: true },
    { path: 'src/foo.spec.tsx', want: true },
    { path: 'packages/a/src/b.spec.js', want: true },
    { path: 'README.mdx', want: false },
    { path: 'src/index.ts', want: false },
    // TRU-03 says **/*.md, which matches at any depth.
    { path: 'src/docs/readme.md', want: true },
    { path: 'contest/x.ts', want: false },
    { path: '.github/workflows/ci.yml', want: false },
    { path: 'docs', want: false },
    { path: 'src/foo.mdx', want: false },
  ])('$path', ({ path, want }) => {
    expect(matchesAutoMergePath(path)).toBe(want);
  });

  it('accepts a Windows separator', () => {
    expect(matchesAutoMergePath('docs\\setup.md')).toBe(true);
    expect(matchesAutoMergePath('src\\index.ts')).toBe(false);
    expect(normalizeSlashes('a\\b\\c.md')).toBe('a/b/c.md');
  });

  it('the allowlist is exactly the six TRU-03 patterns', () => {
    expect(AUTO_MERGE_FILE_PATTERNS).toEqual(['**/*.md', 'docs/**', 'test/**', 'tests/**', '**/*.test.*', '**/*.spec.*']);
  });
});

describe('TRU-03 auto-merge allowed and denied', () => {
  it.each<{ name: string; over: Partial<AutoMergeInput>; want: boolean }>([
    { name: 'level 3, single mode, one markdown file, 10 lines', over: {}, want: true },
    { name: 'level 2 is never enough', over: { level: 2 }, want: false },
    { name: 'level 1 is never enough', over: { level: 1 }, want: false },
    { name: 'compare mode', over: { mode: 'compare' }, want: false },
    { name: 'council mode', over: { mode: 'council' }, want: false },
    { name: 'autoloop mode', over: { mode: 'autoloop' }, want: false },
    { name: 'a job from the spec queue', over: { specQueue: true }, want: false },
    { name: 'one changed file outside the allowlist', over: { changedFiles: ['README.md', 'src/index.ts'] }, want: false },
    { name: 'a diff at 199 lines', over: { changedLines: 199 }, want: true },
    { name: 'a diff at exactly 200 lines', over: { changedLines: 200 }, want: false },
    { name: 'a diff at 201 lines', over: { changedLines: 201 }, want: false },
    { name: 'many small files, still under the line limit', over: { changedFiles: ['a.md', 'docs/b.md', 'test/c.js', 'src/d.test.ts', 'src/e.spec.ts'] }, want: true },
    { name: 'an empty allowlist is vacuous, so level and mode still decide', over: { changedFiles: [] }, want: true },
  ])('$name', ({ over, want }) => {
    expect(autoMergeAllowed(input(over))).toBe(want);
  });

  it('the line limit is 200', () => {
    expect(AUTO_MERGE_MAX_CHANGED_LINES).toBe(200);
  });
});

describe('the glob matcher', () => {
  it.each<{ pattern: string; path: string; want: boolean }>([
    { pattern: '**/*.md', path: 'a.md', want: true },
    { pattern: '**/*.md', path: 'a/b/c.md', want: true },
    { pattern: '**/*.md', path: 'a/b/c.txt', want: false },
    { pattern: 'docs/**', path: 'docs/a.md', want: true },
    { pattern: 'docs/**', path: 'docs/a/b.md', want: true },
    { pattern: 'docs/**', path: 'other/a.md', want: false },
    { pattern: '**/*.test.*', path: 'a.test.ts', want: true },
    { pattern: '**/*.test.*', path: 'a/b/c.spec.tsx', want: false },
    { pattern: '**', path: 'a/b/c', want: true },
    { pattern: 'a/*', path: 'a/b', want: true },
    { pattern: 'a/*', path: 'a/b/c', want: false },
  ])('$pattern against $path', ({ pattern, path, want }) => {
    expect(matchesGlob(path, pattern)).toBe(want);
    expect(globToRegExp(pattern).test(path)).toBe(want);
  });

  it('escapes the characters that mean something in a regular expression', () => {
    // `+` is a character in a file name, not "one or more of the one before it".
    expect(matchesGlob('a+b.md', 'a+b.md')).toBe(true);
    expect(matchesGlob('ab.md', 'a+b.md')).toBe(false);
    // `(` opens no group.
    expect(matchesGlob('a(b.md', 'a(b.md')).toBe(true);
    expect(matchesGlob('ab.md', 'a(b.md')).toBe(false);
  });

  it('* does not cross a separator', () => {
    expect(matchesGlob('a/b.md', '*.md')).toBe(false);
    expect(matchesGlob('a.md', '*.md')).toBe(true);
  });
});

describe('levels and modes the caller passes', () => {
  it.each<TrustLevel>([1, 2, 3])('level %s is only auto-merged at 3', (level) => {
    expect(autoMergeAllowed(input({ level }))).toBe(level === 3);
  });

  it.each<JobMode>(['single', 'compare', 'council', 'autoloop'])('mode %s', (mode) => {
    expect(autoMergeAllowed(input({ mode }))).toBe(mode === 'single');
  });
});
