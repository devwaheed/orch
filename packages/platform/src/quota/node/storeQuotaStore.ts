/**
 * The quota store port backed by the database: usage windows (quota_window),
 * limits (quota_limit) and request estimates (quota_estimate). A restart keeps
 * limited accounts limited (QTA-02, QTA-03).
 */
import { eq } from 'drizzle-orm';
import type { AccountId, QuotaWindow } from '@orch/contracts';
import type { IStoreService } from '../../store/common/store.js';
import { quotaEstimateTable, quotaLimitTable, quotaWindowTable } from '../../store/common/schema.js';
import type { EstimateRecord, IQuotaStore, LimitRecord } from '../common/ports.js';

/** Store-backed windows, limits and estimates. */
export class StoreQuotaStore implements IQuotaStore {
  constructor(private readonly store: IStoreService) {}

  listWindows(): QuotaWindow[] {
    return this.store.db
      .select()
      .from(quotaWindowTable)
      .all()
      .map((row) => ({
        accountId: row.accountId as AccountId,
        window: row.kind,
        usedPct: row.usedPct,
        resetsAt: row.resetsAt,
        source: row.source as QuotaWindow['source'],
        seenAt: row.seenAt,
      }));
  }

  putWindow(window: QuotaWindow): void {
    const row = {
      accountId: window.accountId,
      kind: window.window,
      usedPct: window.usedPct,
      resetsAt: window.resetsAt,
      source: window.source,
      seenAt: window.seenAt,
    };
    this.store.db
      .insert(quotaWindowTable)
      .values(row)
      .onConflictDoUpdate({ target: [quotaWindowTable.accountId, quotaWindowTable.kind], set: row })
      .run();
  }

  listLimits(): LimitRecord[] {
    return this.store.db
      .select()
      .from(quotaLimitTable)
      .all()
      .map((row) => ({ accountId: row.accountId as AccountId, resetsAt: row.resetsAt }));
  }

  putLimit(limit: LimitRecord): void {
    const row = { accountId: limit.accountId, resetsAt: limit.resetsAt };
    this.store.db
      .insert(quotaLimitTable)
      .values(row)
      .onConflictDoUpdate({ target: quotaLimitTable.accountId, set: row })
      .run();
  }

  deleteLimit(accountId: AccountId): void {
    this.store.db.delete(quotaLimitTable).where(eq(quotaLimitTable.accountId, accountId)).run();
  }

  getEstimate(accountId: AccountId): EstimateRecord | undefined {
    const [row] = this.store.db.select().from(quotaEstimateTable).where(eq(quotaEstimateTable.accountId, accountId)).all();
    if (!row) return undefined;
    return {
      accountId: row.accountId as AccountId,
      window: row.window,
      requestsSinceReset: row.requestsSinceReset,
      learnedLimit: row.learnedLimit,
      resetsAt: row.resetsAt,
    };
  }

  putEstimate(estimate: EstimateRecord): void {
    const row = {
      accountId: estimate.accountId,
      window: estimate.window,
      requestsSinceReset: estimate.requestsSinceReset,
      learnedLimit: estimate.learnedLimit,
      resetsAt: estimate.resetsAt,
    };
    this.store.db
      .insert(quotaEstimateTable)
      .values(row)
      .onConflictDoUpdate({ target: quotaEstimateTable.accountId, set: row })
      .run();
  }
}
