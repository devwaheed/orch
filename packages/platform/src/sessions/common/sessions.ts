/**
 * Sessions (SES-01..SES-04): the records orch keeps for each agent conversation,
 * the resume options and their availability rules, and the pure helpers the
 * service uses. Plain TypeScript: no Node, no DOM.
 */
import type {
  Account,
  AccountId,
  AgentId,
  QuotaWindow,
  ResumeMode,
  ResumeOption,
  Result,
  Session,
  SessionId,
  WorktreeId,
} from '@orchagents/contracts';

/** SES-04: ended sessions are deleted this many days after they end. */
export const SESSION_KEEP_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Agent names as the prototype shows them (Main.dc.html, AG list). */
export const AGENT_NAMES: Readonly<Record<AgentId, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  agy: 'Antigravity',
};

/** The fork copy from design/prototype/Main.dc.html ("Fork into a new worktree"). */
export const FORK_DESCRIPTION = 'Copy the current state to a new branch to try a different approach. The original stays as it is.';

/** orch's record of one session. `engineHandle` and `cwd` are the engine-side details the contract does not carry. */
export interface SessionRecord {
  readonly session: Session;
  /** Claw's handle for the session. Null when the engine never started it. */
  readonly engineHandle: string | null;
  /** The folder the session runs in (its worktree). Claw hands off only within the same folder. */
  readonly cwd: string | null;
}

/** Storage for session records. The store service backs the real one; tests use InMemorySessionRepository. */
export interface ISessionRepository {
  list(): SessionRecord[];
  get(id: SessionId): SessionRecord | undefined;
  put(record: SessionRecord): void;
  delete(id: SessionId): void;
}

export class InMemorySessionRepository implements ISessionRepository {
  private readonly rows = new Map<SessionId, SessionRecord>();

  list(): SessionRecord[] {
    return [...this.rows.values()];
  }

  get(id: SessionId): SessionRecord | undefined {
    return this.rows.get(id);
  }

  put(record: SessionRecord): void {
    this.rows.set(record.session.id, record);
  }

  delete(id: SessionId): void {
    this.rows.delete(id);
  }
}

/** Creates the worktree for a fork and returns its folder. Implemented on top of git in node/. */
export interface ISessionWorktrees {
  /** Creates `branch` at the current commit of the worktree at `fromPath`, in a new worktree. */
  fork(fromPath: string, branch: string): Promise<Result<{ path: string }>>;
}

/** A session's account as the resume rules need it. */
export interface AccountFacts {
  readonly id: AccountId;
  readonly agent: AgentId;
  readonly name: string;
  readonly use: boolean;
  readonly state: Account['state'];
  /** Highest usedPct over the account's windows; null when usage is unknown. */
  readonly usedPct: number | null;
  /** Latest reset time among windows at 100% that have not reset yet; null when unknown. */
  readonly resetsAt: string | null;
}

export function accountFacts(
  account: Pick<Account, 'id' | 'agent' | 'name' | 'use' | 'state'>,
  windows: readonly QuotaWindow[],
  now: Date,
): AccountFacts {
  const mine = windows.filter((w) => w.accountId === account.id);
  const usedPct = mine.length === 0 ? null : Math.max(...mine.map((w) => w.usedPct));
  const future = mine
    .filter((w) => w.usedPct >= 100 && w.resetsAt !== null && Date.parse(w.resetsAt) > now.getTime())
    .map((w) => w.resetsAt as string);
  const resetsAt = future.length === 0 ? null : future.reduce((latest, t) => (Date.parse(t) > Date.parse(latest) ? t : latest));
  return { id: account.id, agent: account.agent, name: account.name, use: account.use, state: account.state, usedPct, resetsAt };
}

/** An account that can take a session: set to use, signed in, and not limited. */
export function isUsable(facts: AccountFacts): boolean {
  return facts.use && facts.state !== 'signed_out' && facts.state !== 'limited';
}

/** Least used first; unknown usage ranks last; ties keep the given order (oldest account first). */
export function leastUsed(list: readonly AccountFacts[]): AccountFacts | undefined {
  let best: AccountFacts | undefined;
  for (const candidate of list) {
    if (!best) {
      best = candidate;
      continue;
    }
    const a = candidate.usedPct ?? Number.POSITIVE_INFINITY;
    const b = best.usedPct ?? Number.POSITIVE_INFINITY;
    if (a < b) best = candidate;
  }
  return best;
}

/** Local HH:MM, the clock format the prototype uses for resets ("15:00"). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface ResumeInput {
  readonly session: Session;
  /** Whether the engine has a handle for the session (needed to reopen it). */
  readonly hasEngineHandle: boolean;
  readonly accounts: readonly AccountFacts[];
}

/**
 * The four resume options (SES-01..SES-03) with their availability rules, copy
 * from design/screens.md and design/prototype/Main.dc.html. Live sessions have
 * no resume options: they only open in the workspace.
 */
