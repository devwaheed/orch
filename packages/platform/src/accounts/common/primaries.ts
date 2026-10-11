/**
 * Pure helpers for the one-primary rule (ACC-05) and for shaping config edits.
 * Kept free of I/O so the node service and its tests share one rule.
 */
import type { AccountId, AgentId } from '@orch/contracts';

/** Minimal shape of a row the rule needs. */
export interface PrimaryCandidate {
  readonly id: AccountId;
  readonly agent: AgentId;
  readonly createdAt: string;
}

/**
 * ACC-05: for every agent that has accounts, exactly one must be primary.
 * `isPrimary` reports the current flag. Returns, per agent, the id that must
 * become primary, or nothing when the agent already has one.
 * `candidates` must be oldest first per agent. A primary that is no longer a
 * candidate does not count.
 */
export function primaryToPromote(
  candidates: readonly PrimaryCandidate[],
  isPrimary: (id: AccountId) => boolean,
): Map<AgentId, AccountId> {
  const promote = new Map<AgentId, AccountId>();
  const byAgent = new Map<AgentId, PrimaryCandidate[]>();
  for (const candidate of candidates) {
    const list = byAgent.get(candidate.agent) ?? [];
    list.push(candidate);
    byAgent.set(candidate.agent, list);
  }
  for (const [agent, list] of byAgent) {
    if (list.some((c) => isPrimary(c.id))) continue;
    const oldest = list[0];
    if (oldest) promote.set(agent, oldest.id);
  }
  return promote;
}
