/**
 * Pure view-model for the Capacity panel (UI-05, QTA-01..02, QTA-05).
 * Reads account, agent, window and limit data from the stores and produces
 * grouped, formatted render props. Has no DOM and no store coupling beyond
 * the snapshot types — it is trivially tested.
 */
import type { Account, AccountId, AgentId, AgentInfo, QuotaWindow, SpendToday } from '@orchagents/contracts';

/** QTA-05: windows older than 6 hours are stale. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** A window is stale when its seenAt is older than 6 hours. */
function isStale(window: QuotaWindow, now: Date): boolean {
  return now.getTime() - Date.parse(window.seenAt) > STALE_AFTER_MS;
}

export interface WindowRender {
  readonly key: string;
  readonly label: string;
  readonly pctText: string;
  readonly width: string;
  readonly resetText: string;
  readonly bar: string;
  readonly estimated: boolean;
}

export interface AccountRender {
  readonly accountId: string;
  readonly label: string;
  readonly emailMasked: string;
  readonly plan: string;
  readonly isPrimary: boolean;
  readonly inUse: boolean;
  readonly inUseText: string;
  readonly stateLabel: string;
  readonly stateKind: 'available' | 'near' | 'limited' | 'estimated' | 'signed_out';
  readonly railBorder: string;
  readonly pillColor: string;
  readonly topPct: number | null;
  readonly bindingText: string;
  readonly resetText: string;
  readonly windows: WindowRender[];
  readonly hasWindows: boolean;
  readonly expanded: boolean;
  readonly chevron: string;
  readonly sourceText: string;
  readonly seenText: string;
  readonly holding: string | null;
}

export interface AgentGroup {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly mono: string;
  readonly tileBg: string;
  readonly tileFg: string;
  readonly accounts: AccountRender[];
  readonly usableText: string;
}

export interface CapacityModel {
  readonly agents: AgentGroup[];
  readonly spendToday: SpendToday | null;
  readonly showEmpty: boolean;
}

