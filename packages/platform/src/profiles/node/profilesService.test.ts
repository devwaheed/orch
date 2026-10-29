import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter } from '@orchagents/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProfilesService, currentOs, defaultProfilesRoot } from './profilesService.js';

/** A small stand-in for an agent adapter. Writes no real agent files. */
function fakeAdapter(id: 'claude' | 'codex', homeDir: string, extraEnv: Record<string, string> = {}): AgentAdapter {
  return {
    id,
    displayName: id,
    command: id,
    accountSetting: 'FAKE_HOME',
    supportByOs: { macos: 'parallel', linux: 'parallel', windows: 'parallel' },
    accountEnv: (profileDir) => ({ CLAUDE_CONFIG_DIR: profileDir, ...extraEnv }),
    prepareProfile: async (profileDir) => {
      await writeFile(join(profileDir, 'prepared.txt'), 'yes');
    },
    loginCommand: () => ({ argv: [], env: {} }),
    resumeCommand: () => ({ argv: [], env: {} }),
    whoAmICommand: () => null,
    parseWhoAmI: () => null,
    sharedSkillsDir: (home) => join(home, '.fake', 'skills'),
    profileSkillsDir: (profileDir) => join(profileDir, 'skills'),
    parseQuotaSignal: () => null,
    testedVersions: '*',
  } as AgentAdapter & { id: typeof id };
}

