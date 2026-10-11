import { describe, expect, it } from 'vitest';
import type { Account, AccountId, AgentChoice, AgentId, PickAccountResult } from '@orch/contracts';
import { JobSpec } from '@orch/contracts';
import {
  AGENT_ORDER,
  DEFAULT_LIMIT_POLICY,
  GUARDRAIL_CHECKS,
  accountOptionSub,
  accountTone,
  autoOptionSub,
  buildSingleJobSpec,
  cliFailed,
  cliIdle,
  cliLoading,
  cliReady,
  createLatestGate,
  defaultOrchestrator,
  defaultWorkers,
  formatResetTime,
  isModeEnabled,
  isUsable,
  orchestratorWarning,
  pinnedStatus,
  startButtonLabel,
  withGuardrails,
  type JobFormValues,
} from '../src/browser/contrib/newjob/newJobModel.js';
import { newJobStrings } from '../src/browser/contrib/newjob/strings.js';
import {
  EMPTY_DRAFT,
  effectiveValues,
  useNewJobDraft,
  type NewJobDefaults,
} from '../src/browser/contrib/newjob/stores/newJobStore.js';
import { sampleAccount } from './fixtures.js';

const REPO = '/home/dev/api-server';

function acct(id: string, agent: AgentId, overrides: Partial<Account> = {}): Account {
  return sampleAccount({ id: id as AccountId, agent, name: id, profileDir: `/p/${id}`, ...overrides });
}

function values(overrides: Partial<JobFormValues> = {}): JobFormValues {
  return {
    goal: 'Fix the flaky integration tests in api-server',
    mode: 'single',
    orchestrator: { agent: 'codex', account: 'auto' },
    workers: ['claude', 'codex'],
    commandChecks: [],
    onLimit: DEFAULT_LIMIT_POLICY,
    ...overrides,
  };
}

describe('buildSingleJobSpec', () => {
  it('builds a valid single-mode JobSpec from the form', () => {
    const spec = buildSingleJobSpec(values({ goal: '  Fix tests  ' }), REPO);
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      mode: 'single',
      goal: 'Fix tests',
      repoPath: REPO,
      orchestrator: { agent: 'codex', account: 'auto' },
      workers: ['claude', 'codex'],
      onLimit: 'switch-account',
    });
    expect(JobSpec.safeParse(spec).success).toBe(true);
  });

  it('returns null while the form cannot produce a valid spec', () => {
    expect(buildSingleJobSpec(values({ goal: '   ' }), REPO)).toBeNull();
    expect(buildSingleJobSpec(values({ orchestrator: null }), REPO)).toBeNull();
    expect(buildSingleJobSpec(values({ workers: [] }), REPO)).toBeNull();
    expect(buildSingleJobSpec(values(), '')).toBeNull();
    expect(buildSingleJobSpec(values({ mode: 'compare' }), REPO)).toBeNull();
  });

  it('always carries both locked guardrails, first, exactly once', () => {
    const spec = buildSingleJobSpec(values(), REPO);
    expect(spec?.checks).toEqual(GUARDRAIL_CHECKS);
    expect(spec?.checks).toEqual([
      { kind: 'guardrail', rule: 'no_new_suppressions' },
      { kind: 'guardrail', rule: 'protected_files' },
    ]);
  });

  it('appends the user command checks after the guardrails, in the order added', () => {
    const spec = buildSingleJobSpec(values({ commandChecks: ['npm test', 'npm run lint'] }), REPO);
    expect(spec?.checks).toEqual([
      ...GUARDRAIL_CHECKS,
      { kind: 'command', run: 'npm test' },
      { kind: 'command', run: 'npm run lint' },
    ]);
  });
});

describe('withGuardrails', () => {
  it('re-adds guardrails that are missing and drops duplicates', () => {
    const checks = withGuardrails([
      { kind: 'guardrail', rule: 'protected_files' },
      { kind: 'command', run: 'npm test' },
      { kind: 'guardrail', rule: 'protected_files' },
    ]);
    expect(checks).toEqual([...GUARDRAIL_CHECKS, { kind: 'command', run: 'npm test' }]);
  });

  it('returns exactly the guardrails for an empty list', () => {
    expect(withGuardrails([])).toEqual(GUARDRAIL_CHECKS);
  });
});

