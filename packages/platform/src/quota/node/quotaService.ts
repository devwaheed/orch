/**
 * The quota service: turns adapter observations into usage windows and limits,
 * picks an account for a run (ACC-05..07, QTA-05) and emits quota.limited /
 * quota.available. Dependencies come in through the constructor.
 */
import { Emitter, type Event } from '@orchagents/base';
import {
  QuotaObservation,
  type AccountId,
  type AgentId,
  type IQuotaService,
  type OrchEvent,
  type PickAccountResult,
  type QuotaWindow,
  type Result,
  type SpendToday,
} from '@orchagents/contracts';
import { routeAccount, type RouteCandidate } from '../common/route.js';
import type {
  EstimateRecord,
  IQuotaAccountSource,
  IQuotaSettingsSource,
  IQuotaStore,
  LimitRecord,
} from '../common/ports.js';
import type { EngineClient } from '../../engine/common/engineClient.js';
import { accountUsedPct, estimatedUsedPct } from '../common/usage.js';

export interface QuotaServiceDeps {
  store: IQuotaStore;
  accounts: IQuotaAccountSource;
  settings: IQuotaSettingsSource;
  engine: Pick<EngineClient, 'request'>;
  now: () => Date;
}

export class QuotaService implements Pick<IQuotaService, 'windows' | 'pickAccount' | 'spendToday'> {
  private readonly emitter = new Emitter<OrchEvent>();
  /** Live events: quota.changed, quota.limited, quota.available. */
  readonly onEvent: Event<OrchEvent> = this.emitter.event;

  constructor(private readonly deps: QuotaServiceDeps) {}

  async windows(): Promise<Result<QuotaWindow[]>> {
    return { ok: true, value: this.deps.store.listWindows() };
  }

  async spendToday(): Promise<Result<SpendToday>> {
    const since = startOfDayIso(this.deps.now());
    const result = await this.deps.engine.request({ op: 'ledger.query', since });
    if (!result.ok) return result as Result<SpendToday>;
    const value = result.value as { rows?: Array<{ costUsd?: number; ok?: boolean }> } | undefined;
    const rows = value?.rows ?? [];
    let usd = 0;
    for (const row of rows) {
      if (row.ok === true && typeof row.costUsd === 'number') {
        usd += row.costUsd;
      }
    }
    return { ok: true, value: { usd, fromApiKeysOnly: false } };
  }

  async pickAccount(agent: AgentId): Promise<Result<PickAccountResult>> {
    const now = this.deps.now();
    const settings = this.deps.settings.current();
    const windows = this.deps.store.listWindows();
    const limits = new Map(this.deps.store.listLimits().map((l) => [l.accountId, l] as const));

    const candidates: RouteCandidate[] = this.deps.accounts
      .listAccounts()
      .filter((a) => a.agent === agent)
      .map((a) => {
        const limit = limits.get(a.id);
        return {
          id: a.id,
          primary: a.primary,
          use: a.use,
          signedOut: a.state === 'signed_out',
          usedPct: accountUsedPct(
            windows.filter((w) => w.accountId === a.id),
            now,
          ),
          limited: limit !== undefined && isLimitInForce(limit, now),
          resetsAt: limit?.resetsAt ?? null,
          activeRuns: this.deps.accounts.activeRuns(a.id),
        };
      });

    const result = routeAccount({
      agent,
      rule: settings.routing,
      nearLimitPct: settings.nearLimitPct,
      maxRunsPerAccount: settings.maxRunsPerAccount,
      candidates,
    });
    return { ok: true, value: result };
  }

