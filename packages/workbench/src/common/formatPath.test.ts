import { describe, expect, it } from 'vitest';
import { formatProjectPath } from './formatPath.js';

describe('formatProjectPath', () => {
  it('replaces exact home directory with ~', () => {
    expect(formatProjectPath('/Users/me', '/Users/me')).toBe('~');
    expect(formatProjectPath('C:\\Users\\me', 'C:\\Users\\me')).toBe('~');
  });

  it('replaces home prefix with ~ for POSIX paths', () => {
    expect(formatProjectPath('/Users/me/code/api-server', '/Users/me')).toBe('~/code/api-server');
    expect(formatProjectPath('/Users/me/code', '/Users/me/')).toBe('~/code');
  });

  it('replaces home prefix with ~ for Windows paths (preserving \\ separator)', () => {
    expect(formatProjectPath('C:\\Users\\me\\code\\api-server', 'C:\\Users\\me')).toBe('~\\code\\api-server');
    expect(formatProjectPath('C:\\Users\\me\\code', 'C:\\Users\\me\\')).toBe('~\\code');
    expect(formatProjectPath('c:\\users\\me\\code', 'C:\\Users\\me')).toBe('~\\code');
  });

  it('does not replace a mere prefix that is not a child directory', () => {
    expect(formatProjectPath('/Users/me2/code', '/Users/me')).toBe('/Users/me2/code');
    expect(formatProjectPath('C:\\Users\\me2\\code', 'C:\\Users\\me')).toBe('C:\\Users\\me2\\code');
  });

  it('leaves paths outside home unchanged', () => {
    expect(formatProjectPath('/var/log/syslog', '/Users/me')).toBe('/var/log/syslog');
    expect(formatProjectPath('D:\\other\\code', 'C:\\Users\\me')).toBe('D:\\other\\code');
  });

  it('handles empty path or home gracefully', () => {
    expect(formatProjectPath('', '/Users/me')).toBe('');
    expect(formatProjectPath('/Users/me/code', '')).toBe('/Users/me/code');
  });
});
