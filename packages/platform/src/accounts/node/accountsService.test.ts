import { mkdtemp, mkdir, readFile, rm, stat, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { AccountId, AccountsFile, AgentAdapter, AgentId, CommandSpec, Os, OrchEvent, RoutingRule } from '@orch/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../../config/node/configService.js';
import { ProfilesService, currentOs } from '../../profiles/node/profilesService.js';
import { StoreService } from '../../store/node/storeService.js';
import { FakeAgentAdapter } from '../../adapters/node/fake.js';
import type { IAccountProcessRunner, ProcessRun } from '../common/accounts.js';
import { parseAccountsYaml } from '../../config/node/parse.js';
import { AccountsService } from './accountsService.js';

const AGENTS: AgentId[] = ['claude', 'codex', 'gemini', 'opencode', 'agy'];

/** Runs nothing. Answers from a script keyed by the command and the last argv word. */
class FakeRunner implements IAccountProcessRunner {
  readonly calls: { argv: readonly string[]; env: Readonly<Record<string, string>>; interactive: boolean }[] = [];
  /** Who-am-I answer per profile folder name. Missing = signed out. */
  readonly identityByFolder = new Map<string, string>();
  /** Login exit code per profile folder name. Default 0. */
  readonly loginExitByFolder = new Map<string, number | null>();
  /** Login that cannot start at all (null), per agent command. */
  readonly cannotStart = new Set<string>();
  /** The --version probe answer per command. Missing = not installed. */
  readonly versionByCommand = new Map<string, ProcessRun>();
  /** Raw who-am-I stdout per profile folder, overriding identityByFolder. */
  readonly whoAmIStdoutByFolder = new Map<string, string>();

  async run(spec: CommandSpec, options: { readonly interactive: boolean }): Promise<ProcessRun | null> {
    this.calls.push({ argv: spec.argv, env: spec.env, interactive: options.interactive });
    const command = spec.argv[0] ?? '';
    const last = spec.argv[spec.argv.length - 1] ?? '';
    const folder = basename(Object.values(spec.env)[0] ?? '');

    if (last === '--version') {
      return this.versionByCommand.get(command) ?? { exitCode: 1, stdout: '' };
    }
    if (last === 'login') {
      if (this.cannotStart.has(command)) return null;
      return { exitCode: this.loginExitByFolder.get(folder) ?? 0, stdout: '' };
    }
    if (last === 'whoami') {
      const raw = this.whoAmIStdoutByFolder.get(folder);
      if (raw !== undefined) return { exitCode: 0, stdout: raw };
      const identity = this.identityByFolder.get(folder);
      return { exitCode: 0, stdout: identity === undefined ? 'Not logged in' : JSON.stringify({ emailMasked: identity, plan: 'pro' }) };
    }
    return null;
  }
}

interface Harness {
  readonly service: AccountsService;
  readonly runner: FakeRunner;
  readonly store: StoreService;
  readonly config: ConfigService;
  readonly profiles: ProfilesService;
  readonly home: string;
  readonly configPath: string;
  readonly profilesRoot: string;
  readonly events: OrchEvent[];
}

let base: string;
let home: string;
const cleanup: (() => void)[] = [];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'orch-accounts-'));
  home = join(base, 'home');
  await mkdir(join(home, '.claude', 'skills'), { recursive: true });
  await writeFile(join(home, '.claude', 'skills', 'my-skill.md'), 'skill');
  await mkdir(join(home, '.orch'), { recursive: true });
});

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  await rm(base, { recursive: true, force: true });
});

