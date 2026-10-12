import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orchagents/contracts';
import { codexAdapter } from '../../src/adapters/node/codex.js';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/codex');

describe('CodexAdapter (S1-08)', () => {
  const accountId = 'codex-team' as AccountId;

  it('declares product values matching contracts and LOCKED decisions', () => {
    expect(codexAdapter.id).toBe('codex');
    expect(codexAdapter.displayName).toBe('Codex');
    expect(codexAdapter.command).toBe('codex');
    expect(codexAdapter.accountSetting).toBe('CODEX_HOME');
    expect(codexAdapter.supportByOs).toEqual({
      macos: 'parallel',
      linux: 'parallel',
      windows: 'parallel',
    });
    expect(codexAdapter.testedVersions).toBe('>=0.150.0 <1.0.0');
  });

  it('accountEnv sets CODEX_HOME and stays within ENGINE_ENV_ALLOWLIST', () => {
    for (const platform of ['macos', 'linux', 'windows'] as const) {
      const env = codexAdapter.accountEnv('/test/profile', platform);
      expect(env).toEqual({ CODEX_HOME: '/test/profile' });
      for (const key of Object.keys(env)) {
        expect(ENGINE_ENV_ALLOWLIST).toContain(key);
      }
    }
  });

  it('skills folders match LOCKED ACC-09', () => {
    expect(codexAdapter.sharedSkillsDir('/home/user', 'linux')).toBe('/home/user/.codex/skills');
    expect(codexAdapter.sharedSkillsDir('C:\\Users\\user', 'windows')).toBe('C:\\Users\\user\\.codex\\skills');
    expect(codexAdapter.profileSkillsDir('/profiles/codex-1', 'linux')).toBe('/profiles/codex-1/skills');
    expect(codexAdapter.profileSkillsDir('C:\\profiles\\codex-1', 'windows')).toBe('C:\\profiles\\codex-1\\skills');
  });

  describe('prepareProfile idempotence (S1-08)', () => {
    it('creates config.toml with cli_auth_credentials_store = "file" in a fresh directory', async () => {
      const tmpDir = path.join(os.tmpdir(), `codex-test-fresh-${Date.now()}`);
      await codexAdapter.prepareProfile(tmpDir, 'linux');

      const configPath = path.join(tmpDir, 'config.toml');
      expect(fs.existsSync(configPath)).toBe(true);
      const content = fs.readFileSync(configPath, 'utf8');
      expect(content.trim()).toBe('cli_auth_credentials_store = "file"');

      // Second call must be idempotent
      await codexAdapter.prepareProfile(tmpDir, 'linux');
      const secondContent = fs.readFileSync(configPath, 'utf8');
      expect(secondContent).toBe(content);

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('preserves other configuration lines and comments', async () => {
      const tmpDir = path.join(os.tmpdir(), `codex-test-preserve-${Date.now()}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const configPath = path.join(tmpDir, 'config.toml');

      const initialContent = '# Custom Codex configuration\nmodel = "gpt-5.5"\nsandbox_mode = "workspace-write"\n';
      fs.writeFileSync(configPath, initialContent, 'utf8');

      await codexAdapter.prepareProfile(tmpDir, 'linux');
      const updated = fs.readFileSync(configPath, 'utf8');

      expect(updated).toContain('# Custom Codex configuration');
      expect(updated).toContain('model = "gpt-5.5"');
      expect(updated).toContain('sandbox_mode = "workspace-write"');
      expect(updated).toContain('cli_auth_credentials_store = "file"');

      // Re-running produces identical content
      await codexAdapter.prepareProfile(tmpDir, 'linux');
      const secondUpdated = fs.readFileSync(configPath, 'utf8');
      expect(secondUpdated).toBe(updated);

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('replaces existing cli_auth_credentials_store value without duplicating', async () => {
      const tmpDir = path.join(os.tmpdir(), `codex-test-replace-${Date.now()}`);
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const configPath = path.join(tmpDir, 'config.toml');

      const initialContent = 'model = "o3"\ncli_auth_credentials_store = "keyring"\n# end of file\n';
      fs.writeFileSync(configPath, initialContent, 'utf8');

      await codexAdapter.prepareProfile(tmpDir, 'linux');
      const updated = fs.readFileSync(configPath, 'utf8');

      expect(updated).toContain('model = "o3"');
      expect(updated).toContain('cli_auth_credentials_store = "file"');
      expect(updated).not.toContain('keyring');

      // Must appear exactly once
      const matches = updated.match(/cli_auth_credentials_store/g);
      expect(matches).toHaveLength(1);

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });
  });

  it('loginCommand produces correct CommandSpec', () => {
    const spec = codexAdapter.loginCommand('/test/profile', 'linux');
    expect(spec.argv).toEqual(['codex', 'login']);
    expect(spec.env).toEqual({ CODEX_HOME: '/test/profile' });
    const fixture = fs.readFileSync(path.join(FIXTURES_DIR, 'login.txt'), 'utf8');
    expect(fixture).toContain('Logged in using ChatGPT');
  });

  it('whoAmICommand produces correct CommandSpec', () => {
    const spec = codexAdapter.whoAmICommand('/test/profile', 'linux');
    expect(spec).not.toBeNull();
    expect(spec?.argv).toEqual(['codex', 'login', 'status']);
    expect(spec?.env).toEqual({ CODEX_HOME: '/test/profile' });
  });

  it('parseWhoAmI parses signed-in fixture into masked email and plan', () => {
    const signedInRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-in.txt'), 'utf8');
    const result = codexAdapter.parseWhoAmI(signedInRaw);
    expect(result).toEqual({ emailMasked: 'a•••@acme.dev' });
  });

  it('parseWhoAmI: the real status (no email, on stderr) is signed in with the identity unknown, never a made-up one', () => {
    // Recorded from codex on 2026-10-12: printed to stderr, which the accounts service passes in too.
    expect(codexAdapter.parseWhoAmI('\nLogged in using ChatGPT\n')).toEqual({});
  });

  it('parseWhoAmI parses signed-out fixture as null', () => {
    const signedOutRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'whoami-signed-out.txt'), 'utf8');
    const result = codexAdapter.parseWhoAmI(signedOutRaw);
    expect(result).toBeNull();
  });

  it('parseQuotaSignal returns null on normal output lines', () => {
    const normalOutput = fs.readFileSync(path.join(FIXTURES_DIR, 'normal-output.jsonl'), 'utf8');
    for (const line of normalOutput.split('\n')) {
      if (!line.trim()) continue;
      const obs = codexAdapter.parseQuotaSignal(accountId, line);
      expect(obs).toBeNull();
    }
  });

  it('parseQuotaSignal detects limit event with reset time', () => {
    const limitRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'limit-event.json'), 'utf8');
    const obs = codexAdapter.parseQuotaSignal(accountId, limitRaw);
    expect(obs).not.toBeNull();
    expect(obs?.limited).toBe(true);
    expect(obs?.window).toBe('5h');
    expect(obs?.source).toBe('reported');
    expect(obs?.resetsAt).toBe('2026-10-11T15:00:00.000Z');
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = codexAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });
});
