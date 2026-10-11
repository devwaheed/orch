/**
 * Add-account dialog logic (Agent -> Name -> Sign in). Pure: the dialog renders these results.
 */
import type { Account, AgentId, AgentInfo, Os, SignInResult } from '@orch/contracts';
import { accountsStrings as S, OS_NAME } from './strings.js';

export type AddStep = 1 | 2 | 3;

export interface AgentChoice {
  readonly agent: AgentId;
  readonly name: string;
  readonly sub: string;
  readonly disabled: boolean;
  /** true when the sub-line is a warning (unverified, or single OS already full). */
  readonly warn: boolean;
}

/** Agents to pick from. Single-account OSes grey out once an account exists (ACC-03). */
export function addAgentChoices(
  agents: readonly AgentInfo[],
  accounts: readonly Account[],
  os: Os,
): AgentChoice[] {
  return agents.map((agent) => {
    const count = accounts.filter((a) => a.agent === agent.id).length;
    const full = agent.support === 'single' && count >= 1;
    const unverified = agent.support === 'unverified';
    const sub = full
      ? S.add.oneOnOs(OS_NAME[os])
      : unverified
        ? S.add.testFirst(OS_NAME[os])
        : S.add.addedSeveral(count);
    return { agent: agent.id, name: agent.displayName, sub, disabled: full, warn: full || unverified };
  });
}

/** Next (or Done on step 3) is enabled only when the step's requirement is met. */
export function canAdvance(step: AddStep, agent: AgentId | null, signIn: SignInResult | null): boolean {
  if (step === 1) return agent !== null;
  if (step === 2) return true;
  return signInPassed(signIn);
}

export function signInPassed(result: SignInResult | null): boolean {
  return !!result && result.signedIn && result.keptSeparate && result.ready;
}

export interface CheckRow {
  readonly key: 'signedIn' | 'keptSeparate' | 'ready';
  readonly title: string;
  /** Null when there is no extra text to show (identity not checked, no other accounts). */
  readonly text: string | null;
  readonly ok: boolean;
}

/**
 * The three checks after sign-in. identity 'unknown' means the agent has no status
 * command, so the email is not shown and the row carries no "as ..." text.
 */
export function signInChecks(result: SignInResult, otherLabels: readonly string[]): CheckRow[] {
  const email = result.identity === 'checked' ? result.emailMasked : undefined;
  return [
    {
      key: 'signedIn',
      title: S.add.checkSignedIn,
      text: email ? S.add.checkSignedInAs(email) : null,
      ok: result.signedIn,
    },
    {
      key: 'keptSeparate',
      title: S.add.checkKeptSeparate,
      text: otherLabels.length > 0 ? S.add.checkKeptSeparateOthers(S.add.joinOthers(otherLabels)) : S.add.checkKeptSeparateNew,
      ok: result.keptSeparate,
    },
    {
      key: 'ready',
      title: S.add.checkReady,
      text: S.add.checkReadyText,
      ok: result.ready,
    },
  ];
}

/** Labels of the accounts an agent already has, for "Kept separate". */
export function existingLabels(accounts: readonly Account[], agent: AgentId | null): string[] {
  if (!agent) return [];
  return accounts.filter((a) => a.agent === agent).map((a) => a.name);
}

export function cliLine(agent: AgentId | null, name: string): string {
  return agent ? S.add.cli(agent, name) : S.add.cliPlaceholder;
}

export function stepLabel(step: AddStep): string {
  return S.add.stepLabel(step);
}
