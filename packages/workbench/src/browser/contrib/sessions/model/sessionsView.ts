/**
 * View model for the Sessions screen. Plain TypeScript: no React, no DOM.
 *
 * Availability is never recomputed here: the four resume options come from the core
 * (ISessionsService.resumeOptions) and this file only lays them out. The rules below
 * are presentation rules (filters, which row is selected, labels, the CLI line).
 */
import type {
  Account,
  AccountId,
  AgentId,
  AgentInfo,
  ResumeMode,
  ResumeOption,
  ResumeRequest,
  Session,
  SessionId,
  SessionStatus,
  Job,
  SpecQueue,
} from '@orchagents/contracts';
import { sessionsStrings as S } from '../strings.js';

export type SessionFilter = 'all' | 'resumable' | 'live';

/** Sessions belong to a project through their job. Sessions without an open-project job
 * (including orch-internal sessions) are intentionally omitted from the project view. */
export function sessionsForProject<T extends Pick<Session, 'jobId'>>(
  sessions: readonly T[],
  jobs: readonly { id: Session['jobId']; spec: { repoPath: string } }[],
  project: string,
): T[] {
  if (!project) return [];
  const projectJobs = new Set(jobs.filter((job) => job.spec.repoPath === project).map((job) => job.id));
  return sessions.filter((session) => projectJobs.has(session.jobId));
}

export interface SpecSessionGroup {
  readonly key: string;
  readonly specId: string;
  readonly specTitle: string;
  readonly state: string;
  readonly attempt: number;
  readonly totalTries: number;
  readonly latest: Session;
  readonly earlier: readonly Session[];
}

/** Resolve spec sessions through their job story path and group retries into one row. */
export function groupSpecSessions(sessions: readonly Session[], jobs: readonly Job[], queues: readonly SpecQueue[]): {
  readonly grouped: readonly SpecSessionGroup[];
  readonly ordinary: readonly Session[];
} {
  const specJobs = new Map<string, { id: string; title: string; state: string; attempt: number; totalTries: number }>();
  for (const queue of queues) for (const spec of queue.specs) {
    const matchingJobs = jobs.filter((item) => item.id === spec.jobId || (item.spec.repoPath === queue.repoPath && item.spec.storyPath === spec.file));
    for (const job of matchingJobs) specJobs.set(job.id, { id: spec.id, title: spec.spec.title, state: spec.state, attempt: spec.attempt ?? 1, totalTries: queue.settings.retries + 1 });
  }
  const buckets = new Map<string, Session[]>();
  const ordinary: Session[] = [];
  for (const session of sessions) {
    const spec = specJobs.get(session.jobId);
    if (!spec) { ordinary.push(session); continue; }
    const bucket = buckets.get(spec.id) ?? [];
    bucket.push(session);
    buckets.set(spec.id, bucket);
  }
  const grouped = [...buckets].map(([id, tries]) => {
    tries.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const latest = tries.at(-1)!;
    const spec = specJobs.get(latest.jobId)!;
    return { key: `spec:${id}`, specId: id, specTitle: spec.title, state: spec.state, attempt: spec.attempt, totalTries: spec.totalTries, latest, earlier: tries.slice(0, -1).reverse() };
  });
  return { grouped, ordinary };
}

/** Seven-day default window; live and paused sessions remain visible regardless of age. */
export function sessionsInDefaultWindow<T extends Pick<Session, 'status' | 'lastActivityAt'>>(
  sessions: readonly T[],
  now: Date,
): T[] {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return sessions.filter((session) =>
    session.status === 'live' || session.status === 'paused' || Date.parse(session.lastActivityAt) >= cutoff,
  );
}

export function isLive(session: Pick<Session, 'status'>): boolean {
  return session.status === 'live';
}

/** Resumable: everything that is not live (paused, ended or interrupted). */
export function isResumable(session: Pick<Session, 'status'>): boolean {
  return session.status !== 'live';
}

export function filterSessions<T extends Pick<Session, 'status'>>(sessions: readonly T[], filter: SessionFilter): T[] {
  if (filter === 'all') return [...sessions];
  if (filter === 'live') return sessions.filter(isLive);
  return sessions.filter(isResumable);
}

export interface FilterCounts {
  readonly all: number;
  readonly resumable: number;
  readonly live: number;
}

export function filterCounts(sessions: readonly Pick<Session, 'status'>[]): FilterCounts {
  return {
    all: sessions.length,
    resumable: sessions.filter(isResumable).length,
    live: sessions.filter(isLive).length,
  };
}

