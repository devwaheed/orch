/**
 * Derives the shell's status values (status bar, activity badges) from the data
 * stores and writes them to workbenchStore. Writes only changed values.
 */
import { shellStrings } from '../../parts/strings.js';
import { dataStrings } from '../dataStrings.js';
import { useWorkbenchStore, type LimitedAccountInfo } from '../workbenchStore.js';
import { useAccountsStore } from './accounts.js';
import { useEngineStore } from './engine.js';
import { useJobsStore, useRunsStore } from './work.js';
import { useQuotaStore } from './quota.js';
import { useReviewStore } from './review.js';
import { useSessionsStore } from './sessions.js';
import { useSpecsStore } from './specs.js';

export interface ShellStatus {
  readonly engineHealthy: boolean;
  readonly statusRuns: string;
  readonly limitedAccount: LimitedAccountInfo | null;
  readonly signedOutCount: number;
  readonly badges: {
    readonly specs: number;
    readonly review: number;
    readonly sessions: number;
    readonly accounts: number;
  };
}

/** Formats a reset time for the status bar. Unknown or invalid times get the fallback copy. */
export function formatResetTime(resetsAt: string | null): string {
  if (resetsAt === null) {
    return dataStrings.statusBar.resetTimeUnknown;
  }
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) {
    return dataStrings.statusBar.resetTimeUnknown;
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Pure derivation, read from the current store states. */
export function computeShellStatus(): ShellStatus {
  const accounts = useAccountsStore.getState();
  const quota = useQuotaStore.getState();
  const runs = useRunsStore.getState().runs;
  const specs = useSpecsStore.getState().queues;
  const worktrees = useReviewStore.getState().worktrees;
  const sessions = useSessionsStore.getState().sessions;
  const engine = useEngineStore.getState();

  const limited = accounts.accounts.find((a) => a.state === 'limited');
  let limitedAccount: LimitedAccountInfo | null = null;
  if (limited) {
    const agent = accounts.agents.find((a) => a.id === limited.agent);
    const windowResetsAt =
      Object.values(quota.windows).find(
        (w) => w.accountId === limited.id && (w.usedPct >= 100 || Boolean(w.resetsAt)),
      )?.resetsAt ?? null;
    const resetsAt = quota.limits[limited.id]?.resetsAt ?? windowResetsAt;
    limitedAccount = {
      accountId: limited.id,
      text: shellStrings.statusBar.limitedStatus(
        agent?.displayName ?? limited.agent,
        limited.name,
        formatResetTime(resetsAt),
      ),
    };
  }

  const signedOutCount = accounts.accounts.filter((a) => a.state === 'signed_out').length;
  const runningCount = runs.filter((r) => r.status === 'running').length;

  return {
    engineHealthy: engine.state === 'ready',
    statusRuns: dataStrings.statusBar.runsRunning(runningCount),
    limitedAccount,
    signedOutCount,
    badges: {
      specs: specs.reduce((n, q) => n + q.specs.filter((s) => s.state === 'needs_you').length, 0),
      review: worktrees.filter((w) => w.state === 'ready').length,
      sessions: sessions.filter((s) => s.status === 'interrupted').length,
      accounts: signedOutCount,
    },
  };
}

function writeShellStatus(next: ShellStatus): void {
  const shell = useWorkbenchStore.getState();
  if (shell.engineHealthy !== next.engineHealthy) shell.setEngineHealthy(next.engineHealthy);
  if (shell.statusRuns !== next.statusRuns) shell.setStatusRuns(next.statusRuns);
  if (shell.signedOutCount !== next.signedOutCount) shell.setSignedOutCount(next.signedOutCount);

  const current = shell.limitedAccount;
  const changedLimit =
    current?.text !== next.limitedAccount?.text || current?.accountId !== next.limitedAccount?.accountId;
  if (changedLimit) shell.setLimitedAccount(next.limitedAccount);

  const badgeEntries: Array<[string, number]> = [
    ['specs', next.badges.specs],
    ['review', next.badges.review],
    ['sessions', next.badges.sessions],
    ['accounts', next.badges.accounts],
  ];
  for (const [area, count] of badgeEntries) {
    if (shell.badges[area] !== (count > 0 ? count : undefined)) {
      shell.setBadge(area, count > 0 ? count : undefined);
    }
  }
}

/** Keeps the shell status in step with the data stores. Returns a stop function. */
export function startShellStatusSync(): () => void {
  const sync = (): void => writeShellStatus(computeShellStatus());
  const unsubscribes = [
    useAccountsStore.subscribe(sync),
    useQuotaStore.subscribe(sync),
    useRunsStore.subscribe(sync),
    useJobsStore.subscribe(sync),
    useSpecsStore.subscribe(sync),
    useReviewStore.subscribe(sync),
    useSessionsStore.subscribe(sync),
    useEngineStore.subscribe(sync),
  ];
  sync();
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
