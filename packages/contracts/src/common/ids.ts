/**
 * Identifiers shared by every process. `common` code: plain TypeScript only,
 * no Node, DOM or Electron APIs (see docs/architecture.md, "Environments").
 */
import { z } from 'zod';

export const AgentId = z.enum(['claude', 'codex', 'gemini', 'opencode', 'agy']);
export type AgentId = z.infer<typeof AgentId>;

export const Os = z.enum(['macos', 'linux', 'windows']);
export type Os = z.infer<typeof Os>;

/** `<agent>-<slug>`, e.g. `codex-team`. Also the profile folder name. */
export const AccountId = z
  .string()
  .regex(/^(claude|codex|gemini|opencode|agy)-[a-z0-9]+(-[a-z0-9]+)*$/)
  .brand<'AccountId'>();
export type AccountId = z.infer<typeof AccountId>;

export const JobId = z.string().regex(/^j-[0-9a-z]+$/).brand<'JobId'>();
export type JobId = z.infer<typeof JobId>;

export const RunId = z.string().regex(/^r-[0-9a-z]+$/).brand<'RunId'>();
export type RunId = z.infer<typeof RunId>;

/** orch's own session id. The agent CLI's id is stored separately as `cliSessionId`. */
export const SessionId = z.string().regex(/^s-[0-9a-z]+$/).brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionId>;

/** A worktree is identified by its branch, e.g. `orch/r-02`. */
export const WorktreeId = z.string().regex(/^orch\/[a-z0-9-]+$/).brand<'WorktreeId'>();
export type WorktreeId = z.infer<typeof WorktreeId>;

export const ShellId = z.string().regex(/^sh-[0-9a-z]+$/).brand<'ShellId'>();
export type ShellId = z.infer<typeof ShellId>;

/** ISO-8601 timestamp in UTC. */
export const Timestamp = z.string().datetime({ offset: false });
export type Timestamp = z.infer<typeof Timestamp>;
