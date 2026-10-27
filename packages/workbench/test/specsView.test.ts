import { describe, expect, it } from 'vitest';
import type {
  Account,
  Check,
  QueueId,
  SpecFile,
  SpecQueue,
  SpecQueueSettings,
  SpecRun,
  SpecState,
} from '@orchagents/contracts';
import { AccountId, SpecId } from '@orchagents/contracts';
import {
  formatTokens,
  mapViewModel,
  nowLine,
  progressSegments,
  queueCounts,
  rulesOptions,
  specRows,
  specStatus,
  type SpecsViewContext,
} from '../src/browser/contrib/specs/specsView.js';

function makeSpecFile(id: string, overrides: Partial<SpecFile> = {}): SpecFile {
  return {
    id,
    title: `Spec ${id} title`,
    depends_on: [],
    scope: [`src/${id}/**`],
    done_when: [
      { by: 'check', text: 'Tests pass', check: { kind: 'command', run: 'pnpm test' } as Check },
    ],
    agent: 'claude',
    mode: 'single',
    agents: [],
    ...overrides,
  };
}

function makeSpecRun(id: string, position: number, state: SpecState, overrides: Partial<SpecRun> = {}): SpecRun {
  return {
    id: SpecId.parse(id),
    queueId: 'q-test' as QueueId,
    position,
    file: `docs/specs/${id}-test.md`,
    spec: makeSpecFile(id, overrides.spec),
    state,
    attempt: 1,
    jobId: null,
    worktree: null,
    implementer: { agent: 'claude', accountId: AccountId.parse('claude-work') },
    criteria: [
      { index: 0, state: 'met', summary: 'Passed', auditor: null },
    ],
    blockedBy: [],
    startedAt: '2026-10-11T10:00:00Z',
    finishedAt: '2026-10-11T10:05:00Z',
    tokens: 12500,
    history: [],
    ...overrides,
  };
}

function makeQueue(specs: SpecRun[], settingsOverrides: Partial<SpecQueueSettings> = {}, paused = false): SpecQueue {
  return {
    id: 'q-test' as QueueId,
    repoPath: '/work/my-repo',
    paused,
    createdAt: '2026-10-11T09:00:00Z',
    settings: {
      source: 'docs/specs',
      order: 'strict',
      advance: 'verified',
      retries: 2,
      on_fail: 'retry-stop',
      max_parallel: 2,
      after_each: [
        { name: 'lint-gate', run: 'pnpm lint', timeout_s: 60 },
      ],
      ...settingsOverrides,
    },
    specs,
  };
}

const mockCtx: SpecsViewContext = {
  accounts: [
    {
      id: AccountId.parse('claude-work'),
      agent: 'claude',
      name: 'Work Account',
      primary: true,
      use: true,
      state: 'available',
      profileDir: '/tmp/profiles/claude-1',
      skillsShared: false,
    } satisfies Account,
  ],
  now: new Date('2026-10-11T10:10:00Z'),
};