export function buildResumeOptions(input: ResumeInput): ResumeOption[] {
  const { session, accounts } = input;
  if (session.status === 'live') return [];

  const same = accounts.find((a) => a.id === session.accountId);
  const sameOption = ((): ResumeOption => {
    if (!same) {
      return { mode: 'same', available: false, description: 'The account this session ran on is no longer set up.', target: session.accountId, waitsUntil: null };
    }
    if (!input.hasEngineHandle) {
      return { mode: 'same', available: false, description: 'orch has no engine record of this session, so it cannot be reopened. Start a new job instead.', target: same.id, waitsUntil: null };
    }
    if (same.state === 'signed_out') {
      return { mode: 'same', available: false, description: `${same.name} is signed out. Sign in again on Accounts, then resume.`, target: same.id, waitsUntil: null };
    }
    if (same.state === 'limited') {
      const waits = same.resetsAt;
      return {
        mode: 'same',
        available: true,
        description: waits
          ? `Reopens ${session.id} with its full history. ${same.name} is limited, so this waits until ${formatClock(waits)}.`
          : `Reopens ${session.id} with its full history. ${same.name} is limited and its reset time is not known yet.`,
        target: same.id,
        waitsUntil: waits,
      };
    }
    return {
      mode: 'same',
      available: true,
      description: `Reopens ${session.id} on ${session.agent} · ${same.name} with its full history.`,
      target: same.id,
      waitsUntil: null,
    };
  })();

  const others = accounts.filter((a) => a.id !== session.accountId && isUsable(a));
  const otherAccount = leastUsed(others.filter((a) => a.agent === session.agent));
  const accountOption: ResumeOption = otherAccount
    ? {
        mode: 'account',
        available: true,
        description: `New ${session.agent} session on ${otherAccount.name} in the same worktree, primed with a summary of this one.`,
        target: otherAccount.id,
        waitsUntil: null,
      }
    : { mode: 'account', available: false, description: `No other ${session.agent} account has room right now.`, target: null, waitsUntil: null };

  const otherAgent = leastUsed(others.filter((a) => a.agent !== session.agent));
  const agentOption: ResumeOption = otherAgent
    ? {
        mode: 'agent',
        available: true,
        description: `Continue on ${AGENT_NAMES[otherAgent.agent]} · ${otherAgent.name} with the summary and the job plan.`,
        target: otherAgent.id,
        waitsUntil: null,
      }
    : { mode: 'agent', available: false, description: 'No other agent has room right now.', target: null, waitsUntil: null };

  const forkOption: ResumeOption = session.worktree
    ? { mode: 'fork', available: true, description: FORK_DESCRIPTION, target: session.accountId, waitsUntil: null }
    : { mode: 'fork', available: false, description: 'This session has no worktree to copy.', target: null, waitsUntil: null };

  return [sameOption, accountOption, agentOption, forkOption];
}

/**
 * The option that is pre-selected: hand off to another account when this
 * session's account is limited and another account can take it, otherwise
 * continue this session (screens.md, Sessions).
 */
export function defaultResumeMode(options: readonly ResumeOption[]): ResumeMode | null {
  const by = (mode: ResumeMode) => options.find((o) => o.mode === mode);
  const same = by('same');
  const account = by('account');
  if (same?.waitsUntil && account?.available) return 'account';
  if (same?.available) return 'same';
  return options.find((o) => o.available)?.mode ?? null;
}

/** The run part of a worktree id: `orch/r-02` gives `r-02`, and `orch/r-02-fork-1` also gives `r-02`. */
export function forkBaseOf(worktree: WorktreeId): string {
  return worktree.slice('orch/'.length).replace(/-fork-\d+$/, '');
}

/** The next fork number for a base run, given the worktrees already in use (SES-03: orch/<run-id>-fork-<n>). */
export function nextForkNumber(base: string, existingWorktrees: readonly string[]): number {
  const pattern = new RegExp(`^orch/${escapeRegExp(base)}-fork-(\\d+)$`);
  let max = 0;
  for (const wt of existingWorktrees) {
    const match = pattern.exec(wt);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function forkBranchName(base: string, n: number): string {
  return `orch/${base}-fork-${n}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** JOB-01: `s-` plus four hex digits, from a random number in [0, 1). */
export function sessionIdFromRandom(random: number): SessionId {
  const hex = Math.floor(random * 0x10000).toString(16).padStart(4, '0');
  return `s-${hex}` as SessionId;
}

/** SES-04: ids of ended sessions that ended more than SESSION_KEEP_DAYS before `now`. `lastActivityAt` is the end time of an ended session. */
export function expiredSessionIds(records: readonly SessionRecord[], now: Date): SessionId[] {
  const cutoff = now.getTime() - SESSION_KEEP_DAYS * DAY_MS;
  return records
    .filter((r) => r.session.status === 'ended' && Date.parse(r.session.lastActivityAt) <= cutoff)
    .map((r) => r.session.id);
}

/** Session error copy. Unspecified in LOCKED.md; written in the product voice and listed for owner review. */
export const SESSION_ERRORS = {
  notFound: (id: string) => ({
    code: 'not_found' as const,
    message: `Session ${id} was not found.`,
    fix: 'Check the session id in orch sessions, then try again.',
  }),
  live: (id: string) => ({
    code: 'conflict' as const,
    message: `Session ${id} is still live.`,
    fix: 'Open it in the workspace instead.',
  }),
  unavailable: (id: string, reason: string) => ({
    code: 'conflict' as const,
    message: `Could not resume ${id}: ${reason}`,
    fix: 'Pick another resume option, or try again later.',
  }),
  badTarget: (to: string) => ({
    code: 'validation_failed' as const,
    message: `${to} cannot take this session.`,
    fix: 'Choose a signed-in account that is set to use. For a hand-off to another account, pick the same agent; for another agent, pick a different one.',
  }),
  noWorktree: (id: string) => ({
    code: 'conflict' as const,
    message: `Session ${id} has no worktree to continue in.`,
    fix: 'Start a new job instead.',
  }),
  noEngineRecord: (id: string) => ({
    code: 'conflict' as const,
    message: `orch has no engine record of session ${id}, so it cannot be reopened.`,
    fix: 'Start a new job instead.',
  }),
  forkFailed: (id: string, reason: string) => ({
    code: 'conflict' as const,
    message: `Could not fork ${id}: ${reason}`,
    fix: 'Check the worktree and its branches, then try again.',
  }),
  badEngineReply: {
    code: 'internal' as const,
    message: 'The engine did not return a session for this request.',
    fix: 'Try again. If it keeps happening, report it with the log file.',
  },
};