/** Builds the real store, config and profiles on temp folders, with fake adapters and a fake runner. */
async function setup(options: { os?: Os; yaml?: string; agyOs?: Record<Os, 'parallel' | 'single' | 'unverified'> } = {}): Promise<Harness> {
  const os = options.os ?? 'macos';
  const configPath = join(home, '.orch', 'accounts.yaml');
  if (options.yaml !== undefined) await writeFile(configPath, options.yaml, 'utf8');

  const store = new StoreService();
  cleanup.push(() => store.close());
  const opened = await store.open({ dbPath: join(home, '.orch', 'orch.db'), backupDir: join(home, '.orch', 'backups') });
  if (!opened.ok) throw new Error(opened.error.message);

  const config = new ConfigService({ filePath: configPath, watchDebounceMs: 10 });
  cleanup.push(() => config.dispose());
  const started = await config.start();
  // An invalid file is a valid test input; anything else is a broken harness.
  if (!started.ok && options.yaml === undefined) throw new Error(started.error.message);

  const adapters: AgentAdapter[] = AGENTS.map((agent) => {
    const adapter = new FakeAgentAdapter({ impersonate: agent, command: agent });
    if (agent === 'agy' && options.agyOs) {
      return Object.assign(adapter, { supportByOs: options.agyOs });
    }
    // Mirrors the real OpenCode adapter (ACC-03): unverified on Windows.
    if (agent === 'opencode') {
      return Object.assign(adapter, { supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'unverified' } });
    }
    return adapter;
  });
  const byAgent = new Map(adapters.map((a) => [a.id, a] as const));
  const profilesRoot = join(home, '.orch', 'profiles');
  const profiles = new ProfilesService({ profilesRoot, homeDir: home, os: currentOs(), adapterFor: (agent) => byAgent.get(agent) });

  const runner = new FakeRunner();
  let tick = 0;
  const service = new AccountsService({
    store,
    config,
    profiles,
    adapters,
    runner,
    os,
    homeDir: home,
    now: () => new Date(Date.UTC(2026, 9, 11, 9, 0, 0) + tick++ * 1000),
  });
  const events: OrchEvent[] = [];
  service.onEvent((event) => events.push(event));
  cleanup.push(() => service.dispose());
  return { service, runner, store, config, profiles, home, configPath, profilesRoot, events };
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function readYaml(path: string): Promise<AccountsFile> {
  const parsed = parseAccountsYaml(await readFile(path, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value.parsed;
}

describe('add (ACC-01, ACC-05)', () => {
  it('creates the profile folder from the slug and makes the first account primary', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));

    expect(account.id).toBe('claude-team');
    expect(account.primary).toBe(true);
    expect(account.use).toBe(true);
    expect(account.state).toBe('signed_out');
    expect(account.profileDir).toBe(join(h.profilesRoot, 'claude-team'));
    expect((await stat(account.profileDir)).isDirectory()).toBe(true);
    expect((await readYaml(h.configPath)).accounts.claude?.team?.primary).toBe(true);
  });

  it('turns the name into a slug and adds -2 for a duplicate, which is not primary', async () => {
    const h = await setup();
    const first = must(await h.service.add({ agent: 'claude', name: 'My  Team!' }));
    expect(first.id).toBe('claude-my-team');

    const second = must(await h.service.add({ agent: 'claude', name: 'My Team' }));
    expect(second.id).toBe('claude-my-team-2');
    expect(second.primary).toBe(false);

    const listed = must(await h.service.list());
    expect(listed.filter((a) => a.primary).map((a) => a.id)).toEqual(['claude-my-team']);
  });

  it('refuses a name that cannot make a folder name', async () => {
    const h = await setup();
    const result = await h.service.add({ agent: 'claude', name: '!!!' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
  });

  it('keeps accounts of other agents separate and makes each agent own one primary', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Work' }));
    const codex = must(await h.service.add({ agent: 'codex', name: 'Work' }));
    expect(codex.primary).toBe(true);
  });

  it('writes nothing when accounts.yaml is invalid', async () => {
    const h = await setup({ yaml: 'routing: nonsense\n' });
    const result = await h.service.add({ agent: 'claude', name: 'Team' });
    expect(result.ok).toBe(false);
    await expect(stat(join(h.profilesRoot, 'claude-team'))).rejects.toThrow();
  });
});

describe('single-account agents (ACC-03)', () => {
  it('lets a single-account agent add one account, then refuses a second with agent_single_account_os', async () => {
    const h = await setup({ os: 'macos', agyOs: { macos: 'single', linux: 'parallel', windows: 'single' } });
    const first = must(await h.service.add({ agent: 'agy', name: 'Only' }));
    expect(first.id).toBe('agy-only');

    const second = await h.service.add({ agent: 'agy', name: 'Other' });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('agent_single_account_os');
      expect(second.error.message).toBe('Fake Antigravity allows one account on macOS.');
      expect(second.error.fix).toBeDefined();
    }
    expect(must(await h.service.list())).toHaveLength(1);
  });

  it('allows several accounts for the same agent on an OS where it is parallel', async () => {
    const h = await setup({ os: 'linux', agyOs: { macos: 'single', linux: 'parallel', windows: 'single' } });
    must(await h.service.add({ agent: 'agy', name: 'One' }));
    must(await h.service.add({ agent: 'agy', name: 'Two' }));
    expect(must(await h.service.list())).toHaveLength(2);
  });

  it('allows adding to an unverified agent (OpenCode on Windows)', async () => {
    const h = await setup({ os: 'windows' });
    must(await h.service.add({ agent: 'opencode', name: 'One' }));
    must(await h.service.add({ agent: 'opencode', name: 'Two' }));
    expect(must(await h.service.list())).toHaveLength(2);
  });
});

