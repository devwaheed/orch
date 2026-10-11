import { describe, expect, it } from 'vitest';
import { filterEngineEnv, profileFolderName, profileSlug, shareSkillsFor } from './profiles.js';

describe('profileSlug (ACC-01)', () => {
  it.each([
    ['Team', 'team'],
    ['Personal Work', 'personal-work'],
    ['Team (old)!', 'team-old'],
    ['Café 2', 'caf-2'],
    ['a_b.c/d', 'abcd'],
    ['!!!', ''],
  ])('turns %j into %j', (name, slug) => {
    expect(profileSlug(name)).toBe(slug);
  });

  it('keeps existing hyphens and does not trim', () => {
    expect(profileSlug('team-a')).toBe('team-a');
    expect(profileSlug('Team ')).toBe('team');
    expect(profileSlug(' my  team ')).toBe('my-team');
    expect(profileSlug('a & b')).toBe('a-b');
    expect(profileSlug('--x--')).toBe('x');
  });
});

describe('profileFolderName (ACC-01 duplicates)', () => {
  it('adds -2 and -3 after the first attempt', () => {
    expect(profileFolderName('claude', 'team', 1)).toBe('claude-team');
    expect(profileFolderName('claude', 'team', 2)).toBe('claude-team-2');
    expect(profileFolderName('claude', 'team', 3)).toBe('claude-team-3');
  });
});

describe('shareSkillsFor (ACC-09)', () => {
  it('reads a single boolean for every agent', () => {
    expect(shareSkillsFor(true, 'codex')).toBe(true);
    expect(shareSkillsFor(false, 'codex')).toBe(false);
  });

  it('reads a per-agent map, defaulting missing agents to on', () => {
    expect(shareSkillsFor({ codex: false }, 'codex')).toBe(false);
    expect(shareSkillsFor({ codex: false }, 'claude')).toBe(true);
  });
});

describe('filterEngineEnv', () => {
  it('keeps only ENGINE_ENV_ALLOWLIST keys', () => {
    const env = filterEngineEnv({
      CLAUDE_CONFIG_DIR: '/p/claude-team',
      PATH: '/usr/bin',
      SECRET_TOKEN: 'x',
      HOME: '/p/home',
    });
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/p/claude-team', HOME: '/p/home' });
  });
});
