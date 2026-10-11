/**
 * Adapters that connect the quota service's ports to the accounts table and
 * accounts.yaml. The store-backed window, limit and estimate port lives in
 * platform/quota/node. Only the core host uses these.
 *
 * Usage windows, limits and request estimates are all kept in the store
 * (quota_window, quota_limit, quota_estimate), so a restart keeps limited accounts
 * limited. Running jobs are not counted yet, so every account reports zero active
 * runs for now.
 */
import type { AccountId, AccountsFile } from '@orch/contracts';
import type { IStoreService } from '@orch/platform/src/store/common/store.js';
import { accountTable } from '@orch/platform/src/store/common/schema.js';
import type {
  IQuotaAccountSource,
  IQuotaSettingsSource,
  QuotaAccount,
  QuotaSettings,
} from '@orch/platform/src/quota/common/ports.js';
import type { IConfigService } from '@orch/platform/src/config/common/config.js';

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
