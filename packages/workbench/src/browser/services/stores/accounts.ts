/**
 * Accounts store: the account list in the order the core host sends it (oldest first),
 * and the agent descriptions used for display names. Fed by account.* and config.changed.
 * Each event replaces the whole object it carries.
 */
import { create } from 'zustand';
import type { Account, AccountId, AgentInfo } from '@orch/contracts';

export interface AccountsState {
  readonly accounts: readonly Account[];
  readonly agents: readonly AgentInfo[];
  setAccounts(accounts: readonly Account[]): void;
  upsertAccount(account: Account): void;
  removeAccount(accountId: AccountId): void;
  setAgents(agents: readonly AgentInfo[]): void;
}

export const useAccountsStore = create<AccountsState>()((set) => ({
  accounts: [],
  agents: [],
  setAccounts: (accounts) => set({ accounts: [...accounts] }),
  upsertAccount: (account) =>
    set((s) => {
      const index = s.accounts.findIndex((a) => a.id === account.id);
      if (index === -1) {
        return { accounts: [...s.accounts, account] };
      }
      return { accounts: s.accounts.map((a, i) => (i === index ? account : a)) };
    }),
  removeAccount: (accountId) => set((s) => ({ accounts: s.accounts.filter((a) => a.id !== accountId) })),
  setAgents: (agents) => set({ agents: [...agents] }),
}));