describe('mode availability', () => {
  it('enables only single mode; the others wait for S4-01', () => {
    expect(isModeEnabled('single')).toBe(true);
    expect(isModeEnabled('compare')).toBe(false);
    expect(isModeEnabled('council')).toBe(false);
    expect(isModeEnabled('autoloop')).toBe(false);
  });

  it('ignores selecting a disabled mode in the draft store', () => {
    useNewJobDraft.getState().reset();
    useNewJobDraft.getState().selectMode('council');
    expect(useNewJobDraft.getState().mode).toBe('single');
  });

  it('has the exact tooltip copy for disabled modes', () => {
    expect(newJobStrings.modes.comingLater).toBe('Coming in a later version');
  });
});

describe('defaults (JOB-08, JOB-09)', () => {
  it('defaults onLimit to switch-account', () => {
    expect(DEFAULT_LIMIT_POLICY).toBe('switch-account');
    expect(EMPTY_DRAFT.onLimit).toBe('switch-account');
  });

  it('picks the first usable account in account order, on Auto', () => {
    const accounts = [
      acct('claude-work', 'claude', { state: 'signed_out' }),
      acct('codex-personal', 'codex', { state: 'limited' }),
      acct('codex-team', 'codex', { use: false }),
      acct('gemini-google', 'gemini', { state: 'near_limit' }),
    ];
    expect(defaultOrchestrator(accounts)).toEqual({ agent: 'gemini', account: 'auto' });
  });

  it('has no orchestrator default when no account has room', () => {
    expect(defaultOrchestrator([acct('codex-personal', 'codex', { state: 'limited' })])).toBeNull();
    expect(defaultOrchestrator([])).toBeNull();
  });

  it('defaults workers to agents with a usable account, in picker order', () => {
    const accounts = [
      acct('opencode-main', 'opencode'),
      acct('codex-personal', 'codex', { state: 'limited' }),
      acct('claude-personal', 'claude'),
      acct('agy-alt', 'agy', { state: 'signed_out' }),
    ];
    expect(defaultWorkers(accounts)).toEqual(['claude', 'opencode']);
    expect(AGENT_ORDER.indexOf('claude')).toBeLessThan(AGENT_ORDER.indexOf('opencode'));
  });

  it('uses the picks where the user made them and the defaults elsewhere, live', () => {
    const defaults: NewJobDefaults = {
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
    };
    const untouched = effectiveValues(EMPTY_DRAFT, defaults);
    expect(untouched.orchestrator).toEqual(defaults.orchestrator);
    expect(untouched.workers).toEqual(['claude']);

    const pinned: AgentChoice = { agent: 'codex', account: 'codex-team' as AccountId };
    const picked = effectiveValues({ ...EMPTY_DRAFT, orchestratorPick: pinned }, defaults);
    expect(picked.orchestrator).toEqual(pinned);

    const moved = effectiveValues(EMPTY_DRAFT, { ...defaults, orchestrator: { agent: 'gemini', account: 'auto' } });
    expect(moved.orchestrator).toEqual({ agent: 'gemini', account: 'auto' });
  });
});

describe('draft store', () => {
  it('keeps commands once and removes them', () => {
    useNewJobDraft.getState().reset();
    useNewJobDraft.getState().addCommandCheck('npm test');
    useNewJobDraft.getState().addCommandCheck('npm test');
    expect(useNewJobDraft.getState().commandChecks).toEqual(['npm test']);
    useNewJobDraft.getState().removeCommandCheck('npm test');
    expect(useNewJobDraft.getState().commandChecks).toEqual([]);
  });

  it('reset returns every field to the empty draft', () => {
    useNewJobDraft.getState().setGoal('Fix it');
    useNewJobDraft.getState().setOnLimit('ask');
    useNewJobDraft.getState().reset();
    const state = useNewJobDraft.getState();
    expect(state.goal).toBe('');
    expect(state.onLimit).toBe('switch-account');
    expect(state.orchestratorPick).toBeNull();
  });
});

