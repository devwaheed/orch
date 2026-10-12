/**
 * Formatting logic for the specs CLI, matching docs/specs/spec-queue.md §11, §12, §13
 * and design/prototype/Terminal.dc.html.
 */
import type {
  SpecAdvance,
  SpecInitReport,
  SpecLoadProblem,
  SpecQueue,
  SpecRun,
  SpecState,
} from '@orchagents/contracts';
import { formatTable, formatTimestampTime } from '../../common/format.js';

export function isDepSatisfied(depState: SpecState, advance: SpecAdvance): boolean {
  if (advance === 'verified') {
    return depState === 'verified' || depState === 'approved' || depState === 'merged';
  }
  if (advance === 'approved') {
    return depState === 'approved' || depState === 'merged';
  }
  if (advance === 'merged') {
    return depState === 'merged';
  }
  return false;
}

/**
 * Returns pill and second-line detail strings matching docs/specs/spec-queue.md §12 word for word.
 */
export function formatSpecStatus(
  spec: SpecRun,
  queue: SpecQueue,
): { pill: string; detail: string } {
  switch (spec.state) {
    case 'queued': {
      const deps = spec.spec.depends_on;
      const unsatisfied = deps.filter((depId) => {
        const depSpec = queue.specs.find((s) => s.id === depId);
        if (!depSpec) {
          return true;
        }
        return !isDepSatisfied(depSpec.state, queue.settings.advance);
      });

      if (unsatisfied.length > 0) {
        const lowestUnsatisfied = [...unsatisfied].sort(
          (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
        )[0]!;
        return {
          pill: `Waiting for ${lowestUnsatisfied}`,
          detail: `Starts automatically when ${lowestUnsatisfied} is ${queue.settings.advance}`,
        };
      }

      return {
        pill: 'Queued',
        detail: 'Next in line',
      };
    }

    case 'blocked': {
      const blockedId = spec.blockedBy[0] ?? spec.spec.depends_on[0] ?? '';
      return {
        pill: `Blocked by ${blockedId}`,
        detail: `Won't run until ${blockedId} is retried`,
      };
    }

    case 'waiting_quota': {
      const agent =
        spec.implementer?.agent ?? (spec.spec.agent !== 'auto' ? spec.spec.agent : 'agent');
      const timeStr = formatTimestampTime(spec.startedAt);
      return {
        pill: 'Waiting for an account',
        detail: `Starts when ${agent} has room (${timeStr})`,
      };
    }

    case 'running': {
      const tryNum = spec.attempt ?? 1;
      return {
        pill: `Running · try ${tryNum}`,
        detail: 'Step 1 of 3 · implement',
      };
    }

    case 'verifying': {
      const tryNum = spec.attempt ?? 1;
      return {
        pill: `Running · try ${tryNum}`,
        detail: 'Step 2 of 3 · checks',
      };
    }

    case 'auditing': {
      const tryNum = spec.attempt ?? 1;
      const auditorAgent = spec.criteria.find((c) => c.auditor !== null)?.auditor?.agent;
      const detail = auditorAgent
        ? `Step 3 of 3 · audit by ${auditorAgent}`
        : 'Step 3 of 3 · audit';
      return {
        pill: `Running · try ${tryNum}`,
        detail,
      };
    }

    case 'verified': {
      return {
        pill: 'Verified · your review',
        detail: 'Ready in Review',
      };
    }

    case 'approved': {
      const deps = spec.spec.depends_on;
      const unmergedDep = deps.find((depId) => {
        const depSpec = queue.specs.find((s) => s.id === depId);
        return !depSpec || depSpec.state !== 'merged';
      });

      if (unmergedDep) {
        return {
          pill: 'Verified · approved',
          detail: `Merges after ${unmergedDep}`,
        };
      }

      const earlierApproved = queue.specs.find(
        (s) => s.state === 'approved' && s.position < spec.position,
      );
      if (earlierApproved) {
        return {
          pill: 'Verified · approved',
          detail: `Merges after ${earlierApproved.id}`,
        };
      }

      return {
        pill: 'Verified · approved',
        detail: 'Merging',
      };
    }

    case 'merged': {
      const deps = spec.spec.depends_on;
      const detail = deps.length > 0 ? `Depends on ${deps.join(', ')}` : '';
      return {
        pill: 'Verified · merged',
        detail,
      };
    }

    case 'needs_you': {
      const tries = spec.attempt ?? 1;
      return {
        pill: `Stopped · ${tries} ${tries === 1 ? 'try' : 'tries'}`,
        detail: 'Queue paused here: needs you',
      };
    }

    case 'skipped': {
      const tries = spec.attempt ?? 1;
      return {
        pill: `Skipped · ${tries} ${tries === 1 ? 'try' : 'tries'}`,
        detail: 'Skipped; the queue moved on',
      };
    }

    case 'cancelled': {
      return {
        pill: 'Cancelled',
        detail: '',
      };
    }
  }
}

/**
 * Formats the spec queue as a table, one line per spec.
 */
export function formatSpecsTable(queue: SpecQueue): string {
  if (queue.specs.length === 0) {
    return 'No specs in queue.';
  }

  const sortedSpecs = [...queue.specs].sort((a, b) => a.position - b.position);
  const headers = ['SPEC', 'TITLE', 'STATUS', 'DETAIL'];
  const rows = sortedSpecs.map((spec) => {
    const { pill, detail } = formatSpecStatus(spec, queue);
    return [spec.id, spec.spec.title, pill, detail];
  });

  return formatTable(headers, rows);
}

/**
 * Formats spec load problems using exact messages from docs/specs/spec-queue.md §11.
 */
export function formatProblems(problems: readonly SpecLoadProblem[]): string {
  return problems.map((p) => p.message).join('\n');
}

/**
 * Formats report of added front-matter skeletons from orch specs init (§13).
 */
export function formatBmadInitReport(report: SpecInitReport): string {
  if (report.added.length === 0) {
    return 'No stories needed initialization.';
  }

  const header = `Added front matter to ${report.added.length} ${
    report.added.length === 1 ? 'story' : 'stories'
  }:`;
  const items = report.added.map(
    (item) =>
      `  ${item.file}: spec ${item.id} · ${item.title} (${item.criteriaCount} criteria)`,
  );
  return [header, ...items].join('\n');
}
