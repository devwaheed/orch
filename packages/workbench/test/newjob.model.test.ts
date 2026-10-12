import { describe, expect, it } from 'vitest';
import type { Account, AccountId, AgentChoice, AgentId, PickAccountResult } from '@orchagents/contracts';
import { JobSpec } from '@orchagents/contracts';
import {
  AGENT_ORDER,
  AUTOLOOP_ROLES,
  COUNCIL_ROUNDS_OPTIONS,
  DEFAULT_COUNCIL_ROUNDS,
  DEFAULT_LIMIT_POLICY,
  ENABLED_MODES,
  GUARDRAIL_CHECKS,
  accountOptionSub,
  accountTone,
  autoOptionSub,
  buildJobSpec,
  buildSingleJobSpec,
  cliFailed,
  cliIdle,
  cliLoading,
  cliReady,
  createLatestGate,
  defaultCombine,
  defaultCompareAgents,
  defaultCouncilAgents,
  defaultCouncilRounds,
  defaultOrchestrator,
  defaultRoles,
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
    appAddress: '',
    onLimit: DEFAULT_LIMIT_POLICY,
    compareAgents: ['claude', 'codex'],
    combine: true,
    councilAgents: ['claude', 'codex', 'opencode'],
    councilRounds: DEFAULT_COUNCIL_ROUNDS,
    roles: { planner: 'claude', coder: 'codex', reviewer: 'gemini' },
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

  it('turns the web and file-rule presets into their checks; the web check needs a valid app address', () => {
    const checks = ['GET /health returns 200', 'Only src/ and test/ change'];
    expect(buildSingleJobSpec(values({ commandChecks: checks }), REPO)).toBeNull();
    expect(buildSingleJobSpec(values({ commandChecks: checks, appAddress: 'localhost:3000' }), REPO)).toBeNull();
    const spec = buildSingleJobSpec(values({ commandChecks: checks, appAddress: ' http://localhost:3000/ ' }), REPO);
    expect(spec?.checks.slice(GUARDRAIL_CHECKS.length)).toEqual([
      { kind: 'http', url: 'http://localhost:3000/health', expectStatus: 200 },
      { kind: 'file_rule', allow: ['src/**', 'test/**'] },
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

describe('buildJobSpec', () => {
  it('builds a valid single-mode JobSpec', () => {
    const spec = buildJobSpec(values({ mode: 'single' }), REPO);
    expect(spec?.mode).toBe('single');
    expect(JobSpec.safeParse(spec).success).toBe(true);
  });

  it('builds a valid compare-mode JobSpec (2–5 agents)', () => {
    const spec = buildJobSpec(values({ mode: 'compare', compareAgents: ['claude', 'codex'], combine: true }), REPO);
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      mode: 'compare',
      agents: ['claude', 'codex'],
      combine: true,
      repoPath: REPO,
    });
    expect(JobSpec.safeParse(spec).success).toBe(true);
  });

  it('rejects compare mode with fewer than 2 or more than 5 agents', () => {
    expect(buildJobSpec(values({ mode: 'compare', compareAgents: ['claude'] }), REPO)).toBeNull();
    expect(
      buildJobSpec(
        values({ mode: 'compare', compareAgents: ['claude', 'codex', 'gemini', 'opencode', 'agy', 'codex'] }),
        REPO,
      ),
    ).toBeNull();
  });

  it('builds a valid council-mode JobSpec (2–5 members, rounds 3/5/8)', () => {
    for (const rounds of COUNCIL_ROUNDS_OPTIONS) {
      const spec = buildJobSpec(
        values({ mode: 'council', councilAgents: ['claude', 'codex', 'opencode'], councilRounds: rounds }),
        REPO,
      );
      expect(spec).not.toBeNull();
      expect(spec).toMatchObject({
        mode: 'council',
        agents: ['claude', 'codex', 'opencode'],
        maxRounds: rounds,
      });
      expect(JobSpec.safeParse(spec).success).toBe(true);
    }
  });

  it('rejects council mode with fewer than 2 agents or invalid rounds', () => {
    expect(buildJobSpec(values({ mode: 'council', councilAgents: ['claude'] }), REPO)).toBeNull();
    expect(buildJobSpec(values({ mode: 'council', councilAgents: ['claude', 'codex'], councilRounds: 4 }), REPO)).toBeNull();
  });

  it('builds a valid autoloop-mode JobSpec with planner, coder, reviewer', () => {
    const spec = buildJobSpec(
      values({
        mode: 'autoloop',
        roles: { planner: 'claude', coder: 'codex', reviewer: 'gemini' },
      }),
      REPO,
    );
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      mode: 'autoloop',
      roles: { planner: 'claude', coder: 'codex', reviewer: 'gemini' },
    });
    expect(JobSpec.safeParse(spec).success).toBe(true);
  });
});

describe('mode availability', () => {
  it('enables all four modes in S4-01', () => {
    expect(ENABLED_MODES).toEqual(['single', 'compare', 'council', 'autoloop']);
    expect(isModeEnabled('single')).toBe(true);
    expect(isModeEnabled('compare')).toBe(true);
    expect(isModeEnabled('council')).toBe(true);
    expect(isModeEnabled('autoloop')).toBe(true);
  });

  it('selects compare, council, and autoloop modes in the draft store', () => {
    useNewJobDraft.getState().reset();
    useNewJobDraft.getState().selectMode('compare');
    expect(useNewJobDraft.getState().mode).toBe('compare');
    useNewJobDraft.getState().selectMode('council');
    expect(useNewJobDraft.getState().mode).toBe('council');
    useNewJobDraft.getState().selectMode('autoloop');
    expect(useNewJobDraft.getState().mode).toBe('autoloop');
    useNewJobDraft.getState().selectMode('single');
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

  it('defaults compare agents to 2–5 usable agents and combine to true', () => {
    const accounts = [
      acct('opencode-main', 'opencode'),
      acct('codex-personal', 'codex'),
      acct('claude-personal', 'claude'),
    ];
    expect(defaultCompareAgents(accounts)).toEqual(['claude', 'codex', 'opencode']);
    expect(defaultCombine()).toBe(true);
    expect(defaultCompareAgents([])).toEqual(['claude', 'codex']);
  });

  it('defaults council members to 2–5 usable agents and rounds to 5', () => {
    const accounts = [
      acct('opencode-main', 'opencode'),
      acct('codex-personal', 'codex'),
      acct('claude-personal', 'claude'),
    ];
    expect(defaultCouncilAgents(accounts)).toEqual(['claude', 'codex', 'opencode']);
    expect(defaultCouncilRounds()).toBe(5);
    expect(defaultCouncilAgents([])).toEqual(['claude', 'codex', 'opencode']);
  });

  it('defaults autoloop roles (Planner, Coder, Reviewer) from usable agents', () => {
    const accounts = [
      acct('claude-personal', 'claude'),
      acct('codex-personal', 'codex'),
      acct('gemini-main', 'gemini'),
    ];
    const roles = defaultRoles(accounts);
    expect(roles.planner).toBe('claude');
    expect(roles.coder).toBe('codex');
    expect(roles.reviewer).toBe('gemini');
    expect(AUTOLOOP_ROLES.map((r) => r.role)).toEqual(['planner', 'coder', 'reviewer']);
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
      compareAgents: ['claude', 'codex'],
      combine: true,
      councilAgents: ['claude', 'codex', 'opencode'],
      councilRounds: 5,
      roles: { planner: 'claude', coder: 'codex', reviewer: 'gemini' },
    };
    const untouched = effectiveValues(EMPTY_DRAFT, defaults);
    expect(untouched.orchestrator).toEqual(defaults.orchestrator);
    expect(untouched.workers).toEqual(['claude']);
    expect(untouched.compareAgents).toEqual(['claude', 'codex']);
    expect(untouched.combine).toBe(true);
    expect(untouched.councilAgents).toEqual(['claude', 'codex', 'opencode']);
    expect(untouched.councilRounds).toBe(5);
    expect(untouched.roles).toEqual({ planner: 'claude', coder: 'codex', reviewer: 'gemini' });

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

  it('updates mode picks: compare agents, combine, council members, rounds, and roles', () => {
    useNewJobDraft.getState().reset();
    useNewJobDraft.getState().setCompareAgents(['claude', 'gemini']);
    expect(useNewJobDraft.getState().compareAgentsPick).toEqual(['claude', 'gemini']);
    useNewJobDraft.getState().toggleCompareAgent('codex');
    expect(useNewJobDraft.getState().compareAgentsPick).toEqual(['claude', 'gemini', 'codex']);
    useNewJobDraft.getState().toggleCompareAgent('gemini');
    expect(useNewJobDraft.getState().compareAgentsPick).toEqual(['claude', 'codex']);

    useNewJobDraft.getState().setCombine(false);
    expect(useNewJobDraft.getState().combinePick).toBe(false);

    useNewJobDraft.getState().setCouncilAgents(['claude', 'codex']);
    expect(useNewJobDraft.getState().councilAgentsPick).toEqual(['claude', 'codex']);
    useNewJobDraft.getState().toggleCouncilMember('opencode');
    expect(useNewJobDraft.getState().councilAgentsPick).toEqual(['claude', 'codex', 'opencode']);
    useNewJobDraft.getState().toggleCouncilMember('codex');
    expect(useNewJobDraft.getState().councilAgentsPick).toEqual(['claude', 'opencode']);

    useNewJobDraft.getState().setCouncilRounds(8);
    expect(useNewJobDraft.getState().councilRoundsPick).toBe(8);

    useNewJobDraft.getState().setRole('planner', 'codex');
    useNewJobDraft.getState().setRole('coder', 'opencode');
    useNewJobDraft.getState().setRole('reviewer', 'claude');
    expect(useNewJobDraft.getState().rolesPick).toEqual({
      planner: 'codex',
      coder: 'opencode',
      reviewer: 'claude',
    });
  });

  it('reset returns every field to the empty draft', () => {
    useNewJobDraft.getState().setGoal('Fix it');
    useNewJobDraft.getState().setOnLimit('ask');
    useNewJobDraft.getState().selectMode('compare');
    useNewJobDraft.getState().setCompareAgents(['claude', 'codex']);
    useNewJobDraft.getState().setCombine(false);
    useNewJobDraft.getState().setCouncilAgents(['claude', 'codex', 'opencode']);
    useNewJobDraft.getState().setCouncilRounds(8);
    useNewJobDraft.getState().setRole('planner', 'codex');
    useNewJobDraft.getState().reset();
    const state = useNewJobDraft.getState();
    expect(state.goal).toBe('');
    expect(state.mode).toBe('single');
    expect(state.onLimit).toBe('switch-account');
    expect(state.orchestratorPick).toBeNull();
    expect(state.compareAgentsPick).toBeNull();
    expect(state.combinePick).toBeNull();
    expect(state.councilAgentsPick).toBeNull();
    expect(state.councilRoundsPick).toBeNull();
    expect(state.rolesPick).toBeNull();
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

describe('startButtonLabel across all modes', () => {
  it('formats label for single, compare, council, and autoloop modes', () => {
    expect(startButtonLabel('single', null)).toBe('Start job');
    expect(startButtonLabel('compare', null, 3)).toBe('Ask 3 agents');
    expect(startButtonLabel('compare', null, 2)).toBe('Ask 2 agents');
    expect(startButtonLabel('council', null)).toBe('Start council');
    expect(startButtonLabel('autoloop', null)).toBe('Start with the Planner');
  });

  it('respects schedule time when single mode orchestrator is limited', () => {
    const limitedStatus = {
      limited: true,
      near: false,
      resetsAt: dateAt(15, 0),
      account: acct('codex-personal', 'codex'),
    };
    expect(startButtonLabel('single', limitedStatus)).toBe('Schedule for 15:00');
  });
});