export interface FilterOption {
  readonly id: SessionFilter;
  readonly label: string;
  readonly pressed: boolean;
}

export function filterOptions(counts: FilterCounts, selected: SessionFilter): FilterOption[] {
  return [
    { id: 'all', label: S.filter.all(counts.all), pressed: selected === 'all' },
    { id: 'resumable', label: S.filter.resumable(counts.resumable), pressed: selected === 'resumable' },
    { id: 'live', label: S.filter.live(counts.live), pressed: selected === 'live' },
  ];
}

/** The selected session when it is still in the filtered list, otherwise the first one. */
export function resolveSelection<T extends { id: SessionId }>(filtered: readonly T[], selectedId: SessionId | null): T | null {
  return filtered.find((s) => s.id === selectedId) ?? filtered[0] ?? null;
}

export type ToneName = 'info' | 'warn' | 'err' | 'neutral';

export interface StatusView {
  readonly label: string;
  readonly tone: ToneName;
}

const STATUS_VIEW: Record<SessionStatus, StatusView> = {
  live: { label: S.status.live, tone: 'info' },
  paused: { label: S.status.paused, tone: 'warn' },
  ended: { label: S.status.ended, tone: 'neutral' },
  interrupted: { label: S.status.interrupted, tone: 'err' },
};

export function statusView(status: SessionStatus): StatusView {
  return STATUS_VIEW[status];
}

/** The note box tone follows the status (paused warns, interrupted is an error, the rest is information). */
export function noteTone(status: SessionStatus): ToneName {
  if (status === 'paused') return 'warn';
  if (status === 'interrupted') return 'err';
  return 'info';
}

export interface AgentBadgeView {
  readonly mono: string;
  readonly tone: 'cc' | 'cx' | 'gm' | 'oc' | 'ag';
}

const AGENT_BADGE: Record<AgentId, AgentBadgeView> = {
  claude: { mono: 'CC', tone: 'cc' },
  codex: { mono: 'CX', tone: 'cx' },
  gemini: { mono: 'GM', tone: 'gm' },
  opencode: { mono: 'OC', tone: 'oc' },
  agy: { mono: 'AG', tone: 'ag' },
};

export function agentBadge(agent: AgentId): AgentBadgeView {
  return AGENT_BADGE[agent];
}

/** The agent's display name from the core's agent list, or its id until the list has loaded. */
export function agentLabel(agent: AgentId, agents: readonly Pick<AgentInfo, 'id' | 'displayName'>[]): string {
  return agents.find((a) => a.id === agent)?.displayName ?? agent;
}

export function accountLabel(accountId: AccountId, accounts: readonly Pick<Account, 'id' | 'name'>[]): string {
  return accounts.find((a) => a.id === accountId)?.name ?? accountId;
}

/** `codex-team` becomes `codex@team` (the form `orch resume --to` takes; CLI-01). Same rule as the CLI. */
export function formatAgentAccount(agent: string, accountId: string): string {
  const prefix = `${agent}-`;
  const slug = accountId.startsWith(prefix) ? accountId.slice(prefix.length) : accountId;
  return `${agent}@${slug}`;
}

/** Local HH:MM, the clock format the prototype uses for resets ("15:00"). */
export function formatClock(iso: string, date: Date = new Date(iso), useUtcTime = false): string {
  const hours = useUtcTime ? date.getUTCHours() : date.getHours();
  const minutes = useUtcTime ? date.getUTCMinutes() : date.getMinutes();
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function sameDay(a: Date, b: Date, useUtcTime = false): boolean {
  return useUtcTime
    ? a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
    : a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today 12:31", "Yesterday 18:02", or "Oct 3 09:15". `short` gives "Yest." for yesterday, as the list shows it. */
export function formatWhen(iso: string, now: Date, short = false, useUtcTime = false): string {
  const date = new Date(iso);
  const clock = formatClock(iso, date, useUtcTime);
  const yesterday = useUtcTime
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, now, useUtcTime)) return `${S.time.today} ${clock}`;
  if (sameDay(date, yesterday, useUtcTime)) return `${short ? S.time.yesterdayShort : S.time.yesterday} ${clock}`;
  return `${MONTHS[useUtcTime ? date.getUTCMonth() : date.getMonth()]} ${useUtcTime ? date.getUTCDate() : date.getDate()} ${clock}`;
}

