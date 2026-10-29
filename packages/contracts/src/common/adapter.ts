/**
 * The agent adapter contract. One implementation per agent lives in
 * packages/platform/src/adapters/node/<agent>.ts. Adapters are the ONLY code
 * allowed to know an agent's settings, folders, login and output formats.
 */
import type { AccountId, AgentId, Os } from './ids.js';
import type { MultiAccountSupport, ProviderLogin } from './accounts.js';
import type { QuotaObservation } from './quota.js';

export interface CommandSpec {
  argv: readonly string[];
  /** Added to the process environment; must only contain ENGINE_ENV_ALLOWLIST keys */
  env: Readonly<Record<string, string>>;
  cwd?: string;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly displayName: string;
  readonly command: string;
  /** Shown in the UI as "via …" */
  readonly accountSetting: string;
  readonly supportByOs: Readonly<Record<Os, MultiAccountSupport>>;

  /** Environment that points the agent at one account's profile folder. */
  accountEnv(profileDir: string, os: Os): Readonly<Record<string, string>>;

  /** One-time setup of a new profile folder before login (e.g. force file-based login for Codex). */
  prepareProfile(profileDir: string, os: Os): Promise<void>;

  /** The agent's own interactive login, run inside the profile. orch never sees credentials. */
  loginCommand(profileDir: string, os: Os): CommandSpec;

  /**
   * The agent's interactive CLI command, optionally resuming an existing session.
   * If sessionId is provided and supported, resumes that session; otherwise starts fresh.
   */
  resumeCommand(profileDir: string, os: Os, sessionId?: string | null): CommandSpec;

  /**
   * Ask the agent which account is signed in. parseWhoAmI gets the status command's output
   * (stdout and stderr) after a zero exit: null if signed out; no emailMasked when the agent
   * says it is signed in but not as whom (never guess one).
   */
  whoAmICommand(profileDir: string, os: Os): CommandSpec | null;
  parseWhoAmI(output: string): { emailMasked?: string; plan?: string } | null;
  /** Optional: provider logins inside the account (ACC-10). Parsed from the same output as parseWhoAmI. */
  parseProviders?(stdout: string): ProviderLogin[];

  /** The user's normal personal skills folder for this agent, or null if none. */
  sharedSkillsDir(homeDir: string, os: Os): string | null;
  /** Where that folder must be linked inside a profile, or null if the agent can't use profile skills. */
  profileSkillsDir(profileDir: string, os: Os): string | null;

  /** Parse one line of agent output or one error into a usage signal, if it contains one. */
  parseQuotaSignal(accountId: AccountId, line: string): QuotaObservation | null;

  /** Version range this adapter is tested against (semver range). */
  readonly testedVersions: string;
}
