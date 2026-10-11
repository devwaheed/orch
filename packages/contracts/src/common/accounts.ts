import { z } from 'zod';
import { AccountId, AgentId, Os, Timestamp } from './ids.js';

export const AccountState = z.enum(['available', 'near_limit', 'limited', 'estimated', 'signed_out']);
export type AccountState = z.infer<typeof AccountState>;

/** How many accounts an agent supports on an OS (verified by `orch doctor`). */
export const MultiAccountSupport = z.enum(['parallel', 'single', 'unverified']);
export type MultiAccountSupport = z.infer<typeof MultiAccountSupport>;

export const ProviderLogin = z.object({
  /** e.g. "GitHub Copilot", "OpenAI" — OpenCode only */
  provider: z.string(),
  kind: z.enum(['subscription', 'api_key']),
});
export type ProviderLogin = z.infer<typeof ProviderLogin>;

export const Account = z.object({
  id: AccountId,
  agent: AgentId,
  /** Display name, e.g. "Team" */
  name: z.string().min(1).max(40),
  primary: z.boolean(),
  use: z.boolean(),
  state: AccountState,
  /** Masked, e.g. "a•••@acme.dev". Never the full address. */
  emailMasked: z.string().optional(),
  plan: z.string().optional(),
  /** Absolute path of the profile folder. Only the profiles service writes here. */
  profileDir: z.string(),
  skillsShared: z.boolean(),
  providers: z.array(ProviderLogin).optional(),
  lastIsolationCheck: z.object({ at: Timestamp, ok: z.boolean(), detail: z.string().optional() }).optional(),
});
export type Account = z.infer<typeof Account>;

export const AgentInfo = z.object({
  id: AgentId,
  displayName: z.string(),
  command: z.string(),
  installed: z.boolean(),
  version: z.string().optional(),
  /** Support on the current OS */
  support: MultiAccountSupport,
  supportByOs: z.record(Os, MultiAccountSupport),
  /** The setting orch uses to separate accounts, shown in the UI ("via CODEX_HOME") */
  accountSetting: z.string(),
  sharedSkillsDir: z.string().nullable(),
  sharedSkillsCount: z.number().int().nonnegative(),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

export const AddAccountRequest = z.object({
  agent: AgentId,
  name: z.string().min(1).max(40),
});
export type AddAccountRequest = z.infer<typeof AddAccountRequest>;

/** Result of the three checks shown after sign-in. */
export const SignInResult = z.object({
  accountId: AccountId,
  signedIn: z.boolean(),
  emailMasked: z.string().optional(),
  keptSeparate: z.boolean(),
  ready: z.boolean(),
  /** 'unknown' when the agent has no sign-in status command, so the identity was not checked. */
  identity: z.enum(['checked', 'unknown']),
});
export type SignInResult = z.infer<typeof SignInResult>;