/** The list's right-hand time: "now" for a live session, otherwise when it last did something. */
export function formatLastActivity(session: Pick<Session, 'status' | 'lastActivityAt'>, now: Date, useUtcTime = false): string {
  if (isLive(session)) return S.time.now;
  const date = new Date(session.lastActivityAt);
  if (useUtcTime && sameDay(date, now, true)) return formatClock(session.lastActivityAt, date, true);
  return formatWhen(session.lastActivityAt, now, true, useUtcTime);
}

/** Tokens as the prototype shows them: "61k", "6k", or the plain number under a thousand. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${Math.round(tokens / 1000)}k`;
}

/** The "Stopped at" / "Now at" text: the step, its place in the job, and the try when it is not the first. */
export function positionText(position: Session['position']): string {
  const base = S.step(position.step, position.index, position.total);
  const attempt = position.attempt > 1 ? `${base}${S.tryAttempt(position.attempt)}` : base;
  return position.note?.startsWith('Paused when ') ? `${attempt} (paused by limit)` : attempt;
}

export function stoppedOrNowLabel(status: SessionStatus): string {
  return status === 'live' ? S.details.nowAt : S.details.stoppedAt;
}

export interface SessionListRow {
  readonly id: SessionId;
  readonly title: string;
  readonly jobTitle: string;
  readonly agentName: string;
  readonly accountName: string;
  readonly badge: AgentBadgeView;
  readonly status: StatusView;
  readonly last: string;
}

export function cleanSessionTitle(title: string): string {
  return title.replace(/^The previous try did not meet these criteria:\s*/i, '').trim();
}

export function sessionListRow(
  session: Session,
  ctx: { readonly jobTitle: string; readonly agents: readonly Pick<AgentInfo, 'id' | 'displayName'>[]; readonly accounts: readonly Pick<Account, 'id' | 'name'>[]; readonly now: Date; readonly useUtcTime?: boolean },
): SessionListRow {
  return {
    id: session.id,
    title: cleanSessionTitle(session.title),
    jobTitle: ctx.jobTitle,
    agentName: agentLabel(session.agent, ctx.agents),
    accountName: accountLabel(session.accountId, ctx.accounts),
    badge: agentBadge(session.agent),
    status: statusView(session.status),
    last: formatLastActivity(session, ctx.now, ctx.useUtcTime),
  };
}

export interface SessionFact {
  readonly key: string;
  readonly value: string;
}

export interface SessionDetails {
  readonly id: SessionId;
  readonly title: string;
  readonly badge: AgentBadgeView;
  /** "s-91e0 · codex 91e0…0b47": the orch id, then the CLI's own command and session id. */
  readonly idLine: string;
  readonly status: StatusView;
  readonly facts: readonly SessionFact[];
  readonly note: { readonly text: string; readonly tone: ToneName } | null;
  readonly isLive: boolean;
}

export function sessionDetails(
  session: Session,
  ctx: {
    readonly jobTitle: string;
    readonly title?: string;
    readonly agents: readonly Pick<AgentInfo, 'id' | 'displayName' | 'command'>[];
    readonly accounts: readonly Pick<Account, 'id' | 'name'>[];
    readonly now: Date;
    readonly useUtcTime?: boolean;
  },
): SessionDetails {
  const agentInfo = ctx.agents.find((a) => a.id === session.agent);
  const command = agentInfo?.command ?? session.agent;
  const note = session.position.note;
  return {
    id: session.id,
    title: ctx.title ?? cleanSessionTitle(session.title),
    badge: agentBadge(session.agent),
    idLine: `${session.id} · ${command} ${session.cliSessionId.length >= 8 ? `${session.cliSessionId.slice(0, 4)}…${session.cliSessionId.slice(-4)}` : session.cliSessionId}`,
    status: statusView(session.status),
    facts: [
      { key: S.details.facts.job, value: ctx.jobTitle || S.empty },
      {
        key: S.details.facts.agentAccount,
        value: `${agentLabel(session.agent, ctx.agents)} · ${accountLabel(session.accountId, ctx.accounts)}`,
      },
      { key: S.details.facts.worktree, value: session.worktree ?? S.empty },
      { key: S.details.facts.run, value: session.runId ?? S.empty },
      { key: S.details.facts.started, value: formatWhen(session.startedAt, ctx.now, false, ctx.useUtcTime) },
      { key: S.details.facts.tokensUsed, value: formatTokens(session.tokens) },
      { key: stoppedOrNowLabel(session.status), value: positionText(session.position) },
    ],
    note: note ? { text: note, tone: noteTone(session.status) } : null,
    isLive: isLive(session),
  };
}

