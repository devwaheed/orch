/**
 * Pure view-model helpers for run and job status, agent badges and output times.
 * No React, no services: unit-tested directly.
 */
import type { AgentId, JobStatus, RunStatus } from '@orch/contracts';
import { workStrings } from '../strings.js';

/** Colour family. Always shown with a word too (DESIGN_RULES rule 9). */
export type StatusTone = 'info' | 'ok' | 'warn' | 'neutral';

export interface StatusView {
  readonly label: string;
  readonly tone: StatusTone;
}

export function runStatusView(status: RunStatus): StatusView {
  switch (status) {
    case 'running':
      return { label: workStrings.status.running, tone: 'info' };
    case 'done':
      return { label: workStrings.status.done, tone: 'ok' };
    case 'paused_limit':
      return { label: workStrings.status.pausedLimit, tone: 'warn' };
    case 'queued':
      return { label: workStrings.status.queued, tone: 'neutral' };
    case 'failed':
    case 'stopped':
      return { label: workStrings.unspecifiedStatus(status), tone: 'neutral' };
    default:
      return assertNever(status);
  }
}

export function jobStatusView(status: JobStatus): StatusView {
  switch (status) {
    case 'running':
      return { label: workStrings.status.running, tone: 'info' };
    case 'done':
      return { label: workStrings.status.done, tone: 'ok' };
    case 'scheduled':
    case 'waiting_quota':
    case 'paused':
    case 'failed':
    case 'cancelled':
      return { label: workStrings.unspecifiedStatus(status), tone: 'neutral' };
    default:
      return assertNever(status);
  }
}

export interface AgentBadge {
  /** Two-letter mark shown in the tile */
  readonly mono: string;
  /** Matches an agent badge class in Work.module.css (DESIGN_RULES rule 10: badges only) */
  readonly tone: 'cc' | 'cx' | 'gm' | 'oc' | 'ag';
}

export function agentBadge(agent: AgentId): AgentBadge {
  switch (agent) {
    case 'claude':
      return { mono: 'CC', tone: 'cc' };
    case 'codex':
      return { mono: 'CX', tone: 'cx' };
    case 'gemini':
      return { mono: 'GM', tone: 'gm' };
    case 'opencode':
      return { mono: 'OC', tone: 'oc' };
    case 'agy':
      return { mono: 'AG', tone: 'ag' };
    default:
      return assertNever(agent);
  }
}

/** Local HH:MM:SS for an output line, as the pane shows it. */
export function formatLineTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
