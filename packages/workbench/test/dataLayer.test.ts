/**
 * Data layer end to end: connectCore (fake window + bridge), connectDataLayer against the
 * real platform ChannelServer, stores fed by events, and the shell status derived from them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ok } from '@orchagents/base';
import type { Account, OrchEvent } from '@orchagents/contracts';
import { MiniCoreServer } from './support/coreServer.js';
import {
  ORCH_PORT_MESSAGE,
  connectCore,
  type OrchBridge,
  type PortMessageTarget,
} from '../src/browser/services/orchClient.js';
import { connectDataLayer, type DataLayer } from '../src/browser/services/stores/bootstrap.js';
import { applyOrchEvent } from '../src/browser/services/stores/apply.js';
import { computeShellStatus, formatResetTime, startShellStatusSync } from '../src/browser/services/stores/shellStatus.js';
import { useAccountsStore } from '../src/browser/services/stores/accounts.js';
import { useEngineStore } from '../src/browser/services/stores/engine.js';
import { useJobsStore, useRunsStore } from '../src/browser/services/stores/work.js';
import { useQuotaStore } from '../src/browser/services/stores/quota.js';
import { useReviewStore } from '../src/browser/services/stores/review.js';
import { useSessionsStore } from '../src/browser/services/stores/sessions.js';
import { useSpecsStore } from '../src/browser/services/stores/specs.js';
import { useWorkbenchStore } from '../src/browser/services/workbenchStore.js';
import { dataStrings } from '../src/browser/services/dataStrings.js';
import { sampleAccount, sampleAgent, sampleLine, sampleReview, sampleRun } from './fixtures.js';

class FakeWindow implements PortMessageTarget {
  private readonly listeners = new Set<(event: MessageEvent) => void>();
  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }
  dispatch(data: unknown, ports: unknown[] = []): void {
    const event = { data, ports } as unknown as MessageEvent;
    for (const listener of Array.from(this.listeners)) listener(event);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resetStores(): void {
  useAccountsStore.setState({ accounts: [], agents: [] });
  useQuotaStore.setState({ windows: {}, limits: {} });
  useJobsStore.setState({ jobs: [] });
  useRunsStore.setState({ runs: [], lines: {} });
  useSessionsStore.setState({ sessions: [] });
  useReviewStore.setState({ worktrees: [] });
  useSpecsStore.setState({ queues: [] });
  useEngineStore.setState({ state: 'unknown', message: null });
  useWorkbenchStore.setState({
    engineHealthy: false,
    statusRuns: '',
    limitedAccount: null,
    signedOutCount: 0,
    badges: {},
  });
}

/** A core host with the lists the bootstrap loads, plus an events hub we can fire into. */
function startFakeCore(accounts: Account[]) {
  const { port1, port2 } = new MessageChannel();
  const server = new MiniCoreServer();
  server.register('accounts', {
    listAgents: async () => ok([sampleAgent()]),
    list: async () => ok(accounts),
  });
  server.register('quota', { windows: async () => ok([]) });
  server.register('jobs', { list: async () => ok([]) });
  server.register('sessions', { list: async () => ok([]) });
  server.register('review', { list: async () => ok([]) });
  server.connect(port1);
  return {
    port: port2 as unknown as MessagePort,
    fire(event: OrchEvent) {
      server.emit(event);
    },
    dispose() {
      port1.close();
    },
  };
}

describe('connectCore', () => {
  it('resolves with the port posted as orch:port and detaches its listener', async () => {
    const target = new FakeWindow();
    const port = new MessageChannel().port1;
    const bridge: OrchBridge = {
      connect: async () => {
        target.dispatch('something else', [port]);
        target.dispatch(ORCH_PORT_MESSAGE, []);
        target.dispatch(ORCH_PORT_MESSAGE, [port]);
      },
      app: { version: '0', os: 'linux', demo: false, openExternal: async () => undefined, showItemInFolder: async () => undefined, chooseFolder: async () => null, onUpdateReady: () => () => undefined, onOpenProject: () => () => undefined, cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined }, onReportProblem: () => () => undefined, openNewIssue: async () => undefined, restartEngine: async () => undefined },
    };
    await expect(connectCore({ bridge, target, timeoutMs: 1000 })).resolves.toBe(port);
    expect(target.listenerCount).toBe(0);
    port.close();
  });

  it('rejects with an OrchError when the preload reports the core host is unavailable', async () => {
    const bridge: OrchBridge = {
      connect: async () => {
        throw new Error('The core host is not available.');
      },
      app: { version: '0', os: 'linux', demo: false, openExternal: async () => undefined, showItemInFolder: async () => undefined, chooseFolder: async () => null, onUpdateReady: () => () => undefined, onOpenProject: () => () => undefined, cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined }, onReportProblem: () => () => undefined, openNewIssue: async () => undefined, restartEngine: async () => undefined },
    };
    await expect(connectCore({ bridge, target: new FakeWindow(), timeoutMs: 1000 })).rejects.toEqual({
      code: 'internal',
      message: dataStrings.coreUnavailable.message,
      fix: dataStrings.coreUnavailable.fix,
    });
  });

  it('rejects with the same OrchError when no port arrives in time', async () => {
    const bridge: OrchBridge = {
      connect: async () => undefined,
      app: { version: '0', os: 'linux', demo: false, openExternal: async () => undefined, showItemInFolder: async () => undefined, chooseFolder: async () => null, onUpdateReady: () => () => undefined, onOpenProject: () => () => undefined, cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined }, onReportProblem: () => () => undefined, openNewIssue: async () => undefined, restartEngine: async () => undefined },
    };
    const target = new FakeWindow();
    await expect(connectCore({ bridge, target, timeoutMs: 10 })).rejects.toMatchObject({ code: 'internal' });
    expect(target.listenerCount).toBe(0);
  });
});