describe('account copy and tones', () => {
  it('treats only signed-in, unlimited, switched-on accounts as usable', () => {
    expect(isUsable(acct('a', 'claude'))).toBe(true);
    expect(isUsable(acct('a', 'claude', { state: 'near_limit' }))).toBe(true);
    expect(isUsable(acct('a', 'claude', { state: 'signed_out' }))).toBe(false);
    expect(isUsable(acct('a', 'claude', { state: 'limited' }))).toBe(false);
    expect(isUsable(acct('a', 'claude', { use: false }))).toBe(false);
  });

  it('maps states to tones', () => {
    expect(accountTone('available')).toBe('ok');
    expect(accountTone('near_limit')).toBe('warn');
    expect(accountTone('limited')).toBe('warn');
    expect(accountTone('estimated')).toBe('neutral');
    expect(accountTone('signed_out')).toBe('err');
  });

  it('writes the account option sub-line from plan and state', () => {
    expect(accountOptionSub(acct('a', 'claude', { plan: 'Max' }), null)).toBe('Max · available');
    expect(accountOptionSub(acct('a', 'agy', { state: 'estimated' }), null)).toBe('Available · est.'.toLowerCase());
    expect(accountOptionSub(acct('c', 'codex', { plan: 'Plus', state: 'limited' }), dateAt(15, 0))).toBe(
      'Plus · limited until 15:00',
    );
  });

  it('writes the Auto sub-line from the core routing decision', () => {
    const names = (id: string) => (id === 'claude-personal' ? 'Personal' : null);
    const account: PickAccountResult = { kind: 'account', accountId: 'claude-personal' as AccountId };
    expect(autoOptionSub(account, names)).toBe('Uses Personal now');
    expect(autoOptionSub({ kind: 'wait', until: null, agent: 'codex' }, names)).toBe('No account has room');
    expect(autoOptionSub({ kind: 'none', agent: 'codex', reason: 'x' }, names)).toBe('No account has room');
    expect(autoOptionSub(undefined, names)).toBe('');
  });
});

/** An ISO time for today at the given local hour and minute. */
function dateAt(hour: number, minute: number): string {
  const d = new Date(2026, 9, 11, hour, minute, 0, 0);
  return d.toISOString();
}

describe('limits and the orchestrator warning', () => {
  it('formats reset times in local 24-hour HH:mm', () => {
    expect(formatResetTime(dateAt(15, 0))).toBe('15:00');
    expect(formatResetTime(dateAt(9, 5))).toBe('09:05');
    expect(formatResetTime(null)).toBeNull();
    expect(formatResetTime(undefined)).toBeNull();
    expect(formatResetTime('not a time')).toBeNull();
  });

  it('shows nothing for Auto, and for a pinned account with room', () => {
    const accounts = [acct('codex-personal', 'codex')];
    expect(pinnedStatus({ agent: 'codex', account: 'auto' }, accounts, {})).toBeNull();
    const status = pinnedStatus({ agent: 'codex', account: 'codex-personal' as AccountId }, accounts, {});
    expect(status).toMatchObject({ limited: false, near: false });
    expect(orchestratorWarning(status, 'Codex', 'Team')).toBeNull();
  });

  it('warns when the pinned orchestrator is limited and turns Start into Schedule', () => {
    const accounts = [acct('codex-personal', 'codex', { state: 'limited', name: 'Personal', plan: 'Plus' })];
    const status = pinnedStatus(
      { agent: 'codex', account: 'codex-personal' as AccountId },
      accounts,
      { 'codex-personal': { resetsAt: dateAt(15, 0) } },
    );
    expect(orchestratorWarning(status, 'Codex', 'Team')).toBe(
      'Codex · Personal is limited until 15:00. The job will be scheduled for then, or pick Auto to start now on Team.',
    );
    expect(startButtonLabel(status)).toBe('Schedule for 15:00');
  });

  it('falls back to the copy without a time when the reset is unknown', () => {
    const accounts = [acct('codex-personal', 'codex', { state: 'limited', name: 'Personal' })];
    const status = pinnedStatus({ agent: 'codex', account: 'codex-personal' as AccountId }, accounts, {});
    expect(orchestratorWarning(status, 'Codex', null)).toBe(
      'Codex · Personal is limited. The job will be scheduled for then, or pick Auto to start now on another account.',
    );
    expect(startButtonLabel(status)).toBe('Start job');
  });

  it('warns for a near-limit pinned orchestrator without changing the button', () => {
    const accounts = [acct('codex-team', 'codex', { state: 'near_limit', name: 'Team' })];
    const status = pinnedStatus({ agent: 'codex', account: 'codex-team' as AccountId }, accounts, {});
    expect(orchestratorWarning(status, 'Codex', null)).toBe(
      'Codex · Team is near its limit. Long jobs may pause partway through.',
    );
    expect(startButtonLabel(status)).toBe('Start job');
  });
});

describe('CLI line request state', () => {
  it('applies only the latest request; a stale reply is ignored', () => {
    const gate = createLatestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });

  it('moves through idle, loading, ready and failed', () => {
    expect(cliIdle.status).toBe('idle');
    expect(cliLoading).toMatchObject({ status: 'loading', command: null });
    expect(cliReady('orch run …')).toMatchObject({ status: 'ready', command: 'orch run …' });
    expect(cliFailed('No repo')).toMatchObject({ status: 'failed', message: 'No repo' });
  });
});
