import { describe, expect, it } from 'vitest';
import { globMatch, globMatchAny, globToRegExp } from './glob.js';

describe('globMatch', () => {
  it('a literal pattern matches only that path', () => {
    expect(globMatch('sprint-status.yaml', 'sprint-status.yaml')).toBe(true);
    expect(globMatch('sprint-status.yaml', 'other.yaml')).toBe(false);
  });

  it('a pattern without a slash matches the file name at any depth', () => {
    expect(globMatch('tsconfig*.json', 'tsconfig.json')).toBe(true);
    expect(globMatch('tsconfig*.json', 'tsconfig.base.json')).toBe(true);
    expect(globMatch('tsconfig*.json', 'packages/app/tsconfig.json')).toBe(true);
    expect(globMatch('tsconfig*.json', 'packages/app/tsconfig.node.json')).toBe(true);
    expect(globMatch('.eslintrc*', 'packages/app/.eslintrc.cjs')).toBe(true);
  });

  it('literal dots are not wildcards', () => {
    expect(globMatch('eslint.config.*', 'eslint.config.mjs')).toBe(true);
    expect(globMatch('eslint.config.*', 'eslintXconfig.mjs')).toBe(false);
    expect(globMatch('biome.json*', 'biome.json')).toBe(true);
    expect(globMatch('biome.json*', 'biomeXjson')).toBe(false);
  });

  it('`*` does not cross a path separator', () => {
    expect(globMatch('test/*', 'test/a.ts')).toBe(true);
    expect(globMatch('test/*', 'test/nested/a.ts')).toBe(false);
  });

  it('`**` crosses path segments', () => {
    expect(globMatch('test/**', 'test/a/b/c.ts')).toBe(true);
    expect(globMatch('**/*.test.*', 'a.test.ts')).toBe(true);
    expect(globMatch('**/*.test.*', 'src/deep/a.test.ts')).toBe(true);
    expect(globMatch('**/*.test.*', 'src/deep/a.test')).toBe(false);
  });

  it('a pattern with a slash is anchored to the repo root', () => {
    expect(globMatch('test/**', 'test/a.ts')).toBe(true);
    expect(globMatch('test/**', 'packages/app/test/a.ts')).toBe(false);
    expect(globMatch('.github/workflows/**', '.github/workflows/ci.yml')).toBe(true);
    expect(globMatch('.github/workflows/**', 'x/.github/workflows/ci.yml')).toBe(false);
  });

  it('a leading `**/` matches at any depth', () => {
    expect(globMatch('**/__snapshots__/**', '__snapshots__/a.snap')).toBe(true);
    expect(globMatch('**/__snapshots__/**', 'src/__snapshots__/a.snap')).toBe(true);
    expect(globMatch('**/__screenshots__/**', 'design/tests/__screenshots__/a.png')).toBe(true);
  });

  it('`?` matches one character within a segment', () => {
    expect(globMatch('a?.ts', 'ab.ts')).toBe(true);
    expect(globMatch('a?.ts', 'a/b.ts')).toBe(false);
  });

  it('globToRegExp anchors the whole path', () => {
    expect(globToRegExp('a').test('a')).toBe(true);
    expect(globToRegExp('a').test('ab')).toBe(false);
  });

  it('globMatchAny matches when any pattern matches', () => {
    expect(globMatchAny(['**/*.test.*', 'docs/**'], 'docs/a.md')).toBe(true);
    expect(globMatchAny(['**/*.test.*', 'docs/**'], 'src/a.ts')).toBe(false);
  });
});
