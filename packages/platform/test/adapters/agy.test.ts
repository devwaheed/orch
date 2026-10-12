import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orchagents/contracts';
import { agyAdapter } from '../../src/adapters/node/agy.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/agy');

describe('AntigravityAdapter (S1-09)', () => {
  const accountId = 'agy-main' as AccountId;

  it('declares product values matching contracts and LOCKED decisions', () => {
    expect(agyAdapter.id).toBe('agy');
    expect(agyAdapter.displayName).toBe('Antigravity');
    expect(agyAdapter.command).toBe('agy');
    expect(agyAdapter.accountSetting).toBe('separate home folder');
    expect(agyAdapter.supportByOs).toEqual({
      macos: 'single',
      linux: 'parallel',
      windows: 'single',
    });
    expect(agyAdapter.testedVersions).toBe('>=1.0.0 <2.0.0');
  });

  it('accountEnv sets HOME on Linux/macOS and USERPROFILE on Windows within ENGINE_ENV_ALLOWLIST', () => {
    const linuxEnv = agyAdapter.accountEnv('/test/profile', 'linux');
    expect(linuxEnv).toEqual({ HOME: '/test/profile' });
    for (const key of Object.keys(linuxEnv)) {
      expect(ENGINE_ENV_ALLOWLIST).toContain(key);
    }

    const macEnv = agyAdapter.accountEnv('/test/profile', 'macos');
    expect(macEnv).toEqual({ HOME: '/test/profile' });
    for (const key of Object.keys(macEnv)) {
      expect(ENGINE_ENV_ALLOWLIST).toContain(key);
    }

    const winEnv = agyAdapter.accountEnv('C:\\test\\profile', 'windows');
    expect(winEnv).toEqual({ USERPROFILE: 'C:\\test\\profile' });
    for (const key of Object.keys(winEnv)) {
      expect(ENGINE_ENV_ALLOWLIST).toContain(key);
    }
  });

  it('skills folders match LOCKED ACC-09', () => {
    expect(agyAdapter.sharedSkillsDir('/home/user', 'linux')).toBe('/home/user/.gemini/antigravity/skills');
    expect(agyAdapter.sharedSkillsDir('C:\\Users\\user', 'windows')).toBe('C:\\Users\\user\\.gemini\\antigravity\\skills');
    expect(agyAdapter.profileSkillsDir('/profiles/agy-1', 'linux')).toBe('/profiles/agy-1/.gemini/antigravity/skills');
    expect(agyAdapter.profileSkillsDir('C:\\profiles\\agy-1', 'windows')).toBe('C:\\profiles\\agy-1\\.gemini\\antigravity\\skills');
  });

  it('prepareProfile creates profile directory', async () => {
    const tmpDir = path.join(os.tmpdir(), `agy-test-${Date.now()}`);
    await agyAdapter.prepareProfile(tmpDir, 'linux');
    expect(fs.existsSync(tmpDir)).toBe(true);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('loginCommand produces correct CommandSpec', () => {
    const spec = agyAdapter.loginCommand('/test/profile', 'linux');
    expect(spec.argv).toEqual(['agy']);
    expect(spec.env).toEqual({ HOME: '/test/profile' });
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, 'login.txt'), 'utf8');
    expect(fixture).toContain('Authentication successful');
  });

  it('whoAmICommand is null: the CLI has no sign-in status command (ACC-04 [SPIKE])', () => {
    expect(agyAdapter.whoAmICommand()).toBeNull();
  });

  it('parseWhoAmI parses signed-in fixture into masked email and plan', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.txt'), 'utf8');
    const result = agyAdapter.parseWhoAmI(signedInRaw);
    expect(result).toEqual({
      emailMasked: 'a•••@gmail.com',
      plan: 'Google account',
    });
  });

  it('parseWhoAmI parses signed-out fixture as null', () => {
    const signedOutRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-out.txt'), 'utf8');
    const result = agyAdapter.parseWhoAmI(signedOutRaw);
    expect(result).toBeNull();
  });

  it('parseQuotaSignal returns null on normal output lines', () => {
    const normalOutput = fs.readFileSync(path.join(FIXTURES_DIR, 'normal-output.jsonl'), 'utf8');
    for (const line of normalOutput.split('\n')) {
      if (!line.trim()) continue;
      const obs = agyAdapter.parseQuotaSignal(accountId, line);
      expect(obs).toBeNull();
    }
  });

  it('parseQuotaSignal detects limit event with reset time', () => {
    const limitRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'limit-event.json'), 'utf8');
    const obs = agyAdapter.parseQuotaSignal(accountId, limitRaw);
    expect(obs).not.toBeNull();
    expect(obs?.limited).toBe(true);
    expect(obs?.window).toBe('daily');
    expect(obs?.source).toBe('estimated');
    expect(obs?.resetsAt).toBe('2026-10-12T00:00:00.000Z');
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = agyAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });
});
