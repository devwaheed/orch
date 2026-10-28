import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_ENV_ALLOWLIST, type AccountId } from '@orchagents/contracts';
import { OpenCodeAdapter, opencodeAdapter } from '../../src/adapters/node/opencode.js';

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
    expect(opencodeAdapter.testedVersions).toBe('>=1.0.0 <3.0.0');
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

  it('parses OpenCode free usage exhaustion from recorded output', () => {
    const message = 'AI.Error: Free usage limit reached. Upgrade your plan to continue.';
    const fixture = path.join(FIXTURES_DIR, 'free-usage-limit.txt');
    expect(fs.readFileSync(fixture, 'utf8').trim()).toBe(message);
    expect(opencodeAdapter.parseQuotaSignal(accountId, message)).toMatchObject({ limited: true, source: 'reported' });
  });

  it('parseQuotaSignal does not confuse crash output with a limit event', () => {
    const crashRaw = fs.readFileSync(path.join(FIXTURES_DIR, 'crash.txt'), 'utf8');
    const obs = opencodeAdapter.parseQuotaSignal(accountId, crashRaw);
    expect(obs).toBeNull();
  });

  describe('standalone capability probe', () => {
    it('when probe detects --standalone: login, whoami, and accountEnv include flag/env', async () => {
      const runner = vi.fn().mockResolvedValue({
        stdout: 'opencode auth list\n\nOptions:\n  --standalone  Run with a private server instead of the background service\n',
      });
      const adapter = new OpenCodeAdapter(runner);
      const supported = await adapter.probe();
      expect(supported).toBe(true);
      expect(adapter.supportsStandalone).toBe(true);

      const login = adapter.loginCommand('/test/profile', 'linux');
      expect(login.argv).toEqual(['opencode', 'auth', 'login', '--standalone']);
      expect(login.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
        ORCH_OPENCODE_STANDALONE: '1',
      });

      const whoAmI = adapter.whoAmICommand('/test/profile', 'linux');
      expect(whoAmI?.argv).toEqual(['opencode', 'auth', 'list', '--standalone']);
      expect(whoAmI?.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
        ORCH_OPENCODE_STANDALONE: '1',
      });

      const env = adapter.accountEnv('/test/profile', 'linux');
      expect(env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
        ORCH_OPENCODE_STANDALONE: '1',
      });
    });

    it('when probe output does not include --standalone: login, whoami, and accountEnv remain unchanged', async () => {
      const runner = vi.fn().mockResolvedValue({
        stdout: 'opencode auth list\n\nOptions:\n  --help  Show help\n',
      });
      const adapter = new OpenCodeAdapter(runner);
      const supported = await adapter.probe();
      expect(supported).toBe(false);
      expect(adapter.supportsStandalone).toBe(false);

      const login = adapter.loginCommand('/test/profile', 'linux');
      expect(login.argv).toEqual(['opencode', 'auth', 'login']);
      expect(login.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });

      const whoAmI = adapter.whoAmICommand('/test/profile', 'linux');
      expect(whoAmI?.argv).toEqual(['opencode', 'auth', 'list']);
      expect(whoAmI?.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });

      const env = adapter.accountEnv('/test/profile', 'linux');
      expect(env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });
    });

    it('when probe fails because opencode is not found: logs redacted warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const home = os.homedir();
      const runner = vi.fn().mockRejectedValue(new Error(`spawn ${home}/.opencode/bin/opencode ENOENT`));
      const adapter = new OpenCodeAdapter(runner);
      const supported = await adapter.probe();
      expect(supported).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
      const logged = warnSpy.mock.calls[0]?.[0];
      expect(logged).toContain('[opencode] opencode not found on PATH:');
      // Verify home was redacted to ~
      if (home.length > 0) {
        expect(logged).not.toContain(home);
        expect(logged).toContain('~/.opencode/bin/opencode');
      }
      warnSpy.mockRestore();
    });

    it('when probe fails: login, whoami, and accountEnv remain unchanged', async () => {
      const runner = vi.fn().mockRejectedValue(new Error('ENOENT: command not found'));
      const adapter = new OpenCodeAdapter(runner);
      const supported = await adapter.probe();
      expect(supported).toBe(false);
      expect(adapter.supportsStandalone).toBe(false);

      const login = adapter.loginCommand('/test/profile', 'linux');
      expect(login.argv).toEqual(['opencode', 'auth', 'login']);
      expect(login.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });

      const whoAmI = adapter.whoAmICommand('/test/profile', 'linux');
      expect(whoAmI?.argv).toEqual(['opencode', 'auth', 'list']);
      expect(whoAmI?.env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });

      const env = adapter.accountEnv('/test/profile', 'linux');
      expect(env).toEqual({
        XDG_DATA_HOME: '/test/profile',
        OPENCODE_CONFIG_DIR: '/test/profile/config',
      });
    });

    it('the probe runs once and caches its result', async () => {
      const runner = vi.fn().mockResolvedValue({
        stdout: 'Options:\n  --standalone  Run with a private server\n',
      });
      const adapter = new OpenCodeAdapter(runner);

      const first = await adapter.probe();
      const second = await adapter.probe();
      const third = await adapter.probe();

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(third).toBe(true);
      expect(runner).toHaveBeenCalledTimes(1);
      expect(runner).toHaveBeenCalledWith('opencode', ['auth', 'list', '--help'], { timeout: 5000 });
    });
  });
});

describe('OpenCode v2 auth list', () => {
  const adapter = new OpenCodeAdapter();
  it('counts an empty v2 listing as signed in with unknown identity (free models need no login)', () => {
    expect(adapter.parseWhoAmI('No authenticated integrations\n')).toEqual({});
  });
  it('counts v2 integration rows as provider logins', () => {
    const output = 'OpenCode Console  Default                     stored\nTavily            TAVILY_API_KEY              environment\n';
    expect(adapter.parseWhoAmI(output)).toEqual({ plan: '2 provider logins' });
  });
});
