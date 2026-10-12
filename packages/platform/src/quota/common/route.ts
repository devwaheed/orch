/**
 * Account routing (ACC-05, ACC-06, ACC-07). Pure: the service computes each
 * candidate's state (usage, limit, active runs) and this picks one.
 */
import type { AccountId, AgentId, PickAccountResult, RoutingRule } from '@orchagents/contracts';

export interface RouteCandidate {
  id: AccountId;
  primary: boolean;
  use: boolean;
  signedOut: boolean;
  /** Null = usage unknown. */
  usedPct: number | null;
  limited: boolean;
  /** Only meaningful when `limited`. */
  resetsAt: string | null;
  activeRuns: number;
}

export interface RouteInput {
  agent: AgentId;
  rule: RoutingRule;
  nearLimitPct: number;
  maxRunsPerAccount: number;
  /** Oldest account first. Ties go to the earlier entry (ACC-06). */
  candidates: readonly RouteCandidate[];
}

/**
 * Picks an account, or says why none can take the run.
 *
 * - `none`: no account is signed in and set to `use`.
 * - `wait`: usable accounts exist, but all are limited or at max runs. `until`
 *   is the earliest reset among the limited ones, or null.
 * - `account`: the pick.
 */
export function routeAccount(input: RouteInput): PickAccountResult {
  const { agent, candidates } = input;
  const usable = candidates.filter((c) => c.use && !c.signedOut);
  if (usable.length === 0) {
    return { kind: 'none', agent, reason: `No ${agent} account is signed in and set to use.` };
  }

  const eligible = usable.filter((c) => !c.limited && c.activeRuns < input.maxRunsPerAccount);
  if (eligible.length === 0) {
    return { kind: 'wait', agent, until: earliestReset(usable) };
  }

  const pick = (c: RouteCandidate): PickAccountResult => ({ kind: 'account', accountId: c.id });
  const headroomOrder = (list: readonly RouteCandidate[]): RouteCandidate[] =>
    [...list].sort((a, b) => headroomKey(a) - headroomKey(b) || candidates.indexOf(a) - candidates.indexOf(b));

  const [lowest] = headroomOrder(eligible);
  if (input.rule === 'most-headroom') {
    return lowest ? pick(lowest) : { kind: 'wait', agent, until: earliestReset(usable) };
  }

  // primary-first: the primary until it is near its limit, then the backup with the lowest usage.
  const primary = eligible.find((c) => c.primary);
  if (primary && !isNear(primary, input.nearLimitPct)) {
    return pick(primary);
  }
  const [backup] = headroomOrder(eligible.filter((c) => !c.primary));
  // With no backup able to take the run, the near-limit primary still has room, so it is used.
  const choice = backup ?? primary ?? lowest;
  return choice ? pick(choice) : { kind: 'wait', agent, until: earliestReset(usable) };
}

function isNear(c: RouteCandidate, nearLimitPct: number): boolean {
  return c.usedPct !== null && c.usedPct >= nearLimitPct;
}

/** Unknown usage ranks after every known value. */
function headroomKey(c: RouteCandidate): number {
  return c.usedPct ?? Number.POSITIVE_INFINITY;
}

function earliestReset(usable: readonly RouteCandidate[]): string | null {
  let earliest: string | null = null;
  for (const c of usable) {
    if (!c.limited || c.resetsAt === null) {
      continue;
    }
    if (earliest === null || Date.parse(c.resetsAt) < Date.parse(earliest)) {
      earliest = c.resetsAt;
    }
  }
  return earliest;
}
