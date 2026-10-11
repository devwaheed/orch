/**
 * The gardener's account choice (TRU-04): the primary account of the agent with
 * the highest trust level; ties go to the agent earlier in the ACC order. An
 * agent whose primary account cannot be used is skipped (ACC-06 excludes
 * accounts with use off, signed out or limited).
 */
import type { Account, AccountId, AgentId, TrustLevel } from '@orch/contracts';

/** The agent order of PRD-05 / LOCKED ACC, used for ties. */
export const GARDENER_AGENT_ORDER: readonly AgentId[] = ['claude', 'codex', 'gemini', 'opencode', 'agy'];

/** ACC-06: never picked. */
const UNUSABLE_STATES: readonly Account['state'][] = ['limited', 'signed_out'];

export interface GardenerChoice {
  readonly agent: AgentId;
  readonly accountId: AccountId;
}

/** True when ACC-06 allows this account to be picked. */
export function isUsable(account: Account): boolean {
  return account.use && !UNUSABLE_STATES.includes(account.state);
}

/**
 * The gardener's agent and account, or null when no agent has a usable primary
 * account (the week is then skipped). `levelOf` is TRU-02's level on record.
 */
export function chooseGardenerAccount(
  accounts: readonly Account[],
  levelOf: (agent: AgentId) => TrustLevel,
): GardenerChoice | null {
  let best: { agent: AgentId; accountId: AccountId; level: TrustLevel } | null = null;
  for (const agent of GARDENER_AGENT_ORDER) {
    const primary = accounts.find((account) => account.agent === agent && account.primary);
    if (!primary || !isUsable(primary)) {
      continue;
    }
    const level = levelOf(agent);
    // Strictly higher wins; an equal level keeps the earlier agent in ACC order.
    if (best === null || level > best.level) {
      best = { agent, accountId: primary.id, level };
    }
  }
  return best === null ? null : { agent: best.agent, accountId: best.accountId };
}
