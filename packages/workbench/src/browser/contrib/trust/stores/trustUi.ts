/**
 * Area-local state for the Trust screen: the period toggle, the last summary the core
 * sent, and the outcome of the last promote or gardener switch. The core has no trust
 * events, so the summary is loaded (see ../actions.ts) rather than fed by OrchEvents.
 */
import { create } from 'zustand';
import type { AgentId, OrchError, TrustSummary } from '@orchagents/contracts';

export type TrustPeriod = 7 | 30;

export interface TrustUiState {
  readonly period: TrustPeriod;
  readonly summary: TrustSummary | null;
  readonly loadError: OrchError | null;
  readonly promoteError: OrchError | null;
  readonly promotingAgent: AgentId | null;
  setPeriod(period: TrustPeriod): void;
  setSummary(summary: TrustSummary): void;
  setLoadError(error: OrchError | null): void;
  setPromoteError(error: OrchError | null): void;
  setPromotingAgent(agent: AgentId | null): void;
}

/** The default period is 30 days, the one the agents' tracks always use (TRU-01). */
export const useTrustUiStore = create<TrustUiState>()((set) => ({
  period: 30,
  summary: null,
  loadError: null,
  promoteError: null,
  promotingAgent: null,
  setPeriod: (period) => set({ period }),
  setSummary: (summary) => set({ summary, loadError: null }),
  setLoadError: (loadError) => set({ loadError }),
  setPromoteError: (promoteError) => set({ promoteError }),
  setPromotingAgent: (promotingAgent) => set({ promotingAgent }),
}));
