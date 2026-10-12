import { describe, expect, it } from 'vitest';
import type { AccountId, OrchEvent, QuotaObservation, QuotaWindow, Result } from '@orchagents/contracts';
import { QuotaService } from '../node/quotaService.js';
import { FakeAccounts, FakeClock, FakeSettings, FakeEngineClient, CapturingEngineClient, MemoryQuotaStore, account } from './fakes.js';

const A = 'claude-a' as AccountId; // primary
const B = 'claude-b' as AccountId;
const T0 = '2026-10-11T12:00:00.000Z';

function setup(opts: { accounts?: Parameters<typeof account>[0][]; engineRows?: Array<{ session: string; costUsd: number; ok: boolean; verified: boolean | null }> } = {}) {
  const clock = new FakeClock(new Date(T0));
  const store = new MemoryQuotaStore();
  const accounts = new FakeAccounts(
    (opts.accounts ?? [A]).map((id, i) => account(id, { primary: i === 0 })),
  );
  const settings = new FakeSettings();
  const engine = new FakeEngineClient(opts.engineRows ?? []);
  const service = new QuotaService({ store, accounts, settings, engine, now: clock.now });
  const events: OrchEvent[] = [];
  service.onEvent((e) => events.push(e));
  return { clock, store, accounts, settings, service, events };
}

function report(accountId: AccountId, usedPct: number, window: QuotaWindow['window'] = '5h', extra: Partial<QuotaObservation> = {}): QuotaObservation {
  return { accountId, window, usedPct, limited: false, resetsAt: null, source: 'reported', ...extra };
}

async function pick(service: QuotaService, agent: 'claude' = 'claude') {
  const result = await service.pickAccount(agent);
  if (!result.ok) throw new Error('pickAccount failed');
  return result.value;
}

describe('QTA-05 windows reach routing', () => {
  it.each([
    {
      name: 'a stale 90 % window on the primary does not block it (counts as 0 %)',
      seenAt: '2026-10-11T05:00:00.000Z',
      want: { kind: 'account', accountId: A },
    },
    {
      name: 'a fresh 90 % window on the primary moves the run to the backup',
      seenAt: '2026-10-11T11:00:00.000Z',
      want: { kind: 'account', accountId: B },
    },
  ])('$name', async ({ seenAt, want }) => {
    const { store, service } = setup({ accounts: [A, B] });
    store.putWindow({ accountId: A, window: '5h', usedPct: 90, resetsAt: null, source: 'reported', seenAt });
    store.putWindow({ accountId: B, window: '5h', usedPct: 10, resetsAt: null, source: 'reported', seenAt: T0 });
    expect(await pick(service)).toEqual(want);
  });
});

describe('quota.limited and quota.available', () => {
  it('a limit emits quota.limited, makes the account unroutable, and clearing it emits quota.available', async () => {
    const { service, events } = setup({ accounts: [A, B] });
    const reset = '2026-10-11T13:00:00.000Z';

    service.observe({ accountId: A, limited: true, resetsAt: reset, source: 'reported' });
    expect(events).toEqual([{ type: 'quota.limited', accountId: A, resetsAt: reset }]);
    expect(await pick(service)).toEqual({ kind: 'account', accountId: B });

    service.observe({ accountId: A, limited: false, resetsAt: null, source: 'reported' });
    expect(events.at(-1)).toEqual({ type: 'quota.available', accountId: A });
    expect(await pick(service)).toEqual({ kind: 'account', accountId: A });
  });

  it('sweep ends a limit at its reset time and emits quota.available once', () => {
    const { service, clock, events } = setup();
    service.observe({ accountId: A, limited: true, resetsAt: '2026-10-11T12:30:00.000Z', source: 'reported' });

    clock.advance(20 * 60_000);
    service.sweep();
    expect(events.filter((e) => e.type === 'quota.available')).toHaveLength(0);

    clock.advance(10 * 60_000);
    service.sweep();
    service.sweep();
    expect(events.filter((e) => e.type === 'quota.available')).toEqual([{ type: 'quota.available', accountId: A }]);
  });

  it('an expired limit is not routed even before the sweep runs', async () => {
    const { service, clock } = setup();
    service.observe({ accountId: A, limited: true, resetsAt: '2026-10-11T12:30:00.000Z', source: 'reported' });
    clock.advance(31 * 60_000);
    expect(await pick(service)).toEqual({ kind: 'account', accountId: A });
  });

  it('a limit with no reset time stays in force until a later signal clears it', async () => {
    const { service, clock } = setup();
    service.observe({ accountId: A, limited: true, resetsAt: null, source: 'reported' });
    clock.advance(10 * 60 * 60_000);
    expect(await pick(service)).toEqual({ kind: 'wait', agent: 'claude', until: null });
  });

  it('a second limit for an account whose old limit expired ends the old one first, then emits quota.limited', () => {
    const { service, clock, events } = setup();
    service.observe({ accountId: A, limited: true, resetsAt: '2026-10-11T12:30:00.000Z', source: 'reported' });
    clock.advance(40 * 60_000);
    service.observe({ accountId: A, limited: true, resetsAt: '2026-10-11T14:00:00.000Z', source: 'reported' });
    expect(events.map((e) => e.type)).toEqual(['quota.limited', 'quota.available', 'quota.limited']);
  });
});

