import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lstat, mkdir, realpath, rm, rmdir, stat, symlink, unlink } from 'node:fs/promises';
import { AccountId, AgentId, EngineEnv, type AgentAdapter, type Os, type OrchError, type Result } from '@orch/contracts';
import {
  filterEngineEnv,
  profileFolderName,
  profileSlug,
  type CreateProfileRequest,
  type IProfilesService,
  type ProfileInfo,
} from '../common/profiles.js';

export interface ProfilesServiceOptions {
  /** Defaults to `defaultProfilesRoot(homeDir)`, i.e. ~/.orch/profiles */
  profilesRoot?: string;
  /** The user's real home folder. Defaults to os.homedir(). */
  homeDir?: string;
  /** Defaults to the OS this process runs on. */
  os?: Os;
  /** Looks up the adapter for an agent. */
  adapterFor: (agent: AgentId) => AgentAdapter | undefined;
}

/** ACC-01: `<home>/.orch/profiles`. The only place that derives the default from the home folder. */
export function defaultProfilesRoot(homeDir: string = homedir()): string {
  return join(homeDir, '.orch', 'profiles');
}

export function currentOs(platform: NodeJS.Platform = process.platform): Os {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

type Err = { ok: false; error: OrchError };

function fail(code: OrchError['code'], message: string, fix?: string): Err {
  return { ok: false, error: fix === undefined ? { code, message } : { code, message, fix } };
}

const OUTSIDE_ROOT = (): Err =>
  fail(
    'validation_failed',
    'That account folder is outside the profiles folder.',
    'Remove any link inside ~/.orch/profiles that points somewhere else.',
  );

const SETUP_FAILED = (): Err =>
  fail('internal', 'Could not set up the account folder.', 'Check that the profiles folder can be written, then try again.');

/** True when `child` is inside `parent`. Equal paths count only when `allowSelf` is set. */
function isWithin(parent: string, child: string, allowSelf = false): boolean {
  const rel = relative(parent, child);
  if (rel === '') return allowSelf;
  return !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

async function lstatOrNull(p: string) {
  try {
    return await lstat(p);
  } catch (e) {
    if (isCode(e, 'ENOENT')) return null;
    throw e;
  }
}

function isCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === code;
}

interface Located {
  accountId: AccountId;
  dir: string;
  agent: AgentId;
  adapter: AgentAdapter | undefined;
}

export class ProfilesService implements IProfilesService {
  private readonly root: string;
  private readonly homeDir: string;
  private readonly os: Os;
  private readonly adapterFor: (agent: AgentId) => AgentAdapter | undefined;

  constructor(options: ProfilesServiceOptions) {
    this.homeDir = resolve(options.homeDir ?? homedir());
    this.root = resolve(options.profilesRoot ?? defaultProfilesRoot(this.homeDir));
    this.os = options.os ?? currentOs();
    this.adapterFor = options.adapterFor;
  }

  async create(req: CreateProfileRequest): Promise<Result<ProfileInfo>> {
    const adapter = this.adapterFor(req.agent);
    if (!adapter) return fail('internal', 'This agent is not available.');

    const slug = profileSlug(req.name);
    if (!AccountId.safeParse(`${req.agent}-${slug}`).success) {
      return fail(
        'validation_failed',
        'That name cannot be used for an account folder.',
        'Use letters and numbers, with single dashes or spaces between words.',
      );
    }

    try {
      await mkdir(this.root, { recursive: true });
    } catch {
      return SETUP_FAILED();
    }

    // mkdir without `recursive` fails with EEXIST when the folder is taken, so the
    // duplicate check and the create are one step.
    for (let attempt = 1; ; attempt++) {
      const folder = profileFolderName(req.agent, slug, attempt);
      const parsed = AccountId.safeParse(folder);
      if (!parsed.success) return SETUP_FAILED();
      const dir = join(this.root, folder);
      try {
        await mkdir(dir);
      } catch (e) {
        if (isCode(e, 'EEXIST')) continue;
        return SETUP_FAILED();
      }

      try {
        await adapter.prepareProfile(dir, this.os);
        const skillsShared = req.shareSkills ? await this.linkSharedSkills(dir, adapter) : false;
        return { ok: true, value: { accountId: parsed.data, profileDir: dir, skillsShared } };
      } catch {
        await this.discardFolder(dir, adapter);
        return SETUP_FAILED();
      }
    }
  }

  async remove(accountId: string): Promise<Result<void>> {
    const loc = await this.locate(accountId, false);
    if (!loc.ok) return loc;
    const { dir, adapter } = loc.value;
    if ((await lstatOrNull(dir)) === null) return { ok: true, value: undefined };
    try {
      if (adapter) await this.unlinkSharedSkills(dir, adapter);
      await rm(dir, { recursive: true, force: false });
      return { ok: true, value: undefined };
    } catch {
      return fail(
        'internal',
        'Could not remove the account folder.',
        'Close any running sessions for this account, then try again.',
      );
    }
  }

  async setSharedSkills(accountId: string, on: boolean): Promise<Result<boolean>> {
    const loc = await this.locate(accountId, true);
    if (!loc.ok) return loc;
    const { dir, adapter } = loc.value;
    if (!adapter) return fail('internal', 'This agent is not available.');
    try {
      if (on) return { ok: true, value: await this.linkSharedSkills(dir, adapter) };
      await this.unlinkSharedSkills(dir, adapter);
      return { ok: true, value: false };
    } catch {
      return SETUP_FAILED();
    }
  }

  async sessionEnv(accountId: string): Promise<Result<EngineEnv>> {
    const loc = await this.locate(accountId, true);
    if (!loc.ok) return loc;
    const { dir, adapter } = loc.value;
    if (!adapter) return fail('internal', 'This agent is not available.');

    let raw: Readonly<Record<string, string>>;
    try {
      raw = adapter.accountEnv(dir, this.os);
    } catch {
      return fail('internal', 'Could not read the account settings.');
    }

    // Every ENGINE_ENV_ALLOWLIST key is a path, so each one must stay inside this profile.
    const env = filterEngineEnv(raw);
    for (const value of Object.values(env)) {
      if (!isAbsolute(value) || !isWithin(dir, value, true)) return OUTSIDE_ROOT();
    }

    const parsed = EngineEnv.safeParse(env);
    if (!parsed.success) {
      return fail('validation_failed', 'The account settings for this agent are incomplete.');
    }
    return { ok: true, value: parsed.data };
  }

  /** Validates an account id and returns its folder, refusing anything that resolves outside the root. */
  private async locate(accountIdRaw: string, mustExist: boolean): Promise<Result<Located>> {
    const parsed = AccountId.safeParse(accountIdRaw);
    if (!parsed.success) return fail('validation_failed', 'That account id is not valid.');
    const accountId = parsed.data;
    const agent = AgentId.safeParse(accountId.split('-')[0]);
    if (!agent.success) return fail('validation_failed', 'That account id is not valid.');

    const dir = join(this.root, accountId);
    if (!isWithin(this.root, dir)) return OUTSIDE_ROOT();

    const found = await lstatOrNull(dir);
    if (found === null) {
      return mustExist ? fail('not_found', 'Account folder not found.') : { ok: true, value: this.located(accountId, dir, agent.data) };
    }

    let real: string;
    let realRoot: string;
    try {
      real = await realpath(dir);
      realRoot = await realpath(this.root);
    } catch {
      return OUTSIDE_ROOT();
    }
    if (!isWithin(realRoot, real)) return OUTSIDE_ROOT();
    return { ok: true, value: this.located(accountId, dir, agent.data) };
  }

  private located(accountId: AccountId, dir: string, agent: AgentId): Located {
    return { accountId, dir, agent, adapter: this.adapterFor(agent) };
  }

  /**
   * ACC-09: links the agent's shared skills folder into the profile. Does nothing
   * when the target folder does not exist. Returns whether a link is in place.
   * An existing real folder at the link path is left alone.
   */
  private async linkSharedSkills(dir: string, adapter: AgentAdapter): Promise<boolean> {
    const target = adapter.sharedSkillsDir(this.homeDir, this.os);
    const link = adapter.profileSkillsDir(dir, this.os);
    if (target === null || link === null) return false;
    if (!isWithin(dir, link)) throw new Error('skills link outside profile');

    const targetStat = await stat(target).catch(() => null);
    if (targetStat === null || !targetStat.isDirectory()) return false;

    const existing = await lstatOrNull(link);
    if (existing !== null) return existing.isSymbolicLink();

    await mkdir(dirname(link), { recursive: true });
    // Windows uses a directory junction (no admin rights needed); other systems use a symlink.
    await symlink(resolve(target), link, this.os === 'windows' ? 'junction' : 'dir');
    return true;
  }

  /**
   * Removes only the link itself. A junction is removed with rmdir, which never
   * touches the target folder. A real folder at the link path is never deleted here.
   */
  private async unlinkSharedSkills(dir: string, adapter: AgentAdapter): Promise<void> {
    const link = adapter.profileSkillsDir(dir, this.os);
    if (link === null) return;
    if (!isWithin(dir, link)) throw new Error('skills link outside profile');

    const existing = await lstatOrNull(link);
    if (existing === null || !existing.isSymbolicLink()) return;
    try {
      await unlink(link);
    } catch {
      await rmdir(link);
    }
  }

  /** Best-effort rollback of a folder this call just created. */
  private async discardFolder(dir: string, adapter: AgentAdapter | undefined): Promise<void> {
    try {
      if (adapter) await this.unlinkSharedSkills(dir, adapter);
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Nothing more to do: the folder is ours and will be reported on the next listing.
    }
  }
}
