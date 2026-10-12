import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orchagents/contracts';
import { opencodeAdapter } from '../../src/adapters/node/opencode.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/opencode');

describe('OpenCodeAdapter (S1-09)', () => {
  const accountId = 'opencode-main' as AccountId;

  it('declares product values matching contracts and LOCKED decisions', () => {
    expect(opencodeAdapter.id).toBe('opencode');
    expect(opencodeAdapter.displayName).toBe('OpenCode');
    expect(opencodeAdapter.command).toBe('opencode');
    expect(opencodeAdapter.accountSetting).toBe('XDG_DATA_HOME + OPENCODE_CONFIG_DIR');
    expect(opencodeAdapter.supportByOs).toEqual({
      macos: 'parallel',
      linux: 'parallel',
      windows: 'unverified',
    });
    expect(opencodeAdapter.testedVersions).toBe('>=1.0.0 <2.0.0');
  });

  it('accountEnv sets XDG_DATA_HOME and OPENCODE_CONFIG_DIR within ENGINE_ENV_ALLOWLIST', () => {
    const linuxEnv = opencodeAdapter.accountEnv('/test/profile', 'linux');
    expect(linuxEnv).toEqual({
      XDG_DATA_HOME: '/test/profile',
      OPENCODE_CONFIG_DIR: '/test/profile/config',
    });
    for (const key of Object.keys(linuxEnv)) {
      expect(ENGINE_ENV_ALLOWLIST).toContain(key);
    }

    const winEnv = opencodeAdapter.accountEnv('C:\\test\\profile', 'windows');
    expect(winEnv).toEqual({
      XDG_DATA_HOME: 'C:\\test\\profile',
      OPENCODE_CONFIG_DIR: 'C:\\test\\profile\\config',
    });
    for (const key of Object.keys(winEnv)) {
      expect(ENGINE_ENV_ALLOWLIST).toContain(key);
    }
  });

  it('skills folders match LOCKED ACC-09', () => {
    expect(opencodeAdapter.sharedSkillsDir('/home/user', 'linux')).toBe('/home/user/.config/opencode/skills');
    expect(opencodeAdapter.sharedSkillsDir('C:\\Users\\user', 'windows')).toBe('C:\\Users\\user\\.config\\opencode\\skills');
    expect(opencodeAdapter.profileSkillsDir('/profiles/opencode-1', 'linux')).toBe('/profiles/opencode-1/config/skills');
    expect(opencodeAdapter.profileSkillsDir('C:\\profiles\\opencode-1', 'windows')).toBe('C:\\profiles\\opencode-1\\config\\skills');
  });

  it('prepareProfile creates profile and config directories', async () => {
    const tmpDir = path.join(os.tmpdir(), `opencode-test-${Date.now()}`);
    await opencodeAdapter.prepareProfile(tmpDir, 'linux');
    expect(fs.existsSync(tmpDir)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'config'))).toBe(true);
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('loginCommand produces correct CommandSpec', () => {
    const spec = opencodeAdapter.loginCommand('/test/profile', 'linux');
    expect(spec.argv).toEqual(['opencode', 'auth', 'login']);
    expect(spec.env).toEqual({
      XDG_DATA_HOME: '/test/profile',
      OPENCODE_CONFIG_DIR: '/test/profile/config',
    });
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, 'login.txt'), 'utf8');
    expect(fixture).toContain('Successfully authenticated with GitHub Copilot');
  });

  it('whoAmICommand produces correct CommandSpec', () => {
    const spec = opencodeAdapter.whoAmICommand('/test/profile', 'linux');
    expect(spec).not.toBeNull();
    expect(spec?.argv).toEqual(['opencode', 'auth', 'list']);
    expect(spec?.env).toEqual({
      XDG_DATA_HOME: '/test/profile',
      OPENCODE_CONFIG_DIR: '/test/profile/config',
    });
  });

  it('parseWhoAmI parses signed-in fixture into masked email and plan', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.txt'), 'utf8');
    const result = opencodeAdapter.parseWhoAmI(signedInRaw);
    expect(result).toEqual({
      emailMasked: 'a•••@acme.dev',
      plan: '2 provider logins',
    });
  });

  it('parseWhoAmI treats a successful zero-credential list as signed in with unknown identity', () => {
    const output = '┌  Credentials /tmp/x/data/opencode/auth.json\n│\n└  0 credentials\n';
    expect(opencodeAdapter.parseWhoAmI(output)).toEqual({});
  });

  it('parseProviders lists each provider login from the auth list output (ACC-10)', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.txt'), 'utf8');
    expect(opencodeAdapter.parseProviders(signedInRaw)).toEqual([
      { provider: 'GitHub Copilot', kind: 'subscription' },
      { provider: 'OpenAI', kind: 'api_key' },
    ]);
  });

  it('parseProviders reads the real CLI output: ANSI colours and the "api" / "oauth" kinds (ACC-10)', () => {
    const real = '●  OpenCode Zen \u001b[90mapi\u001b[0m\n●  Anthropic (a•••@acme.dev) \u001b[90moauth\u001b[0m\n';
    expect(opencodeAdapter.parseProviders(real)).toEqual([
      { provider: 'OpenCode Zen', kind: 'api_key' },
      { provider: 'Anthropic', kind: 'subscription' },
    ]);
  });

  it('parseProviders returns no logins for the signed-out output', () => {
    const output = '┌  Credentials /tmp/x/data/opencode/auth.json\n│\n└  0 credentials\n';
    expect(opencodeAdapter.parseProviders(output)).toEqual([]);
  });

  it('parseQuotaSignal returns null on normal output lines', () => {
    const normalOutput = fs.readFileSync(path.join(FIXTURES_DIR, 'normal-output.jsonl'), 'utf8');
    for (const line of normalOutput.split('\n')) {
      if (!line.trim()) continue;
      const obs = opencodeAdapter.parseQuotaSignal(accountId, line);
      expect(obs).toBeNull();
    }
  });

  it('parseQuotaSignal detects limit event with reset time', () => {
    const limitRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'limit-event.json'), 'utf8');
    const obs = opencodeAdapter.parseQuotaSignal(accountId, limitRaw);
    expect(obs).not.toBeNull();
    expect(obs?.limited).toBe(true);
    expect(obs?.window).toBe('monthly');
    expect(obs?.source).toBe('reported');
    expect(obs?.resetsAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = opencodeAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });
});
