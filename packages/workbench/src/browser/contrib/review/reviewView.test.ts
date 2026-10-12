import { describe, expect, it } from 'vitest';
import {
  AgentId,
  JobId,
  RunId,
  WorktreeId,
  type CheckResult,
  type WorktreeReview,
  type WorktreeState,
} from '@orchagents/contracts';
import {
  agentBadge,
  approveView,
  checkRows,
  detailHeader,
  diffTotals,
  fileRows,
  noteView,
  resolveSelection,
  secondaryView,
  stateView,
  verdictView,
  worktreeRow,
  worktreeRows,
} from './reviewView.js';

function check(status: CheckResult['status'], summary: string): CheckResult {
  return { check: { kind: 'command', run: 'pnpm test' }, status, summary };
}

function review(over: Partial<WorktreeReview> = {}): WorktreeReview {
  return {
    worktree: WorktreeId.parse('orch/r-02'),
    jobId: JobId.parse('j-01'),
    runId: RunId.parse('r-02'),
    sessionId: null,
    title: 'Implement /auth/callback',
    state: 'ready',
    verdict: 'verified',
    checks: [check('passed', 'Tests · 14 passed'), check('passed', 'Lint'), check('passed', 'Types')],
    files: [
      { path: 'src/auth/callback.ts', added: 64, removed: 3 },
      { path: 'src/auth/pkce.ts', added: 41, removed: 0 },
    ],
    evidenceRef: null,
    note: null,
    ...over,
  };
}

describe('state pills', () => {
  it('gives every worktree state the prototype word and a colour', () => {
    expect(stateView('ready')).toEqual({ label: 'Ready for review', tone: 'ok' });
    expect(stateView('failing')).toEqual({ label: 'Checks failing', tone: 'err' });
    expect(stateView('in_progress')).toEqual({ label: 'In progress', tone: 'info' });
    expect(stateView('paused')).toEqual({ label: 'Paused · limit', tone: 'warn' });
    expect(stateView('interrupted')).toEqual({ label: 'Interrupted', tone: 'err' });
    expect(stateView('merged')).toEqual({ label: 'Merged', tone: 'neutral' });
    expect(stateView('discarded')).toEqual({ label: 'Discarded', tone: 'neutral' });
  });
});

describe('verdict banner', () => {
  it('uses the verdict, counting the checks for a verified run', () => {
    expect(verdictView(review())).toEqual({
      title: 'Verified',
      text: 'All 3 checks passed when orch ran them. The agent can’t edit these checks.',
      tone: 'ok',
      icon: 'shield',
    });
  });

  it('names a refuted run and its cause', () => {
    expect(verdictView(review({ verdict: 'refuted' }))).toEqual({
      title: 'Refuted',
      text: 'The agent reported success, but a check failed when orch ran it itself.',
      tone: 'err',
      icon: 'alert',
    });
  });

  it('says a run is not verified yet before its checks have run', () => {
    expect(verdictView(review({ verdict: 'unverified', checks: [] }))).toEqual({
      title: 'Not verified yet',
      text: 'Checks run automatically when the agent says it’s done.',
      tone: 'neutral',
      icon: 'clock',
    });
  });

  it('follows the verdict, not the state, so a failing state with a verified verdict still reads verified', () => {
    expect(verdictView(review({ state: 'failing', verdict: 'verified' })).title).toBe('Verified');
  });
});

describe('approve and merge (REV-01)', () => {
  it('is enabled only when the verdict is verified', () => {
    expect(approveView(review({ verdict: 'verified' }))).toEqual({ label: 'Approve & merge', disabled: false });
    expect(approveView(review({ state: 'failing', verdict: 'refuted' }))).toEqual({
      label: 'Approve & merge',
      disabled: true,
    });
    expect(approveView(review({ state: 'paused', verdict: 'unverified' }))).toEqual({
      label: 'Approve & merge',
      disabled: true,
    });
  });

  it('reads Merged into main once the worktree is merged, and is never pressable then', () => {
    expect(approveView(review({ state: 'merged', verdict: 'verified' }))).toEqual({
      label: 'Merged into main',
      disabled: true,
    });
  });
});

describe('secondary action', () => {
  it('offers Resume in Sessions while paused or interrupted', () => {
    expect(secondaryView({ state: 'paused' })).toEqual({ kind: 'resume', label: 'Resume in Sessions', icon: 'history' });
    expect(secondaryView({ state: 'interrupted' })).toEqual({
      kind: 'resume',
      label: 'Resume in Sessions',
      icon: 'history',
    });
  });

  it('offers Request changes otherwise', () => {
    for (const state of ['ready', 'failing', 'in_progress', 'merged', 'discarded'] as WorktreeState[]) {
      expect(secondaryView({ state })).toEqual({ kind: 'request', label: 'Request changes', icon: 'send' });
    }
  });
});

