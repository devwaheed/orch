/**
 * `orch doctor` (S1-14). Gathers facts (commands, the engine's ping, folder states,
 * disk space) and hands them to the pure rules in ../common/checks.ts.
 * Every check is guarded: run() never throws and never returns a failed Result for
 * a check that could not run; that check is reported as warn or fail instead.
 */
import { access, lstat, mkdtemp, realpath, rm, stat, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type {
  AgentAdapter,
  AgentId,
  DoctorCheck,
  DoctorReport,
  DoctorRunRequest,
  IDoctorService,
  OrchError,
  Os,
  Result,
} from '@orchagents/contracts';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import {
  agentVersionCheck,
  commandSucceeded,
  diskCheck,
  engineCheck,
  gitCheck,
  isolationCheck,
  signInFailedCheck,
  skillsCheck,
  worktreeCheck,
  cliOnPathCheck,
  type InstallKind,
} from '../common/checks.js';
import type { ProcessOutcome, ProcessRunner } from '../common/doctor.js';

export interface DoctorEngine {
  ping(): Promise<Result<{ engineVersion: string }>>;
}

export interface DoctorServiceOptions {
  /** The adapters to check, one per agent. */
  agents: readonly AgentAdapter[];
  runner: ProcessRunner;
  profiles: IProfilesService;
  engine: DoctorEngine;
  /**
   * Opens the agent's own sign-in inside a throwaway profile folder. The app supplies
   * this (the same sign-in the accounts flow uses). Only called when signInTwice is set.
   */
  signIn: (agent: AgentId, profileDir: string) => Promise<Result<void>>;
  os: Os;
  homeDir: string;
  /** The folder whose disk space is checked: ~/.orch */
  dataDir: string;
  orchVersion: string;
  /** Required: free space below this fails the disk check. No LOCKED value exists yet. */
  minFreeBytes: number;
  /** When set, an engine reporting another version gives a warn. */
  expectedEngineVersion?: string;
  /** Where the throwaway git repo is made. Defaults to the OS temp folder. */
  tempDir?: string;
  /** Measures free bytes for a folder, or null when it cannot be measured. Defaults to statfs. */
  measureFreeBytes?: (dir: string) => Promise<number | null>;
  /** PATH passed by the owning host; lookup is filesystem-only (INS-05). */
  pathEnv?: string;
  /** Install action shown by cli_on_path. Headless and development hosts use dev. */
  installKind?: InstallKind;
}

export class DoctorService implements IDoctorService {
  constructor(private readonly options: DoctorServiceOptions) {}

  async run(req?: DoctorRunRequest): Promise<Result<DoctorReport>> {
    const o = this.options;
    const checks: DoctorCheck[] = [];
    checks.push(cliOnPathCheck(
      await orchCommandOnPath(o.pathEnv ?? '', o.os),
      o.os,
      o.installKind ?? 'dev',
    ));

    const versionOutcomes = new Map<AgentId, ProcessOutcome>();
    for (const adapter of o.agents) {
      const outcome = await this.safeRun([adapter.command, '--version']);
      versionOutcomes.set(adapter.id, outcome);
      checks.push(
        agentVersionCheck({
          agent: adapter.id,
          name: adapter.displayName,
          command: adapter.command,
          testedVersions: adapter.testedVersions,
          outcome,
        }),
      );
    }

    const gitOutcome = await this.safeRun(['git', '--version']);
    checks.push(gitCheck(gitOutcome));
    checks.push(await this.worktreeCheck());

    const ping = await this.safePing();
    checks.push(engineCheck(ping, o.expectedEngineVersion));

    for (const adapter of o.agents) {
      if (req?.signInTwice === true && this.isolationApplies(adapter)) {
        const outcome = versionOutcomes.get(adapter.id);
        if (outcome && commandSucceeded(outcome)) {
          checks.push(await this.isolationCheckFor(adapter));
        }
      }
      const skills = await this.skillsCheckFor(adapter);
      if (skills) checks.push(skills);
    }

    checks.push(await this.diskCheck());

    return {
      ok: true,
      value: {
        os: o.os,
        orchVersion: o.orchVersion,
        engineVersion: ping.ok ? ping.value.engineVersion : '',
        checks,
      },
    };
  }

  private async safeRun(argv: readonly string[], options?: { cwd?: string; env?: Readonly<Record<string, string>> }): Promise<ProcessOutcome> {
    try {
      return await this.options.runner.run(argv, options);
    } catch {
      return { kind: 'did_not_start' };
    }
  }

  private async safePing(): Promise<Result<{ engineVersion: string }>> {
    try {
      return await this.options.engine.ping();
    } catch {
      return { ok: false, error: { code: 'engine_unavailable', message: 'The engine is not running.' } };
    }
  }

  /** Two accounts can only be told apart when the OS allows more than one (ACC-03). */
  private isolationApplies(adapter: AgentAdapter): boolean {
    return adapter.supportByOs[this.options.os] !== 'single';
  }

  private async worktreeCheck(): Promise<DoctorCheck> {
    let dir: string;
    try {
      dir = await mkdtemp(join(this.options.tempDir ?? tmpdir(), 'orch-doctor-'));
    } catch {
      return worktreeCheck('untested');
    }
    try {
      const init = await this.safeRun(['git', 'init', '-q', dir]);
      if (!commandSucceeded(init)) return worktreeCheck(init);
      return worktreeCheck(await this.safeRun(['git', 'worktree', 'list'], { cwd: dir }));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async isolationCheckFor(adapter: AgentAdapter): Promise<DoctorCheck> {
    const { profiles, os } = this.options;
    const name = adapter.displayName;
    const agent = adapter.id;
    const failure = (error: OrchError): DoctorCheck => ({
      id: `isolation.${agent}`,
      agent,
      title: error.message,
      status: 'fail',
      ...(error.fix ? { fix: error.fix } : {}),
    });

    const first = await profiles.create({ agent, name: 'orch doctor a', shareSkills: false });
    if (!first.ok) return failure(first.error);
    const second = await profiles.create({ agent, name: 'orch doctor b', shareSkills: false });
    if (!second.ok) {
      await profiles.remove(first.value.accountId);
      return failure(second.error);
    }

    try {
      if (!adapter.whoAmICommand(first.value.profileDir, os)) {
        return isolationCheck({ agent, name, supported: false, first: null, second: null });
      }
      for (const profile of [first.value, second.value]) {
        const signedIn = await this.options.signIn(agent, profile.profileDir);
        if (!signedIn.ok) return signInFailedCheck(agent, name, signedIn.error.fix);
      }
      const whoFirst = await this.whoAmI(adapter, first.value.profileDir);
      const whoSecond = await this.whoAmI(adapter, second.value.profileDir);
      return isolationCheck({ agent, name, supported: true, first: whoFirst, second: whoSecond });
    } finally {
      await profiles.remove(first.value.accountId);
      await profiles.remove(second.value.accountId);
    }
  }

  /** Masked identity of the account signed in to one profile, or null when it cannot be confirmed. */
  private async whoAmI(adapter: AgentAdapter, profileDir: string): Promise<string | null> {
    const spec = adapter.whoAmICommand(profileDir, this.options.os);
    if (!spec) return null;
    const outcome = await this.safeRun(spec.argv, { env: spec.env, ...(spec.cwd ? { cwd: spec.cwd } : {}) });
    if (outcome.kind !== 'ran') return null;
    return adapter.parseWhoAmI(outcome.stdout)?.emailMasked ?? null;
  }

  private async skillsCheckFor(adapter: AgentAdapter): Promise<DoctorCheck | null> {
    const { profiles, os, homeDir } = this.options;
    const shared = adapter.sharedSkillsDir(homeDir, os);
    if (shared === null) return null;
    const agent = adapter.id;
    const name = adapter.displayName;

    const sharedExists = await isDirectory(shared);
    const made = await profiles.create({ agent, name: 'orch doctor skills', shareSkills: true });
    if (!made.ok) return skillsCheck({ agent, name, sharedExists, linked: 'untested' });

    try {
      const link = adapter.profileSkillsDir(made.value.profileDir, os);
      if (link === null) return null;
      const linked = sharedExists && (await linksTo(link, shared));
      return skillsCheck({ agent, name, sharedExists, linked });
    } finally {
      await profiles.remove(made.value.accountId);
    }
  }

  private async diskCheck(): Promise<DoctorCheck> {
    const measure = this.options.measureFreeBytes ?? measureFreeBytes;
    let free: number | null;
    try {
      free = await measure(this.options.dataDir);
    } catch {
      free = null;
    }
    return diskCheck(free, this.options.minFreeBytes);
  }
}

async function orchCommandOnPath(pathEnv: string, os: Os): Promise<boolean> {
  const candidates = os === 'windows' ? ['orch.cmd', 'orch.exe'] : ['orch'];
  for (const folder of pathEnv.split(os === 'windows' ? ';' : ':').filter(Boolean)) {
    for (const candidate of candidates) {
      const file = join(folder, candidate);
      try {
        if (!(await stat(file)).isFile()) continue;
        await access(file, os === 'windows' ? constants.R_OK : constants.X_OK);
        return true;
      } catch {
        // Missing or inaccessible candidates do not stop the remaining PATH lookup.
      }
    }
  }
  return false;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** True when `link` is a symlink (or Windows junction) that resolves to `target`. */
async function linksTo(link: string, target: string): Promise<boolean> {
  try {
    const info = await lstat(link);
    if (!info.isSymbolicLink()) return false;
    const [resolvedLink, resolvedTarget] = await Promise.all([realpath(link), realpath(target)]);
    return resolvedLink === resolvedTarget;
  } catch {
    return false;
  }
}

/** Free bytes available to this user on the disk holding `dir` (or its nearest existing parent). */
export async function measureFreeBytes(dir: string): Promise<number | null> {
  let current = resolve(dir);
  for (;;) {
    try {
      const fs = await statfs(current);
      return Number(fs.bavail) * Number(fs.bsize);
    } catch (e) {
      const parent = dirname(current);
      if (parent === current || !isNotFound(e)) return null;
      current = parent;
    }
  }
}

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'ENOENT';
}
