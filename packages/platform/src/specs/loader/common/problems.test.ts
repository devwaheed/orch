import { describe, expect, it } from 'vitest';
import {
  dependencyCycle,
  dependencyLaterInOrder,
  duplicateId,
  invalidFrontMatter,
  isScopeOutsideRepo,
  scopeOutsideRepo,
  unknownDependency,
} from './problems.js';

describe('Spec load problems (spec-queue.md §11 exact copy)', () => {
  it('formats invalid_front_matter matching template', () => {
    const p = invalidFrontMatter('docs/specs/042-callback.md', 'id: Required');
    expect(p.code).toBe('invalid_front_matter');
    expect(p.file).toBe('docs/specs/042-callback.md');
    expect(p.message).toBe('docs/specs/042-callback.md: id: Required. See docs/specs/templates/spec.md.');
  });

  it('formats duplicate_id matching template', () => {
    const p = duplicateId('42', 'docs/specs/042-a.md', 'docs/specs/042-b.md');
    expect(p.code).toBe('duplicate_id');
    expect(p.file).toBe('docs/specs/042-b.md');
    expect(p.message).toBe('Spec 42 is defined in both docs/specs/042-a.md and docs/specs/042-b.md.');
  });

  it('formats unknown_dependency matching template', () => {
    const p = unknownDependency('42', '99', 'docs/specs/042-callback.md');
    expect(p.code).toBe('unknown_dependency');
    expect(p.file).toBe('docs/specs/042-callback.md');
    expect(p.message).toBe("Spec 42 depends on 99, which doesn't exist.");
  });

  it('formats dependency_later_in_order matching template', () => {
    const p = dependencyLaterInOrder('41', '42', 'docs/specs/041-earlier.md');
    expect(p.code).toBe('dependency_later_in_order');
    expect(p.file).toBe('docs/specs/041-earlier.md');
    expect(p.message).toBe('Spec 41 depends on 42, which comes later. Dependencies must come first.');
  });

  it('formats dependency_cycle matching template with arrow', () => {
    const p = dependencyCycle(['1', '2', '3', '1'], 'docs/specs/001-a.md');
    expect(p.code).toBe('dependency_cycle');
    expect(p.file).toBe('docs/specs/001-a.md');
    expect(p.message).toBe('Specs 1 → 2 → 3 → 1 depend on each other.');
  });

  it('formats scope_outside_repo matching template', () => {
    const p = scopeOutsideRepo('42', '../outside/**', 'docs/specs/042-callback.md');
    expect(p.code).toBe('scope_outside_repo');
    expect(p.file).toBe('docs/specs/042-callback.md');
    expect(p.message).toBe('Spec 42: scope ../outside/** points outside the repository.');
  });
});

describe('isScopeOutsideRepo', () => {
  it('allows repo-relative paths', () => {
    expect(isScopeOutsideRepo('src/**')).toBe(false);
    expect(isScopeOutsideRepo('packages/contracts/src/common/**')).toBe(false);
    expect(isScopeOutsideRepo('test/auth/callback.test.ts')).toBe(false);
    expect(isScopeOutsideRepo('./src/**')).toBe(false);
  });

  it('detects parent directory traversal', () => {
    expect(isScopeOutsideRepo('../outside/**')).toBe(true);
    expect(isScopeOutsideRepo('a/../../b')).toBe(true);
    expect(isScopeOutsideRepo('..')).toBe(true);
  });

  it('detects absolute paths and drive letters', () => {
    expect(isScopeOutsideRepo('/etc/passwd')).toBe(true);
    expect(isScopeOutsideRepo('\\Windows\\system32')).toBe(true);
    expect(isScopeOutsideRepo('C:/Users/foo')).toBe(true);
    expect(isScopeOutsideRepo('D:\\workspace')).toBe(true);
    expect(isScopeOutsideRepo('//server/share/file')).toBe(true);
    expect(isScopeOutsideRepo('~/home')).toBe(true);
  });
});
