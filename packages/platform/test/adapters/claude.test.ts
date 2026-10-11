import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orch/contracts';
import { claudeAdapter } from '../../src/adapters/node/claude.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/claude');

describe('ClaudeAdapter (S1-07)', () => {
  const accountId = 'claude-personal' as AccountId;

  it('declares product values matching contracts and LOCKED decisions', () => {
    expect(claudeAdapter.id).toBe('claude');
    expect(claudeAdapter.displayName).toBe('Claude Code');
    expect(claudeAdapter.command).toBe('claude');
    expect(claudeAdapter.accountSetting).toBe('CLAUDE_CONFIG_DIR');
    expect(claudeAdapter.supportByOs).toEqual({
      macos: 'parallel',
      linux: 'parallel',
      windows: 'parallel',
    });
    expect(claudeAdapter.testedVersions).toBe('>=2.0.0 <3.0.0');
  });

  it('accountEnv sets CLAUDE_CONFIG_DIR and stays within ENGINE_ENV_ALLOWLIST', () => {
    for (const platform of ['macos', 'linux', 'windows'] as const) {
      const env = claudeAdapter.accountEnv('/test/profile', platform);
      expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/test/profile' });
      for (const key of Object.keys(env)) {
        expect(ENGINE_ENV_ALLOWLIST).toContain(key);
      }
    }
  });

  it('skills folders match LOCKED ACC-09', () => {
    expect(claudeAdapter.sharedSkillsDir('/home/user', 'linux')).toBe('/home/user/.claude/skills');
    expect(claudeAdapter.sharedSkillsDir('C:\\Users\\user', 'windows')).toBe('C:\\Users\\user\\.claude\\skills');
    expect(claudeAdapter.profileSkillsDir('/profiles/claude-1', 'linux')).toBe('/profiles/claude-1/skills');
    expect(claudeAdapter.profileSkillsDir('C:\\profiles\\claude-1', 'windows')).toBe('C:\\profiles\\claude-1\\skills');
  });

  it('prepareProfile creates the profile directory', async () => {
    const tmpDir = path.join(os.tmpdir(), `claude-test-${Date.now()}`);
    await claudeAdapter.prepareProfile(tmpDir, 'linux');
    expect(fs.existsSync(tmpDir)).toBe(true);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('loginCommand produces correct CommandSpec', () => {
    const spec = claudeAdapter.loginCommand('/test/profile', 'linux');
    expect(spec.argv).toEqual(['claude', 'auth', 'login']);
    expect(spec.env).toEqual({ CLAUDE_CONFIG_DIR: '/test/profile' });
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, 'login.txt'), 'utf8');
    expect(fixture).toContain('Visit this URL to authenticate');
  });

  it('whoAmICommand produces correct CommandSpec', () => {
    const spec = claudeAdapter.whoAmICommand('/test/profile', 'linux');
    expect(spec).not.toBeNull();
    expect(spec?.argv).toEqual(['claude', 'auth', 'status', '--json']);
    expect(spec?.env).toEqual({ CLAUDE_CONFIG_DIR: '/test/profile' });
  });

  it('parseWhoAmI parses signed-in fixture into masked email and plan', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.json'), 'utf8');
    const result = claudeAdapter.parseWhoAmI(signedInRaw);
    expect(result).toEqual({
      emailMasked: 'a•••@acme.dev',
      plan: 'Pro',
    });
  });

  it('parseWhoAmI parses signed-out fixture as null', () => {
    const signedOutRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-out.json'), 'utf8');
    const result = claudeAdapter.parseWhoAmI(signedOutRaw);
    expect(result).toBeNull();
  });

  it('parseQuotaSignal returns null on normal output lines', () => {
    const normalOutput = fs.readFileSync(path.join(FIXTURES_DIR, 'normal-output.jsonl'), 'utf8');
    for (const line of normalOutput.split('\n')) {
      if (!line.trim()) continue;
      const obs = claudeAdapter.parseQuotaSignal(accountId, line);
      expect(obs).toBeNull();
    }
  });

  it('parseQuotaSignal detects limit event with reset time', () => {
    const limitRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'limit-event.json'), 'utf8');
    const obs = claudeAdapter.parseQuotaSignal(accountId, limitRaw);
    expect(obs).not.toBeNull();
    expect(obs?.limited).toBe(true);
    expect(obs?.window).toBe('5h');
    expect(obs?.source).toBe('reported');
    expect(obs?.resetsAt).toBe('2026-10-11T17:30:00.000Z');
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = claudeAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });
});
