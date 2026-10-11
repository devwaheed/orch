import { describe, expect, it } from 'vitest';
import { formatVersion, parseVersion, satisfiesRange } from './versionRange.js';

describe('parseVersion', () => {
  it('reads the first x.y.z in tool output', () => {
    expect(parseVersion('2.0.14 (Claude Code)\n')).toEqual({ major: 2, minor: 0, patch: 14 });
    expect(parseVersion('git version 2.39.5')).toEqual({ major: 2, minor: 39, patch: 5 });
  });

  it('returns null when there is no version', () => {
    expect(parseVersion('usage: claude [options]')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('formats a version back to text', () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });
});

describe('satisfiesRange', () => {
  const v = (text: string) => parseVersion(text)!;

  it('checks a >=a.b.c <x.y.z range (the form adapters use)', () => {
    expect(satisfiesRange(v('2.0.0'), '>=2.0.0 <3.0.0')).toBe(true);
    expect(satisfiesRange(v('2.9.9'), '>=2.0.0 <3.0.0')).toBe(true);
    expect(satisfiesRange(v('1.9.9'), '>=2.0.0 <3.0.0')).toBe(false);
    expect(satisfiesRange(v('3.0.0'), '>=2.0.0 <3.0.0')).toBe(false);
  });

  it('compares patch and minor numbers, not text', () => {
    expect(satisfiesRange(v('0.150.0'), '>=0.150.0 <1.0.0')).toBe(true);
    expect(satisfiesRange(v('0.99.0'), '>=0.150.0 <1.0.0')).toBe(false);
  });

  it('understands single comparators and exact versions', () => {
    expect(satisfiesRange(v('5.0.0'), '>=4.0.0')).toBe(true);
    expect(satisfiesRange(v('4.0.0'), '>4.0.0')).toBe(false);
    expect(satisfiesRange(v('4.0.1'), '<=4.0.1')).toBe(true);
    expect(satisfiesRange(v('4.0.1'), '4.0.1')).toBe(true);
    expect(satisfiesRange(v('4.0.2'), '=4.0.1')).toBe(false);
    expect(satisfiesRange(v('4.0.0'), '<4.0.0')).toBe(false);
  });

  it('returns null for forms it does not understand, instead of guessing', () => {
    expect(satisfiesRange(v('2.0.0'), '*')).toBeNull();
    expect(satisfiesRange(v('2.0.0'), '^2.0.0')).toBeNull();
    expect(satisfiesRange(v('2.0.0'), '')).toBeNull();
    expect(satisfiesRange(v('2.0.0'), '>=2 <3')).toBeNull();
  });
});
