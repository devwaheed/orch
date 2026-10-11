/**
 * Service-backed behaviour of New job: the live CLI line (IJobsService.toCommand),
 * the routing choice shown under Auto (IQuotaService.pickAccount), and Start (IJobsService.start).
 */
import { useEffect, useMemo, useState } from 'react';
import type { Account, AgentId, JobSpec, OrchError, PickAccountResult } from '@orch/contracts';
import { getNewJobServices } from '../services.js';
import {
  AGENT_ORDER,
  cliFailed,
  cliIdle,
  cliLoading,
  cliReady,
  createLatestGate,
  type CliLineState,
} from '../newJobModel.js';

/**
 * The CLI line for the current spec. A reply is shown only if it answers the
 * latest spec (latest-wins), so a slow reply never overwrites a newer line.
 */
export function useCliLine(spec: JobSpec | null): CliLineState {
  const [state, setState] = useState<CliLineState>(cliIdle);
  const gate = useMemo(createLatestGate, []);

  useEffect(() => {
    const ticket = gate.next();
    const services = getNewJobServices();
    if (spec === null || services === null) {
      setState(cliIdle);
      return;
    }
    setState(cliLoading);
    void services.jobs.toCommand(spec).then((result) => {
      if (!gate.isLatest(ticket)) return;
      setState(result.ok ? cliReady(result.value) : cliFailed(result.error.message));
    });
  }, [gate, spec]);

  return state;
}

/** The core's routing decision per agent, for the Auto option. */
export function useAutoPicks(
  accounts: readonly Account[],
): Partial<Record<AgentId, PickAccountResult>> {
  const [picks, setPicks] = useState<Partial<Record<AgentId, PickAccountResult>>>({});

  useEffect(() => {
    const services = getNewJobServices();
    if (services === null) {
      setPicks({});
      return;
    }
    const agents = AGENT_ORDER.filter((agent) => accounts.some((a) => a.agent === agent));
    let cancelled = false;
    void Promise.all(
      agents.map(async (agent) => [agent, await services.quota.pickAccount(agent)] as const),
    ).then((entries) => {
      if (cancelled) return;
      const next: Partial<Record<AgentId, PickAccountResult>> = {};
      for (const [agent, result] of entries) {
        if (result.ok) next[agent] = result.value;
      }
      setPicks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  return picks;
}

export type StartOutcome = { ok: true } | { ok: false; error: OrchError };

/** Calls jobs.start. Returns the error so the view can say what happened. */
export async function startNewJob(spec: JobSpec): Promise<StartOutcome> {
  const services = getNewJobServices();
  if (services === null) {
    return { ok: false, error: { code: 'internal', message: 'The core is not connected.' } };
  }
  const result = await services.jobs.start(spec);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
