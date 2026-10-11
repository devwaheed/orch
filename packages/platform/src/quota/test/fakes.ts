/** In-memory fakes for the quota service's ports. */
import type { Account, AccountId, QuotaWindow } from '@orch/contracts';
import type {
  EstimateRecord,
  IQuotaAccountSource,
  IQuotaSettingsSource,
  IQuotaStore,
  LimitRecord,
  QuotaAccount,
  QuotaSettings,
} from '../common/ports.js';

export class MemoryQuotaStore implements IQuotaStore {
  private windows = new Map<string, QuotaWindow>();
  private limits = new Map<AccountId, LimitRecord>();
  private estimates = new Map<AccountId, EstimateRecord>();

  listWindows(): QuotaWindow[] {
    return [...this.windows.values()];
  }
  putWindow(window: QuotaWindow): void {
    this.windows.set(`${window.accountId}|${window.window}`, window);
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
    this.estimates.set(estimate.accountId, { ...estimate });
  }
}

export class FakeAccounts implements IQuotaAccountSource {
  private runs = new Map<AccountId, number>();
  constructor(private readonly accounts: QuotaAccount[]) {}

  listAccounts(): QuotaAccount[] {
    return this.accounts;
  }
  activeRuns(accountId: AccountId): number {
    return this.runs.get(accountId) ?? 0;
  }
  setActiveRuns(accountId: AccountId, count: number): void {
    this.runs.set(accountId, count);
  }
}

export class FakeSettings implements IQuotaSettingsSource {
  constructor(private settings: QuotaSettings = { routing: 'primary-first', nearLimitPct: 85, maxRunsPerAccount: 3 }) {}
  current(): QuotaSettings {
    return this.settings;
  }
  set(patch: Partial<QuotaSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }
}

/** A clock the test moves by hand. */
export class FakeClock {
  constructor(private at: Date) {}
  now = (): Date => new Date(this.at.getTime());
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms);
  }
  set(iso: string): void {
    this.at = new Date(iso);
  }
}

/** Builds an account in the shape the quota service reads. */
export function account(
  id: AccountId,
  opts: { primary?: boolean; use?: boolean; signedOut?: boolean } = {},
): QuotaAccount {
  return {
    id,
    agent: id.split('-')[0] as Account['agent'],
    primary: opts.primary ?? false,
    use: opts.use ?? true,
    state: opts.signedOut ? 'signed_out' : 'available',
  };
}
