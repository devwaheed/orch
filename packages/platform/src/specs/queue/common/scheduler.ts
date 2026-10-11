/**
 * Pure scheduler logic (docs/specs/spec-queue.md §5).
 * Pure functions: no Node built-ins.
 */
import type {
  AgentId,
  SpecAdvance,
  SpecId,
  SpecOrder,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
} from '@orch/contracts';
import { scopesOverlap } from './overlap.js';
import { buildDependencyGraph } from './reorder.js';
import { transitionSpecState } from './stateMachine.js';

export const AGENT_ORDER: readonly AgentId[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'agy',
] as const;

export const DEFAULT_SPEC_QUEUE_SETTINGS: SpecQueueSettings = {
  source: 'docs/specs',
  order: 'waves',
  advance: 'verified',
  on_fail: 'retry-stop',
  max_parallel: 2,
  retries: 2,
  after_each: [],
};

export const ACTIVE_STATES = new Set<SpecState>([
  'running',
  'verifying',
  'auditing',
  'waiting_quota',
]);

/**
 * Checks whether a dependency spec's state satisfies the advance rule (§5).
 */
export function isDependencySatisfied(depState: SpecState, advance: SpecAdvance): boolean {
  switch (advance) {
    case 'verified':
      return depState === 'verified' || depState === 'approved' || depState === 'merged';
    case 'approved':
      return depState === 'approved' || depState === 'merged';
    case 'merged':
      return depState === 'merged';
  }
}

export interface SchedulerContext {
  /** Checks if any account for this agent currently has room */
  hasRoom?: (agent: AgentId) => boolean;
}

export interface ScheduleResult {
  readonly updatedSpecs: SpecRun[];
  readonly specsToStart: SpecRun[];
}

/**
 * Runs the scheduling algorithm per docs/specs/spec-queue.md §5:
 *
 * ```text
 * if queue.paused: return
 * active   = specs in {running, verifying, auditing, waiting_quota}
 * capacity = 1 if order == strict else max_parallel
 *
 * satisfied(dep) =
 *   advance == verified -> dep.state in {verified, approved, merged}
 *   advance == approved -> dep.state in {approved, merged}
 *   advance == merged   -> dep.state == merged
 *
 * for spec in specs where state == queued, by position ascending:
 *   if any dependency (direct or indirect) is needs_you, skipped or cancelled:
 *       set spec blocked (blockedBy = those ids); continue
 *   if not all direct dependencies satisfied: continue
 *   if len(active) >= capacity: break
 *   if order == waves and active is not empty:
 *       if spec.scope is empty: continue              # runs only alone
 *       if overlaps(spec.scope, any active spec's scope): continue
 *   if order == strict and active is not empty: break
 *   start(spec); add to active
 * ```
 */
