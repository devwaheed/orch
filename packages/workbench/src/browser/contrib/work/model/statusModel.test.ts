import { describe, expect, it } from 'vitest';
import { AgentId, JobStatus, RunStatus } from '@orchagents/contracts';
import { agentBadge, formatLineTime, jobStatusView, runStatusView } from './statusModel.js';

describe('runStatusView', () => {
  it('uses the design words for the statuses the design covers', () => {
    expect(runStatusView('running')).toEqual({ label: 'Running', tone: 'info' });
    expect(runStatusView('done')).toEqual({ label: 'Done', tone: 'ok' });
    expect(runStatusView('paused_limit')).toEqual({ label: 'Paused · limit', tone: 'warn' });
    expect(runStatusView('queued')).toEqual({ label: 'Queued', tone: 'neutral' });
  });

  it('always gives a word for every run status, so colour is never the only signal', () => {
    for (const status of RunStatus.options) {
      expect(runStatusView(status).label.length).toBeGreaterThan(0);
    }
  });
});

describe('jobStatusView', () => {
  it('gives a word for every job status', () => {
    for (const status of JobStatus.options) {
      expect(jobStatusView(status).label.length).toBeGreaterThan(0);
    }
    expect(jobStatusView('running').label).toBe('Running');
    expect(jobStatusView('done').tone).toBe('ok');
  });
});

describe('agentBadge', () => {
  it('maps each agent to its two-letter mark and badge colour family', () => {
    expect(agentBadge('claude')).toEqual({ mono: 'CC', tone: 'cc' });
    expect(agentBadge('codex')).toEqual({ mono: 'CX', tone: 'cx' });
    expect(agentBadge('gemini')).toEqual({ mono: 'GM', tone: 'gm' });
    expect(agentBadge('opencode')).toEqual({ mono: 'OC', tone: 'oc' });
    expect(agentBadge('agy')).toEqual({ mono: 'AG', tone: 'ag' });
  });

  it('covers every agent id', () => {
    for (const agent of AgentId.options) {
      expect(agentBadge(agent).mono).toHaveLength(2);
    }
  });
});

describe('formatLineTime', () => {
  it('formats local HH:MM:SS with two digits per field', () => {
    const at = new Date(2026, 9, 11, 9, 5, 7).toISOString();
    expect(formatLineTime(at)).toBe('09:05:07');
  });

  it('returns an empty string for a value that is not a date', () => {
    expect(formatLineTime('not a date')).toBe('');
  });
});
