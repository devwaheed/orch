/**
 * Exact UI labels and strings for specs (docs/specs/spec-queue.md §12).
 * Pure functions: no Node built-ins.
 */
import type { SpecAdvance, SpecRun } from '@orchagents/contracts';
import { isDependencySatisfied } from './scheduler.js';

export interface SpecLabelInfo {
  readonly pill: string;
  readonly secondLine: string;
}

export function formatSpecLabels(
  spec: SpecRun,
  allSpecs: readonly SpecRun[] = [],
  advance: SpecAdvance = 'verified',
): SpecLabelInfo {
  const tryNum = spec.attempt ?? 1;

  switch (spec.state) {
    case 'queued': {
      // Find unsatisfied dependencies
      const directDeps = spec.spec.depends_on;
      const specMap = new Map<string, SpecRun>(allSpecs.map((s) => [s.id as string, s]));

      let lowestUnsatisfied: string | null = null;
      for (const depId of directDeps) {
        const depSpec = specMap.get(depId);
        if (!depSpec || !isDependencySatisfied(depSpec.state, advance)) {
          lowestUnsatisfied = depId;
          break;
        }
      }

      if (lowestUnsatisfied) {
        return {
          pill: `Waiting for ${lowestUnsatisfied}`,
          secondLine: `Starts automatically when ${lowestUnsatisfied} is ${advance}`,
        };
      }
      return {
        pill: 'Queued',
        secondLine: 'Next in line',
      };
    }

    case 'blocked': {
      const blockedId = spec.blockedBy[0] ?? spec.spec.depends_on[0] ?? '';
      return {
        pill: `Blocked by ${blockedId}`,
        secondLine: `Won't run until ${blockedId} is retried`,
      };
    }

    case 'waiting_quota': {
      const agent = spec.implementer?.agent ?? spec.spec.agent ?? 'agent';
      return {
        pill: 'Waiting for an account',
        secondLine: `Starts when ${agent} has room`,
      };
    }

    case 'running':
      return {
        pill: `Running · try ${tryNum}`,
        secondLine: 'Step 1 of 3 · implement',
      };

    case 'verifying':
      return {
        pill: `Running · try ${tryNum}`,
        secondLine: 'Step 2 of 3 · checks',
      };

    case 'auditing': {
      const auditorAgent =
        spec.criteria.find((c) => c.auditor)?.auditor?.agent ?? 'agent';
      return {
        pill: `Running · try ${tryNum}`,
        secondLine: `Step 3 of 3 · audit by ${auditorAgent}`,
      };
    }

    case 'verified':
      return {
        pill: 'Verified · your review',
        secondLine: 'Ready in Review',
      };

    case 'approved': {
      const specMap = new Map<string, SpecRun>(allSpecs.map((s) => [s.id as string, s]));
      const directDeps = spec.spec.depends_on;
      const unmergedDep = directDeps.find((depId) => {
        const dep = specMap.get(depId);
        return dep && dep.state !== 'merged';
      });

      return {
        pill: 'Verified · approved',
        secondLine: unmergedDep ? `Merges after ${unmergedDep}` : 'Merging',
      };
    }

    case 'merged': {
      const deps = spec.spec.depends_on;
      return {
        pill: 'Verified · merged',
        secondLine: deps.length > 0 ? `Depends on ${deps.join(', ')}` : '',
      };
    }

    case 'needs_you':
      return {
        pill: `Stopped · ${tryNum} ${tryNum === 1 ? 'try' : 'tries'}`,
        secondLine: 'Queue paused here: needs you',
      };

    case 'skipped':
      return {
        pill: `Skipped · ${tryNum} ${tryNum === 1 ? 'try' : 'tries'}`,
        secondLine: 'Skipped; the queue moved on',
      };

    case 'cancelled':
      return {
        pill: 'Cancelled',
        secondLine: '',
      };
  }
}