describe('signIn: the agent login and the three checks (ACC-04)', () => {
  it('runs the agent login interactively, checks who-am-I, and reports ready', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    h.runner.identityByFolder.set('claude-team', 'a•••@acme.dev');

    const result = must(await h.service.signIn(account.id));
    expect(result).toEqual({
      accountId: 'claude-team',
      signedIn: true,
      emailMasked: 'a•••@acme.dev',
      keptSeparate: true,
      ready: true,
    });

    const login = h.runner.calls.find((c) => c.argv[c.argv.length - 1] === 'login');
    expect(login?.interactive).toBe(true);
    expect(login?.env).toEqual({ CLAUDE_CONFIG_DIR: account.profileDir });
    const whoAmI = h.runner.calls.find((c) => c.argv[c.argv.length - 1] === 'whoami');
    expect(whoAmI?.interactive).toBe(false);

    const listed = must(await h.service.list())[0];
    expect(listed?.state).toBe('available');
    expect(listed?.emailMasked).toBe('a•••@acme.dev');
  });

  it('masks a full address that the adapter returns unmasked', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    h.runner.identityByFolder.set('claude-team', 'alex@acme.dev');
    const result = must(await h.service.signIn(account.id));
    expect(result.emailMasked).toBe('a•••@acme.dev');
    expect(must(await h.service.list())[0]?.emailMasked).toBe('a•••@acme.dev');
  });

  it('reports not signed in when who-am-I finds no login', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    h.runner.whoAmIStdoutByFolder.set('claude-team', 'Not logged in');

    const result = must(await h.service.signIn(account.id));
    expect(result.signedIn).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.emailMasked).toBeUndefined();
    expect(must(await h.service.list())[0]?.state).toBe('signed_out');
  });

  it('reports not signed in and skips who-am-I when the login itself fails', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    h.runner.loginExitByFolder.set('claude-team', 1);
    h.runner.identityByFolder.set('claude-team', 'a•••@acme.dev');

    const result = must(await h.service.signIn(account.id));
    expect(result.signedIn).toBe(false);
    expect(result.ready).toBe(false);
    expect(h.runner.calls.some((c) => c.argv[c.argv.length - 1] === 'whoami')).toBe(false);
  });

  it('reports the identity as unknown, not failed, when the agent has no status command', async () => {
    const h = await setup();
    const gemini = Object.assign(new FakeAgentAdapter({ impersonate: 'gemini', command: 'gemini' }), {
      whoAmICommand: () => null,
    });
    // A second service over the same store, config and profiles, using the no-status-command adapter.
    const service = new AccountsService({
      store: h.store,
      config: h.config,
      profiles: h.profiles,
      adapters: [gemini],
      runner: h.runner,
      os: 'macos',
      homeDir: h.home,
    });
    const account = must(await service.add({ agent: 'gemini', name: 'Solo' }));

    const result = must(await service.signIn(account.id));
    expect(result).toEqual({ accountId: 'gemini-solo', signedIn: true, keptSeparate: true, ready: true });
    expect(h.runner.calls.some((c) => c.argv[c.argv.length - 1] === 'whoami')).toBe(false);
    const listed = must(await service.list())[0];
    expect(listed?.emailMasked).toBeUndefined();
    expect(listed?.state).toBe('available');
    service.dispose();
  });

  it('reports not kept separate when the login matches another account of the same agent', async () => {
    const h = await setup();
    const first = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const second = must(await h.service.add({ agent: 'claude', name: 'Client' }));
    h.runner.identityByFolder.set('claude-team', 'a•••@acme.dev');
    h.runner.identityByFolder.set('claude-client', 'a•••@acme.dev');
    must(await h.service.signIn(first.id));

    const result = must(await h.service.signIn(second.id));
    expect(result.signedIn).toBe(true);
    expect(result.keptSeparate).toBe(false);
    expect(result.ready).toBe(false);
  });

  it('reports kept separate when the login differs from the other accounts', async () => {
    const h = await setup();
    const first = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const second = must(await h.service.add({ agent: 'claude', name: 'Client' }));
    h.runner.identityByFolder.set('claude-team', 'a•••@acme.dev');
    h.runner.identityByFolder.set('claude-client', 'c•••@client.com');
    must(await h.service.signIn(first.id));
    const result = must(await h.service.signIn(second.id));
    expect(result).toMatchObject({ signedIn: true, keptSeparate: true, ready: true });
  });

  it('returns not_found for an unknown account', async () => {
    const h = await setup();
    const result = await h.service.signIn('claude-nope' as AccountId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('returns agent_not_installed when the login command cannot start', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    h.runner.cannotStart.add('claude');
    const result = await h.service.signIn(account.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('agent_not_installed');
  });
});

describe('primary account (ACC-05)', () => {
  it('moves the primary to the chosen account and clears the old one', async () => {
    const h = await setup();
    const first = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const second = must(await h.service.add({ agent: 'claude', name: 'Client' }));

    must(await h.service.setPrimary(second.id));
    const primaries = (await readYaml(h.configPath)).accounts.claude;
    expect(primaries?.team?.primary).toBe(false);
    expect(primaries?.client?.primary).toBe(true);

    const listed = must(await h.service.list());
    expect(listed.filter((a) => a.primary).map((a) => a.id)).toEqual([second.id]);
    expect(listed.find((a) => a.id === first.id)?.primary).toBe(false);
  });

  it('returns not_found for an unknown account', async () => {
    const h = await setup();
    const result = await h.service.setPrimary('claude-nope' as AccountId);
    expect(result.ok).toBe(false);
  });

  it('removing the primary makes the oldest remaining account of that agent primary', async () => {
    const h = await setup();
    const oldest = must(await h.service.add({ agent: 'claude', name: 'Oldest' }));
    const middle = must(await h.service.add({ agent: 'claude', name: 'Middle' }));
    must(await h.service.add({ agent: 'claude', name: 'Newest' }));
    must(await h.service.setPrimary(middle.id));

    must(await h.service.remove(middle.id));

    const listed = must(await h.service.list());
    expect(listed.map((a) => a.id)).toEqual([oldest.id, 'claude-newest']);
    expect(listed.filter((a) => a.primary).map((a) => a.id)).toEqual([oldest.id]);
  });

  it('removing a non-primary account leaves the primary alone', async () => {
    const h = await setup();
    const primary = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const other = must(await h.service.add({ agent: 'claude', name: 'Client' }));
    must(await h.service.remove(other.id));
    expect(must(await h.service.list()).filter((a) => a.primary).map((a) => a.id)).toEqual([primary.id]);
  });
});

describe('remove (ACC-08)', () => {
  it('deletes only the profile folder and keeps the agent normal folders', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    must(await h.service.remove(account.id));

    await expect(stat(account.profileDir)).rejects.toThrow();
    expect(must(await h.service.list())).toEqual([]);
    expect(await readFile(join(home, '.claude', 'skills', 'my-skill.md'), 'utf8')).toBe('skill');
  });

  it('removes the account entry from accounts.yaml', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    must(await h.service.remove(account.id));
    expect((await readYaml(h.configPath)).accounts.claude?.team).toBeUndefined();
  });

  it('returns not_found for an unknown account', async () => {
    const h = await setup();
    const result = await h.service.remove('claude-nope' as AccountId);
    expect(result.ok).toBe(false);
  });
});

