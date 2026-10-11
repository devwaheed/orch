import { describe, expect, it } from 'vitest';
import { runWorktreePath } from './worktreePath.js';

describe('runWorktreePath (JOB-02)', () => {
  it('joins with / for POSIX repo paths', () => {
    expect(runWorktreePath('/Users/me/api-server', 'r-04')).toBe('/Users/me/api-server/.orch/wt/r-04');
  });

  it('joins with \\ when the repo path uses backslashes', () => {
    expect(runWorktreePath('C:\\work\\api-server', 'r-04')).toBe('C:\\work\\api-server\\.orch\\wt\\r-04');
  });

  it('drops trailing separators on the repo path', () => {
    expect(runWorktreePath('/repo/', 'r-1')).toBe('/repo/.orch/wt/r-1');
    expect(runWorktreePath('C:\\repo\\', 'r-1')).toBe('C:\\repo\\.orch\\wt\\r-1');
  });
});
