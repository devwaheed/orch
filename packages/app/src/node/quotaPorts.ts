/**
 * Adapters that connect the quota service's ports to the store, the accounts
 * table and accounts.yaml. Only the core host uses these.
 *
 * Usage windows are kept in the store (quota_window). Limits and request
 * estimates have no table yet, so they live in memory and start empty on each
 * launch. Running jobs are not known until the runs service exists (S1-13), so
 * every account reports zero active runs for now.
 */
import type { AccountId, AccountsFile, QuotaWindow } from '@orch/contracts';
import type { IStoreService } from '@orch/platform/src/store/common/store.js';
import { accountTable, quotaWindowTable } from '@orch/platform/src/store/common/schema.js';
import type {
  EstimateRecord,
  IQuotaAccountSource,
  IQuotaSettingsSource,
  IQuotaStore,
  LimitRecord,
  QuotaAccount,
  QuotaSettings,
} from '@orch/platform/src/quota/common/ports.js';
import type { IConfigService } from '@orch/platform/src/config/common/config.js';

/** Store-backed window table plus in-memory limits and estimates. */
export class StoreQuotaStore implements IQuotaStore {
  private readonly limits = new Map<AccountId, LimitRecord>();
  private readonly estimates = new Map<AccountId, EstimateRecord>();

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
    return [...this.limits.values()];
  }

  putLimit(limit: LimitRecord): void {
    this.limits.set(limit.accountId, limit);
  }

  deleteLimit(accountId: AccountId): void {
    this.limits.delete(accountId);
  }

  getEstimate(accountId: AccountId): EstimateRecord | undefined {
    return this.estimates.get(accountId);
  }

  putEstimate(estimate: EstimateRecord): void {
    this.estimates.set(estimate.accountId, estimate);
  }
}

/** Accounts in the order they were added (oldest first), read from the store. */
export class StoreQuotaAccounts implements IQuotaAccountSource {
  constructor(private readonly store: IStoreService) {}

  listAccounts(): QuotaAccount[] {
    return this.store.db
      .select()
      .from(accountTable)
      .all()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map((row) => ({
        id: row.id as AccountId,
        agent: row.agent,
        primary: row.isPrimary,
        use: row.useEnabled,
        state: row.state,
      }));
  }

  /** TODO(S1-13): count live runs per account once the runs service exists. */
  activeRuns(): number {
    return 0;
  }
}

/** Routing and limits from accounts.yaml. Defaults apply until the file loads. */
export class ConfigQuotaSettings implements IQuotaSettingsSource {
  constructor(private readonly config: IConfigService) {}

  current(): QuotaSettings {
    const file: AccountsFile | undefined = this.config.current()?.parsed;
    return {
      routing: file?.routing ?? 'primary-first',
      nearLimitPct: percentValue(file?.limits.near_limit_at ?? '85%'),
      maxRunsPerAccount: file?.limits.max_runs_per_account ?? 3,
    };
  }
}

/** `85` or `'85%'` to 85. */
function percentValue(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}