  /** Ingests one signal from an adapter. Validated here, the same schema the contract uses. */
  observe(observation: QuotaObservation): Result<void> {
    const parsed = QuotaObservation.safeParse(observation);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'validation_failed',
          message: 'orch could not read the usage signal from the agent.',
          fix: 'Check the agent version with orch doctor, then try the run again.',
        },
      };
    }
    const o = parsed.data;
    const now = this.deps.now();
    const nowIso = now.toISOString();

    if (o.source === 'reported') {
      if (o.window !== undefined && o.usedPct !== undefined) {
        this.storeWindow({ accountId: o.accountId, window: o.window, usedPct: o.usedPct, resetsAt: o.resetsAt, source: 'reported', seenAt: nowIso });
      }
    } else if (o.limited) {
      this.learnFromLimit(o.accountId, o.window ?? null, o.resetsAt, nowIso);
    } else if (o.window !== undefined && o.usedPct !== undefined) {
      this.storeWindow({ accountId: o.accountId, window: o.window, usedPct: o.usedPct, resetsAt: o.resetsAt, source: 'estimated', seenAt: nowIso });
    }

    if (o.limited) {
      const previous = this.findLimit(o.accountId);
      if (previous !== undefined && !isLimitInForce(previous, now)) {
        // An expired limit that the sweep has not cleared yet ends first, so the cycle emits both events.
        this.clearLimit(o.accountId);
      }
      this.deps.store.putLimit({ accountId: o.accountId, resetsAt: o.resetsAt });
      this.emitter.fire({ type: 'quota.limited', accountId: o.accountId, resetsAt: o.resetsAt });
    } else if (this.findLimit(o.accountId) !== undefined) {
      this.clearLimit(o.accountId);
    }
    return { ok: true, value: undefined };
  }

  /** Counts one request for an estimated account (QTA-02). */
  recordRequest(accountId: AccountId): Result<void> {
    const now = this.deps.now();
    const estimate = this.findEstimate(accountId);
    if (estimate.resetsAt !== null && now.getTime() >= Date.parse(estimate.resetsAt)) {
      estimate.requestsSinceReset = 0;
      estimate.resetsAt = null;
    }
    estimate.requestsSinceReset += 1;
    this.deps.store.putEstimate(estimate);
    this.refreshEstimatedWindow(estimate, now.toISOString());
    return { ok: true, value: undefined };
  }

  /** Ends limits whose reset time has passed and emits quota.available for each. */
  sweep(): void {
    const now = this.deps.now();
    for (const limit of this.deps.store.listLimits()) {
      if (!isLimitInForce(limit, now)) {
        this.clearLimit(limit.accountId);
      }
    }
  }

  private learnFromLimit(accountId: AccountId, window: QuotaWindow['window'] | null, resetsAt: string | null, nowIso: string): void {
    const estimate = this.findEstimate(accountId);
    if (estimate.requestsSinceReset > 0) {
      estimate.learnedLimit = estimate.requestsSinceReset;
    }
    estimate.window = window ?? estimate.window;
    estimate.resetsAt = resetsAt;
    this.deps.store.putEstimate(estimate);
    this.refreshEstimatedWindow(estimate, nowIso);
  }

  private refreshEstimatedWindow(estimate: EstimateRecord, nowIso: string): void {
    if (estimate.window === null) {
      return;
    }
    const usedPct = estimatedUsedPct(estimate.requestsSinceReset, estimate.learnedLimit);
    if (usedPct === null) {
      return;
    }
    this.storeWindow({ accountId: estimate.accountId, window: estimate.window, usedPct, resetsAt: estimate.resetsAt, source: 'estimated', seenAt: nowIso });
  }

  private storeWindow(window: QuotaWindow): void {
    this.deps.store.putWindow(window);
    this.emitter.fire({ type: 'quota.changed', window });
  }

  private clearLimit(accountId: AccountId): void {
    this.deps.store.deleteLimit(accountId);
    this.emitter.fire({ type: 'quota.available', accountId });
  }

  private findLimit(accountId: AccountId): LimitRecord | undefined {
    return this.deps.store.listLimits().find((l) => l.accountId === accountId);
  }

  private findEstimate(accountId: AccountId): EstimateRecord {
    return (
      this.deps.store.getEstimate(accountId) ?? {
        accountId,
        window: null,
        requestsSinceReset: 0,
        learnedLimit: null,
        resetsAt: null,
      }
    );
  }
}

/** A limit with no reset time stays in force until a later signal clears it. */
function isLimitInForce(limit: LimitRecord, now: Date): boolean {
  return limit.resetsAt === null || now.getTime() < Date.parse(limit.resetsAt);
}

/** ISO datetime for midnight UTC of the given date (start of today). */
function startOfDayIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
