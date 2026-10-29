import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountId,
  IAccountsService,
  IDoctorService,
  IEventsService,
  IJobsService,
  IQuotaService,
  IReviewService,
  IRunsService,
  ISessionsService,
  IShellService,
  ISpecsService,
  ITrustService,
  JobId,
  OrchEvent,
  QueueId,
  RunId,
  SessionId,
  WorktreeId,
} from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/channels/common';
import { createSocketClientTransport } from '@orchagents/platform/channels/node';
import { CHANNEL_SCHEMAS } from '../channelSchemas.js';
import { startCoreHost, type RunningCoreHost } from '../coreHostMain.js';
import { createDemoServices } from './demoServices.js';
import { DEMO_RESET_AT } from './sampleData.js';

let home = '';
let running: RunningCoreHost[] = [];

function readToken(host: RunningCoreHost): string {
  return readFileSync(host.tokenPath, 'utf8').trim();
}

interface DemoClientServices {
  accounts: IAccountsService;
  quota: IQuotaService;
  jobs: IJobsService;
  runs: IRunsService;
  sessions: ISessionsService;
  review: IReviewService;
  trust: ITrustService;
  shells: IShellService;
  doctor: IDoctorService;
  specs: ISpecsService;
  events: IEventsService;
}

async function connectDemo(host: RunningCoreHost): Promise<{ client: ChannelClient; services: DemoClientServices }> {
  const token = readToken(host);
  const transport = await createSocketClientTransport({ socketPath: host.socketPath, token });
  const client = new ChannelClient(transport);
  const services: DemoClientServices = {
    accounts: client.getService<IAccountsService>('accounts', CHANNEL_SCHEMAS.accounts),
    quota: client.getService<IQuotaService>('quota', CHANNEL_SCHEMAS.quota),
    doctor: client.getService<IDoctorService>('doctor', CHANNEL_SCHEMAS.doctor),
    jobs: client.getService<IJobsService>('jobs'),
    runs: client.getService<IRunsService>('runs'),
    sessions: client.getService<ISessionsService>('sessions'),
    review: client.getService<IReviewService>('review'),
    trust: client.getService<ITrustService>('trust'),
    shells: client.getService<IShellService>('shells'),
    specs: client.getService<ISpecsService>('specs'),
    events: client.getService<IEventsService>('events'),
  };
  return { client, services };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orch-demo-'));
  running = [];
});