describe('startDataLayer through connectDataLayer', () => {
  let layer: DataLayer | undefined;
  let core: ReturnType<typeof startFakeCore> | undefined;

  beforeEach(() => resetStores());
  afterEach(() => {
    layer?.dispose();
    layer = undefined;
    core?.dispose();
    core = undefined;
  });

  async function connect(accounts: Account[]): Promise<void> {
    core = startFakeCore(accounts);
    const port = core.port;
    const target = new FakeWindow();
    const bridge: OrchBridge = {
      connect: async () => target.dispatch(ORCH_PORT_MESSAGE, [port]),
      app: { version: '0', os: 'linux', demo: false, openExternal: async () => undefined, showItemInFolder: async () => undefined, chooseFolder: async () => null, onUpdateReady: () => () => undefined, onOpenProject: () => () => undefined, cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined }, onReportProblem: () => () => undefined, openNewIssue: async () => undefined, restartEngine: async () => undefined },
    };
    const result = await connectDataLayer({ bridge, target, timeoutMs: 1000 });
    if (!result.ok) throw new Error(result.error.message);
    layer = result.value;
    await wait(20);
  }

  it('loads the account list and agent names at start', async () => {
    await connect([sampleAccount()]);
    expect(useAccountsStore.getState().accounts).toEqual([sampleAccount()]);
    expect(useAccountsStore.getState().agents).toEqual([sampleAgent()]);
  });

  it('feeds the stores from live events and derives the status bar', async () => {
    await connect([sampleAccount()]);
    const fire = (event: OrchEvent) => core?.fire(event);

    fire({ type: 'engine.health', state: 'ready' });
    fire({ type: 'run.changed', run: sampleRun({ status: 'running' }) });
    fire({ type: 'run.changed', run: sampleRun({ id: 'r-2' as never, status: 'running' }) });
    fire({ type: 'run.line', line: sampleLine({ seq: 1 }) });
    fire({ type: 'run.line', line: sampleLine({ seq: 1 }) });
    await wait(20);

    expect(useEngineStore.getState().state).toBe('ready');
    expect(useWorkbenchStore.getState().engineHealthy).toBe(true);
    expect(useWorkbenchStore.getState().statusRuns).toBe('2 runs running');
    expect(useRunsStore.getState().lines['r-1']).toHaveLength(1);
  });

  it('shows a limited account in the status bar and clears it when the limit ends', async () => {
    await connect([sampleAccount({ state: 'limited' })]);
    core?.fire({ type: 'quota.limited', accountId: 'claude-team' as never, resetsAt: '2026-10-11T18:00:00.000Z' });
    await wait(20);

    const limited = useWorkbenchStore.getState().limitedAccount;
    expect(limited?.accountId).toBe('claude-team');
    expect(limited?.text.startsWith('Claude Code · Team limited → ')).toBe(true);

    core?.fire({ type: 'account.changed', account: sampleAccount({ state: 'available' }) });
    core?.fire({ type: 'quota.available', accountId: 'claude-team' as never });
    await wait(20);
    expect(useWorkbenchStore.getState().limitedAccount).toBeNull();
  });

  it('stops receiving events after dispose', async () => {
    await connect([]);
    layer?.dispose();
    layer = undefined;
    core?.fire({ type: 'engine.health', state: 'failed' });
    await wait(20);
    expect(useEngineStore.getState().state).toBe('unknown');
  });
});