describe('use, routing and config file', () => {
  it('setUse writes use to accounts.yaml and shows it in the list', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    must(await h.service.setUse(account.id, false));
    expect((await readYaml(h.configPath)).accounts.claude?.team?.use).toBe(false);
    expect(must(await h.service.list())[0]?.use).toBe(false);
  });

  it('setRouting writes the rule, and refuses a value outside the rule set', async () => {
    const h = await setup();
    must(await h.service.setRouting('most-headroom'));
    expect((await readYaml(h.configPath)).routing).toBe('most-headroom');

    const bad = await h.service.setRouting('bogus' as RoutingRule);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('validation_failed');
  });

  it('keeps the user comments in accounts.yaml when orch writes it', async () => {
    const h = await setup({ yaml: '# my own note\nrouting: primary-first\n' });
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    must(await h.service.setUse(account.id, false));
    must(await h.service.setRouting('most-headroom'));
    const text = await readFile(h.configPath, 'utf8');
    expect(text).toContain('# my own note');
  });

  it('getConfig returns the file text and the parsed file', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const config = must(await h.service.getConfig());
    expect(config.text).toBe(await readFile(h.configPath, 'utf8'));
    expect(config.parsed.accounts.claude?.team?.primary).toBe(true);
  });

  it('setConfig applies edited YAML and returns the parsed file', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const parsed = must(await h.service.setConfig('routing: most-headroom\naccounts:\n  claude:\n    team:\n      primary: true\n'));
    expect(parsed.routing).toBe('most-headroom');
  });

  it('setConfig rejects two primaries with field errors and changes nothing', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const before = await readFile(h.configPath, 'utf8');
    const bad = 'accounts:\n  claude:\n    team:\n      primary: true\n    client:\n      primary: true\n';
    const result = await h.service.setConfig(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_failed');
      expect(result.error.details).toBeDefined();
    }
    expect(await readFile(h.configPath, 'utf8')).toBe(before);
  });

  it('setConfig restores a primary when the edited file leaves none (ACC-05)', async () => {
    const h = await setup();
    const first = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    must(await h.service.add({ agent: 'claude', name: 'Client' }));
    must(await h.service.setConfig('routing: primary-first\naccounts:\n  claude:\n    team: {}\n    client: {}\n'));
    expect(must(await h.service.list()).filter((a) => a.primary).map((a) => a.id)).toEqual([first.id]);
  });
});

