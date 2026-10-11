/**
 * Limits and request estimates are stored (QTA-02, QTA-03): a restart keeps a
 * limited account limited. Real store, real quota service.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountId, AgentId } from '@orch/contracts';
import { StoreService } from '../../store/node/storeService.js';
import { accountTable } from '../../store/common/schema.js';
import { QuotaService } from './quotaService.js';
import { StoreQuotaStore } from './storeQuotaStore.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const acct = 'claude-a' as AccountId;
const other = 'claude-b' as AccountId;

let root: string;
const stores: StoreService[] = [];

function openStore(): StoreService {
  const s = new StoreService();
  stores.push(s);
  return s;
}

function quotaFor(store: StoreService): QuotaService {
  return new QuotaService({
    store: new StoreQuotaStore(store),
    accounts: {
      listAccounts: () => [
        { id: acct, agent: 'claude', primary: true, use: true, state: 'available' },
        { id: other, agent: 'claude', primary: false, use: true, state: 'available' },
      ],
      activeRuns: () => 0,
    },
    settings: { current: () => ({ routing: 'primary-first', nearLimitPct: 85, maxRunsPerAccount: 3 }) },
    now: () => NOW,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'orch-quota-store-'));
});

afterEach(async () => {
  for (const s of stores) s.close();
  stores.length = 0;
  await rm(root, { recursive: true, force: true });
});

async function openWithAccounts(): Promise<StoreService> {
  const store = openStore();
  await store.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });
  for (const id of [acct, other]) {
    await store.db.insert(accountTable).values({
      id,
      agent: 'claude',
      name: id,
      isPrimary: id === acct,
      useEnabled: true,
      state: 'available',
      profileDir: `/profiles/${id}`,
      skillsShared: true,
      createdAt: '2026-10-10T09:00:00.000Z',
    });
  }
  return store;
}

describe('quota limits and estimates in the store (QTA-02, QTA-03)', () => {
  it('a limit with no reset time survives a restart and keeps the account limited', async () => {
    const first = await openWithAccounts();
    new StoreQuotaStore(first).putLimit({ accountId: acct, resetsAt: null });
    first.close();

    const second = openStore();
    await second.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });
    const port = new StoreQuotaStore(second);
    expect(port.listLimits()).toEqual([{ accountId: acct, resetsAt: null }]);

    const picked = await quotaFor(second).pickAccount('claude' as AgentId);
    expect(picked.ok && picked.value).toEqual({ kind: 'account', accountId: other });
  });

  it('deleting a limit clears it, and the delete is stored too', async () => {
    const store = await openWithAccounts();
    const port = new StoreQuotaStore(store);
    port.putLimit({ accountId: acct, resetsAt: '2026-10-11T16:00:00.000Z' });
    port.deleteLimit(acct);
    expect(port.listLimits()).toEqual([]);
  });

  it('keeps request estimates across a restart (learned limit and count)', async () => {
    const first = await openWithAccounts();
    new StoreQuotaStore(first).putEstimate({
      accountId: acct,
      window: '5h',
      requestsSinceReset: 12,
      learnedLimit: 40,
      resetsAt: '2026-10-11T16:00:00.000Z',
    });
    first.close();

    const second = openStore();
    await second.open({ dbPath: path.join(root, 'orch.db'), backupDir: path.join(root, 'backups') });
    expect(new StoreQuotaStore(second).getEstimate(acct)).toEqual({
      accountId: acct,
      window: '5h',
      requestsSinceReset: 12,
      learnedLimit: 40,
      resetsAt: '2026-10-11T16:00:00.000Z',
    });
    expect(new StoreQuotaStore(second).getEstimate(other)).toBeUndefined();
  });
});