describe('checks', () => {
  it('uses the core summary and a per-status icon', () => {
    expect(checkRows([check('passed', 'Tests · 14 passed'), check('failed', '1 failing'), check('not_run', 'Lint')])).toEqual([
      { label: 'Tests · 14 passed', tone: 'ok', icon: 'check' },
      { label: '1 failing', tone: 'err', icon: 'x' },
      { label: 'Lint', tone: 'neutral', icon: 'clock' },
    ]);
  });
});

describe('files and totals', () => {
  it('keeps the core order rather than imposing one', () => {
    const rows = fileRows(review().files);
    expect(rows.map((row) => row.path)).toEqual(['src/auth/callback.ts', 'src/auth/pkce.ts']);
  });

  it('adds the running totals the list header shows', () => {
    expect(diffTotals(review().files)).toEqual({ added: 105, removed: 3 });
    expect(diffTotals([])).toEqual({ added: 0, removed: 0 });
  });
});

describe('agent tile', () => {
  it('maps each agent to its mono tile, and shows a dash when there is none', () => {
    expect(agentBadge(AgentId.parse('claude'))).toEqual({ mono: 'CC', tone: 'cc' });
    expect(agentBadge(AgentId.parse('codex'))).toEqual({ mono: 'CX', tone: 'cx' });
    expect(agentBadge(AgentId.parse('gemini'))).toEqual({ mono: 'GM', tone: 'gm' });
    expect(agentBadge(AgentId.parse('opencode'))).toEqual({ mono: 'OC', tone: 'oc' });
    expect(agentBadge(AgentId.parse('agy'))).toEqual({ mono: 'AG', tone: 'ag' });
    expect(agentBadge(null)).toEqual({ mono: '—', tone: 'none' });
  });
});

describe('worktree rows', () => {
  it('shows the run and title, the agent tile, the state and the totals', () => {
    const row = worktreeRow(review(), AgentId.parse('claude'));
    expect(row.worktree).toBe('orch/r-02');
    expect(row.sub).toBe('r-02 · Implement /auth/callback');
    expect(row.badge).toEqual({ mono: 'CC', tone: 'cc' });
    expect(row.state).toEqual({ label: 'Ready for review', tone: 'ok' });
    expect(row.added).toBe(105);
    expect(row.removed).toBe(3);
  });

  it('shows just the title when the review has no run', () => {
    const row = worktreeRow(review({ runId: null }), null);
    expect(row.sub).toBe('Implement /auth/callback');
  });

  it('asks the caller for each review’s agent', () => {
    const list = [review({ worktree: WorktreeId.parse('orch/r-02') }), review({ worktree: WorktreeId.parse('orch/r-05') })];
    const rows = worktreeRows(list, (r) => (r.worktree === 'orch/r-05' ? AgentId.parse('codex') : null));
    expect(rows.map((row) => row.badge.mono)).toEqual(['—', 'CX']);
  });
});

describe('detail header', () => {
  it('writes the branch line with the agent, account and run it was given', () => {
    expect(detailHeader(review(), { agent: AgentId.parse('claude'), accountName: 'Personal' }).sub).toBe(
      'orch/r-02 → main · Claude Code · Personal · r-02',
    );
  });

  it('capitalizes the agent name in the branch line', () => {
    expect(detailHeader(review(), { agent: AgentId.parse('codex'), accountName: 'Team' }).sub).toBe(
      'orch/r-02 → main · Codex · Team · r-02',
    );
  });

  it('shows dashes for what the review does not carry', () => {
    expect(detailHeader(review({ runId: null }), { agent: null, accountName: null }).sub).toBe('orch/r-02 → main · —');
  });
});

describe('note', () => {
  it('is hidden once merged and when there is no note', () => {
    expect(noteView(review({ state: 'merged', note: 'x' }))).toBeNull();
    expect(noteView(review({ note: null }))).toBeNull();
  });

  it('is green when the work is verified, plain otherwise', () => {
    expect(noteView(review({ verdict: 'verified', note: 'Squashed and committed.' }))).toEqual({
      text: 'Squashed and committed.',
      tone: 'ok',
    });
    expect(noteView(review({ verdict: 'refuted', state: 'failing', note: 'Try 2 of 3.' }))).toEqual({
      text: 'Try 2 of 3.',
      tone: 'neutral',
    });
  });
});

describe('selection', () => {
  it('keeps the chosen review when it is still listed, otherwise the first, otherwise none', () => {
    const a = review({ worktree: WorktreeId.parse('orch/r-02') });
    const b = review({ worktree: WorktreeId.parse('orch/r-05') });
    expect(resolveSelection([a, b], WorktreeId.parse('orch/r-05'))).toBe(b);
    expect(resolveSelection([a, b], WorktreeId.parse('orch/r-09'))).toBe(a);
    expect(resolveSelection([a, b], null)).toBe(a);
    expect(resolveSelection([], null)).toBeNull();
  });
});
