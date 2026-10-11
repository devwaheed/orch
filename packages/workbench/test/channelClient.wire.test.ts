/**
 * Wire compatibility: the browser client talks over a MessageChannel to a copy of the core
 * host's channel server (test/support/coreServer.ts). See that file for why it is a copy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok } from '@orch/base';
import type { Account, AccountId, AddAccountRequest, IAccountsService, OrchEvent } from '@orch/contracts';
import { MiniCoreServer } from './support/coreServer.js';
import { BrowserChannelClient, type BrowserPortLike } from '../src/browser/services/channelClient.js';
import { createCoreServices } from '../src/browser/services/channelSchemas.js';
import { sampleAccount, sampleAgent, sampleLine } from './fixtures.js';

type Accounts = IAccountsService & { calls: unknown[][] };

function fakeAccounts(accounts: Account[]): Accounts {
  const calls: unknown[][] = [];
  return {
    calls,
    async listAgents() {
      calls.push(['listAgents']);
      return ok([sampleAgent()]);
    },
    async list() {
      calls.push(['list']);
      return ok(accounts);
    },
    async add(req: AddAccountRequest) {
      calls.push(['add', req]);
      return ok(sampleAccount({ name: req.name }));
    },
    async signIn(id: AccountId) {
      calls.push(['signIn', id]);
      return err({ code: 'account_signed_out', message: 'Sign in to Team first.' });
    },
    async setPrimary() {
      return ok(undefined);
    },
    async setUse() {
      return ok(undefined);
    },
    async setRouting() {
      return ok(undefined);
    },
    async setShareSkills() {
      return ok(undefined);
    },
    async remove() {
      return ok(undefined);
    },
    async getConfig() {
      return ok({ text: 'routing: primary-first\naccounts: {}\n', parsed: { routing: 'primary-first', accounts: {} } });
    },
    async setConfig() {
      return err({ code: 'validation_failed', message: 'Invalid accounts.yaml.' });
    },
  } as unknown as Accounts;
}

interface Harness {
  readonly server: MiniCoreServer;
  readonly client: BrowserChannelClient;
  readonly rawPort: MessagePort;
  readonly accounts: Accounts;
  dispose(): void;
}

function harness(accounts: Accounts): Harness {
  const { port1, port2 } = new MessageChannel();
  const server = new MiniCoreServer();
  server.register('accounts', accounts);
  server.connect(port1);
  const client = new BrowserChannelClient(port2 as unknown as BrowserPortLike);
  return {
    server,
    client,
    rawPort: port1,
    accounts,
    dispose() {
      client.close();
      port1.close();
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('BrowserChannelClient against the platform ChannelServer', () => {
  let h: Harness | undefined;
  afterEach(() => {
    h?.dispose();
    h = undefined;
  });

  it('returns validated replies for a method with no arguments', async () => {
    h = harness(fakeAccounts([sampleAccount()]));
    const services = createCoreServices(h.client);
    const result = await services.accounts.list();
    expect(result).toEqual({ ok: true, value: [sampleAccount()] });
  });

  it('sends arguments and receives a typed result', async () => {
    const accounts = fakeAccounts([]);
    h = harness(accounts);
    const services = createCoreServices(h.client);
    const result = await services.accounts.add({ agent: 'claude', name: 'Work' });
    expect(result.ok).toBe(true);
    expect(accounts.calls).toContainEqual(['add', { agent: 'claude', name: 'Work' }]);
  });

  it('passes service errors through unchanged', async () => {
    h = harness(fakeAccounts([]));
    const services = createCoreServices(h.client);
    const result = await services.accounts.signIn('claude-team' as AccountId);
    expect(result).toEqual({
      ok: false,
      error: { code: 'account_signed_out', message: 'Sign in to Team first.' },
    });
  });

  it('rejects bad arguments on the client before anything is sent', async () => {
    const accounts = fakeAccounts([]);
    h = harness(accounts);
    const services = createCoreServices(h.client);
    const result = await services.accounts.add({ agent: 'not-an-agent', name: 'Work' } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
    expect(accounts.calls.filter((c) => c[0] === 'add')).toHaveLength(0);
  });

  it('reports a reply that breaks the contract as an unreadable reply', async () => {
    const broken = fakeAccounts([]);
    broken.list = async () => ok([{ id: 'nope' }] as unknown as Account[]);
    h = harness(broken);
    const services = createCoreServices(h.client);
    const result = await services.accounts.list();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toBe('orch sent a reply it could not read (accounts.list).');
    }
  });

  it('turns an unknown method into not_found', async () => {
    h = harness(fakeAccounts([]));
    const result = await h.client.call('accounts', 'doesNotExist', [], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('resolves every call even when the connection closes first', async () => {
    const slow = fakeAccounts([]);
    slow.list = () => new Promise(() => undefined);
    h = harness(slow);
    const services = createCoreServices(h.client);
    const pending = services.accounts.list();
    h.client.close();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('The connection to orch was lost.');
  });

  it('subscribes once to events and delivers validated OrchEvents', async () => {
    h = harness(fakeAccounts([]));
    const received: OrchEvent[] = [];
    const unsubscribe = h.client.subscribe((event) => received.push(event));
    await wait(10);
    expect(h.server.subscriberCount).toBe(1);

    const changed = { type: 'account.changed' as const, account: sampleAccount({ state: 'limited' }) };
    h.server.emit(changed);
    h.server.emit({ type: 'run.line', line: sampleLine() });
    await wait(10);
    expect(received).toEqual([changed, { type: 'run.line', line: sampleLine() }]);

    unsubscribe();
    await wait(10);
    expect(h.server.subscriberCount).toBe(0);
  });

  it('drops events that do not match the contract', async () => {
    h = harness(fakeAccounts([]));
    const received: OrchEvent[] = [];
    h.client.subscribe((event) => received.push(event));
    await wait(10);
    h.rawPort.postMessage({ jsonrpc: '2.0', method: 'events.event', params: [{ type: 'run.changed', run: { id: 'x' } }] });
    h.rawPort.postMessage({ jsonrpc: '2.0', method: 'events.event', params: [{ type: 'engine.health', state: 'ready' }] });
    await wait(10);
    expect(received).toEqual([{ type: 'engine.health', state: 'ready' }]);
  });
});