describe('reported windows', () => {
  it('a reported observation is stored as a window and emits quota.changed', async () => {
    const { service, events } = setup();
    service.observe(report(A, 42, '5h', { resetsAt: '2026-10-11T15:00:00.000Z' }));
    const windows = await service.windows();
    expect(windows).toEqual({
      ok: true,
      value: [
        { accountId: A, window: '5h', usedPct: 42, resetsAt: '2026-10-11T15:00:00.000Z', source: 'reported', seenAt: T0 },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['quota.changed']);
  });

  it('an invalid observation is rejected with an OrchError and changes nothing', async () => {
    const { service, store } = setup();
    const bad = { accountId: A, limited: false, resetsAt: null, source: 'reported', usedPct: 150 } as unknown as QuotaObservation;
    const result = service.observe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('validation_failed');
    expect(store.listWindows()).toEqual([]);
  });
});

describe('estimated windows (QTA-02)', () => {
  it('usage stays unknown until one limit has been seen', async () => {
    const { service } = setup();
    for (let i = 0; i < 12; i++) service.recordRequest(A);
    expect(await service.windows()).toEqual({ ok: true, value: [] });
  });

  it('after a limit, usage is requests since reset over the learned number', async () => {
    const { service, clock } = setup();
    for (let i = 0; i < 40; i++) service.recordRequest(A);
    service.observe({ accountId: A, window: 'daily', limited: true, resetsAt: '2026-10-12T00:00:00.000Z', source: 'estimated' });

    const afterLimit = await service.windows();
    expect(afterLimit).toEqual({
      ok: true,
      value: [{ accountId: A, window: 'daily', usedPct: 100, resetsAt: '2026-10-12T00:00:00.000Z', source: 'estimated', seenAt: T0 }],
    });

    // Reset passes: the counter starts again, and 10 requests of a learned 40 is 25 %.
    clock.set('2026-10-12T00:00:00.000Z');
    for (let i = 0; i < 10; i++) service.recordRequest(A);
    const windows = (await service.windows()) as { ok: true; value: QuotaWindow[] };
    expect(windows.value[0]?.usedPct).toBe(25);
  });

  it('an estimated account at 100 % counts as near its limit, so routing moves to the backup', async () => {
    const { service } = setup({ accounts: [A, B] });
    for (let i = 0; i < 40; i++) service.recordRequest(A);
    service.observe({ accountId: A, window: 'daily', limited: true, resetsAt: null, source: 'estimated' });
    service.observe({ accountId: A, limited: false, resetsAt: null, source: 'estimated' });
    expect(await pick(service)).toEqual({ kind: 'account', accountId: B });
  });
});

describe('spendToday (S3-04)', () => {
  it('sums costUsd for rows where ok is true', async () => {
    const clock = new FakeClock(new Date(T0));
    const store = new MemoryQuotaStore();
    const engine = new FakeEngineClient([
      { session: 's1', costUsd: 2.5, ok: true, verified: null },
      { session: 's2', costUsd: 1.62, ok: true, verified: true },
      { session: 's3', costUsd: 10, ok: false, verified: null },
    ]);
    const service = new QuotaService({ store, accounts: new FakeAccounts([]), settings: new FakeSettings(), engine, now: clock.now });
    const result = await service.spendToday();
    expect(result).toEqual({ ok: true, value: { usd: 4.12, fromApiKeysOnly: false } });
  });

  it('propagates an engine failure', async () => {
    const clock = new FakeClock(new Date(T0));
    const engine = {
      request: (): Promise<Result<unknown>> =>
        Promise.resolve({ ok: false, error: { code: 'engine_unavailable', message: 'down', fix: 'restart' } }),
    };
    const service = new QuotaService({ store: new MemoryQuotaStore(), accounts: new FakeAccounts([]), settings: new FakeSettings(), engine, now: clock.now });
    const result = await service.spendToday();
    expect(result).toEqual({ ok: false, error: { code: 'engine_unavailable', message: 'down', fix: 'restart' } });
  });

  it('sends ledger.query with midnight UTC of today', async () => {
    const clock = new FakeClock(new Date(T0));
    const engine = new CapturingEngineClient([]);
    const service = new QuotaService({ store: new MemoryQuotaStore(), accounts: new FakeAccounts([]), settings: new FakeSettings(), engine, now: clock.now });
    await service.spendToday();
    const req = engine.lastRequest as { op: string; since: string };
    expect(req.op).toBe('ledger.query');
    expect(req.since).toBe('2026-10-11T00:00:00.000Z');
  });
});
