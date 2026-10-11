import { describe, expect, it } from 'vitest';
import { extractStaticPrefix, isParentOrEqual, scopesOverlap } from '../common/overlap.js';

describe('scope overlap (SQ-05, SQ-06, §5)', () => {
  describe('extractStaticPrefix (SQ-06)', () => {
    it('extracts non-wildcard directory from glob pattern', () => {
      expect(extractStaticPrefix('src/jobs/**')).toBe('src/jobs');
      expect(extractStaticPrefix('packages/contracts/src/specs.ts')).toBe('packages/contracts/src/specs.ts');
      expect(extractStaticPrefix('*')).toBe('');
      expect(extractStaticPrefix('**/*.ts')).toBe('');
      expect(extractStaticPrefix('packages/platform/src/specs/queue/')).toBe('packages/platform/src/specs/queue/');
      expect(extractStaticPrefix('src/foo/*/bar')).toBe('src/foo');
    });
  });

  describe('isParentOrEqual', () => {
    it('returns true when equal or parent', () => {
      expect(isParentOrEqual('src/auth', 'src/auth')).toBe(true);
      expect(isParentOrEqual('src/auth', 'src/auth/providers/github.ts')).toBe(true);
      expect(isParentOrEqual('', 'src/auth')).toBe(true);
      expect(isParentOrEqual('src/auth', 'test/auth')).toBe(false);
    });
  });

  describe('scopesOverlap (SQ-05, SQ-06, §5)', () => {
    it('treats empty scopes as full repo (overlaps with everything)', () => {
      expect(scopesOverlap([], [])).toBe(true);
      expect(scopesOverlap([], ['src/jobs/**'])).toBe(true);
      expect(scopesOverlap(['src/jobs/**'], [])).toBe(true);
    });

    it('identifies identical and prefix overlapping scopes', () => {
      expect(scopesOverlap(['src/jobs/**'], ['src/jobs/**'])).toBe(true);
      expect(scopesOverlap(['src/jobs/**'], ['src/jobs/sub/**'])).toBe(true);
      expect(scopesOverlap(['src/jobs/sub/**'], ['src/jobs/**'])).toBe(true);
      expect(scopesOverlap(['src/auth/**'], ['src/auth/providers/github.ts'])).toBe(true);
    });

    it('identifies disjoint scopes as non-overlapping', () => {
      expect(scopesOverlap(['src/jobs/**'], ['src/runs/**'])).toBe(false);
      expect(scopesOverlap(['src/auth/**'], ['test/auth/**'])).toBe(false);
      expect(scopesOverlap(['packages/contracts/**'], ['packages/workbench/**'])).toBe(false);
    });
  });
});
