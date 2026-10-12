/**
 * Pure state machine and transitions table for the spec queue (docs/specs/spec-queue.md §4).
 * Enforced in this ONE place. Illegal transitions are rejected with `conflict`.
 */
import { err, ok } from '@orchagents/base';
import type { OrchError, Result, SpecId, SpecRun, SpecState } from '@orchagents/contracts';

/**
 * Valid transitions table from docs/specs/spec-queue.md §4:
 *
 * | From | To | When |
 * | --- | --- | --- |
 * | queued | running | Scheduler starts it (§5) and an account is available |
 * | queued | waiting_quota | Scheduler starts it but no account has room |
 * | queued | blocked | A dependency becomes needs_you, skipped or cancelled |
 * | waiting_quota | running | An account becomes available |
 * | blocked | queued | The blocking dependency is retried |
 * | running | verifying | The implementer finishes its turn |
 * | verifying | auditing | All check criteria and guardrails pass |
 * | verifying | running | A check fails and tries remain (attempt + 1) |
 * | auditing | verified | All audit criteria are met and every after_each gate passes |
 * | auditing | running | An audit criterion is not met, or a gate fails, and tries remain (attempt + 1) |
 * | verifying, auditing | needs_you | Fails on the last try and on_fail = retry-stop |
 * | verifying, auditing | skipped | Fails on the last try and on_fail = retry-skip |
 * | running | waiting_quota | The account hits its limit and no other account of that agent has room |
 * | verified | approved | You approve it in Review |
 * | verified | running | You request changes in Review (attempt + 1, does not count against retries) |
 * | approved | merged | Merge succeeds (§7) |
 * | approved | running | After rebasing on main, checks fail (attempt + 1, does not count against retries) |
 * | needs_you, skipped | queued | You choose Retry (attempt resets to none) |
 * | queued, blocked, waiting_quota, needs_you | skipped | You choose Skip |
 * | any except merged | cancelled | You cancel the queue |
 */
export const ALLOWED_TRANSITIONS: ReadonlyMap<SpecState, ReadonlySet<SpecState>> = new Map([
  ['queued', new Set<SpecState>(['running', 'waiting_quota', 'blocked', 'skipped', 'cancelled'])],
  ['waiting_quota', new Set<SpecState>(['running', 'skipped', 'cancelled'])],
  ['blocked', new Set<SpecState>(['queued', 'skipped', 'cancelled'])],
  ['running', new Set<SpecState>(['verifying', 'waiting_quota', 'cancelled'])],
  ['verifying', new Set<SpecState>(['auditing', 'running', 'needs_you', 'skipped', 'cancelled'])],
  ['auditing', new Set<SpecState>(['verified', 'running', 'needs_you', 'skipped', 'cancelled'])],
  ['verified', new Set<SpecState>(['approved', 'running', 'cancelled'])],
  ['approved', new Set<SpecState>(['merged', 'running', 'cancelled'])],
  ['needs_you', new Set<SpecState>(['queued', 'skipped', 'cancelled'])],
  ['skipped', new Set<SpecState>(['queued', 'cancelled'])],
  ['cancelled', new Set<SpecState>([])],
  ['merged', new Set<SpecState>([])],
]);

export function illegalTransitionError(from: SpecState, to: SpecState): OrchError {
  return {
    code: 'conflict',
    message: `Cannot transition spec from '${from}' to '${to}'.`,
    fix: 'Follow the states and transitions table in docs/specs/spec-queue.md §4.',
  };
}

/**
 * Returns true if the transition from `from` to `to` is permitted by spec-queue.md §4.
 */
export function canTransition(from: SpecState, to: SpecState): boolean {
  const allowed = ALLOWED_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

/**
 * Validates whether transitioning from `from` to `to` is allowed.
 * Rejects illegal transitions with an OrchError of code `conflict`.
 */
export function validateTransition(from: SpecState, to: SpecState): Result<void> {
  if (!canTransition(from, to)) {
    return err(illegalTransitionError(from, to));
  }
  return ok(undefined);
}

export interface TransitionOptions {
  readonly attemptAction?: 'increment' | 'reset' | 'keep';
  readonly blockedBy?: readonly SpecId[];
}

/**
 * Pure transition function: takes a SpecRun and target state, validates against the table,
 * and produces a new SpecRun with updated state, attempts, and dependencies according to §4/§8.
 */
export function transitionSpecState(
  spec: SpecRun,
  to: SpecState,
  options: TransitionOptions = {},
): Result<SpecRun> {
  const check = validateTransition(spec.state, to);
  if (!check.ok) {
    return check;
  }

  let attempt = spec.attempt;
  const action = options.attemptAction;

  if (action === 'increment') {
    attempt = (spec.attempt ?? 0) + 1;
  } else if (action === 'reset') {
    attempt = null;
  } else if (action === 'keep') {
    attempt = spec.attempt;
  } else {
    // Default transitions behavior:
    if ((spec.state === 'needs_you' || spec.state === 'skipped') && to === 'queued') {
      // Retry resets attempt to null (§4, §8)
      attempt = null;
    } else if (
      (spec.state === 'verifying' ||
        spec.state === 'auditing' ||
        spec.state === 'verified' ||
        spec.state === 'approved') &&
      to === 'running'
    ) {
      // Retrying after check/audit fail, or request changes, or rebase check fail (§4)
      attempt = (spec.attempt ?? 0) + 1;
    } else if (
      (spec.state === 'queued' || spec.state === 'waiting_quota') &&
      to === 'running' &&
      attempt === null
    ) {
      // First attempt
      attempt = 1;
    }
  }

  const blockedBy = to === 'blocked'
    ? [...(options.blockedBy ?? spec.blockedBy)]
    : to === 'queued' && spec.state === 'blocked'
      ? []
      : [...spec.blockedBy];

  // If retried from needs_you or skipped, reset criteria states to pending
  const criteria =
    (spec.state === 'needs_you' || spec.state === 'skipped') && to === 'queued'
      ? spec.criteria.map((c) => ({
          ...c,
          state: 'pending' as const,
          summary: null,
          auditor: null,
        }))
      : spec.criteria;

  const updated: SpecRun = {
    ...spec,
    state: to,
    attempt,
    blockedBy,
    criteria,
  };

  return ok(updated);
}