describe('specsView: specStatus (§12 exact labels)', () => {
  it('formats queued specs without unsatisfied dependencies', () => {
    const s = makeSpecRun('01', 1, 'queued');
    const status = specStatus(s, [s], 'verified');
    expect(status.pill).toBe('Queued');
    expect(status.secondLine).toBe('Next in line');
    expect(status.tone).toBe('neutral');
  });

  it('formats queued specs waiting on a dependency', () => {
    const s1 = makeSpecRun('01', 1, 'running');
    const s2 = makeSpecRun('02', 2, 'queued', { spec: makeSpecFile('02', { depends_on: ['01'] }) });
    const status = specStatus(s2, [s1, s2], 'verified');
    expect(status.pill).toBe('Waiting for 01');
    expect(status.secondLine).toBe('Starts automatically when 01 is verified');
    expect(status.tone).toBe('neutral');
  });

  it('formats blocked specs', () => {
    const s = makeSpecRun('02', 2, 'blocked', { blockedBy: [SpecId.parse('01')] });
    const status = specStatus(s, [s], 'verified');
    expect(status.pill).toBe('Blocked by 01');
    expect(status.secondLine).toBe("Won't run until 01 is retried");
    expect(status.tone).toBe('neutral');
  });

  it('formats waiting_quota specs', () => {
    const s = makeSpecRun('01', 1, 'waiting_quota', { implementer: { agent: 'claude', accountId: AccountId.parse('claude-work') } });
    const status = specStatus(s, [s], 'verified');
    expect(status.pill).toBe('Waiting for an account');
    expect(status.secondLine).toBe('Starts when Claude Code has room');
    expect(status.tone).toBe('info');
  });

  it('formats running, verifying, and auditing specs', () => {
    const sRun = makeSpecRun('01', 1, 'running', { attempt: 2 });
    expect(specStatus(sRun, [sRun])).toEqual({
      pill: 'Running · try 2',
      secondLine: 'Step 1 of 3 · implement',
      tone: 'info',
    });

    const sVer = makeSpecRun('01', 1, 'verifying', { attempt: 1 });
    expect(specStatus(sVer, [sVer])).toEqual({
      pill: 'Running · try 1',
      secondLine: 'Step 2 of 3 · checks',
      tone: 'info',
    });

    const sAud = makeSpecRun('01', 1, 'auditing', {
      attempt: 1,
      criteria: [
        { index: 0, state: 'running', summary: null, auditor: { agent: 'codex', accountId: AccountId.parse('codex-team'), sameAgent: false } },
      ],
    });
    expect(specStatus(sAud, [sAud])).toEqual({
      pill: 'Running · try 1',
      secondLine: 'Step 3 of 3 · audit by Codex',
      tone: 'info',
    });
  });

  it('formats verified and approved specs', () => {
    const sVer = makeSpecRun('01', 1, 'verified');
    expect(specStatus(sVer, [sVer])).toEqual({
      pill: 'Verified · your review',
      secondLine: 'Ready in Review',
      tone: 'info',
    });

    const s0 = makeSpecRun('00', 0, 'verified');
    const sAppWithDep = makeSpecRun('01', 1, 'approved', {
      spec: makeSpecFile('01', { depends_on: ['00'] }),
    });
    expect(specStatus(sAppWithDep, [s0, sAppWithDep])).toEqual({
      pill: 'Verified · approved',
      secondLine: 'Merges after 00',
      tone: 'ok',
    });

    const sAppMerging = makeSpecRun('01', 1, 'approved');
    expect(specStatus(sAppMerging, [sAppMerging])).toEqual({
      pill: 'Verified · approved',
      secondLine: 'Merging',
      tone: 'ok',
    });
  });

  it('formats merged specs', () => {
    const sMergedNoDep = makeSpecRun('01', 1, 'merged', { spec: makeSpecFile('01', { depends_on: [] }) });
    expect(specStatus(sMergedNoDep, [sMergedNoDep])).toEqual({
      pill: 'Verified · merged',
      secondLine: '',
      tone: 'ok',
    });

    const sMergedWithDep = makeSpecRun('02', 2, 'merged', { spec: makeSpecFile('02', { depends_on: ['01'] }) });
    expect(specStatus(sMergedWithDep, [sMergedWithDep])).toEqual({
      pill: 'Verified · merged',
      secondLine: 'Depends on 01',
      tone: 'ok',
    });
  });

  it('formats needs_you, skipped, and cancelled specs', () => {
    const sNeed1 = makeSpecRun('01', 1, 'needs_you', { attempt: 1 });
    expect(specStatus(sNeed1, [sNeed1])).toEqual({
      pill: 'Stopped · 1 try',
      secondLine: 'Queue paused here: needs you',
      tone: 'err',
    });

    const sNeed3 = makeSpecRun('01', 1, 'needs_you', { attempt: 3 });
    expect(specStatus(sNeed3, [sNeed3])).toEqual({
      pill: 'Stopped · 3 tries',
      secondLine: 'Queue paused here: needs you',
      tone: 'err',
    });

    const sSkip = makeSpecRun('01', 1, 'skipped', { attempt: 2 });
    expect(specStatus(sSkip, [sSkip])).toEqual({
      pill: 'Skipped · 2 tries',
      secondLine: 'Skipped; the queue moved on',
      tone: 'warn',
    });

    const sCancel = makeSpecRun('01', 1, 'cancelled');
    expect(specStatus(sCancel, [sCancel])).toEqual({
      pill: 'Cancelled',
      secondLine: '',
      tone: 'neutral',
    });
  });
});

