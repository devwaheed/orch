/**
 * Accounts service contract (ACC-01..ACC-09). Plain TypeScript: the
 * implementation lives in ../node. The process runner is a port so that this
 * package never starts a process itself (AGENTS.md: only adapters, git, shells
 * and the engine host may start processes).
 */
import { createServiceId } from '@orchagents/base';
import type { AccountId, AgentAdapter, AgentId, CommandSpec, Os } from '@orchagents/contracts';

/** What a finished process reported. `exitCode` is null when it ended by signal. */
export interface ProcessRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  /** Non-interactive runs only. */
  readonly stderr?: string;
}

export interface IAccountProcessRunner {
  /**
   * Runs `spec.argv` with `spec.env` added to the environment. Never a shell string.
   * `interactive` lets the agent's own login use the user's terminal (the caller decides
   * the stdio). Resolves null when the process could not start at all.
   */
  run(spec: CommandSpec, options: { readonly interactive: boolean }): Promise<ProcessRun | null>;
}

export const IAccountProcessRunner = createServiceId<IAccountProcessRunner>('accountProcessRunner');

/** Adapters the accounts service knows about, keyed by agent id. */
export type AdapterLookup = (agent: AgentId) => AgentAdapter | undefined;

/** The fields of one account row that the accounts service needs for decisions. */
export interface AccountRecord {
  readonly id: AccountId;
  readonly agent: AgentId;
  readonly createdAt: string;
  readonly emailMasked: string | null;
}

/** `codex-team` -> `team`: the key used under `accounts.<agent>` in accounts.yaml. */
export function accountKey(accountId: string, agent: AgentId): string {
  return accountId.slice(agent.length + 1);
}

/** The adapter's support on the current OS (ACC-03). */
export function supportOnOs(adapter: AgentAdapter, os: Os) {
  return adapter.supportByOs[os];
}

/**
 * Sorts oldest first by created_at. Ties keep the order the rows came in
 * (the store's insertion order).
 */
export function oldestFirst<T extends { readonly createdAt: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.createdAt < b.row.createdAt ? -1 : a.row.createdAt > b.row.createdAt ? 1 : a.index - b.index))
    .map((entry) => entry.row);
}

export interface SignInEvidence {
  /** The agent's own login command finished successfully. */
  readonly loginOk: boolean;
  /** Whether the agent offers a status command at all (adapter.whoAmICommand !== null). */
  readonly identityCheckAvailable: boolean;
  /** The status command reported a login (with or without an email). */
  readonly statusSignedIn: boolean;
  /** Masked identity from who-am-I, when it found one. */
  readonly emailMasked: string | null;
  /** The profile folder's settings stay inside that folder (profiles.sessionEnv succeeded). */
  readonly envInsideProfile: boolean;
  /** Other accounts of the same agent, with their masked identity when known. */
  readonly others: readonly { readonly id: AccountId; readonly emailMasked: string | null }[];
}

export interface SignInOutcome {
  readonly signedIn: boolean;
  /** Masked identity, or null when the identity check is unknown or found nothing. */
  readonly emailMasked: string | null;
  readonly identityKnown: boolean;
  readonly keptSeparate: boolean;
  readonly ready: boolean;
}

/**
 * The three checks after sign-in (SignInResult; design/screens.md "Add account").
 * - Signed in: who-am-I found a login (some agents' status names no email, so the
 *   identity can stay unknown). With no status command, the agent's own login finishing
 *   is the evidence and the identity stays unknown (not failed).
 * - Kept separate: the settings stay in this account's folder, and this login is not the
 *   same masked identity as another account of the same agent.
 * - Ready: signed in and kept separate.
 */
export function evaluateSignIn(evidence: SignInEvidence): SignInOutcome {
  const identityKnown = evidence.identityCheckAvailable && evidence.emailMasked !== null;
  // The status command is the better evidence: a login can end non-zero after it signed in.
  const signedIn = evidence.identityCheckAvailable ? evidence.statusSignedIn : evidence.loginOk;

  const clash =
    identityKnown && evidence.emailMasked !== null
      ? evidence.others.some((other) => other.emailMasked === evidence.emailMasked)
      : false;
  const keptSeparate = evidence.envInsideProfile && !clash;
  return {
    signedIn,
    emailMasked: identityKnown ? evidence.emailMasked : null,
    identityKnown,
    keptSeparate,
    ready: signedIn && keptSeparate,
  };
}