describe('ProfilesService', () => {
  let base: string;
  let home: string;
  let root: string;
  let service: ProfilesService;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'orch-profiles-'));
    home = join(base, 'home');
    root = join(home, '.orch', 'profiles');
    await mkdir(join(home, '.fake', 'skills'), { recursive: true });
    await writeFile(join(home, '.fake', 'skills', 'keep.md'), 'skill');
    service = makeService();
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  function makeService(extraEnv?: Record<string, string>): ProfilesService {
    const claude = fakeAdapter('claude', home, extraEnv);
    return new ProfilesService({
      profilesRoot: root,
      homeDir: home,
      os: currentOs(),
      adapterFor: (agent) => (agent === 'claude' ? claude : undefined),
    });
  }

  describe('create (ACC-01)', () => {
    it('creates <agent>-<slug> and calls prepareProfile', async () => {
      const res = await service.create({ agent: 'claude', name: 'Team', shareSkills: false });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.accountId).toBe('claude-team');
      expect(res.value.profileDir).toBe(join(root, 'claude-team'));
      expect(res.value.skillsShared).toBe(false);
      expect(await readFile(join(root, 'claude-team', 'prepared.txt'), 'utf8')).toBe('yes');
    });

    it('gives duplicates -2 and -3', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await service.create({ agent: 'claude', name: 'Team', shareSkills: false });
        if (!res.ok) throw new Error(res.error.message);
        ids.push(res.value.accountId);
      }
      expect(ids).toEqual(['claude-team', 'claude-team-2', 'claude-team-3']);
    });

    it('applies the slug rules to the name', async () => {
      const res = await service.create({ agent: 'claude', name: 'Personal (Work)!', shareSkills: false });
      expect(res.ok && res.value.accountId).toBe('claude-personal-work');
    });

    it('rejects a name with no letters or numbers and creates nothing', async () => {
      const res = await service.create({ agent: 'claude', name: '!!!', shareSkills: false });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('validation_failed');
      expect(await readdir(root).catch(() => [])).toEqual([]);
    });

    it('trims and collapses dashes so the name fits an account id', async () => {
      const res = await service.create({ agent: 'claude', name: ' Team  A ', shareSkills: false });
      expect(res.ok && res.value.accountId).toBe('claude-team-a');
    });

    it('removes the folder again when prepareProfile fails', async () => {
      const broken: AgentAdapter = {
        ...fakeAdapter('claude', home),
        prepareProfile: async () => {
          throw new Error('boom');
        },
      };
      const svc = new ProfilesService({ profilesRoot: root, homeDir: home, adapterFor: () => broken });
      const res = await svc.create({ agent: 'claude', name: 'Team', shareSkills: false });
      expect(res.ok).toBe(false);
      expect(await lstat(join(root, 'claude-team')).catch(() => null)).toBeNull();
    });
  });

  describe('shared skills (ACC-09)', () => {
    it('links the shared folder when share_skills is on and the target exists', async () => {
      const res = await service.create({ agent: 'claude', name: 'Team', shareSkills: true });
      if (!res.ok) throw new Error(res.error.message);
      expect(res.value.skillsShared).toBe(true);
      const link = join(root, 'claude-team', 'skills');
      expect((await lstat(link)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(link, 'keep.md'), 'utf8')).toBe('skill');
    });

    it('does not link when the target folder is missing', async () => {
      await rm(join(home, '.fake'), { recursive: true, force: true });
      const res = await service.create({ agent: 'claude', name: 'Team', shareSkills: true });
      if (!res.ok) throw new Error(res.error.message);
      expect(res.value.skillsShared).toBe(false);
      expect(await lstat(join(root, 'claude-team', 'skills')).catch(() => null)).toBeNull();
    });

    it('does not link when share_skills is off', async () => {
      const res = await service.create({ agent: 'claude', name: 'Team', shareSkills: false });
      if (!res.ok) throw new Error(res.error.message);
      expect(await lstat(join(root, 'claude-team', 'skills')).catch(() => null)).toBeNull();
    });

    it('unlinks without touching the target contents', async () => {
      await service.create({ agent: 'claude', name: 'Team', shareSkills: true });
      const off = await service.setSharedSkills('claude-team', false);
      expect(off).toEqual({ ok: true, value: false });
      expect(await lstat(join(root, 'claude-team', 'skills')).catch(() => null)).toBeNull();
      expect(await readFile(join(home, '.fake', 'skills', 'keep.md'), 'utf8')).toBe('skill');
    });

    it('removing a profile keeps the shared skills folder and its contents', async () => {
      await service.create({ agent: 'claude', name: 'Team', shareSkills: true });
      const res = await service.remove('claude-team');
      expect(res.ok).toBe(true);
      expect(await lstat(join(root, 'claude-team')).catch(() => null)).toBeNull();
      expect(await readFile(join(home, '.fake', 'skills', 'keep.md'), 'utf8')).toBe('skill');
    });
  });

  describe('remove (ACC-08)', () => {
    it('deletes only the profile folder', async () => {
      await service.create({ agent: 'claude', name: 'Team', shareSkills: false });
      await mkdir(join(root, 'claude-other'));
      const res = await service.remove('claude-team');
      expect(res.ok).toBe(true);
      expect(await lstat(join(root, 'claude-team')).catch(() => null)).toBeNull();
      expect((await lstat(join(root, 'claude-other'))).isDirectory()).toBe(true);
    });

    it('treats a missing folder as removed', async () => {
      const res = await service.remove('claude-missing');
      expect(res.ok).toBe(true);
    });
  });

  describe('path containment', () => {
    it.each(['../outside', 'claude-../../x', '/etc/passwd', 'claude-team/../../x', 'claude-a/b'])(
      'rejects the account id %j',
      async (id) => {
        expect((await service.remove(id)).ok).toBe(false);
        expect((await service.sessionEnv(id)).ok).toBe(false);
      },
    );

    it('refuses to remove a profile whose folder is a link to somewhere outside the root', async () => {
      const outside = join(base, 'outside');
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'precious.txt'), 'keep');
      await mkdir(root, { recursive: true });
      await symlink(outside, join(root, 'claude-escape'), 'dir');
      const res = await service.remove('claude-escape');
      expect(res.ok).toBe(false);
      expect(await readFile(join(outside, 'precious.txt'), 'utf8')).toBe('keep');
    });

    it('refuses a session env for a profile linked outside the root', async () => {
      const outside = join(base, 'outside');
      await mkdir(outside, { recursive: true });
      await mkdir(root, { recursive: true });
      await symlink(outside, join(root, 'claude-escape'), 'dir');
      expect((await service.sessionEnv('claude-escape')).ok).toBe(false);
    });

    it('refuses an env value that points outside the profile', async () => {
      const svc = makeService({ CLAUDE_CONFIG_DIR: join(base, 'elsewhere') });
      await svc.create({ agent: 'claude', name: 'Team', shareSkills: false });
      const res = await svc.sessionEnv('claude-team');
      expect(res.ok).toBe(false);
    });

    it('uses the default root under the home folder', () => {
      expect(defaultProfilesRoot(home)).toBe(join(home, '.orch', 'profiles'));
    });
  });

  describe('sessionEnv', () => {
    it('contains only ENGINE_ENV_ALLOWLIST keys', async () => {
      const svc = makeService({ PATH: '/usr/bin', SECRET_TOKEN: 'x', CODEX_HOME: join(root, 'claude-team') });
      await svc.create({ agent: 'claude', name: 'Team', shareSkills: false });
      const res = await svc.sessionEnv('claude-team');
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(Object.keys(res.value).sort()).toEqual(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
    });

    it('returns the adapter env for an account that exists', async () => {
      await service.create({ agent: 'claude', name: 'Team', shareSkills: false });
      const res = await service.sessionEnv('claude-team');
      expect(res).toEqual({ ok: true, value: { CLAUDE_CONFIG_DIR: join(root, 'claude-team') } });
    });

    it('fails with not_found for a profile that does not exist', async () => {
      const res = await service.sessionEnv('claude-nobody');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('not_found');
    });

    it('fails when no allowed key is left', async () => {
      const bare = new ProfilesService({
        profilesRoot: root,
        homeDir: home,
        adapterFor: () => ({ ...fakeAdapter('claude', home), accountEnv: () => ({ PATH: '/x' }) }),
      });
      await bare.create({ agent: 'claude', name: 'Team', shareSkills: false });
      expect((await bare.sessionEnv('claude-team')).ok).toBe(false);
    });
  });
});
