/**
 * Quota store: the latest usage window per account and window kind, and which
 * accounts are limited until when. Fed by quota.changed, quota.limited and quota.available.
 */
import { create } from 'zustand';
import type { QuotaWindow, SpendToday } from '@orchagents/contracts';

export interface LimitInfo {
  /** ISO time the limit resets, or null when the core host does not know it. */
  readonly resetsAt: string | null;
}

export interface QuotaState {
  /** Keyed by `${accountId}:${window}`. */
  readonly windows: Readonly<Record<string, QuotaWindow>>;
  /** Keyed by account id. Present only while the account is limited. */
  readonly limits: Readonly<Record<string, LimitInfo>>;
  /** Today's spend from the engine ledger, or null until loaded. */
  readonly spendToday: SpendToday | null;
  setWindows(windows: readonly QuotaWindow[]): void;
  upsertWindow(window: QuotaWindow): void;
  setLimited(accountId: string, resetsAt: string | null): void;
  clearLimited(accountId: string): void;
  setSpendToday(spend: SpendToday): void;
}

export function quotaWindowKey(window: Pick<QuotaWindow, 'accountId' | 'window'>): string {
  return `${window.accountId}:${window.window}`;
}

export const useQuotaStore = create<QuotaState>()((set) => ({
  windows: {},
  limits: {},
  spendToday: null,
  setWindows: (windows) =>
    set({ windows: Object.fromEntries(windows.map((w) => [quotaWindowKey(w), w])) }),
  upsertWindow: (window) =>
    set((s) => ({ windows: { ...s.windows, [quotaWindowKey(window)]: window } })),
  setLimited: (accountId, resetsAt) =>
    set((s) => ({ limits: { ...s.limits, [accountId]: { resetsAt } } })),
  clearLimited: (accountId) =>
    set((s) => {
      const limits = { ...s.limits };
      delete limits[accountId];
      return { limits };
    }),
  setSpendToday: (spend) => set({ spendToday: spend }),
}));