const WINDOW_LABELS: Record<QuotaWindow['window'], string> = {
  per_minute: 'Per minute',
  '5h': '5-hour',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** Pill colour per state, from the prototype's ST rail colours. */
const PILL_COLORS: Record<AccountRender['stateKind'], string> = {
  available: 'var(--ok)',
  near: 'var(--warn)',
  limited: 'var(--warn)',
  estimated: 'var(--text3)',
  signed_out: 'var(--err)',
};

const AGENT_TILES: Record<string, { mono: string; bg: string; fg: string }> = {
  claude: { mono: 'CC', bg: 'var(--cc-bg)', fg: 'var(--cc-fg)' },
  codex: { mono: 'CX', bg: 'var(--cx-bg)', fg: 'var(--cx-fg)' },
  gemini: { mono: 'GM', bg: 'var(--gm-bg)', fg: 'var(--gm-fg)' },
  opencode: { mono: 'OC', bg: 'var(--oc-bg)', fg: 'var(--oc-fg)' },
  agy: { mono: 'AG', bg: 'var(--ag-bg)', fg: 'var(--ag-fg)' },
};

export interface CapacitySnapshot {
  readonly accounts: readonly Account[];
  readonly agents: readonly AgentInfo[];
  readonly windows: Readonly<Record<string, QuotaWindow>>;
  readonly limits: Readonly<Record<string, { resetsAt: string | null }>>;
  readonly spendToday: SpendToday | null;
  readonly now: Date;
  readonly expandedAccount: AccountId | null;
  readonly runCounts: Readonly<Record<string, number>>;
  readonly holding: Readonly<Record<string, string>>;
}

export function buildCapacityModel(snap: CapacitySnapshot): CapacityModel {
  const windowsByAccount = new Map<AccountId, QuotaWindow[]>();
  for (const w of Object.values(snap.windows)) {
    const arr = windowsByAccount.get(w.accountId) ?? [];
    arr.push(w);
    windowsByAccount.set(w.accountId, arr);
  }

  const agentGroups = groupByAgent(snap.agents, snap.accounts);
  const model: AgentGroup[] = [];

  for (const group of agentGroups) {
    const tile = AGENT_TILES[group.agentId] ?? {
      mono: group.agentId.slice(0, 2).toUpperCase(),
      bg: 'var(--neutral)',
      fg: 'var(--text)',
    };
    const accounts: AccountRender[] = [];

    for (const acct of group.accounts) {
      const acctWindows = sortWindows(windowsByAccount.get(acct.id) ?? []);
      const limitInfo = snap.limits[acct.id];
      const runCount = snap.runCounts[acct.id] ?? 0;
      const holding = snap.holding[acct.id] ?? null;

      const { stateKind, stateLabel, railBorder } = classifyAccountState(
        acct.state,
        limitInfo,
        acctWindows,
        snap.now,
      );

      const top =
        acctWindows.length > 0
          ? acctWindows.reduce((max, w) => (w.usedPct > max.usedPct ? w : max))
          : null;
      const isEstimated = top?.source === 'estimated';
      const topPct = top ? top.usedPct : null;

      const bindingText = top
        ? `${WINDOW_LABELS[top.window]} ${isEstimated ? '~' : ''}${top.usedPct}%`
        : acct.state === 'signed_out'
          ? 'Not signed in'
          : 'usage unknown';

      let resetText = '';
      if (stateKind === 'limited' && limitInfo?.resetsAt) {
        resetText = `back at ${timeOnly(limitInfo.resetsAt)}`;
      } else if (top?.resetsAt) {
        resetText = `resets ${formatWindowReset(top)}`;
      }

      const sourceText = top ? (top.source === 'reported' ? 'Reported by CLI' : 'Estimated locally') : '—';
      const seenText = top ? (top.source === 'reported' ? formatAge(top.seenAt, snap.now) : '—') : '—';

      const windows: WindowRender[] = acctWindows.map((w) => {
        const wEstimated = w.source === 'estimated';
        let bar: string;
        if (wEstimated) {
          bar = 'repeating-linear-gradient(90deg, var(--muted2) 0 5px, var(--disabled) 5px 8px)';
        } else if (w.usedPct >= 100) {
          bar = 'var(--warn-solid)';
        } else if (w.usedPct >= 85) {
          bar = 'var(--warn-bar)';
        } else {
          bar = 'var(--ok-dot)';
        }
        return {
          key: `${w.accountId}:${w.window}`,
          label: WINDOW_LABELS[w.window],
          pctText: `${wEstimated ? '~' : ''}${w.usedPct}%`,
          width: `${w.usedPct}%`,
          resetText: w.resetsAt ? formatWindowReset(w) : '',
          bar,
          estimated: wEstimated,
        };
      });

      const chevron = snap.expandedAccount === acct.id ? 'rotate(180deg)' : 'none';

      accounts.push({
        accountId: acct.id,
        label: acct.name,
        emailMasked: acct.emailMasked ?? '',
        plan: acct.plan ?? '',
        isPrimary: acct.primary,
        inUse: runCount > 0,
        inUseText: `${runCount} ${runCount === 1 ? 'run' : 'runs'}`,
        stateLabel,
        stateKind,
        railBorder,
        pillColor: PILL_COLORS[stateKind],
        topPct,
        bindingText,
        resetText,
        windows,
        hasWindows: acctWindows.length > 0,
        expanded: snap.expandedAccount === acct.id,
        chevron,
        sourceText,
        seenText,
        holding,
      });
    }

    const usable = accounts.filter((a) => a.stateKind !== 'signed_out' && a.stateKind !== 'limited').length;
    model.push({
      agentId: group.agentId,
      displayName: group.displayName,
      mono: tile.mono,
      tileBg: tile.bg,
      tileFg: tile.fg,
      accounts,
      usableText: `${usable}/${group.accounts.length} usable`,
    });
  }

  return {
    agents: model,
    spendToday: snap.spendToday,
    showEmpty: snap.accounts.length === 0,
  };
}

function groupByAgent(
  agents: readonly AgentInfo[],
  accounts: readonly Account[],
): Array<{ agentId: AgentId; displayName: string; accounts: Account[] }> {
  const groups = new Map<AgentId, Account[]>();
  const order: AgentId[] = [];
  for (const acct of accounts) {
    if (!groups.has(acct.agent)) {
      groups.set(acct.agent, []);
      order.push(acct.agent);
    }
    groups.get(acct.agent)!.push(acct);
  }
  return order.map((agentId) => {
    const agent = agents.find((a) => a.id === agentId);
    return {
      agentId,
      displayName: agent?.displayName ?? agentId,
      accounts: groups.get(agentId) ?? [],
    };
  });
}

function sortWindows(windows: QuotaWindow[]): QuotaWindow[] {
  const order: QuotaWindow['window'][] = ['5h', 'daily', 'weekly', 'monthly', 'per_minute'];
  return [...windows].sort((a, b) => {
    const ai = order.indexOf(a.window);
    const bi = order.indexOf(b.window);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

function classifyAccountState(
  accountState: Account['state'],
  limitInfo: { resetsAt: string | null } | undefined,
  windows: readonly QuotaWindow[],
  now: Date,
): { stateKind: 'available' | 'near' | 'limited' | 'estimated' | 'signed_out'; stateLabel: string; railBorder: string } {
  if (accountState === 'signed_out') {
    return { stateKind: 'signed_out', stateLabel: 'Signed out', railBorder: 'var(--line)' };
  }
  if (accountState === 'limited' || limitInfo !== undefined) {
    return {
      stateKind: 'limited',
      stateLabel: limitInfo?.resetsAt ? `Limited · ${timeOnly(limitInfo.resetsAt)}` : 'Limited',
      railBorder: 'var(--warn-line)',
    };
  }
  if (accountState === 'near_limit') {
    return { stateKind: 'near', stateLabel: 'Near limit', railBorder: 'var(--warn)' };
  }
  if (accountState === 'estimated') {
    return { stateKind: 'estimated', stateLabel: 'Available · est.', railBorder: 'var(--line)' };
  }
  const freshWindows = windows.filter((w) => !isStale(w, now));
  const hasEstimated = windows.some((w) => w.source === 'estimated');
  if (freshWindows.length > 0) {
    const max = Math.max(...freshWindows.map((w) => w.usedPct));
    if (max >= 85) {
      return { stateKind: 'near', stateLabel: 'Near limit', railBorder: 'var(--warn)' };
    }
    if (hasEstimated) {
      return { stateKind: 'estimated', stateLabel: 'Available · est.', railBorder: 'var(--line)' };
    }
    return { stateKind: 'available', stateLabel: 'Available', railBorder: 'var(--line)' };
  }
  if (windows.length > 0) {
    return { stateKind: 'estimated', stateLabel: 'Available · est.', railBorder: 'var(--line)' };
  }
  return { stateKind: 'available', stateLabel: 'Available', railBorder: 'var(--line)' };
}

function timeOnly(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatWindowReset(window: QuotaWindow): string {
  if (!window.resetsAt) return '';
  const date = new Date(window.resetsAt);
  if (window.source === 'estimated' && window.window === 'daily') {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    return `${time} PT`;
  }
  if (window.window === 'weekly') {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
    return `${day} ${timeOnly(window.resetsAt)}`;
  }
  if (window.window === 'monthly') {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
  }
  return timeOnly(window.resetsAt);
}

export function formatAge(seenAt: string, now: Date): string {
  const elapsedMs = now.getTime() - Date.parse(seenAt);
  const elapsedMin = Math.floor(elapsedMs / 60_000);
  const elapsedH = Math.floor(elapsedMin / 60);
  if (elapsedMin < 1) return 'just now';
  if (elapsedMin < 60) return `${elapsedMin} min ago`;
  if (elapsedH < 24) return `${elapsedH} h ago`;
  return `${Math.floor(elapsedH / 24)} d ago`;
}

export function formatSpendUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
