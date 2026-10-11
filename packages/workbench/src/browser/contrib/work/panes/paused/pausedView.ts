/**
 * View model for the paused-by-limit card (S3-03, QTA-03/QTA-04, screens.md Work, Main.dc.html pausedText/autoText).
 */
import type { AccountId, PickAccountResult, QuotaWindow, Run, RunLine } from '@orch/contracts';
import { workStrings } from '../../strings.js';

export interface PausedCardView {
  /** "{agent} · {account} hit its 5-hour limit at 12:46. The worktree, transcript and CLI session … are saved." */
  readonly pausedText: string;
  /** Checkbox label: "Otherwise continue this exact session on {account} at {reset}" */
  readonly autoText: string;
  /** Null when no other account of the run's agent has room: the button is not shown. */
  readonly resumeOn: { readonly accountId: AccountId; readonly label: string } | null;
}

/** Local HH:MM, or '' for an unreadable time. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function pausedCardView(input: {
  readonly run: Pick<Run, 'resumesAt' | 'accountId' | 'sessionId' | 'id'>;
  readonly lines: readonly Pick<RunLine, 'kind' | 'at'>[];
  readonly windows: readonly Pick<QuotaWindow, 'accountId' | 'window' | 'usedPct' | 'resetsAt'>[];
  readonly pick: PickAccountResult | null;
  readonly agentName: string;
  readonly accountName: (id: AccountId) => string;
}): PausedCardView {
  const { run, agentName, accountName } = input;
  const own = accountName(run.accountId);
  const hit = [...input.lines].reverse().find((l) => l.kind === 'limit');
  const limited = input.windows.find((w) => w.accountId === run.accountId && (w.resetsAt === run.resumesAt || w.usedPct >= 100));
  const pausedText = workStrings.paused.pausedText(
    agentName,
    own,
    limited ? workStrings.paused.window[limited.window] : null,
    hit ? formatClock(hit.at) || null : null,
    run.sessionId ?? run.id,
  );
  // The run's own account is the limited one; offering it again would resume into the same limit.
  const other = input.pick?.kind === 'account' && input.pick.accountId !== run.accountId ? input.pick.accountId : null;
  return {
    pausedText,
    autoText: workStrings.paused.autoText(own, run.resumesAt ? formatClock(run.resumesAt) || null : null),
    resumeOn: other ? { accountId: other, label: workStrings.paused.resumeNowLabel(agentName, accountName(other)) } : null,
  };
}
