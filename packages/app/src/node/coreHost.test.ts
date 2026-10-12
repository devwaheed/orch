/**
 * Core host start-up (S1-15). Runs the real services over the real local socket,
 * in a temp home folder. No agent and no doctor command ever runs: both process
 * runners are fakes. The engine is disabled (its own tests cover the child process).
 */
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  IAccountsService,
  IDoctorService,
  IEventsService,
  IQuotaService,
  ITrustService,
  OrchEvent,
} from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/channels/common';
import { createSocketClientTransport } from '@orchagents/platform/channels/node';
import type { IAccountProcessRunner } from '@orchagents/platform/src/accounts/common/accounts.js';
import type { ProcessOutcome, ProcessRunner } from '@orchagents/platform/src/doctor/common/doctor.js';
import { CHANNEL_SCHEMAS } from './channelSchemas.js';
import { startCoreHost, type RunningCoreHost } from './coreHostMain.js';
import { runCli } from '../../../cli/src/node/cli.js';

let home = '';
let running: RunningCoreHost[] = [];
const doctorCalls: string[][] = [];

/** Doctor runner that records each command and reports every command as missing. */
const fakeDoctorRunner: ProcessRunner = {
  async run(argv: readonly string[]): Promise<ProcessOutcome> {
    doctorCalls.push([...argv]);
    return { kind: 'not_found' };
  },
};

/** Accounts runner that never starts a process: every agent looks like it cannot start. */
const fakeAccountsRunner: IAccountProcessRunner = {
  async run() {
    return null;
  },
};

async function start(): Promise<RunningCoreHost> {
  const host = await startCoreHost({
    home,
    baseEnv: { PATH: process.env.PATH ?? '' },
    runners: { doctor: fakeDoctorRunner, accounts: fakeAccountsRunner },
    measureFreeBytes: async () => 1,
  });
  running.push(host);
  return host;
}

interface ClientServices {
  accounts: IAccountsService;
  doctor: IDoctorService;
  quota: IQuotaService;
  events: IEventsService;
  trust: ITrustService;
}

async function connect(host: RunningCoreHost, token: string): Promise<{ client: ChannelClient; services: ClientServices }> {
  const transport = await createSocketClientTransport({ socketPath: host.socketPath, token });
  const client = new ChannelClient(transport);
  const services: ClientServices = {
    accounts: client.getService<IAccountsService>('accounts', CHANNEL_SCHEMAS.accounts),
    doctor: client.getService<IDoctorService>('doctor', CHANNEL_SCHEMAS.doctor),
    quota: client.getService<IQuotaService>('quota', CHANNEL_SCHEMAS.quota),
    events: client.getService<IEventsService>('events'),
    trust: client.getService<ITrustService>('trust', CHANNEL_SCHEMAS.trust),
  };
  return { client, services };
}

function readToken(host: RunningCoreHost): string {
  return readFileSync(host.tokenPath, 'utf8').trim();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orch-core-'));
  running = [];
  doctorCalls.length = 0;
});

afterEach(async () => {
  for (const host of running) await host.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe('core host start-up', () => {
  it('starts in a temp home and serves accounts and doctor over the socket', async () => {
    const host = await start();
    const { client, services } = await connect(host, readToken(host));

    const agents = await services.accounts.listAgents();
    expect(agents.ok).toBe(true);
    if (agents.ok) expect(agents.value.map((agent) => agent.id)).toEqual(['claude', 'codex', 'gemini', 'opencode', 'agy']);

    const report = await services.doctor.run();
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.checks.length).toBeGreaterThan(0);
    expect(doctorCalls.length).toBeGreaterThan(0);

    const windows = await services.quota.windows();
    expect(windows).toEqual({ ok: true, value: [] });

    client.dispose();
  });

  it('lets orch accounts connect to a headless host in a temp home', async () => {
    await start();
    const output: string[] = [];
    const code = await runCli(['accounts', '--json'], {
      home,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(0);
    expect(output).toEqual(['[]']);
  });

  it('serves the trust summary for both periods, with every agent at level 1 and no runs yet', async () => {
    const host = await start();
    const { client, services } = await connect(host, readToken(host));

    const trust30 = await services.trust.summary(30);
    expect(trust30.ok).toBe(true);
    if (trust30.ok) {
      expect(trust30.value.periodDays).toBe(30);
      expect(trust30.value.agents.map((agent) => agent.agent)).toEqual(['claude', 'codex', 'gemini', 'opencode', 'agy']);
      for (const agent of trust30.value.agents) {
        expect(agent.level).toBe(1);
        expect(agent.runs).toBe(0);
        expect(agent.eligibleFor).toBeNull();
      }
      expect(trust30.value.gardener.on).toBe(true);
      expect(trust30.value.gardener.nextRunAt).not.toBeNull();
    }

    const trust7 = await services.trust.summary(7);
    expect(trust7.ok && trust7.value.periodDays).toBe(7);

    // TRU-01: an agent with fewer than 20 runs cannot be promoted, and the reply says why.
    const promoted = await services.trust.promote('claude', 2);
    expect(promoted.ok).toBe(false);
    if (!promoted.ok) expect(promoted.error.message).toBe('Not enough runs yet: Claude Code has 0 runs in the last 30 days, and 20 runs are needed.');

    const switched = await services.trust.setGardener(false);
    expect(switched.ok).toBe(true);
    const after = await services.trust.summary(30);
    expect(after.ok && after.value.gardener.on).toBe(false);
    expect(after.ok && after.value.gardener.nextRunAt).toBeNull();

    client.dispose();
  });

  it('keeps every file under the temp home', async () => {
    const host = await start();
    expect(host.socketPath.startsWith(home)).toBe(true);
    expect(host.tokenPath.startsWith(home)).toBe(true);
  });

  it('forwards OrchEvents to a subscriber when an account changes', async () => {
    const host = await start();
    const { client, services } = await connect(host, readToken(host));

    const received = new Promise<OrchEvent>((resolve) => {
      services.events.subscribe((event) => {
        if (event.type === 'account.changed') resolve(event);
      });
    });

    const added = await services.accounts.add({ agent: 'claude', name: 'Work' });
    expect(added.ok).toBe(true);

    const event = await received;
    expect(event.type).toBe('account.changed');
    client.dispose();
  });

  it('refuses a wrong token', async () => {
    const host = await start();
    await expect(
      createSocketClientTransport({ socketPath: host.socketPath, token: 'not-the-token' }),
    ).rejects.toThrow();
  });

  it('writes a new token on each start, so an old token stops working', async () => {
    const first = await start();
    const oldToken = readToken(first);
    await first.dispose();
    running = [];

    const second = await start();
    expect(readToken(second)).not.toBe(oldToken);
    await expect(createSocketClientTransport({ socketPath: second.socketPath, token: oldToken })).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('writes the token file owner-only (0600) on macOS and Linux', async () => {
    const host = await start();
    expect(statSync(host.tokenPath).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('creates the socket owner-only on macOS and Linux', async () => {
    const host = await start();
    expect(statSync(host.socketPath).mode & 0o777).toBe(0o600);
  });
});
