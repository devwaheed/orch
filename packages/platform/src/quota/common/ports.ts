/**
 * Small interfaces the quota service depends on. The real store and the
 * accounts service implement them later; tests use in-memory fakes.
 */
import type {
  AccountId,
  Account,
  QuotaWindow,
  QuotaWindowKind,
  RoutingRule,
} from '@orchagents/contracts';

export interface LimitRecord {
  accountId: AccountId;
  /** null = the agent did not say when the limit resets. */
  resetsAt: string | null;
}

/** Requests counted for an estimated window (QTA-02). */
export interface EstimateRecord {
  accountId: AccountId;
  window: QuotaWindowKind | null;
  requestsSinceReset: number;
  /** Requests at the last limit seen; null until one limit has been seen. */
  learnedLimit: number | null;
  resetsAt: string | null;
}

export interface IQuotaStore {
  listWindows(): QuotaWindow[];
  putWindow(window: QuotaWindow): void;
  listLimits(): LimitRecord[];
  putLimit(limit: LimitRecord): void;
  deleteLimit(accountId: AccountId): void;
  getEstimate(accountId: AccountId): EstimateRecord | undefined;
  putEstimate(estimate: EstimateRecord): void;
}

/** Accounts as the quota service needs them. Accounts come in the order they were added, oldest first. */
export type QuotaAccount = Pick<Account, 'id' | 'agent' | 'primary' | 'use' | 'state'>;

export interface IQuotaAccountSource {
  listAccounts(): QuotaAccount[];
  activeRuns(accountId: AccountId): number;
}

export interface QuotaSettings {
  routing: RoutingRule;
  /** Percent, 1–100. */
  nearLimitPct: number;
  maxRunsPerAccount: number;
}

export interface IQuotaSettingsSource {
  current(): QuotaSettings;
}