afterEach(async () => {
  for (const host of running) await host.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe('Demo mode core host (ORCH_DEMO=1)', () => {
  it('shows a mid-pipeline tidemark product with an open prototype gate, run controls and a filled trail', async () => {
    const demo = createDemoServices({ fire: () => undefined }, 'macos');
    const [pipeline, run, trail, files] = await Promise.all([
      demo.specs.factoryPipeline('~/code/api-server'),
      demo.specs.pipelineRun('~/code/api-server'),
      demo.specs.factoryTrail('~/code/api-server'),
      demo.specs.productFiles('~/code/api-server'),
    ]);
    expect(pipeline.ok && pipeline.value?.product).toBe('tidemark');
    expect(pipeline.ok && pipeline.value?.counts).toMatchObject({ total: 28, done: 11, needs_you: 1, left: 16, gates_ahead: 3 });
    expect(pipeline.ok && pipeline.value?.stages.find((stage) => stage.id === 'approve-prototype')?.state).toBe('needs_you');
    expect(run.ok && run.value).toMatchObject({ state: 'working', stage: 'Extract the look' });
    expect(trail.ok && trail.value.rows).toHaveLength(8);
    expect(trail.ok && new Set(trail.value.rows.map((row) => row.by))).toEqual(new Set(['operator', 'agent']));
    expect(files.ok && files.value.some((file) => file.path === 'design/sheets/prototypes.jpg' && file.kind === 'image')).toBe(true);
  });

  it.each([
    { os: 'macos' as const, accountCount: 7, hasAgyAlt: false },
    { os: 'linux' as const, accountCount: 8, hasAgyAlt: true },
    { os: 'windows' as const, accountCount: 7, hasAgyAlt: false },
  ])('uses the expected demo account set on $os', async ({ os, accountCount, hasAgyAlt }) => {
    const demo = createDemoServices({ fire: () => undefined }, os);
    const accounts = await demo.accounts.list();
    expect(accounts.ok).toBe(true);
    if (accounts.ok) {
      expect(accounts.value).toHaveLength(accountCount);
      expect(accounts.value.some((account) => account.id === 'agy-alt')).toBe(hasAgyAlt);
    }
  });

  it('serves sample data for every service interface over the socket', async () => {
    const host = await startCoreHost({
      home,
      baseEnv: { ORCH_DEMO: '1' },
    });
    running.push(host);

    const { client, services } = await connectDemo(host);

    // Accounts
    const accounts = await services.accounts.list();
    expect(accounts.ok).toBe(true);
    if (accounts.ok) {
      // ACC-03: Antigravity supports parallel accounts on Linux, but only one on
      // macOS and Windows in the demo fixture.
      expect(accounts.value.length).toBe(process.platform === 'linux' ? 8 : 7);
      expect(accounts.value.some((account) => account.id === 'agy-alt')).toBe(process.platform === 'linux');
      expect(accounts.value.map((a) => a.id)).toContain('claude-personal');
      expect(accounts.value.map((a) => a.id)).toContain('codex-team');
    }

    const agents = await services.accounts.listAgents();
    expect(agents.ok).toBe(true);
    if (agents.ok) {
      expect(agents.value.length).toBe(5);
      expect(agents.value.find((a) => a.id === 'claude')?.accountSetting).toBe('CLAUDE_CONFIG_DIR');
    }

    const config = await services.accounts.getConfig();
    expect(config.ok).toBe(true);
    if (config.ok) {
      expect(config.value.parsed.routing).toBe('primary-first');
    }

    // Quota
    const windows = await services.quota.windows();
    expect(windows.ok).toBe(true);
    if (windows.ok) {
      expect(windows.value.length).toBe(11);
      const claude5h = windows.value.find((w) => w.accountId === 'claude-personal' && w.window === '5h');
      expect(claude5h?.usedPct).toBe(62);
    }

    const pick = await services.quota.pickAccount('claude');
    expect(pick.ok).toBe(true);

    const spend = await services.quota.spendToday();
    expect(spend.ok).toBe(true);

    // Jobs
    const jobs = await services.jobs.list();
    expect(jobs.ok).toBe(true);
    if (jobs.ok) {
      expect(jobs.value.length).toBe(3);
      expect(jobs.value.map((j) => j.id)).toEqual(['j-07', 'j-08', 'j-05']);
    }

    const job07 = await services.jobs.get('j-07' as JobId);
    expect(job07.ok).toBe(true);
    if (job07.ok) {
      expect(job07.value.title).toBe('Integration tests for the callback flow');
      expect(job07.value.status).toBe('running');
    }

    // Runs
    const runs = await services.runs.list('j-07' as JobId);
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      expect(runs.value.length).toBe(6);
      expect(runs.value.map((r) => r.id)).toEqual(['r-01', 'r-02', 'r-03', 'r-04', 'r-05', 'r-06']);
    }

    const lines = await services.runs.lines('r-02' as RunId, 0);
    expect(lines.ok).toBe(true);
    if (lines.ok) {
      expect(lines.value.length).toBeGreaterThan(5);
      expect(lines.value.some((l) => l.kind === 'diff_add')).toBe(true);
    }

    // Sessions
    const allSessions = await services.sessions.list('all');
    expect(allSessions.ok).toBe(true);
    if (allSessions.ok) {
      expect(allSessions.value.length).toBeGreaterThanOrEqual(7);
      expect(allSessions.value.map((s) => s.id)).toContain('s-0f9d');
    }

    const resumableSessions = await services.sessions.list('resumable');
    expect(resumableSessions.ok).toBe(true);
    if (resumableSessions.ok) {
      expect(resumableSessions.value.every((s) => s.status !== 'live')).toBe(true);
    }

    const liveSessions = await services.sessions.list('live');
    expect(liveSessions.ok).toBe(true);
    if (liveSessions.ok) {
      expect(liveSessions.value.every((s) => s.status === 'live')).toBe(true);
    }

    const resumeOpts = await services.sessions.resumeOptions('s-91e0' as SessionId);
    expect(resumeOpts.ok).toBe(true);
    if (resumeOpts.ok) {
      expect(resumeOpts.value.length).toBe(4);
    }

    // Review
    const reviews = await services.review.list();
    expect(reviews.ok).toBe(true);
    if (reviews.ok) {
      expect(reviews.value.length).toBe(4);
      expect(reviews.value.find((r) => r.worktree === 'orch/r-02')?.state).toBe('ready');
      expect(reviews.value.find((r) => r.worktree === 'orch/r-05')?.state).toBe('failing');
    }

    const diff = await services.review.diff('~/code/api-server', 'orch/r-02' as WorktreeId, 'src/auth/callback.ts');
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.value.after).toContain('pkceStore.take');
    }

    // Trust
    const trust7 = await services.trust.summary(7);
    expect(trust7.ok).toBe(true);
    if (trust7.ok) {
      expect(trust7.value.firstTryVerifiedPct).toBe(76);
      expect(trust7.value.refutedCount).toBe(3);
      expect(trust7.value.agents.find((a) => a.agent === 'claude')?.eligibleFor).toBe(3);
    }

    const trust30 = await services.trust.summary(30);
    expect(trust30.ok).toBe(true);
    if (trust30.ok) {
      expect(trust30.value.firstTryVerifiedPct).toBe(72);
      expect(trust30.value.refutedCount).toBe(9);
    }

    // Shells
    const shell = await services.shells.open('~/code/api-server', 80, 24);
    expect(shell.ok).toBe(true);

    // Doctor
    const doctor = await services.doctor.run();
    expect(doctor.ok).toBe(true);
    if (doctor.ok) {
      expect(doctor.value.checks.length).toBeGreaterThan(0);
      expect(doctor.value.checks.every((c) => c.status === 'pass')).toBe(true);
    }

    // Specs
    const specsQueue = await services.specs.load('~/code/api-server');
    expect(specsQueue.ok).toBe(true);
    if (specsQueue.ok && specsQueue.value.queue) {
      expect(specsQueue.value.queue.specs.length).toBe(64);
      expect(specsQueue.value.queue.specs.find((s) => s.id === '42')?.state).toBe('running');
    }

    client.dispose();
  });

  it('updates in-memory state on mutating calls and emits live OrchEvents', async () => {
    const host = await startCoreHost({
      home,
      demo: true,
      baseEnv: {},
    });
    running.push(host);

    const { client, services } = await connectDemo(host);

    const receivedEvents: OrchEvent[] = [];
    services.events.subscribe((event) => {
      receivedEvents.push(event);
    });

    // 1. Mutate accounts
    const added = await services.accounts.add({ agent: 'codex', name: 'Client' });
    expect(added.ok).toBe(true);
    const listedAfterAdd = await services.accounts.list();
    expect(listedAfterAdd.ok && listedAfterAdd.value.some((a) => a.name === 'Client')).toBe(true);

    const signedIn = await services.accounts.signIn('codex-client' as AccountId);
    expect(signedIn.ok).toBe(true);

    await services.accounts.setPrimary('codex-team' as AccountId);
    const listedAfterPrimary = await services.accounts.list();
    expect(listedAfterPrimary.ok && listedAfterPrimary.value.find((a) => a.id === 'codex-team')?.primary).toBe(true);

    // 2. Mutate runs
    await services.runs.send('r-02' as RunId, 'Looking good, please proceed');
    const linesAfterSend = await services.runs.lines('r-02' as RunId, 0);
    expect(linesAfterSend.ok && linesAfterSend.value.some((l) => l.text === 'Looking good, please proceed')).toBe(true);

    await services.runs.pause('r-02' as RunId);
    const runsAfterPause = await services.runs.list('j-07' as JobId);
    expect(runsAfterPause.ok && runsAfterPause.value.find((r) => r.id === 'r-02')?.status).toBe('paused_limit');

    // 3. Mutate review
    await services.review.approveAndMerge('~/code/api-server', 'orch/r-02' as WorktreeId);
    const reviewAfterMerge = await services.review.get('~/code/api-server', 'orch/r-02' as WorktreeId);
    expect(reviewAfterMerge.ok && reviewAfterMerge.value.state).toBe('merged');

    // 4. Mutate specs
    await services.specs.pause('q-specs' as QueueId);
    const specQueuePaused = await services.specs.get('q-specs' as QueueId);
    expect(specQueuePaused.ok && specQueuePaused.value.paused).toBe(true);

    // 5. Verify events received
    expect(receivedEvents.length).toBeGreaterThan(0);
    expect(receivedEvents.some((e) => e.type === 'account.changed')).toBe(true);
    expect(receivedEvents.some((e) => e.type === 'run.line')).toBe(true);
    expect(receivedEvents.some((e) => e.type === 'review.changed')).toBe(true);

    client.dispose();
  });

  it('respects process.env.ORCH_DEMO=1', async () => {
    const prevEnv = process.env.ORCH_DEMO;
    process.env.ORCH_DEMO = '1';
    try {
      const host = await startCoreHost({
        home,
        baseEnv: {},
      });
      running.push(host);

      const { client, services } = await connectDemo(host);
      const jobs = await services.jobs.list();
      expect(jobs.ok).toBe(true);
      if (jobs.ok) {
        expect(jobs.value.length).toBe(3);
      }
      client.dispose();
    } finally {
      if (prevEnv === undefined) {
        delete process.env.ORCH_DEMO;
      } else {
        process.env.ORCH_DEMO = prevEnv;
      }
    }
  });

  it('emits initial engine.health ready and quota.limited with resetsAt on accounts.list (U-01)', async () => {
    const host = await startCoreHost({
      home,
      baseEnv: {},
      demo: true,
    });
    running.push(host);

    const { client, services } = await connectDemo(host);
    const receivedEvents: OrchEvent[] = [];
    const unsubscribe = await services.events.subscribe((event) => {
      receivedEvents.push(event);
    });

    await services.accounts.list();

    expect(receivedEvents.some((e) => e.type === 'engine.health' && e.state === 'ready')).toBe(true);
    expect(
      receivedEvents.some(
        (e) =>
          e.type === 'quota.limited' &&
          e.accountId === 'codex-personal' &&
          e.resetsAt === DEMO_RESET_AT,
      ),
    ).toBe(true);

    await unsubscribe();
    client.dispose();
  });

  it('calling list() twice fires config.changed once', async () => {
    const host = await startCoreHost({
      home,
      baseEnv: {},
      demo: true,
    });
    running.push(host);

    const { client, services } = await connectDemo(host);
    const configChangedEvents: OrchEvent[] = [];
    const unsubscribe = await services.events.subscribe((event) => {
      if (event.type === 'config.changed') {
        configChangedEvents.push(event);
      }
    });

    await services.accounts.list();
    await services.accounts.list();

    expect(configChangedEvents.length).toBe(1);

    await unsubscribe();
    client.dispose();
  });
});
