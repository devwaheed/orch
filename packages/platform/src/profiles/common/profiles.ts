/**
 * Profiles service: account folders under ~/.orch/profiles, shared-skills links
 * and each session's engine env (ACC-01, ACC-02, ACC-08, ACC-09). Plain TypeScript
 * only; the implementation lives in ../node.
 */
import type { AccountId, AgentId, EngineEnv, Result } from '@orch/contracts';
import { ENGINE_ENV_ALLOWLIST } from '@orch/contracts';
import { createServiceId } from '@orch/base';

export interface CreateProfileRequest {
  agent: AgentId;
  /** Display name, e.g. "Team". Turned into the slug by `profileSlug`. */
  name: string;
  /** Resolved `share_skills` value for this agent (see `shareSkillsFor`). */
  shareSkills: boolean;
}

export interface ProfileInfo {
  accountId: AccountId;
  /** Absolute path of the profile folder */
  profileDir: string;
  /** true when the shared skills link was created */
  skillsShared: boolean;
}

export interface IProfilesService {
  /** Creates `<agent>-<slug>` (with -2, -3 for duplicates) and calls adapter.prepareProfile. */
  create(req: CreateProfileRequest): Promise<Result<ProfileInfo>>;
  /** Deletes the profile folder only. Missing folders count as removed. */
  remove(accountId: string): Promise<Result<void>>;
  /** Links (on) or unlinks (off) the agent's shared skills folder for one profile. Returns whether it is linked. */
  setSharedSkills(accountId: string, on: boolean): Promise<Result<boolean>>;
  /** The engine env for a session on this account, filtered to ENGINE_ENV_ALLOWLIST. */
  sessionEnv(accountId: string): Promise<Result<EngineEnv>>;
}

export const IProfilesService = createServiceId<IProfilesService>('profiles');

/** ACC-01 slug: lowercase, spaces become '-', every other character outside a-z, 0-9, '-' is removed. */
export function profileSlug(name: string): string {
  return name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

/** `<agent>-<slug>` for the first attempt, `<agent>-<slug>-2`, `-3`, … for duplicates. */
export function profileFolderName(agent: AgentId, slug: string, attempt: number): string {
  const base = `${agent}-${slug}`;
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

/** ACC-09: shared skills default on. `share_skills` may be one boolean or a per-agent map. */
export function shareSkillsFor(setting: boolean | Partial<Record<AgentId, boolean>>, agent: AgentId): boolean {
  if (typeof setting === 'boolean') return setting;
  return setting[agent] ?? true;
}

/** Keeps only the keys a Claw session may receive (ENGINE_ENV_ALLOWLIST). */
export function filterEngineEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const allowed = new Set<string>(ENGINE_ENV_ALLOWLIST);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key)));
}