describe('connectDataLayer failures', () => {
  it('returns an error result instead of throwing when the core host is unavailable', async () => {
    const bridge: OrchBridge = {
      connect: async () => {
        throw new Error('no core');
      },
      app: { version: '0', os: 'linux', demo: false, openExternal: async () => undefined, showItemInFolder: async () => undefined, chooseFolder: async () => null, onUpdateReady: () => () => undefined, onOpenProject: () => () => undefined, cliCommand: { offered: false, install: async () => undefined, uninstall: async () => undefined, machineCheckFinished: async () => undefined }, onReportProblem: () => () => undefined, openNewIssue: async () => undefined, restartEngine: async () => undefined },
    };
    const result = await connectDataLayer({ bridge, target: new FakeWindow(), timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });
});

describe('stores and shell status', () => {
  beforeEach(() => resetStores());

  it('replaces an account object on account.changed and removes it on account.removed', () => {
    applyOrchEvent({ type: 'account.changed', account: sampleAccount({ name: 'Team' }) });
    applyOrchEvent({ type: 'account.changed', account: sampleAccount({ name: 'Renamed' }) });
    expect(useAccountsStore.getState().accounts.map((a) => a.name)).toEqual(['Renamed']);
    applyOrchEvent({ type: 'account.removed', accountId: 'claude-team' as never });
    expect(useAccountsStore.getState().accounts).toEqual([]);
  });

  it('counts signed-out accounts and gives the accounts badge the count', () => {
    applyOrchEvent({ type: 'account.changed', account: sampleAccount({ id: 'claude-a' as never, state: 'signed_out' }) });
    applyOrchEvent({ type: 'account.changed', account: sampleAccount({ id: 'claude-b' as never, state: 'signed_out' }) });
    const stop = startShellStatusSync();
    try {
      expect(useWorkbenchStore.getState().signedOutCount).toBe(2);
      expect(useWorkbenchStore.getState().badges.accounts).toBe(2);
      expect(useWorkbenchStore.getState().statusRuns).toBe('No runs running');
    } finally {
      stop();
    }
  });

  it('counts review worktrees that are ready and sessions that are interrupted', () => {
    const stop = startShellStatusSync();
    try {
      applyOrchEvent({ type: 'review.changed', review: sampleReview({ state: 'ready' }) });
      applyOrchEvent({ type: 'review.changed', review: sampleReview({ worktree: 'orch/other' as never, state: 'merged' }) });
      expect(useWorkbenchStore.getState().badges.review).toBe(1);
      expect(useWorkbenchStore.getState().badges.sessions).toBeUndefined();
    } finally {
      stop();
    }
  });

  it('uses the fallback copy when the reset time is missing or invalid', () => {
    expect(formatResetTime(null)).toBe(dataStrings.statusBar.resetTimeUnknown);
    expect(formatResetTime('not a date')).toBe(dataStrings.statusBar.resetTimeUnknown);
  });

  it('formats valid reset time in 24-hour HH:mm format', () => {
    const d = new Date(2026, 9, 11, 15, 0, 0);
    const expected = `${String(d.getHours()).padStart(2, '0')}:00`;
    expect(formatResetTime(d.toISOString())).toBe(expected);
  });

  it('derives limited account reset time from quota window when quota limit entry is absent (U-01)', () => {
    useAccountsStore.setState({
      accounts: [sampleAccount({ id: 'codex-personal' as never, name: 'Personal', agent: 'codex', state: 'limited' })],
      agents: [sampleAgent({ id: 'codex', displayName: 'Codex' })],
    });
    const d = new Date(2026, 9, 11, 15, 0, 0);
    const resetsAtIso = d.toISOString();
    const expectedTime = `${String(d.getHours()).padStart(2, '0')}:00`;

    useQuotaStore.setState({
      limits: {},
      windows: {
        'codex-5h': {
          accountId: 'codex-personal' as never,
          window: '5h',
          usedPct: 100,
          resetsAt: resetsAtIso,
          source: 'reported',
          seenAt: '2026-10-11T12:45:00Z',
        },
      },
    });

    const status = computeShellStatus();
    expect(status.limitedAccount).not.toBeNull();
    expect(status.limitedAccount?.accountId).toBe('codex-personal');
    expect(status.limitedAccount?.text).toBe(`Codex · Personal limited → ${expectedTime}`);
  });

  it('keeps run status counts in step with run events', () => {
    const stop = startShellStatusSync();
    try {
      applyOrchEvent({ type: 'run.changed', run: sampleRun({ status: 'running' }) });
      expect(useWorkbenchStore.getState().statusRuns).toBe('1 run running');
      applyOrchEvent({ type: 'run.changed', run: sampleRun({ status: 'done' }) });
      expect(useWorkbenchStore.getState().statusRuns).toBe('No runs running');
    } finally {
      stop();
    }
  });
});