describe('shared skills (ACC-09)', () => {
  it('turning shared skills off unlinks the folder, and turning it on links it again', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    expect(must(await h.service.list())[0]?.skillsShared).toBe(true);
    expect((await lstat(join(account.profileDir, 'skills'))).isSymbolicLink()).toBe(true);

    must(await h.service.setShareSkills('claude', false));
    expect(must(await h.service.list())[0]?.skillsShared).toBe(false);
    await expect(lstat(join(account.profileDir, 'skills'))).rejects.toThrow();

    const config = await readYaml(h.configPath);
    expect(config.share_skills).toEqual({ claude: false, codex: true, gemini: true, opencode: true, agy: true });

    must(await h.service.setShareSkills('claude', true));
    expect(must(await h.service.list())[0]?.skillsShared).toBe(true);
    expect((await lstat(join(account.profileDir, 'skills'))).isSymbolicLink()).toBe(true);
  });

  it('a link is not created when the agent has no shared skills folder to link', async () => {
    const h = await setup();
    await rm(join(home, '.claude'), { recursive: true, force: true });
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    expect(account.skillsShared).toBe(false);
    await expect(lstat(join(account.profileDir, 'skills'))).rejects.toThrow();
  });

  it('a share toggle for an agent that already matches leaves the file unchanged', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Team' }));
    const before = await readFile(h.configPath, 'utf8');
    must(await h.service.setShareSkills('claude', true));
    expect(await readFile(h.configPath, 'utf8')).toBe(before);
  });
});

describe('listAgents (ACC-03)', () => {
  it('returns the five agents with per-OS support, install state and the shared skills count', async () => {
    const h = await setup({ os: 'windows', agyOs: { macos: 'single', linux: 'parallel', windows: 'single' } });
    h.runner.versionByCommand.set('claude', { exitCode: 0, stdout: '\nclaude 2.1.0\nmore output\n' });

    const agents = must(await h.service.listAgents());
    expect(agents.map((a) => a.id)).toEqual(AGENTS);

    const claude = agents.find((a) => a.id === 'claude');
    expect(claude).toMatchObject({ installed: true, version: 'claude 2.1.0', support: 'parallel', sharedSkillsCount: 1 });
    expect(claude?.sharedSkillsDir).toBe(join(home, '.claude', 'skills'));

    const codex = agents.find((a) => a.id === 'codex');
    expect(codex).toMatchObject({ installed: false, sharedSkillsCount: 0 });
    expect(codex?.version).toBeUndefined();

    expect(agents.find((a) => a.id === 'agy')?.support).toBe('single');
    expect(agents.find((a) => a.id === 'opencode')?.support).toBe('unverified');
    expect(agents.find((a) => a.id === 'opencode')?.supportByOs).toEqual({ macos: 'parallel', linux: 'parallel', windows: 'unverified' });
  });
});

describe('list order', () => {
  it('lists accounts oldest first by created_at', async () => {
    const h = await setup();
    must(await h.service.add({ agent: 'claude', name: 'Zeta' }));
    must(await h.service.add({ agent: 'codex', name: 'Alpha' }));
    must(await h.service.add({ agent: 'claude', name: 'Beta' }));
    expect(must(await h.service.list()).map((a) => a.id)).toEqual(['claude-zeta', 'codex-alpha', 'claude-beta']);
  });
});

describe('account events', () => {
  it('emits account.changed on add and sign-in, and account.removed on remove', async () => {
    const h = await setup();
    const account = must(await h.service.add({ agent: 'claude', name: 'Team' }));
    expect(h.events).toContainEqual({ type: 'account.changed', account: expect.objectContaining({ id: 'claude-team' }) });

    h.events.length = 0;
    h.runner.identityByFolder.set('claude-team', 'a•••@acme.dev');
    must(await h.service.signIn(account.id));
    expect(h.events.some((e) => e.type === 'account.changed' && e.account.state === 'available')).toBe(true);

    h.events.length = 0;
    must(await h.service.remove(account.id));
    expect(h.events).toEqual([{ type: 'account.removed', accountId: 'claude-team' }]);
  });
});