/**
 * The option the screen pre-selects: hand off to another account when this session's
 * account is limited and another account can take it, otherwise continue this session
 * (screens.md, Sessions). Reads the core's availability and waits; decides nothing new.
 */
export function defaultResumeMode(options: readonly ResumeOption[]): ResumeMode | null {
  const by = (mode: ResumeMode) => options.find((o) => o.mode === mode);
  const same = by('same');
  const account = by('account');
  if (same?.waitsUntil && account?.available) return 'account';
  if (same?.available) return 'same';
  return options.find((o) => o.available)?.mode ?? null;
}

/** The chosen mode when the core says it is available, otherwise the default. */
export function effectiveResumeMode(options: readonly ResumeOption[], chosen: ResumeMode | null): ResumeMode | null {
  const picked = chosen ? options.find((o) => o.mode === chosen) : undefined;
  if (picked?.available) return picked.mode;
  return defaultResumeMode(options);
}

const OPTION_TITLE: Record<ResumeMode, string> = {
  same: S.option.same,
  account: S.option.account,
  agent: S.option.agent,
  fork: S.option.fork,
};

const OPTION_ICON: Record<ResumeMode, 'history' | 'swap' | 'robot' | 'fork'> = {
  same: 'history',
  account: 'swap',
  agent: 'robot',
  fork: 'fork',
};

export interface ResumeRow {
  readonly mode: ResumeMode;
  readonly title: string;
  readonly description: string;
  readonly icon: 'history' | 'swap' | 'robot' | 'fork';
  readonly available: boolean;
  readonly checked: boolean;
}

/** The four rows in the core's order. A row with no target is shown disabled, with the core's reason. */
export function resumeRows(options: readonly ResumeOption[], selected: ResumeMode | null): ResumeRow[] {
  return options.map((o) => ({
    mode: o.mode,
    title: OPTION_TITLE[o.mode],
    description: o.description,
    icon: OPTION_ICON[o.mode],
    available: o.available,
    checked: o.mode === selected,
  }));
}

/** The resume button text for the effective mode. */
export function resumeButtonLabel(
  mode: ResumeMode | null,
  option: ResumeOption | undefined,
  ctx: { readonly agents: readonly Pick<AgentInfo, 'id' | 'displayName'>[]; readonly accounts: readonly Pick<Account, 'id' | 'name' | 'agent'>[] },
): string {
  if (!mode || !option) return S.button.resumeSession;
  const target = option.target ? ctx.accounts.find((a) => a.id === option.target) : undefined;
  switch (mode) {
    case 'same':
      return option.waitsUntil ? S.button.schedule(formatClock(option.waitsUntil)) : S.button.resumeSession;
    case 'account':
      return S.button.resumeOn(target?.name ?? S.empty);
    case 'agent':
      return S.button.handOffTo(target ? agentLabel(target.agent, ctx.agents) : S.empty);
    case 'fork':
      return S.button.fork;
  }
}

/**
 * The CLI line under the options, in CLI-01's form: `orch resume <session> [--to <agent@account>] [--fork]`.
 * A continue that is waiting for a reset carries the prototype's "scheduled for" comment.
 */
export function cliLine(
  sessionId: SessionId,
  mode: ResumeMode | null,
  option: ResumeOption | undefined,
  accounts: readonly Pick<Account, 'id' | 'agent'>[],
): string {
  const base = `orch resume ${sessionId}`;
  if (!mode) return base;
  switch (mode) {
    case 'same':
      return option?.waitsUntil ? `${base}${S.cli.scheduledFor(formatClock(option.waitsUntil))}` : base;
    case 'account':
    case 'agent': {
      const target = option?.target ? accounts.find((a) => a.id === option.target) : undefined;
      if (!target) return base;
      return `${base} --to ${formatAgentAccount(target.agent, target.id)}`;
    }
    case 'fork':
      return `${base} --fork`;
  }
}

/** The request the resume button sends for the effective mode. Null when the mode has no target to send. */
export function buildResumeRequest(
  sessionId: SessionId,
  mode: ResumeMode | null,
  option: ResumeOption | undefined,
): ResumeRequest | null {
  if (!mode || !option) return null;
  switch (mode) {
    case 'same':
      return { mode: 'same', sessionId };
    case 'fork':
      return { mode: 'fork', sessionId };
    case 'account':
    case 'agent':
      return option.target ? { mode, sessionId, to: option.target } : null;
  }
}
