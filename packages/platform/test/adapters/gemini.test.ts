import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orchagents/contracts';
import { geminiAdapter } from '../../src/adapters/node/gemini.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/gemini');

describe('GeminiAdapter (S1-09)', () => {
  const accountId = 'gemini-google' as AccountId;

  it('declares product values matching contracts and LOCKED decisions', () => {
    expect(geminiAdapter.id).toBe('gemini');
    expect(geminiAdapter.displayName).toBe('Gemini CLI');
    expect(geminiAdapter.command).toBe('gemini');
    expect(geminiAdapter.accountSetting).toBe('GEMINI_CLI_HOME');
    expect(geminiAdapter.supportByOs).toEqual({
      macos: 'parallel',
      linux: 'parallel',
      windows: 'parallel',
    });
    expect(geminiAdapter.testedVersions).toBe('>=0.40.0 <1.0.0');
  });

  it('accountEnv sets GEMINI_CLI_HOME and stays within ENGINE_ENV_ALLOWLIST', () => {
    for (const platform of ['macos', 'linux', 'windows'] as const) {
      const env = geminiAdapter.accountEnv('/test/profile', platform);
      expect(env).toEqual({ GEMINI_CLI_HOME: '/test/profile' });
      for (const key of Object.keys(env)) {
        expect(ENGINE_ENV_ALLOWLIST).toContain(key);
      }
    }
  });

  it('skills folders match LOCKED ACC-09', () => {
    expect(geminiAdapter.sharedSkillsDir('/home/user', 'linux')).toBe('/home/user/.gemini/skills');
    expect(geminiAdapter.sharedSkillsDir('C:\\Users\\user', 'windows')).toBe('C:\\Users\\user\\.gemini\\skills');
    expect(geminiAdapter.profileSkillsDir('/profiles/gemini-1', 'linux')).toBe('/profiles/gemini-1/skills');
    expect(geminiAdapter.profileSkillsDir('C:\\profiles\\gemini-1', 'windows')).toBe('C:\\profiles\\gemini-1\\skills');
  });

  it('prepareProfile creates the profile directory', async () => {
    const tmpDir = path.join(os.tmpdir(), `gemini-test-${Date.now()}`);
    await geminiAdapter.prepareProfile(tmpDir, 'linux');
    expect(fs.existsSync(tmpDir)).toBe(true);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('loginCommand produces correct CommandSpec', () => {
    const spec = geminiAdapter.loginCommand('/test/profile', 'linux');
    expect(spec.argv).toEqual(['gemini']);
    expect(spec.env).toEqual({ GEMINI_CLI_HOME: '/test/profile' });
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, 'login.txt'), 'utf8');
    expect(fixture).toContain('Authentication complete');
  });

  it('whoAmICommand is null: the CLI has no sign-in status command (ACC-04 [SPIKE])', () => {
    expect(geminiAdapter.whoAmICommand()).toBeNull();
  });

  it('parseWhoAmI parses signed-in fixture into masked email and plan', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.txt'), 'utf8');
    const result = geminiAdapter.parseWhoAmI(signedInRaw);
    expect(result).toEqual({
      emailMasked: 'a•••@gmail.com',
      plan: 'Free tier',
    });
  });

  it('parseWhoAmI parses signed-out fixture as null', () => {
    const signedOutRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-out.txt'), 'utf8');
    const result = geminiAdapter.parseWhoAmI(signedOutRaw);
    expect(result).toBeNull();
  });

  it('parseQuotaSignal returns null on normal output lines', () => {
    const normalOutput = fs.readFileSync(path.join(FIXTURES_DIR, 'normal-output.jsonl'), 'utf8');
    for (const line of normalOutput.split('\n')) {
      if (!line.trim()) continue;
      const obs = geminiAdapter.parseQuotaSignal(accountId, line);
      expect(obs).toBeNull();
    }
  });

  it('parseQuotaSignal detects limit event with reset time', () => {
    const limitRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'limit-event.json'), 'utf8');
    const obs = geminiAdapter.parseQuotaSignal(accountId, limitRaw);
    expect(obs).not.toBeNull();
    expect(obs?.limited).toBe(true);
    expect(obs?.window).toBe('daily');
    expect(obs?.source).toBe('estimated');
    expect(obs?.resetsAt).toBe('2026-10-12T00:00:00.000Z');
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = geminiAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });
});