export function scheduleQueue(
  queue: SpecQueue,
  context: SchedulerContext = {},
): ScheduleResult {
  const specsMap = new Map<SpecId, SpecRun>();
  for (const s of queue.specs) {
    specsMap.set(s.id, s);
  }

  const depGraph = buildDependencyGraph(queue.specs);

  // 1. First pass: Handle unblocking of blocked specs whose blocking dependencies were retried (§4, §8)
  const currentSpecs: SpecRun[] = queue.specs.map((s) => {
    if (s.state === 'blocked') {
      const allDeps = depGraph.get(s.id) ?? new Set<SpecId>();
      const blockingIds: SpecId[] = [];
      for (const depId of allDeps) {
        const depSpec = specsMap.get(depId);
        if (
          depSpec &&
          (depSpec.state === 'needs_you' ||
            depSpec.state === 'skipped' ||
            depSpec.state === 'cancelled')
        ) {
          blockingIds.push(depId);
        }
      }
      if (blockingIds.length === 0) {
        // Unblock: blocked -> queued
        const res = transitionSpecState(s, 'queued');
        return res.ok ? res.value : s;
      }
      return { ...s, blockedBy: blockingIds };
    }
    return s;
  });

  if (queue.paused) {
    return {
      updatedSpecs: currentSpecs,
      specsToStart: [],
    };
  }

  const order: SpecOrder = queue.settings.order;
  const advance: SpecAdvance = queue.settings.advance;
  const maxParallel = queue.settings.max_parallel;
  const capacity = order === 'strict' ? 1 : maxParallel;

  // Active specs currently running / verifying / auditing / waiting_quota
  const active: SpecRun[] = currentSpecs.filter((s) => ACTIVE_STATES.has(s.state));

  // Sort specs by position ascending (§5)
  const sorted = [...currentSpecs].sort((a, b) => a.position - b.position);
  const specsToStart: SpecRun[] = [];
  const updatedSpecsMap = new Map<SpecId, SpecRun>();
  for (const s of currentSpecs) {
    updatedSpecsMap.set(s.id, s);
  }

  for (let i = 0; i < sorted.length; i++) {
    const spec = updatedSpecsMap.get(sorted[i]!.id)!;

    if (spec.state !== 'queued') {
      continue;
    }

    const allDeps = depGraph.get(spec.id) ?? new Set<SpecId>();

    // Check if any dependency (direct or indirect) is needs_you, skipped or cancelled
    const blockingIds: SpecId[] = [];
    for (const depId of allDeps) {
      const depSpec = updatedSpecsMap.get(depId);
      if (
        depSpec &&
        (depSpec.state === 'needs_you' ||
          depSpec.state === 'skipped' ||
          depSpec.state === 'cancelled')
      ) {
        blockingIds.push(depId);
      }
    }

    if (blockingIds.length > 0) {
      // Set spec blocked (blockedBy = those ids); continue
      const blockedRes = transitionSpecState(spec, 'blocked', { blockedBy: blockingIds });
      if (blockedRes.ok) {
        updatedSpecsMap.set(spec.id, blockedRes.value);
      }
      continue;
    }

    // Check if all direct dependencies are satisfied
    const directDeps = spec.spec.depends_on as SpecId[];
    const allDirectSatisfied = directDeps.every((depId) => {
      const depSpec = updatedSpecsMap.get(depId);
      return depSpec !== undefined && isDependencySatisfied(depSpec.state, advance);
    });

    if (!allDirectSatisfied) {
      continue;
    }

    if (active.length >= capacity) {
      break;
    }

    if (order === 'waves' && active.length > 0) {
      // If spec.scope is empty: continue (runs only alone)
      if (spec.spec.scope.length === 0) {
        continue;
      }

      // If overlaps(spec.scope, any active spec's scope): continue
      const hasOverlap = active.some((activeSpec) =>
        scopesOverlap(spec.spec.scope, activeSpec.spec.scope),
      );
      if (hasOverlap) {
        continue;
      }
    }

    if (order === 'strict' && active.length > 0) {
      break;
    }

    // Determine target state (running or waiting_quota)
    // Check implementer agent room
    let targetState: SpecState = 'running';
    if (context.hasRoom) {
      let agentHasRoom = false;
      if (spec.spec.agent !== 'auto' && spec.spec.agent) {
        agentHasRoom = context.hasRoom(spec.spec.agent as AgentId);
      } else {
        agentHasRoom = AGENT_ORDER.some((agent) => context.hasRoom!(agent));
      }

      if (!agentHasRoom) {
        targetState = 'waiting_quota';
      }
    }

    const startRes = transitionSpecState(spec, targetState);
    if (startRes.ok) {
      const started = startRes.value;
      updatedSpecsMap.set(spec.id, started);
      specsToStart.push(started);
      active.push(started);
    }
  }

  const finalSpecs = currentSpecs.map((s) => updatedSpecsMap.get(s.id) ?? s);
  return {
    updatedSpecs: finalSpecs,
    specsToStart,
  };
}
