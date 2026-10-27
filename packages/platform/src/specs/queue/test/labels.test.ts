import { describe, expect, it } from 'vitest';
import type { AccountId, AgentId, QueueId, SpecId, SpecRun } from '@orchagents/contracts';
import { formatSpecLabels } from '../common/labels.js';

describe('formatSpecLabels (§12)', () => {
  const makeSpec = (overrides: Partial<SpecRun> = {}): SpecRun => ({
    id: '1' as SpecId,
    queueId: 'q-test' as QueueId,
    position: 1,
    file: 'docs/specs/01-test.md',
    spec: {
      id: '1',
      title: 'Spec 1',
      depends_on: [],
      scope: [],
      done_when: [{ by: 'audit', text: 'Audit 1' }],
      agent: 'auto',
    },
    state: 'queued',
    attempt: null,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
    history: [],
    ...overrides,
  });

  it('formats queued ready and waiting', () => {
    const ready = makeSpec({ state: 'queued' });
    expect(formatSpecLabels(ready)).toEqual({
      pill: 'Queued',
      secondLine: 'Next in line',
    });

    const waiting = makeSpec({
      id: '2' as SpecId,
      state: 'queued',
      spec: {
        id: '2',
        title: 'Spec 2',
        depends_on: ['1'],
        scope: [],
        done_when: [{ by: 'audit', text: 'Audit 2' }],
        agent: 'auto',
      },
    });
    const all = [ready, waiting];
    expect(formatSpecLabels(waiting, all, 'verified')).toEqual({
      pill: 'Waiting for 1',
      secondLine: 'Starts automatically when 1 is verified',
    });
  });

  it('formats blocked', () => {
    const blocked = makeSpec({
      state: 'blocked',
      blockedBy: ['1' as SpecId],
    });
    expect(formatSpecLabels(blocked)).toEqual({
      pill: 'Blocked by 1',
      secondLine: "Won't run until 1 is retried",
    });
  });

  it('formats waiting_quota', () => {
    const wq = makeSpec({
      state: 'waiting_quota',
      implementer: { agent: 'claude' as AgentId, accountId: 'a1' as AccountId },
    });
    expect(formatSpecLabels(wq)).toEqual({
      pill: 'Waiting for an account',
      secondLine: 'Starts when claude has room',
    });
  });

  it('formats running, verifying, auditing', () => {
    const running = makeSpec({ state: 'running', attempt: 1 });
    expect(formatSpecLabels(running)).toEqual({
      pill: 'Running · try 1',
      secondLine: 'Step 1 of 3 · implement',
    });

    const verifying = makeSpec({ state: 'verifying', attempt: 2 });
    expect(formatSpecLabels(verifying)).toEqual({
      pill: 'Running · try 2',
      secondLine: 'Step 2 of 3 · checks',
    });

    const auditing = makeSpec({
      state: 'auditing',
      attempt: 1,
      criteria: [
        {
          index: 0,
          state: 'running',
          summary: null,
          auditor: { agent: 'codex' as AgentId, accountId: 'a2' as AccountId, sameAgent: false },
        },
      ],
    });
    expect(formatSpecLabels(auditing)).toEqual({
      pill: 'Running · try 1',
      secondLine: 'Step 3 of 3 · audit by codex',
    });
  });

  it('formats verified, approved, merged', () => {
    const verified = makeSpec({ state: 'verified' });
    expect(formatSpecLabels(verified)).toEqual({
      pill: 'Verified · your review',
      secondLine: 'Ready in Review',
    });

    const approved = makeSpec({ state: 'approved' });
    expect(formatSpecLabels(approved)).toEqual({
      pill: 'Verified · approved',
      secondLine: 'Merging',
    });

    const merged = makeSpec({
      state: 'merged',
      spec: {
        id: '1',
        title: 'Spec 1',
        depends_on: ['0'],
        scope: [],
        done_when: [{ by: 'audit', text: 'Audit 1' }],
        agent: 'auto',
      },
    });
    expect(formatSpecLabels(merged)).toEqual({
      pill: 'Verified · merged',
      secondLine: 'Depends on 0',
    });
  });

  it('formats needs_you, skipped, cancelled', () => {
    const needsYou = makeSpec({ state: 'needs_you', attempt: 3 });
    expect(formatSpecLabels(needsYou)).toEqual({
      pill: 'Stopped · 3 tries',
      secondLine: 'Queue paused here: needs you',
    });

    const skipped = makeSpec({ state: 'skipped', attempt: 1 });
    expect(formatSpecLabels(skipped)).toEqual({
      pill: 'Skipped · 1 try',
      secondLine: 'Skipped; the queue moved on',
    });

    const cancelled = makeSpec({ state: 'cancelled' });
    expect(formatSpecLabels(cancelled)).toEqual({
      pill: 'Cancelled',
      secondLine: '',
    });
  });
});
