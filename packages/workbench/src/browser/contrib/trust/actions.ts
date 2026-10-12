/**
 * What the Trust screen does with the core: load the summary for the chosen period,
 * promote an agent (manual only, TRU-02) and switch the gardener. Each action takes the
 * trust port it calls, so tests pass a fake.
 */
import type { AgentId, ITrustService, TrustLevel } from '@orchagents/contracts';
import { useTrustUiStore, type TrustPeriod } from './stores/trustUi.js';

/** The part of the core's trust service this area calls. */
export type TrustPort = Pick<ITrustService, 'summary' | 'promote' | 'setGardener'>;

/** Loads the summary for `period` and stores it. A reply for a period the user has since left is dropped. */
export async function loadSummary(port: TrustPort, period: TrustPeriod = useTrustUiStore.getState().period): Promise<void> {
  const reply = await port.summary(period);
  if (useTrustUiStore.getState().period !== period) return;
  if (reply.ok) {
    useTrustUiStore.getState().setSummary(reply.value);
  } else {
    useTrustUiStore.getState().setLoadError(reply.error);
  }
}

/** Switches the period toggle and loads that period's numbers. */
export async function selectPeriod(port: TrustPort, period: TrustPeriod): Promise<void> {
  useTrustUiStore.getState().setPeriod(period);
  await loadSummary(port, period);
}

/** Promotes one agent one step (TRU-02). The core refuses when the agent does not qualify. */
export async function promoteAgent(port: TrustPort, agent: AgentId, level: TrustLevel): Promise<void> {
  const ui = useTrustUiStore.getState();
  ui.setPromotingAgent(agent);
  ui.setPromoteError(null);
  const reply = await port.promote(agent, level);
  const after = useTrustUiStore.getState();
  after.setPromotingAgent(null);
  if (!reply.ok) after.setPromoteError(reply.error);
  await loadSummary(port);
}

/** Turns the gardener on or off (TRU-04). */
export async function setGardenerOn(port: TrustPort, on: boolean): Promise<void> {
  const reply = await port.setGardener(on);
  if (!reply.ok) useTrustUiStore.getState().setLoadError(reply.error);
  await loadSummary(port);
}