describe('specsView: queueCounts and progressSegments (§12)', () => {
  it('computes counts with retry-stop setting', () => {
    const specs = [
      makeSpecRun('01', 1, 'merged'),
      makeSpecRun('02', 2, 'verified'),
      makeSpecRun('03', 3, 'running'),
      makeSpecRun('04', 4, 'needs_you'),
      makeSpecRun('05', 5, 'queued'),
      makeSpecRun('06', 6, 'blocked'),
    ];
    const settings: SpecQueueSettings = {
      source: 'docs/specs',
      order: 'strict',
      advance: 'verified',
      retries: 2,
      on_fail: 'retry-stop',
      max_parallel: 2,
      after_each: [],
    };
    const counts = queueCounts(specs, settings);
    expect(counts).toEqual({
      verified: 2,
      running: 1,
      bad: 1,
      badLabel: 'needs you',
      badTone: 'err',
      queued: 2,
      total: 6,
    });

    const segments = progressSegments(specs, settings);
    expect(segments).toHaveLength(4);
    expect(segments[0]?.tone).toBe('ok');
    expect(segments[2]?.tone).toBe('err');
  });

  it('computes counts with retry-skip setting', () => {
    const specs = [
      makeSpecRun('01', 1, 'merged'),
      makeSpecRun('02', 2, 'skipped'),
      makeSpecRun('03', 3, 'queued'),
    ];
    const settings: SpecQueueSettings = {
      source: 'docs/specs',
      order: 'strict',
      advance: 'verified',
      retries: 2,
      on_fail: 'retry-skip',
      max_parallel: 2,
      after_each: [],
    };
    const counts = queueCounts(specs, settings);
    expect(counts.bad).toBe(1);
    expect(counts.badLabel).toBe('skipped');
    expect(counts.badTone).toBe('warn');

    const segments = progressSegments(specs, settings);
    expect(segments[2]?.tone).toBe('warn');
  });
});

describe('specsView: nowLine', () => {
  it('returns paused line when queue is paused', () => {
    const q = makeQueue([makeSpecRun('01', 1, 'queued')], {}, true);
    const nl = nowLine(q);
    expect(nl).toEqual({
      text: 'Queue paused. Running specs finish; nothing new starts until you resume.',
      tone: 'neutral',
      icon: 'pauseCircle',
    });
  });

  it('returns stopped text when a spec needs you', () => {
    const s1 = makeSpecRun('01', 1, 'needs_you', { attempt: 3 });
    const s2 = makeSpecRun('02', 2, 'queued', {
      spec: makeSpecFile('02', { depends_on: ['00'] }),
    });
    const s0 = makeSpecRun('00', 0, 'running');
    const q = makeQueue([s0, s1, s2]);
    const nl = nowLine(q);
    expect(nl).not.toBeNull();
    expect(nl?.tone).toBe('warn');
    expect(nl?.icon).toBe('alert');
    expect(nl?.text).toContain('Spec 01 stopped after 3 tries and needs you');
  });

  it('returns startsWhen for next waiting spec when nothing needs you', () => {
    const s1 = makeSpecRun('01', 1, 'running');
    const s2 = makeSpecRun('02', 2, 'queued', {
      spec: makeSpecFile('02', { depends_on: ['01'] }),
    });
    const q = makeQueue([s1, s2]);
    const nl = nowLine(q);
    expect(nl).toEqual({
      text: 'Spec 02 starts as soon as 01 is verified.',
      tone: 'info',
      icon: 'sync',
    });
  });

  it('returns null when no spec is waiting on a dependency', () => {
    const s1 = makeSpecRun('01', 1, 'queued');
    const q = makeQueue([s1]);
    expect(nowLine(q)).toBeNull();
  });
});

