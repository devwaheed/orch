/**
 * The core host uses an engine that is already running and reached by a port
 * (Electron's engine utility), instead of forking its own (item 6). Restart
 * ordering (item 7): past-due auto-resumes wait for the engine to report ready.
 * Fake port and fake engine; no Claw, no agent.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineRequest } from '@orch/contracts';
import { createPortPair } from '@orch/platform/src/engine/test/portPair.js';
import type { EnginePort } from '@orch/platform/src/engine/common/engineClient.js';
import type { ProcessOutcome, ProcessRunner } from '@orch/platform/src/doctor/common/doctor.js';
import type { IAccountProcessRunner } from '@orch/platform/src/accounts/common/accounts.js';
import { StoreService } from '@orch/platform/src/store/node/storeService.js';
import { jobTable, runLinkTable } from '@orch/platform/src/store/common/schema.js';
import { startCoreHost, type RunningCoreHost } from '../node/coreHostMain.js';
import { ENGINE_PORT_MESSAGE, startCoreUtility, type CoreParentPortLike } from './coreHost.js';

let home = '';
let running: RunningCoreHost[] = [];
let received: EngineRequest[];

const doctorRunner: ProcessRunner = {
  async run(): Promise<ProcessOutcome> {
    return { kind: 'not_found' };
  },
};
const accountsRunner: IAccountProcessRunner = {
  async run() {
    return null;
  },
};

/** A fake engine host on the far side of a port. It answers requests and sends engine.ready when told. */
function fakeEngine(): { port: EnginePort; ready(): void } {
  const pair = createPortPair();
  pair.right.on('message', (raw) => {
    const message = raw as { id?: number; request?: EngineRequest };
    if (message.request === undefined || message.id === undefined) return;
    received.push(message.request);
    pair.right.postMessage({ id: message.id, ok: true, value: { session: message.request.op === 'session.resume' ? message.request.session : undefined } });
  });
  return {
    port: pair.left,
    ready: () => pair.right.postMessage({ type: 'engine.ready', engineVersion: 'test' }),
  };
}

/** Seeds one run paused by a limit whose auto-resume time has already passed (QTA-04). */
async function seedPastDueRun(): Promise<void> {
  const orchRoot = path.join(home, '.orch');
  mkdirSync(path.join(orchRoot, 'profiles', 'claude-a'), { recursive: true });
  const store = new StoreService();
  await store.open({ dbPath: path.join(orchRoot, 'orch.db'), backupDir: path.join(orchRoot, 'backups') });
  await store.db.insert(jobTable).values({
    id: 'j-1',
    title: 'goal',
    mode: 'single',
    spec: {
      mode: 'single',
      goal: 'goal',
      repoPath: '/repo',
      orchestrator: { agent: 'claude', account: 'auto' },
      workers: ['claude'],
      checks: [],
      onLimit: 'switch-account',
    },
    status: 'running',
    step: null,
    createdAt: '2026-10-11T12:00:00.000Z',
    scheduledFor: null,
  });
  await store.db.insert(runLinkTable).values({
    id: 'r-1',
    jobId: 'j-1',
    parentId: null,
    depth: 0,
    role: 'implementer',
    task: 'goal',
    agent: 'claude',
    accountId: 'claude-a',
    status: 'paused_limit',
    worktree: 'orch/r-1',
    readOnly: false,
    sessionId: 's-old',
    cliSessionId: null,
    startedAt: '2026-10-11T12:00:00.000Z',
    resumesAt: null,
    autoResume: true,
    resumeFireAt: '2020-01-01T00:00:00.000Z',
  });
  store.close();
}

function options() {
  return {
    home,
    baseEnv: {},
    runners: { doctor: doctorRunner, accounts: accountsRunner },
    measureFreeBytes: async () => 1,
  };
}

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
}

const resumes = (): EngineRequest[] => received.filter((r) => r.op === 'session.resume');

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'orch-engine-port-'));
  received = [];
  running = [];
});

afterEach(async () => {
  for (const host of running) await host.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe('engine port (Electron hands the core host the engine utility)', () => {
  it('uses the engine on the port and waits for it to be ready before past-due auto-resumes (QTA-04)', async () => {
    await seedPastDueRun();
    const engine = fakeEngine();
    running.push(await startCoreHost({ ...options(), enginePort: engine.port }));

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(resumes()).toEqual([]);

    engine.ready();
    await waitFor(() => resumes().length === 1);
    expect(resumes()[0]).toMatchObject({ op: 'session.resume', session: 's-old' });
  });

  it('Electron path: an engine port sent to the utility parent port is attached, and the resume still waits for ready', async () => {
    await seedPastDueRun();
    const listeners: Array<(event: { data: unknown; ports: readonly never[] }) => void> = [];
    const parentPort: CoreParentPortLike = {
      on: (_event, listener) => {
        listeners.push(listener as (event: { data: unknown; ports: readonly never[] }) => void);
      },
    };
    const host = await startCoreUtility(parentPort, options());
    running.push(host);

    const engine = fakeEngine();
    for (const listener of listeners) {
      listener({ data: { type: ENGINE_PORT_MESSAGE }, ports: [engine.port as unknown as never] });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(resumes()).toEqual([]);

    engine.ready();
    await waitFor(() => resumes().length === 1);
    expect(resumes()[0]).toMatchObject({ op: 'session.resume', session: 's-old' });
  });
});