describe('specsView: rulesOptions', () => {
  it('generates options and highlights active settings', () => {
    const settings: SpecQueueSettings = {
      source: 'docs/specs',
      order: 'waves',
      advance: 'approved',
      retries: 3,
      on_fail: 'retry-skip',
      max_parallel: 2,
      after_each: [],
    };
    const rules = rulesOptions(settings);
    expect(rules.order.find((o) => o.value === 'waves')?.pressed).toBe(true);
    expect(rules.order.find((o) => o.value === 'strict')?.pressed).toBe(false);

    expect(rules.advance.find((a) => a.value === 'approved')?.pressed).toBe(true);
    expect(rules.advance.find((a) => a.value === 'verified')?.pressed).toBe(false);

    const failSkip = rules.onFail.find((f) => f.value === 'retry-skip');
    expect(failSkip?.pressed).toBe(true);
    expect(failSkip?.label).toBe('Retry 3× then skip');
  });
});

describe('specsView: specRows grouping (§12)', () => {
  it('groups leading merged specs and trailing queued specs', () => {
    const specs = [
      makeSpecRun('01', 1, 'merged'),
      makeSpecRun('02', 2, 'merged'),
      makeSpecRun('03', 3, 'running'),
      makeSpecRun('04', 4, 'queued'),
      makeSpecRun('05', 5, 'queued'),
    ];
    const rows = specRows(specs, { advance: 'verified', selectedId: '03' }, mockCtx);
    expect(rows).toHaveLength(3); // group-merged, 03, group-queued
    expect(rows[0]?.key).toBe('group-merged');
    expect(rows[1]?.key).toBe('03');
    expect(rows[2]?.key).toBe('group-queued');
  });

  it('groups the full leading merged history', () => {
    const specs = [
      makeSpecRun('01', 1, 'merged'),
      makeSpecRun('02', 2, 'merged'),
      makeSpecRun('03', 3, 'merged'),
      makeSpecRun('04', 4, 'merged'),
      makeSpecRun('05', 5, 'running'),
    ];
    const rows = specRows(specs, { advance: 'verified', selectedId: '05' }, mockCtx);
    expect(rows.map((row) => row.key)).toEqual(['group-merged', '05']);
    expect(rows[0]).toMatchObject({ range: '01–04', text: '4 specs verified and merged' });
  });
});

describe('specsView: mapViewModel', () => {
  it('constructs runner, spec nodes, steps, and background tasks', () => {
    const s1 = makeSpecRun('01', 1, 'running', { tokens: 10000 });
    const s2 = makeSpecRun('02', 2, 'queued', {
      tokens: 5000,
      spec: makeSpecFile('02', { depends_on: ['01'] }),
    });
    const s3 = makeSpecRun('03', 3, 'queued', { tokens: 7000 });
    const q = makeQueue([s1, s2, s3], {
      after_each: [{ name: 'lint-gate', run: 'pnpm lint', timeout_s: 30 }],
    });
    const vm = mapViewModel(q, mockCtx, '01');

    expect(vm.runner.id).toBe('runner');
    expect(vm.runner.title).toContain('my-repo');
    expect(vm.runner.sub).toContain('1 agent');
    expect(vm.runner.sub).toContain('10k');
    expect(vm.runner.tone).toBe('info');

    expect(vm.specNodes.map((node) => node.id)).toEqual(['01', '02']);
    expect(vm.selectedId).toBe('01');
    expect(vm.hasSelection).toBe(true);
    expect(vm.steps).toHaveLength(3);
    expect(vm.steps[0]?.title).toContain('Implement (spec 01)');

    expect(vm.backgroundTasks).toHaveLength(1);
    expect(vm.backgroundTasks[0]?.title).toBe('lint-gate');
  });
});

describe('specsView: formatTokens', () => {
  it('formats thousands and millions correctly', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1500)).toBe('2k');
    expect(formatTokens(24500)).toBe('25k');
    expect(formatTokens(1250000)).toBe('1.25M');
  });
});
